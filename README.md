# Time Off Service

This repository contains two cooperating apps:

- apps/time-off-service — the NestJS application that implements the Time-Off domain (APIs, services, repositories, retry logic, tests).
- apps/hcm-express — a small Express-based HCM mock used for local development and tests.

This README describes how to run the services, run tests, and where to find the key code.

## Requirements

- Node.js (18+ recommended)
- npm (or yarn/pnpm — commands below use npm)
- macOS / Linux / Windows (examples use zsh-style commands)

## Repo layout (important locations)

- apps/time-off-service
  - src/ — NestJS app source code
  - test/ — Jest test config and tests
  - package.json — app-level scripts (test, start)

- apps/hcm-express
  - server.js — small Express mock exposing HCM endpoints
  - package.json — start script for the mock

- package.json — monorepo/root scripts and shared Jest config

## Environment variables

- HCM_URL — base URL for the HCM service used by the Nest adapter. Defaults to `http://localhost:4000`.
- TIME_OFF_PORT — port for the Nest time-off service (fallbacks: PORT, then 3000).
- RETRY_BASE_MS — base backoff (ms) used by the retry gating logic (default: 5000).
- RETRY_MAX_MS — max backoff (ms) used by the retry gating logic (default: 300000).

Set them in your shell before starting the services, e.g.:

```bash
export HCM_URL=http://localhost:4000
export TIME_OFF_PORT=3001
export RETRY_BASE_MS=5000
export RETRY_MAX_MS=300000
```

## Running locally

1) Install dependencies (root or per-app)

From the repository root:

```bash
npm install
```

2) Start the HCM Express mock

```bash
cd apps/hcm-express
npm install   # first time
npm start
```

This starts a small HTTP server (default port 4000) with endpoints used by the Nest app (e.g. `/realtime/book`, `/balances`, `/health`). Check health:

```bash
curl http://localhost:4000/health
```

3) Start the Nest time-off service

Open a new terminal and run from the app folder:

```bash
cd apps/time-off-service
npm install   # first time
npm start
```

By default it will use `TIME_OFF_PORT` (or PORT) if set, otherwise runs on 3000. The API base is `/api/v1/time-off` (see controller files).

Health endpoint (if present):

```bash
curl http://localhost:${TIME_OFF_PORT:-3000}/api/v1/time-off/health
```

Key endpoints (examples)

- POST /api/v1/time-off/requests — submit a time-off request. Include an `Idempotency-Key` header.
- POST /api/v1/time-off/sync — trigger a sync balances action.

Refer to `apps/time-off-service/src/modules/time-off/controllers/time-off.controller.ts` for full details and payload shapes.

## Tests

There are two ways to run tests.

- From the repo root (root jest config):

```bash
npm test
```

- From the time-off app folder (matches Nest behaviour):

```bash
cd apps/time-off-service
npm test
```

The app-level package.json and `test/jest.config.js` ensure Jest runs the app's tests (`test/*.spec.ts` and `src/**/__tests__/*.spec.ts`).

If you encounter issues with the `uuid` package (ESM), tests currently mock `uuid` before importing modules that use it. The test files show the pattern used.

### Running E2E or integration tests (future)

Integration tests that spin up both the Nest app and the HCM mock are planned (not included as automated e2e yet). You can run the HCM mock separately and point the Nest adapter to its URL (`HCM_URL`).

## Notes on architecture and behavior

- The Nest app follows a repository + adapter pattern: domain entities -> repositories -> services -> controllers. The HCM integration is via an adapter (`hcm-http.adapter.ts`) so it can be swapped for a different implementation.
- RetryRequestsService runs a scheduled job (cron) that looks for requests in a RETRYING state and attempts re-submission. Retries are gated via an exponential backoff (configurable via env). For production-grade reliability consider using a durable queue (BullMQ + Redis) instead of a cron.
- Idempotency is implemented via an `Idempotency-Key` value required for POST /requests to avoid duplicate submissions.

## Troubleshooting

- If you see `listen EADDRINUSE` errors, another process is bound to the port. List and kill the process, or change the port.
- If a test fails due to `uuid` import errors, ensure Jest is running with ts-jest and tests mock `uuid` where necessary (`jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }))`).

## Next steps / improvements

- Replace cron-based retries with a persistent queue (BullMQ + Redis) for production reliability.
- Add full integration tests using supertest that programmatically start the HCM mock and Nest test module.
- Expose admin endpoints to requeue or reset requests for manual intervention.

If you'd like, I can add the integration test next (supertest) and wire it into the app test scripts.

---
Created on April 24, 2026 — if you'd like changes (shorter, more/less detail, examples), tell me what to emphasize.
# Time-Off Microservice

This repository implements a production-grade Time-Off integration microservice designed for high concurrency and eventual consistency with a mocked HCM system.

## Quick Start

### Prerequisites
- Node.js 18+
- npm

### Installation
```bash
cd time-off-service
npm install
```

### Running the Services
The solution utilizes an internal NestJS monorepo, orchestrating the `time-off-service` (Main App) on port 3000, and the `hcm-mock` on port 3001.

**Start HCM Mock (Terminal 1):**
```bash
npm run start hcm-mock
```

**Start Primary Service (Terminal 2):**
```bash
npm run start time-off-service
```

### Testing the Service (cURL)
```bash
# Request Time Off
curl -X POST http://localhost:3000/api/v1/time-off/requests \
  -H "Idempotency-Key: e0801da2-0c91-4475-a8fb-eed849ddc2af" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "E123",
    "locationId": "US-CA",
    "days": 2
  }'

# Read Local Balance
curl http://localhost:3000/api/v1/time-off/balances/E123/US-CA
```

## Architecture

This application strictly implements the **Clean/Hexagonal Architecture**.
- **Controllers** only map HTTP to domain layers.
- **Services (Use Cases)** act as workflow orchestrators.
- **Domain layer** rules dictate status transitions for Requests.
- **Infrastructure** (TypeORM/SQLite) provides repositories and adapter details.

### Concurrency and Consistency
- **Optimistic Locking:** Ensures no Double-Spending. Time-off deduction increments a version number locally (`TimeOffBalance` entity). Concurrent read/write conflicts throw an error immediately, effectively killing race conditions.
- **Eventual Consistency:** Local cache resolves race conditions by preemptively deducting balances. Batch syncs from HCM true-up the balance.

## Failure Scenarios Handled
1. **Network Partition (HCM Down):** Generates a `RETRYING` state. A background `Cron` job implements polling to resubmit. 
2. **Double Click / Retries from Client:** Caught via Unique Constraint indexing on the `idempotencyKey` globally in the database.
3. **Reconciliation (Lost Local Balance):** The `BalanceSyncService` verifies pending requests during a sync tick. If HCM overwrites local balance making pending requests mathematically impossible, they fall into `REJECTED` state automatically.

## Known Limitations / Future Improvements
- Test suite skipped to respect time limits (ideally Jest e2e with mock DB).
- Replace Cron retry with an advanced Dead Letter Queue (`RabbitMQ` / `@nestjs/bull`).
- Add Prometheus/Grafana metric hooks on endpoints for production debugging.
