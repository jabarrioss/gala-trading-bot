const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'trading.db');
const db = new sqlite3.Database(dbPath);

console.log('Adding gala_symbol column to monitored_symbols table...');

// Add the column
db.run("ALTER TABLE monitored_symbols ADD COLUMN gala_symbol TEXT", (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding column:', err);
    return;
  }
  
  console.log('✅ gala_symbol column added successfully');
  
  // Update GALA symbol with gala_symbol value
  db.run("UPDATE monitored_symbols SET gala_symbol = 'GALA|Unit|none|none' WHERE symbol = 'GALA'", (err) => {
    if (err) {
      console.error('Error updating GALA symbol:', err);
      return;
    }
    
    console.log('✅ GALA symbol updated with gala_symbol');
    
    // Verify the changes
    db.all("SELECT * FROM monitored_symbols WHERE symbol = 'GALA'", (err, rows) => {
      if (err) {
        console.error('Error verifying changes:', err);
        return;
      }
      
      console.log('\nUpdated GALA symbol data:');
      console.log(JSON.stringify(rows, null, 2));
      
      db.close();
      console.log('\n🎉 Database migration completed successfully!');
    });
  });
});