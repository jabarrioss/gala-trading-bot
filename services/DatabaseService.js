const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const BaseService = require('./BaseService');

/**
 * Database service with singleton pattern for SQLite operations
 */
class DatabaseService extends BaseService {
  constructor() {
    super('DatabaseService');
    this.db = null;
    this.dbPath = null;
  }

  /**
   * Initialize database connection and create tables
   * @returns {Promise<void>}
   */
  async onInit() {
    this.dbPath = this.getConfig('DB_PATH');
    
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      this.logger.info(`Created data directory: ${dataDir}`);
    }

    // Connect to database
    await this.connect();
    
    // Create tables
    await this.createTables();
  }

  /**
   * Connect to SQLite database
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          this.logger.error('Failed to connect to database:', err);
          reject(err);
        } else {
          this.logger.info(`Connected to SQLite database: ${this.dbPath}`);
          resolve();
        }
      });
    });
  }

  /**
   * Create database tables
   * @returns {Promise<void>}
   */
  async createTables() {
    const tables = [
      // Trades table
      `CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
        amount REAL NOT NULL,
        price REAL NOT NULL,
        total_value REAL NOT NULL,
        slippage REAL NOT NULL,
        fee REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),
        tx_hash TEXT,
        dry_run BOOLEAN NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        executed_at DATETIME,
        notes TEXT
      )`,

      // Price history table
      `CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        volume REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT DEFAULT 'yahoo_finance'
      )`,

      // Strategy performance table
      `CREATE TABLE IF NOT EXISTS strategy_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_name TEXT NOT NULL,
        period_start DATETIME NOT NULL,
        period_end DATETIME NOT NULL,
        total_trades INTEGER DEFAULT 0,
        winning_trades INTEGER DEFAULT 0,
        losing_trades INTEGER DEFAULT 0,
        total_pnl REAL DEFAULT 0,
        max_drawdown REAL DEFAULT 0,
        sharpe_ratio REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // System logs table
      `CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('INFO', 'WARN', 'ERROR', 'DEBUG')),
        message TEXT NOT NULL,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const tableSql of tables) {
      await this.run(tableSql);
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_trades_symbol_created ON trades(symbol, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_price_history_symbol_timestamp ON price_history(symbol, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_strategy_performance_name ON strategy_performance(strategy_name)',
      'CREATE INDEX IF NOT EXISTS idx_system_logs_service_timestamp ON system_logs(service, timestamp)'
    ];

    for (const indexSql of indexes) {
      await this.run(indexSql);
    }

    this.logger.info('Database tables and indexes created successfully');
  }

  /**
   * Execute a SQL query (for INSERT, UPDATE, DELETE)
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Result with changes and lastID
   */
  async run(sql, params = []) {
    // Don't check initialization during table creation
    if (!this.isInitialized && !sql.includes('CREATE TABLE') && !sql.includes('CREATE INDEX')) {
      this.ensureInitialized();
    }
    
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            changes: this.changes,
            lastID: this.lastID
          });
        }
      });
    });
  }

  /**
   * Execute a SQL query and get first row (for SELECT)
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object|null>} First row or null
   */
  async get(sql, params = []) {
    // Don't check initialization during setup queries
    if (!this.isInitialized && !sql.includes('sqlite_master') && !sql.includes('SELECT 1')) {
      this.ensureInitialized();
    }
    
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  /**
   * Execute a SQL query and get all rows (for SELECT)
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Array of rows
   */
  async all(sql, params = []) {
    // Don't check initialization during setup queries
    if (!this.isInitialized && !sql.includes('sqlite_master')) {
      this.ensureInitialized();
    }
    
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Execute multiple statements in a transaction
   * @param {Array} statements - Array of {sql, params} objects
   * @returns {Promise<Array>} Array of results
   */
  async transaction(statements) {
    this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        const results = [];
        let completed = 0;
        let hasError = false;

        const executeNext = (index) => {
          if (index >= statements.length) {
            if (!hasError) {
              this.db.run('COMMIT', (err) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(results);
                }
              });
            }
            return;
          }

          const { sql, params } = statements[index];
          this.db.run(sql, params, function(err) {
            if (err && !hasError) {
              hasError = true;
              this.db.run('ROLLBACK');
              reject(err);
            } else if (!hasError) {
              results.push({
                changes: this.changes,
                lastID: this.lastID
              });
              executeNext(index + 1);
            }
          });
        };

        executeNext(0);
      });
    });
  }

  /**
   * Close database connection
   * @returns {Promise<void>}
   */
  async shutdown() {
    await super.shutdown();
    
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            this.logger.error('Error closing database:', err);
          } else {
            this.logger.info('Database connection closed');
          }
          resolve();
        });
      });
    }
  }

  /**
   * Health check - verify database connection
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      await this.get('SELECT 1 as test');
      return true;
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService();