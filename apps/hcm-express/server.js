const express = require('express');
const bodyParser = require('body-parser');


const app = express();
app.use(bodyParser.json());

// simple in-memory balances map
const balances = new Map();
function key(employeeId, locationId) { return `${employeeId}:${locationId}`; }

// Realtime validation endpoint
app.get('/realtime/validate', (req, res) => {
  const { employeeId, locationId, days } = req.query;
  const d = Number(days || 0);
  if (!employeeId || !locationId || !d) return res.status(400).json({ ok: false, error: 'missing params' });
  const b = balances.get(key(employeeId, locationId)) ?? 0;
  if (b >= d) return res.json({ ok: true });
  return res.json({ ok: false, error: 'insufficient_balance' });
});

// Realtime booking endpoint
app.post('/realtime/book', (req, res) => {
  const { employeeId, locationId, days, requestId } = req.body;
  if (!employeeId || !locationId || typeof days !== 'number') return res.status(400).json({ ok: false, error: 'missing body' });
  const k = key(employeeId, locationId);
  const b = balances.get(k) ?? 0;
  if (b < days) return res.status(422).json({ ok: false, error: 'insufficient_balance' });
  balances.set(k, b - days);
  return res.json({ ok: true, hcmReferenceId: `hcm-${requestId || Math.random().toString(36).slice(2)}` });
});

// Batch replace balances (simulate HCM pushing full corpus)
app.post('/batch/replace-balances', (req, res) => {
  const { balances: incoming } = req.body;
  if (!Array.isArray(incoming)) return res.status(400).json({ ok: false, error: 'expected balances array' });
  balances.clear();
  for (const item of incoming) {
    const { employeeId, locationId, balance } = item;
    if (!employeeId || !locationId || typeof balance !== 'number') continue;
    balances.set(key(employeeId, locationId), balance);
  }
  res.json({ ok: true, count: balances.size });
});

// Manage balances (for tests)
app.post('/balances', (req, res) => {
  const { employeeId, locationId, balance } = req.body;
  if (!employeeId || !locationId || typeof balance !== 'number') return res.status(400).json({ ok: false, error: 'missing' });
  balances.set(key(employeeId, locationId), balance);
  res.json({ ok: true });
});

app.get('/balances/:employeeId/:locationId', (req, res) => {
  const b = balances.get(key(req.params.employeeId, req.params.locationId)) ?? 0;
  res.json({ employeeId: req.params.employeeId, locationId: req.params.locationId, balance: b });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`HCM express mock listening on ${port}`));
