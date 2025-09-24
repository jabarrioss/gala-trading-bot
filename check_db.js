const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'trading.db');
const db = new sqlite3.Database(dbPath);

console.log('Checking monitored_symbols table structure...');

// Check table schema
db.all("PRAGMA table_info(monitored_symbols)", (err, rows) => {
  if (err) {
    console.error('Error checking table info:', err);
    return;
  }
  
  console.log('\nTable columns:');
  rows.forEach(col => {
    console.log(`  - ${col.name} (${col.type})`);
  });
  
  // Check if gala_symbol column exists
  const hasGalaSymbol = rows.some(col => col.name === 'gala_symbol');
  console.log(`\ngala_symbol column exists: ${hasGalaSymbol}`);
  
  // Get GALA symbol data
  db.all("SELECT * FROM monitored_symbols WHERE symbol = 'GALA'", (err, rows) => {
    if (err) {
      console.error('Error getting GALA symbol:', err);
      return;
    }
    
    console.log('\nGALA symbol data:');
    console.log(JSON.stringify(rows, null, 2));
    
    db.close();
  });
});