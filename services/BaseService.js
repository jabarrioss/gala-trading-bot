const config = require('../config/ConfigManager');

/**
 * Base service class that all services should extend
 * Provides common functionality like initialization, configuration access, and logging
 */
class BaseService {
  constructor(serviceName) {
    this.serviceName = serviceName || this.constructor.name;
    this.isInitialized = false;
    this.config = config;
    this.logger = null; // Will be set up in init()
  }

  /**
   * Initialize the service
   * Must be implemented by child classes
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    // Initialize configuration
    this.config.init();

    // Set up logging (basic console logging for now, can be enhanced)
    this.logger = {
      info: (message, ...args) => console.log(`[${this.serviceName}] INFO:`, message, ...args),
      warn: (message, ...args) => console.warn(`[${this.serviceName}] WARN:`, message, ...args),
      error: (message, ...args) => console.error(`[${this.serviceName}] ERROR:`, message, ...args),
      debug: (message, ...args) => {
        if (this.config.get('LOG_LEVEL') === 'debug') {
          console.log(`[${this.serviceName}] DEBUG:`, message, ...args);
        }
      }
    };

    this.logger.info(`${this.serviceName} initializing...`);

    // Call child class initialization
    await this.onInit();

    this.isInitialized = true;
    this.logger.info(`${this.serviceName} initialized successfully`);
  }

  /**
   * Child classes should implement this method for their specific initialization
   * @returns {Promise<void>}
   */
  async onInit() {
    // Override in child classes
  }

  /**
   * Get configuration value
   * @param {string} key - Configuration key
   * @returns {*} Configuration value
   */
  getConfig(key) {
    return this.config.get(key);
  }

  /**
   * Check if service is initialized
   * @returns {boolean}
   */
  isReady() {
    return this.isInitialized;
  }

  /**
   * Ensure service is initialized before performing operations
   * @throws {Error} If service is not initialized
   */
  ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error(`${this.serviceName} is not initialized. Call init() first.`);
    }
  }

  /**
   * Graceful shutdown
   * Override in child classes if cleanup is needed
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger?.info(`${this.serviceName} shutting down...`);
    // Override in child classes for cleanup
  }

  /**
   * Health check - override in child classes
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    return this.isInitialized;
  }
}

module.exports = BaseService;