

# Technical Requirements Document (TRD)

Project: Time-Off Microservice
Last updated: 2026-04-26 (expanded)

Purpose
-------
This document captures the technical requirements, architecture decisions, APIs, data models, operational considerations, testing strategy and acceptance criteria for the Time-Off microservice. It is intended to be a single source of truth for engineers, reviewers, and operators deciding how the service should behave and be maintained.

Audience
--------
- Engineering (backend, SRE, QA)
- Product owners and architects validating trade-offs
- Future maintainers who need reasoning and operational runbook items

Scope and non-goals
-------------------
Scope:
- Submit and manage employee time-off requests.
- Maintain per-employee-per-location balances and keep them in sync with an HCM source via realtime booking and batch imports.
- Provide idempotency, retries, and basic observability.

Non-goals:
- Multi-tenant orchestration across multiple tenants in a single instance.
- Full-fledged enterprise features (advanced authorization, audit storage beyond simple logs, or multi-region HA). Those are noted as future work.

High-level goals and acceptance criteria
--------------------------------------
Goals (what success looks like):
1. Correctness: requests never double-deduct local balances; business rejections are handled deterministically. Acceptance: unit/integration tests demonstrate no double-deduct scenarios under normal concurrency.
2. Resilience: transient HCM failures are retried with exponential backoff; permanent rejections do not retry. Acceptance: retry process moves requests from RETRYING→APPROVED/REJECTED/FAILED as appropriate.
3. Observability and debuggability: logs and metrics must make it straightforward to reason about request state and HCM interactions. Acceptance: log entries include requestId, idempotencyKey, employeeId, locationId, and HCM status.
4. Developer ergonomics: local development with an HCM mock and a single command flow. Acceptance: README + scripts allow spin-up and smoke tests.

Key design decisions and rationale
---------------------------------
1) Local-first transactional deduction
  - Decision: Deduct the local balance inside a DB transaction (QueryRunner), then perform HCM booking outside transaction.
  - Rationale: Ensures local consistency and allows handling idempotency and retries; HCM calls are external and may fail — so we mark RETRYING and reconcile later. We avoid long DB transactions during network calls.

2) Idempotency via header + repository check
  - Decision: Require `Idempotency-Key` header for POST /requests. Service checks repository for an existing request and returns it if present.
  - Rationale: Prevent duplicate operations on retries from clients and protect HCM from duplicate booking attempts.

3) Optimistic locking on Balance
  - Decision: Use a VersionColumn on Balance ORM entity for optimistic locking and retry on conflict a small fixed number (3 attempts).
  - Rationale: Balances are high-contention; optimistic locking avoids DB-level lock contention while providing consistency.

4) Three-way categorization of HCM responses
  - Business rejection (400/422): no retry, mark REJECTED.
  - Success (200/201): APPROVED, persist hcmReferenceId.
  - Transient (5xx/network/timeouts): mark RETRYING and schedule background retry.
  - Rationale: Clear separation makes retry policy safe and simple to reason about.

5) Startup seeding
  - Decision: On module init, attempt a batch fetch via `fetchAllBalances()`. If empty, fallback to per-employee `fetchBalance()` based on `HCM_BOOTSTRAP_EMPLOYEES` env var.
  - Rationale: The deployed HCM mock may not support batch GET; fallback ensures we can seed developer/test DBs with minimal setup.

6) HCM adapter base URL from env
  - Decision: Adapter reads `process.env.HCM_URL` and falls back to `http://localhost:4000`.
  - Rationale: Flexible between local dev and the deployed mock.

Data model (detailed)
---------------------
Entities (TypeORM oriented):

Balance (table: time_off_balances)
- employeeId: string (PK composite)
- locationId: string (PK composite)
- amount: number (integer)
- version: number (version column — optimistic lock)
- lastSyncedAt: datetime | null
- updatedAt: datetime

TimeOffRequest (table: time_off_requests)
- id: uuid (PK)
- employeeId: string
- locationId: string
- days: number
- status: enum {PENDING, APPROVED, REJECTED, RETRYING, FAILED}
- idempotencyKey: string (unique index)
- hcmReferenceId: string | null
- requestedAt: datetime
- processedAt: datetime | null
- retryCount: integer default 0
- lastError: text | null

Design notes:
- Use composite PK for Balance for quick lookup and simple unique constraint.
- Keep version column to increment automatically on updates for optimistic retries.

API contract (full examples)
---------------------------
1) POST /api/v1/time-off/requests
Request headers:
- Idempotency-Key: <uuid-or-client-generated-string>
Body (application/json):
{
  "employeeId":"E123",
  "locationId":"US-CA",
  "days":2
}

Responses:
- 201 Created — returns stored request object (status may be PENDING/APPROVED depending on HCM call timing).
- 400 Bad Request — validation failure or business error like INSUFFICIENT_BALANCE (returned as { error: 'INSUFFICIENT_BALANCE' }).
- 409 Conflict — idempotency conflict (should not occur if repository check is done).

Behavior:
1. Validate body and require Idempotency-Key.
2. Check repo.findByIdempotencyKey — if present return existing request (200 or 201 consistent with previous response design).
3. Create a transaction via DataSource.createQueryRunner(): read balance, ensure sufficient amount, call balance.deduct(days), update balance via repository with manager, create TimeOffRequest with status=PENDING and save with same manager, commit transaction.
4. Call HCM adapter outside the transaction with { employeeId, locationId, days, idempotencyKey }.
   - If HCM returns approved: timeOffRequest.approve(hcmReferenceId); save request.
   - If HCM returns rejected: timeOffRequest.reject(error); save request.
   - If adapter throws (network/timeout): timeOffRequest.markRetrying(errorMessage); save request.

2) POST /api/v1/time-off/sync
Body (optional): { balances: [ { employeeId, locationId, balance } ] }
- If body provided, treat as HCM push: upsert/replace balances as specified.
- If no body, attempt to fetch via adapter.fetchAllBalances(). Upsert results.

Idempotency & consistency contract
---------------------------------
- The Idempotency-Key must be unique per logical request. The repository enforces uniqueness. The service returns the existing request for repeated keys.

Concurrency and transaction strategy
-----------------------------------
- For each request creation: Use a QueryRunner manager to perform reads and updates within a transaction.
- Use optimistic locking: when updating balance, rely on TypeORM's version check. If a save fails due to concurrent update, retry the transaction up to 3 times with a short backoff.
- Keep network calls (HCM) outside the DB transaction to avoid holding locks during network latency.

Retry/backoff policy and mechanism
---------------------------------
Parameters (configurable via env):
- RETRY_BASE_MS (default 5_000)
- RETRY_MAX_MS (default 300_000)
- RETRY_MAX_ATTEMPTS (default 5)

Algorithm:
nextDelayMs = min(RETRY_MAX_MS, RETRY_BASE_MS * 2^retryCount) ± jitter where jitter is ±10% random.

Implementation:
- A scheduled job (cron via NestJS schedule) scans for requests with status RETRYING and processedAt older than nextDelay.
- For matched requests, call the adapter submitTimeOffRequest again and update state accordingly. Increment retryCount on each attempt. If retryCount >= RETRY_MAX_ATTEMPTS and still failing, mark FAILED and set lastError.

Edge cases & failure handling
----------------------------
- HCM returns 400 with specific error (e.g., INSUFFICIENT_BALANCE): mark REJECTED and include HCM error in lastError; consider putting a reconciliation task on pending balances.
- HCM times out: treat as transient and mark RETRYING.
- Local DB write fails after successful HCM call: rare; mark request as needing reconciliation, log both HCM response and DB error. Operational runbook required.

Startup and seeding
------------------
- On module init run StartupSyncService:
  1. Try hcmAdapter.fetchAllBalances(). If non-empty, call BalanceSyncService.executeBatch.
  2. If empty, parse HCM_BOOTSTRAP_EMPLOYEES env var (CSV of employee:location pairs) and call fetchBalance per pair.
  3. If still empty, log and continue — don't fail boot.

HCM adapter contract
--------------------
Adapter interface methods:
- submitTimeOffRequest(params) -> { status: 'approved'|'rejected', hcmReferenceId?, remainingBalance?, error?, currentBalance?, requested? }
- fetchAllBalances() -> [{ employeeId, locationId, balance }]
- fetchBalance(employeeId, locationId) -> { employeeId, locationId, balance } | null

Implementation notes
--------------------
- HcmHttpAdapter maps 400 responses into the 'rejected' shape and throws for technical failures; timeout is set to small (~5s) to detect cold-starts quickly.

Observability & monitoring
--------------------------
Logs (structured where possible):
- Always log: requestId, idempotencyKey, employeeId, locationId, days, action, HCM status or error.

Metrics to export (Prometheus preferred):
- requests_total{status} (PENDING, APPROVED, REJECTED, RETRYING, FAILED)
- hcm_calls_total{outcome=success|business_reject|failure}
- retries_total
- syncs_total
- balance_upserts_total

Alerts & thresholds (SRE guidance):
- Alert if hcm_calls_total failure rate > 10% for 5 minutes.
- Alert if requests in RETRYING > threshold (e.g., 100) indicating systemic HCM outage.

Testing strategy (detailed)
--------------------------
Unit tests (fast, deterministic):
- RequestTimeOffService: happy path, HCM approved, HCM rejected, HCM error → RETRYING, BALANCE_NOT_FOUND, INSUFFICIENT_BALANCE, idempotency.
- RetryRequestsService: backoff gating logic, retry increment and transitions for success/failure.
- BalanceSyncService: upsert behavior, transaction rollback on error.
- Repositories: mock DB manager behavior to assert that QueryRunner manager is used and that upsert uses ORM correctly.

Integration tests (runner spins Nest TestModule):
- Start Express HCM mock (apps/hcm-express/server.js) and the Nest app in test mode.
- Scenarios: seed HCM -> POST /sync -> submit requests -> HCM replies -> verify state transitions and DB rows.

E2E smoke tests (manual or CI stage):
- Boot HCM mock (local or deployed), boot Nest app, run smoke script to seed, sync and submit a request verifying end-to-end.

Acceptance criteria / Test matrix
--------------------------------
Must-have tests before merge to main:
1. Unit tests covering service logic with >95% coverage for services folder.
2. Integration test that performs a full submit flow using the HCM mock.
3. Tests verifying idempotency behavior.
4. Tests verifying startup seeding works with per-employee fallback.

Deployments and operational configuration
---------------------------------------
Runtime env vars (minimum):
- HCM_URL — base URL for HCM (optional; default `http://localhost:4000`)
- TIME_OFF_PORT — port for the Nest app (default 3000)
- HCM_BOOTSTRAP_EMPLOYEES — CSV pairs for bootstrapping (E123:US-CA,...)
- RETRY_BASE_MS, RETRY_MAX_MS, RETRY_MAX_ATTEMPTS

Database
--------
- Development: SQLite file under repo (time_off_prod.db). For production use a managed database (Postgres recommended).

Deployment
----------
- Containerize the app (Docker) and deploy to a platform (k8s/GCP/Github Actions → staging). For production use managed DB, Redis for queue (when adopted), and secure HCM connections.

Security
--------
- Transport: TLS for HCM_URL and API endpoints.
- Auth: out of scope for this version; recommend API key / mTLS or OAuth for production.
- Secrets: do not commit secrets to repo; use secret manager in CI/CD.

Operational runbook (short)
--------------------------
Common tasks:
- Restarting the service: normal process restart; verifies StartupSyncService upserts balances again.
- For stuck RETRYING requests: manual requeue via admin endpoint (not implemented yet) or run a script to call adapter directly.
- Inspect logs for `RetryRequestsService` and `RequestTimeOffService` traces.

Risks and mitigations
---------------------
Risk: HCM cold starts cause timeouts and many retries.
Mitigation: use short timeout, treat as transient, and surface metrics/alerts. Optionally pre-warm the HCM mock in deployment.

Risk: Concurrent deductions race and cause incorrect balances.
Mitigation: optimistic locking with retries; consider moving to a centralized queue for submissions if contention grows.

Alternatives considered
-----------------------
1. Always call HCM first then update local DB on success — rejected because HCM outages would block local operations and reduce availability.
2. Use a durable queue (BullMQ) for submission to HCM — this is recommended for production to guarantee retry and visibility. Deferred for now to keep the prototype simple.
3. Event-sourcing for full audit trail — powerful but increases complexity; not adopted now.

Migration and data retention
---------------------------
- Backups: periodic DB backups recommended for any persisted data. For production, use managed DB snapshots.
- Migration: track schema via TypeORM migration scripts when upgrading entities.

Open implementation items
------------------------
- Admin endpoints for requeue/inspect.
- Replace cron-based retry with BullMQ + Redis for production durability.
- Add integration tests that run in CI against a containerized HCM mock.

Author's thought process (human notes)
-------------------------------------
I approached the TRD with three priorities: correctness, resilience, and simplicity. Correctness driven choices push me to do local transactional deductions and explicit idempotency checks — that way the system's local state (which is authoritative for the API surface) is consistent even if HCM is flaky. Resilience demanded a clear retry/backoff policy and a background reattempt process so transient network issues don't transform into user-visible failures. Simplicity drove me to prefer optimistic locking and small transactions over heavy synchronous distributed transactions.

Trade-offs I considered:
- Doing HCM-first would avoid local inconsistencies but make user operations brittle during outages; I preferred local-first and eventual reconciliation.
- A durable queue is more robust but requires infra; I deferred it to keep the project runnable locally and easy to test.

How this document should be used:
- As the decision record for reviewers to understand why certain patterns were chosen.
- As a checklist for QA and SRE to implement monitoring and acceptance tests.

Next steps
----------
1. Implement admin endpoints and the queue-based retry as a follow-up PR.
2. Add CI integration tests that start HCM mock containers.
3. Surface metrics to a monitoring stack and add alerts.

Appendix: quick acceptance checklist
----------------------------------
- Unit tests for core services pass (coverage thresholds met).
- Integration test for submit flow with HCM mock passes.
- README contains run instructions and `.env` points to the correct HCM_URL for dev.

-- End of TRD --

