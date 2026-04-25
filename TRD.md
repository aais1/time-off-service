# Technical Requirements Document (TRD)

Time-Off Microservice — Technical Requirements Document

Last updated: 2026-04-24

Overview
--------
This service (Time-Off Microservice) manages the lifecycle of employee time-off requests and maintains per-employee-per-location balances in sync with one or more Human Capital Management (HCM) systems (e.g., Workday, SAP).

Goals
-----
- Provide REST APIs for creating and querying time-off requests and balances.
- Verify requested time-off against an HCM "Source of Truth" using realtime APIs.
- Accept batch balance updates from HCM (full corpus replacement) and reconcile local state.
- Be defensive when HCM is unavailable or returns ambiguous results; use retries with backoff and idempotency to avoid double-deductions.

Non-goals
---------
- This TRD does not prescribe a multi-tenant SaaS orchestration; it assumes a single tenant per deployment. It also does not implement long-term archival or advanced SSO.

Context and assumptions
-----------------------
- Balances are scoped by (employeeId, locationId).
- HCM provides:
  - A realtime book endpoint to attempt to consume balance (e.g., POST /realtime/book)
  - A realtime validate endpoint to check if a booking is possible (optional)
  - A batch endpoint that periodically pushes the full corpus (e.g., POST /batch/replace-balances)
- HCM may reject invalid dimension combinations (400/422) or return 5xx transient errors. It may also silently accept/reject; therefore we must track state and be defensive.

Core data model
---------------
- TimeOffRequest (persisted)
  - id (uuid)
  - employeeId (string)
  - locationId (string)
  - days (int)
  - status (enum: PENDING, APPROVED, REJECTED, RETRYING, FAILED)
  - idempotencyKey (string, unique)
  - hcmReferenceId? (string)
  - requestedAt (datetime)
  - processedAt? (datetime)
  - retryCount (int)
  - lastError? (text)
  - metadata? (json)

- Balance (persisted)
  - employeeId (pk)
  - locationId (pk)
  - amount (int)
  - version (for optimistic locking)
  - lastSyncedAt (datetime)
  - updatedAt (datetime)

Persistence
-----------
- This implementation uses SQLite (via TypeORM) for durability. Entities are under `infrastructure/database/entities` and repositories under `infrastructure/database/repositories`.

APIs
----
All endpoints are prefixed with `/api/v1/time-off`.

- POST /requests
  - Body: { employeeId, locationId, days, metadata? }
  - Headers: Idempotency-Key required
  - Behavior:
    1. Validate input.
    2. Check for existing request with the same idempotency key -> return existing (idempotent).
    3. Persist a PENDING request.
    4. Optionally call HCM realtime validate first (fast-fail). Then call HCM realtime book.
    5. On HCM success: mark APPROVED, persist hcmReferenceId and processedAt. Update local balance (deduct days) in the same transaction where possible.
    6. On HCM business rejection (400/422): mark REJECTED and persist lastError.
    7. On HCM transient error (5xx/network): mark RETRYING, increment retryCount and leave processedAt null; a background retry process will re-attempt with backoff.

- GET /requests/:id
  - Returns the persisted request (domain view).

- POST /sync (or POST /balances/sync)
  - Trigger a fetch or push from HCM, or accept a batch push from HCM.

- POST /batch/replace-balances (HCM -> ReadyOn push)
  - Body: { balances: [ { employeeId, locationId, balance }, ... ] }
  - Behavior: Replace local balances with the incoming corpus. Update `lastSyncedAt` and `updatedAt`.

- GET /balances/:employeeId/:locationId
  - Returns local balance for read-only display.

Idempotency
-----------
- `Idempotency-Key` header required for POST /requests.
- The repository enforces a unique constraint on idempotencyKey in the ORM layer. The service checks for existing idempotencyKey before creating new request.

Error handling and retry policy
------------------------------
- Distinguish three categories of HCM response:
  - Business rejection (400/422) — do not retry; mark REJECTED.
  - Success (200/201) — mark APPROVED and persist hcmReferenceId.
  - Transient failure (5xx/network) — mark RETRYING and queue for retry.
- Retry mechanism:
  - A background Cron will scan for RETRYING requests and re-attempt submission.
  - Apply exponential backoff with jitter: nextAttemptDelay = min(RETRY_MAX_MS, RETRY_BASE_MS * 2^retryCount) ± random jitter.
  - Limit total attempts (configurable MAX_RETRIES). After exceeding, mark FAILED and notify (logging/metrics).

Concurrency
-----------
- Use optimistic locking on `Balance` (VersionColumn) to avoid lost updates when multiple concurrent requests attempt to deduct from the same balance. If a conflict is detected, the transaction should be retried up to a small fixed number of times and then fail with a transient error.

Transactions & consistency
-------------------------
- Where possible, combine changes to the request and balance within the same DB transaction (TypeORM QueryRunner) to ensure either both persist (local deduction) or neither (rollback on failure). This avoids double-deduct.

Batch balance pushes from HCM
----------------------------
- HCM can push a full corpus; the service should:
  - Validate the incoming shape.
  - Replace the local balances (clear and insert) in a transaction or upsert per row.
  - Update `lastSyncedAt` for each balance.
  - For any in-flight requests (PENDING/RETRYING) touching balances that changed in a batch, the service should re-evaluate them (optionally re-run validation or flag for manual review).

Security and auth
-----------------
- For production, protect endpoints with TLS and API auth (OAuth, mTLS or signed tokens). For the mock and tests we use no auth.

Observability & metrics
-----------------------
- Track metrics: requests created, approvals, rejections, retries, failures, HCM latency.
- Emit logs for each HCM interaction with context (requestId, idempotencyKey, employeeId/locationId).

Alternatives considered
-----------------------
- Synchronous-only approach: Blocking until HCM responds. Rejected because HCM transient outages would cause poor UX.
- Durable queue (recommended for production): Use BullMQ/Redis to push retry tasks and process them with workers. This is the most robust option and supports retries and visibility into the queue.
- Event-sourcing: Record domain events (RequestCreated, RequestApproved, BalanceUpdated) and replay. Stronger auditability but more complexity.

Integration testing strategy (summary)
------------------------------------
- Use a local Express HCM mock (already in `apps/hcm-express`) that supports realtime/book, validate, batch, and balances endpoints. Tests spin it up and run end-to-end flows.
- Tests include:
  - Unit tests for domain logic (approve/reject, state transitions).
  - Repository tests using SQLite in-memory where possible.
  - Integration tests (supertest) that start Nest TestModule and the HCM mock and assert end-to-end behavior including retry/backoff.

Open questions
--------------
- Should batch pushes from HCM be applied as full replacement (clear+insert) or as upserts with metadata merging? Current design supports full replacement.
- How to surface manual requeueing/inspection? Consider an admin API.

Files of interest in the repo
----------------------------
- `apps/time-off-service/src/infrastructure/database/*` — ORM entities and DB wiring
- `apps/time-off-service/src/modules/time-off/*` — controllers, services, adapters, domain
- `apps/hcm-express/server.js` — minimal HCM mock used for tests and local development

Appendix: failure scenarios and responses
---------------------------------------
- HCM transient failure when booking: mark RETRYING and schedule retries. If retries exhausted, mark FAILED and surface in admin UI/alerts.
- HCM returns invalid-dimensions: mark REJECTED and include HCM error in `lastError`.
- HCM silent acceptance but local DB update fails: transaction ensures local update and HCM booking are coordinated where possible. If not possible (HCM call came first), a compensating action or manual reconciliation is required.
