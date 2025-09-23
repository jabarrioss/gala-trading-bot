const dotenv = require('dotenv');
const path = require('path');

class ConfigManager {
  constructor() {
    this.config = {};
    this.isInitialized = false;
  }

  /**
   * Initialize configuration by loading environment variables
   */
  init() {
    if (this.isInitialized) {
      return this.config;
    }

    // Load environment variables
    dotenv.config();

    // Define configuration with defaults and validation
    this.config = {
      // Environment
      NODE_ENV: process.env.NODE_ENV || 'development',
      PORT: parseInt(process.env.PORT) || 3000,

      // Blockchain Configuration
      PRIVATE_KEY: process.env.PRIVATE_KEY,
      WALLET_ADDRESS: process.env.WALLET_ADDRESS,

      // Trading Parameters
      DRY_RUN_MODE: process.env.DRY_RUN_MODE === 'true' || true, // Default to true for safety
      DEFAULT_SLIPPAGE: parseFloat(process.env.DEFAULT_SLIPPAGE) || 0.05,
      MAX_TRADE_SIZE: parseFloat(process.env.MAX_TRADE_SIZE) || 1000,
      DAILY_LOSS_LIMIT: parseFloat(process.env.DAILY_LOSS_LIMIT) || 500,

      // External APIs
      DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,

      // Database
      DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'trading.db'),

      // Logging
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      LOG_DIR: process.env.LOG_DIR || path.join(__dirname, '..', 'logs'),
    };

    // Validate required configuration
    this.validate();

    this.isInitialized = true;
    return this.config;
  }

  /**
   * Get configuration value
   * @param {string} key - Configuration key
   * @returns {*} Configuration value
   */
  get(key) {
    if (!this.isInitialized) {
      this.init();
    }
    return this.config[key];
  }

  /**
   * Get all configuration
   * @returns {Object} All configuration
   */
  getAll() {
    if (!this.isInitialized) {
      this.init();
    }
    return { ...this.config };
  }

  /**
   * Check if running in development mode
   * @returns {boolean}
   */
  isDevelopment() {
    return this.get('NODE_ENV') === 'development';
  }

  /**
   * Check if running in production mode
   * @returns {boolean}
   */
  isProduction() {
    return this.get('NODE_ENV') === 'production';
  }

  /**
   * Check if dry run mode is enabled
   * @returns {boolean}
   */
  isDryRun() {
    return this.get('DRY_RUN_MODE') === true;
  }

  /**
   * Validate required configuration
   * @throws {Error} If required configuration is missing
   */
  validate() {
    const required = ['PRIVATE_KEY', 'WALLET_ADDRESS'];
    const missing = [];

    for (const key of required) {
      if (!this.config[key]) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }

    // Validate wallet address format (only if provided)
    if (this.config.WALLET_ADDRESS && !this.config.WALLET_ADDRESS.startsWith('eth|')) {
      throw new Error('WALLET_ADDRESS must be in format: eth|123...abc');
    }

    // Validate numeric values
    if (this.config.DEFAULT_SLIPPAGE < 0 || this.config.DEFAULT_SLIPPAGE > 1) {
      throw new Error('DEFAULT_SLIPPAGE must be between 0 and 1');
    }
  }

  /**
   * Get masked configuration for logging (hide sensitive data)
   * @returns {Object} Masked configuration
   */
  getMaskedConfig() {
    const masked = { ...this.config };
    
    // Mask sensitive values
    if (masked.PRIVATE_KEY) {
      masked.PRIVATE_KEY = `${masked.PRIVATE_KEY.substring(0, 8)}...`;
    }
    if (masked.DISCORD_WEBHOOK_URL) {
      masked.DISCORD_WEBHOOK_URL = `${masked.DISCORD_WEBHOOK_URL.substring(0, 50)}...`;
    }

    return masked;
  }
}

// Export singleton instance
module.exports = new ConfigManager();