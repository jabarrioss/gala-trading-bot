const DatabaseService = require('../services/DatabaseService');
const fs = require('fs');
const path = require('path');

describe('DatabaseService', () => {
  const testDbPath = path.join(__dirname, 'test.db');
  
  beforeAll(async () => {
    // Set test database path
    process.env.DB_PATH = testDbPath;
    
    // Initialize the service
    await DatabaseService.init();
  });

  afterAll(async () => {
    // Clean up
    await DatabaseService.shutdown();
    
    // Remove test database file
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  test('should initialize successfully', () => {
    expect(DatabaseService.isReady()).toBe(true);
  });

  test('should create tables successfully', async () => {
    // Test if we can query the trades table
    const result = await DatabaseService.get("SELECT name FROM sqlite_master WHERE type='table' AND name='trades'");
    expect(result).toBeDefined();
    expect(result.name).toBe('trades');
  });

  test('should insert and retrieve trade data', async () => {
    // Insert test trade
    const result = await DatabaseService.run(
      'INSERT INTO trades (strategy, symbol, side, amount, price, total_value, slippage, dry_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['test_strategy', 'GALA-USD', 'BUY', 100, 0.05, 5, 0.05, 1]
    );

    expect(result.lastID).toBeDefined();

    // Retrieve the trade
    const trade = await DatabaseService.get('SELECT * FROM trades WHERE id = ?', [result.lastID]);
    
    expect(trade).toBeDefined();
    expect(trade.strategy).toBe('test_strategy');
    expect(trade.symbol).toBe('GALA-USD');
    expect(trade.side).toBe('BUY');
    expect(trade.amount).toBe(100);
  });

  test('should handle transactions', async () => {
    const statements = [
      {
        sql: 'INSERT INTO trades (strategy, symbol, side, amount, price, total_value, slippage, dry_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: ['golden_cross', 'GALA-USD', 'BUY', 50, 0.06, 3, 0.05, 1]
      },
      {
        sql: 'INSERT INTO price_history (symbol, price) VALUES (?, ?)',
        params: ['GALA-USD', 0.06]
      }
    ];

    const results = await DatabaseService.transaction(statements);
    
    expect(results).toHaveLength(2);
    expect(results[0].lastID).toBeDefined();
    expect(results[1].lastID).toBeDefined();
  });

  test('should pass health check', async () => {
    const isHealthy = await DatabaseService.healthCheck();
    expect(isHealthy).toBe(true);
  });
});