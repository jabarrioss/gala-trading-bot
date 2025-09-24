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
    
    // Initialize default symbols if none exist
    await this.initializeDefaultSymbols();
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
      // Monitored symbols table
      `CREATE TABLE IF NOT EXISTS monitored_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        yahoo_symbol TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        trading_enabled BOOLEAN NOT NULL DEFAULT 1,
        min_trade_amount REAL DEFAULT 1,
        max_trade_amount REAL DEFAULT 100,
        strategy_config TEXT, -- JSON string for strategy-specific config
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

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
      'CREATE INDEX IF NOT EXISTS idx_monitored_symbols_active ON monitored_symbols(is_active, trading_enabled)',
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
   * Get all monitored symbols
   * @param {boolean} activeOnly - Only return active symbols
   * @returns {Promise<Array>} Array of monitored symbols
   */
  async getMonitoredSymbols(activeOnly = true) {
    const sql = activeOnly 
      ? 'SELECT * FROM monitored_symbols WHERE is_active = 1 ORDER BY symbol'
      : 'SELECT * FROM monitored_symbols ORDER BY symbol';
    
    try {
      const symbols = await this.all(sql);
      return symbols.map(symbol => ({
        ...symbol,
        strategy_config: symbol.strategy_config ? JSON.parse(symbol.strategy_config) : null,
        is_active: !!symbol.is_active,
        trading_enabled: !!symbol.trading_enabled
      }));
    } catch (error) {
      this.logger.error('Error getting monitored symbols:', error);
      throw error;
    }
  }

  /**
   * Get a specific monitored symbol
   * @param {string} symbol - Symbol to get
   * @returns {Promise<Object|null>} Symbol data or null
   */
  async getMonitoredSymbol(symbol) {
    try {
      const result = await this.get(
        'SELECT * FROM monitored_symbols WHERE symbol = ?',
        [symbol]
      );
      
      if (!result) return null;
      
      return {
        ...result,
        strategy_config: result.strategy_config ? JSON.parse(result.strategy_config) : null,
        is_active: !!result.is_active,
        trading_enabled: !!result.trading_enabled
      };
    } catch (error) {
      this.logger.error('Error getting monitored symbol:', error);
      throw error;
    }
  }

  /**
   * Add or update a monitored symbol
   * @param {Object} symbolData - Symbol data to insert/update
   * @returns {Promise<Object>} Operation result
   */
  async upsertMonitoredSymbol(symbolData) {
    const {
      symbol,
      display_name,
      yahoo_symbol,
      is_active = true,
      trading_enabled = true,
      min_trade_amount = 1,
      max_trade_amount = 100,
      strategy_config = null
    } = symbolData;

    const strategyConfigStr = strategy_config ? JSON.stringify(strategy_config) : null;

    try {
      // Check if symbol exists
      const existing = await this.get(
        'SELECT id FROM monitored_symbols WHERE symbol = ?',
        [symbol]
      );

      if (existing) {
        // Update existing
        const result = await this.run(
          `UPDATE monitored_symbols 
           SET display_name = ?, yahoo_symbol = ?, is_active = ?, trading_enabled = ?,
               min_trade_amount = ?, max_trade_amount = ?, strategy_config = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE symbol = ?`,
          [display_name, yahoo_symbol, is_active ? 1 : 0, trading_enabled ? 1 : 0,
           min_trade_amount, max_trade_amount, strategyConfigStr, symbol]
        );
        
        return { action: 'updated', changes: result.changes, symbol };
      } else {
        // Insert new
        const result = await this.run(
          `INSERT INTO monitored_symbols 
           (symbol, display_name, yahoo_symbol, is_active, trading_enabled,
            min_trade_amount, max_trade_amount, strategy_config)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [symbol, display_name, yahoo_symbol, is_active ? 1 : 0, trading_enabled ? 1 : 0,
           min_trade_amount, max_trade_amount, strategyConfigStr]
        );
        
        return { action: 'inserted', id: result.lastID, symbol };
      }
    } catch (error) {
      this.logger.error('Error upserting monitored symbol:', error);
      throw error;
    }
  }

  /**
   * Remove a monitored symbol
   * @param {string} symbol - Symbol to remove
   * @returns {Promise<Object>} Operation result
   */
  async removeMonitoredSymbol(symbol) {
    try {
      const result = await this.run(
        'DELETE FROM monitored_symbols WHERE symbol = ?',
        [symbol]
      );
      
      return { 
        success: result.changes > 0, 
        changes: result.changes,
        symbol 
      };
    } catch (error) {
      this.logger.error('Error removing monitored symbol:', error);
      throw error;
    }
  }

  /**
   * Toggle symbol active status
   * @param {string} symbol - Symbol to toggle
   * @param {boolean} isActive - New active status
   * @returns {Promise<Object>} Operation result
   */
  async setSymbolActiveStatus(symbol, isActive) {
    try {
      const result = await this.run(
        'UPDATE monitored_symbols SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?',
        [isActive ? 1 : 0, symbol]
      );
      
      return { 
        success: result.changes > 0, 
        changes: result.changes,
        symbol,
        isActive 
      };
    } catch (error) {
      this.logger.error('Error setting symbol active status:', error);
      throw error;
    }
  }

  /**
   * Get symbols for trading (active and trading_enabled)
   * @returns {Promise<Array>} Array of symbols available for trading
   */
  async getTradingSymbols() {
    try {
      const symbols = await this.all(
        'SELECT * FROM monitored_symbols WHERE is_active = 1 AND trading_enabled = 1 ORDER BY symbol'
      );
      
      return symbols.map(symbol => ({
        ...symbol,
        strategy_config: symbol.strategy_config ? JSON.parse(symbol.strategy_config) : null,
        is_active: !!symbol.is_active,
        trading_enabled: !!symbol.trading_enabled
      }));
    } catch (error) {
      this.logger.error('Error getting trading symbols:', error);
      throw error;
    }
  }

  /**
   * Initialize default symbols if none exist
   * @returns {Promise<void>}
   */
  async initializeDefaultSymbols() {
    try {
      // Direct database query without initialization check for bootstrap
      const countResult = await new Promise((resolve, reject) => {
        this.db.get('SELECT COUNT(*) as count FROM monitored_symbols', (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (countResult.count === 0) {
        this.logger.info('No monitored symbols found, initializing defaults...');
        
        const defaultSymbols = [
          {
            symbol: 'GALA',
            display_name: 'Gala Games',
            yahoo_symbol: 'GALA-USD',
            is_active: true,
            trading_enabled: true,
            min_trade_amount: 1,
            max_trade_amount: 100,
            strategy_config: {
              golden_cross: {
                short_period: 50,
                long_period: 200,
                rsi_period: 14,
                confidence_threshold: 0.6
              }
            }
          }
        ];

        for (const symbolData of defaultSymbols) {
          await this.upsertMonitoredSymbolDirect(symbolData);
          this.logger.info(`Added default symbol: ${symbolData.symbol}`);
        }
      }
    } catch (error) {
      this.logger.error('Error initializing default symbols:', error);
      throw error;
    }
  }

  /**
   * Direct symbol upsert for initialization (bypasses init check)
   * @param {Object} symbolData - Symbol data to insert/update
   * @returns {Promise<Object>} Operation result
   */
  async upsertMonitoredSymbolDirect(symbolData) {
    const {
      symbol,
      display_name,
      yahoo_symbol,
      is_active = true,
      trading_enabled = true,
      min_trade_amount = 1,
      max_trade_amount = 100,
      strategy_config = null
    } = symbolData;

    const strategyConfigStr = strategy_config ? JSON.stringify(strategy_config) : null;

    return new Promise((resolve, reject) => {
      // Check if symbol exists
      this.db.get(
        'SELECT id FROM monitored_symbols WHERE symbol = ?',
        [symbol],
        (err, existing) => {
          if (err) {
            reject(err);
            return;
          }

          if (existing) {
            // Update existing
            this.db.run(
              `UPDATE monitored_symbols 
               SET display_name = ?, yahoo_symbol = ?, is_active = ?, trading_enabled = ?,
                   min_trade_amount = ?, max_trade_amount = ?, strategy_config = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE symbol = ?`,
              [display_name, yahoo_symbol, is_active ? 1 : 0, trading_enabled ? 1 : 0,
               min_trade_amount, max_trade_amount, strategyConfigStr, symbol],
              function(err) {
                if (err) reject(err);
                else resolve({ action: 'updated', changes: this.changes, symbol });
              }
            );
          } else {
            // Insert new
            this.db.run(
              `INSERT INTO monitored_symbols 
               (symbol, display_name, yahoo_symbol, is_active, trading_enabled,
                min_trade_amount, max_trade_amount, strategy_config)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [symbol, display_name, yahoo_symbol, is_active ? 1 : 0, trading_enabled ? 1 : 0,
               min_trade_amount, max_trade_amount, strategyConfigStr],
              function(err) {
                if (err) reject(err);
                else resolve({ action: 'inserted', id: this.lastID, symbol });
              }
            );
          }
        }
      );
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