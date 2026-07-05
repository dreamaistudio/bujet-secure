const db = require('../src/server/database');

async function main() {
  await db.init();
  console.log('Database Initialized.');
  console.log('dbType:', db.dbType);
  
  // Check savings in DB initially
  const rawSavings = db.getAllSavingsRaw();
  console.log('Initial raw savings:', rawSavings);

  // Sync a test saving entry
  const dummySaving = {
    id: 'test-saving-id-123',
    keeperName: 'John Doe',
    amount: 5000,
    date: '2026-07-04',
    notes: 'Test savings entry',
    status: 'kept',
    updated_at: Date.now()
  };

  console.log('Calling syncSavings...');
  const merged = db.syncSavings([dummySaving]);
  console.log('Merged output:', merged);

  const rawSavingsAfter = db.getAllSavingsRaw();
  console.log('Raw savings after sync:', rawSavingsAfter);
}

main().catch(console.error);
