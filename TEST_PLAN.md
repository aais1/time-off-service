# Test Plan — Time-Off Microservice

Last updated: 2026-04-24

Purpose
-------
This document enumerates the tests that validate correctness, resilience, and regression safety for the Time-Off Microservice. The plan covers unit tests, integration tests, and end-to-end scenarios. It also describes the mock HCM behavior used by tests and provides commands to run and measure coverage.

Summary of current code and tests
---------------------------------
- The repository contains a NestJS app (`apps/time-off-service`) with domain services, repositories (TypeORM + SQLite), and an Express HCM mock (`apps/hcm-express/server.js`).
- There are unit tests under `apps/time-off-service/test` and `src/**/__tests__` already covering core domain and retry service logic. These run via `npm test` in the app folder.

Testing strategy
----------------
- Unit tests (fast, single-process):
  - Test domain entities (state transitions) and small pure functions.
  - Mock repositories/adapters for services to isolate logic.

- Integration tests (module-level using Nest TestModule & in-memory SQLite where possible):
  - Boot the Nest TestModule with real providers and an in-memory SQLite (or file-based SQLite) DB.
  - Use the Express HCM mock (programmatically started by the test or run in a separate process) for realistic HTTP interactions.

- End-to-end tests (optional manual/e2e):
  - Spin up the HCM mock and the running Nest app and exercise HTTP endpoints (supertest or curl) to verify end-to-end flows including batch replace and retry behaviors.

Mock HCM behavior (current implementation)
-----------------------------------------
The Express mock provides:

- GET /realtime/validate?employeeId&locationId&days
  - Returns 200 { ok: true } or { ok: false, error: 'insufficient_balance' }.
- POST /realtime/book
  - Body: { employeeId, locationId, days, requestId? }
  - Returns 200 { ok: true, hcmReferenceId } on success.
  - Returns 422 { ok: false, error: 'insufficient_balance' } on insufficient balance.
- POST /batch/replace-balances
  - Body: { balances: [ { employeeId, locationId, balance } ] }
  - Replaces internal map.
- POST /balances — set a single balance (useful in tests)
- GET /balances/:employeeId/:locationId — read current balance

Note: The mock stores balances in-memory. Tests should set up required balances before exercising booking endpoints.

Test cases (detailed)
---------------------

1) Unit tests — Domain (TimeOffRequest)
  - request starts in PENDING when created. (happy path)
  - approve(): moves PENDING -> APPROVED and sets processedAt.
  - reject(): moves PENDING -> REJECTED and stores lastError.
  - markRetrying(): moves to RETRYING and increments retryCount appropriately.
  - incrementRetry: increases retryCount and respects configured MAX_RETRIES.

Files to create/verify:
  - `apps/time-off-service/test/request-time-off.service.spec.ts` (exists)

2) Unit tests — RequestTimeOffService (service-level with mocks)
  - Creating a new request with sufficient local balance: service saves PENDING, calls HCM book -> APPROVED and deducts balance locally.
  - Creating a new request with insufficient local balance: service returns REJECTED without calling HCM.
  - Idempotency: two POSTs with the same Idempotency-Key return the same request (no duplicate persisted record).
  - Transaction rollback: if HCM call succeeds but local DB update fails (simulate by throwing in repo.save), service should log and either clean up or mark failed — test expected behavior.

Mocks and fixtures:
  - Mock RequestRepository and BalanceRepository where necessary to isolate error paths.

3) Integration tests — RetryRequestsService (with HCM mock)
  - Scenario A (transient HCM failure):
    - Prepare a request that initially failed with a transient error (set status RETRYING, retryCount=0).
    - Configure the HCM mock to respond with 500 for the first call and 200 subsequently.
    - Run the retry worker once (or trigger its retry method) and assert that the request becomes APPROVED after subsequent attempts; assert retryCount incremented and backoff gating used.

  - Scenario B (permanent business rejection):
    - HCM mock returns 422 -> service should mark REJECTED and not retry.

  - Scenario C (exhaust retries):
    - Force HCM to keep failing; after MAX_RETRIES the request should be marked FAILED and not retried further.

Implementation notes for integration tests:
  - Programmatically start the Express HCM mock inside the test (require server module and call app.listen on ephemeral port) or run it in a child process. Ensure ports and URLs are isolated via env vars.
  - Use Jest timers or mocking to advance time for backoff tests (jest.useFakeTimers + advanceTimersByTime), or configure RETRY_BASE_MS small (e.g., 50ms) during tests to avoid long waits.

4) Integration tests — Batch replace & reconciliation
  - Push a batch that increases balance for employee A.
  - Ensure the local Balance entry is replaced and `lastSyncedAt` updated.
  - If there is an in-flight RETRYING request for the same employee/location that would now be invalid (balance insufficient), the service should re-evaluate it. Tests should assert expected behavior (either continue retrying, mark REJECTED, or mark for manual review depending on policy; default: re-validate with HCM and mark accordingly).

5) End-to-end manual smoke tests (for CI or local dev)
  - Start HCM mock and Nest app.
  - Set a balance via POST /balances.
  - POST /api/v1/time-off/requests with an Idempotency-Key and assert 201 and APPROVED status when enough balance.
  - POST /batch/replace-balances and ensure subsequent queries return new balances.

Coverage targets and metrics
--------------------------
- Goal: 80%+ overall coverage. Critical modules (domain, services that affect balances and retries) should aim for 90%+ coverage.
- Required coverage artifacts:
  - Jest coverage report (HTML and text) in `coverage/` produced via `npm test -- --coverage` or `npm run test:cov`.

Test harness commands
---------------------
- Run unit + integration tests (app folder):
```bash
cd apps/time-off-service
npm test
```

- Run tests with coverage:
```bash
cd apps/time-off-service
npm run test:cov
```

- Programmatically start the HCM mock for integration tests (pattern):

```js
// tests/setup/hcm-mock.js
const server = require('../../../../apps/hcm-express/server');
// The mock should export a function to start/stop or return the express app.
```

CI recommendations
------------------
- Use GitHub Actions with matrix steps for Node 18.
- Steps:
  - Checkout
  - Install deps
  - Run `npm test --prefix apps/time-off-service` and collect coverage
  - Optionally spin up hcm-express for integration job

Open considerations & future work
--------------------------------
- Move retry scheduling to a durable queue (BullMQ + Redis) for production.
- Consider adding a test-only mode to HCM mock that can simulate transient failures or delays (useful for retry/backoff verification); current mock is simple but easily extendable.

Mapping tests to repo files (suggested)
-------------------------------------
- Domain tests: `apps/time-off-service/test/request-time-off.service.spec.ts` and `apps/time-off-service/src/modules/time-off/services/__tests__/*`
- Retry tests: `apps/time-off-service/test/retry-requests.service.spec.ts` and `.../__tests__/retry-requests.service.spec.ts`
- Integration tests (to add): `apps/time-off-service/test/integration/*` (spin up HCM mock and Nest TestModule)

Acceptance criteria
-------------------
1. TRD document exists (DELIVERABLE: `TRD.md`) — done.
2. Test plan document exists (DELIVERABLE: `TEST_PLAN.md`) — created by this commit.
3. Unit tests exist and pass locally (run `npm test`) — there are existing unit tests that pass.
4. Integration tests to simulate transient failures and backoff should be added next (tests outlined in this plan).
5. Coverage report shows >= 80% overall (or per-team agreed thresholds).

How I validated current state
----------------------------
- Ran the app-level tests earlier and observed test suites passing. The HCM mock is present in `apps/hcm-express` and supports balance manipulation.

Next actions I can take (pick one)
---------------------------------
1. Implement integration tests (supertest + programmatic HCM mock start) that cover the retry/backoff scenarios described above.
2. Extend the HCM mock to support transient error simulation (fail N times then succeed) and add tests that exercise backoff with jest timers.
3. Add CI configuration (GitHub Actions) to run tests and collect coverage automatically.

If you want me to proceed with one of the next actions, pick the option and I will implement it and update the todo list accordingly.
