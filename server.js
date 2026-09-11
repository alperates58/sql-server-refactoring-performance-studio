const path = require('path');
const express = require('express');
const api = require('./server/routes/api');
const db = require('./server/services/sqlServer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const { resolveLocalMonacoPath } = require('./server/services/monacoLocator');

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// Mount local Monaco assets for 100% offline workbench
const monacoLocal = resolveLocalMonacoPath();
if (monacoLocal.available) {
  app.use('/vendor/monaco/vs', express.static(monacoLocal.path));
  console.log(`[Monaco] Offline assets mounted from ${monacoLocal.source}: ${monacoLocal.path}`);
}

app.use('/api', api);
app.use(express.static(path.join(__dirname, 'public')));

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`  SQL Server Refactoring & Performance Studio`);
  console.log(`==================================================`);
  console.log(`Tarayıcınızdan açın:`);
  console.log(`  ▶ http://localhost:${PORT}`);
  console.log(`  ▶ http://127.0.0.1:${PORT}\n`);
  // Asynchronously restore previous connection in the background
  db.autoConnect().catch(() => {});
});
