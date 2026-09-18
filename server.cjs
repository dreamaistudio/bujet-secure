const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRouter = require('./src/server/api');
const db = require('./src/server/database');

async function start() {
  // Initialize SQLite/JSON database
  await db.init();

  const expressApp = express();
  expressApp.use(cors());
  expressApp.use(express.json());

  // Expose local REST endpoints
  expressApp.use('/api', apiRouter);

  // Serve static assets (welcome video, etc.)
  const assetsPath = path.join(__dirname, 'electron', 'assets');
  expressApp.use('/assets', express.static(assetsPath));

  const port = 3001;
  expressApp.listen(port, '127.0.0.1', () => {
    console.log(`Express sync server running on http://127.0.0.1:${port}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
});
