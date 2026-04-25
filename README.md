# Time Off Service
## Time Off Service — Quick Start

This README contains only the minimal commands to run the HCM mock, run the Nest time-off app, and run tests.
# Time Off Service — Quick Start

Start the HCM mock (local):

```bash
cd apps/hcm-express
npm install   # first time only
npm start
```

Build & start the time-off service:

```bash
cd apps/time-off-service
npm install   # first time only
npm run build
npm start
```

Run tests:

```bash
# from repo root
npm test

# or scoped to the app
cd apps/time-off-service
npm test
```

Dev env note: `apps/time-off-service/.env` contains `HCM_URL` and the adapter falls back to `http://localhost:4000` when unset.

That's it.
From the repo root or the app folder:
