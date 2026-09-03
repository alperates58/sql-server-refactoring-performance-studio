const path = require('path');
const express = require('express');
const api = require('./server/routes/api');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use('/api', api);
app.use(express.static(path.join(__dirname, 'public')));

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`SQL Server Refactoring & Performance Studio: http://localhost:${PORT}`);
});
