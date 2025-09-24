const config = require('../config/ConfigManager');
const DatabaseService = require('./DatabaseService');
const TradingService = require('./TradingService');
const YahooFinanceService = require('./YahooFinanceService');
const NotificationService = require('./NotificationService');
const CoinMarketCapService = require('./CoinMarketCapService');
const BinanceService = require('./BinanceService');
/**
 * Service initialization and management
 */
class ServiceManager {
  constructor() {
    this.services = new Map();
    this.initializationOrder = [];
  }

  /**
   * Register a service
   * @param {string} name - Service name
   * @param {BaseService} service - Service instance
   * @param {number} priority - Initialization priority (lower = earlier)
   */
  register(name, service, priority = 100) {
    this.services.set(name, { service, priority });
    
    // Update initialization order
    this.initializationOrder = Array.from(this.services.entries())
      .sort(([,a], [,b]) => a.priority - b.priority)
      .map(([name]) => name);
  }

  /**
   * Initialize all registered services in priority order
   * @returns {Promise<void>}
   */
  async initializeAll() {
    console.log('🚀 Initializing services...');
    
    // First initialize configuration
    config.init();
    console.log('✅ Configuration initialized');

    for (const serviceName of this.initializationOrder) {
      const { service } = this.services.get(serviceName);
      
      try {
        await service.init();
        console.log(`✅ ${serviceName} initialized`);
      } catch (error) {
        console.error(`❌ Failed to initialize ${serviceName}:`, error);
        throw error;
      }
    }

    console.log('🎉 All services initialized successfully');
  }

  /**
   * Shutdown all services in reverse order
   * @returns {Promise<void>}
   */
  async shutdownAll() {
    console.log('🛑 Shutting down services...');
    
    const reverseOrder = [...this.initializationOrder].reverse();
    
    for (const serviceName of reverseOrder) {
      const { service } = this.services.get(serviceName);
      
      try {
        await service.shutdown();
        console.log(`✅ ${serviceName} shut down`);
      } catch (error) {
        console.error(`❌ Error shutting down ${serviceName}:`, error);
      }
    }

    console.log('✅ All services shut down');
  }

  /**
   * Get a service instance
   * @param {string} name - Service name
   * @returns {BaseService} Service instance
   */
  get(name) {
    const serviceInfo = this.services.get(name);
    if (!serviceInfo) {
      throw new Error(`Service '${name}' not found`);
    }
    return serviceInfo.service;
  }

  /**
   * Check if a service is registered
   * @param {string} name - Service name
   * @returns {boolean}
   */
  has(name) {
    return this.services.has(name);
  }

  /**
   * Perform health checks on all services
   * @returns {Promise<Object>} Health status of all services
   */
  async healthCheck() {
    const health = {
      overall: 'healthy',
      services: {}
    };

    for (const [serviceName, { service }] of this.services) {
      try {
        const isHealthy = await service.healthCheck();
        health.services[serviceName] = {
          status: isHealthy ? 'healthy' : 'unhealthy',
          initialized: service.isReady()
        };

        if (!isHealthy) {
          health.overall = 'degraded';
        }
      } catch (error) {
        health.services[serviceName] = {
          status: 'error',
          error: error.message,
          initialized: service.isReady()
        };
        health.overall = 'unhealthy';
      }
    }

    return health;
  }
}

// Create singleton instance and register core services
const serviceManager = new ServiceManager();

// Register core services with priorities
serviceManager.register('database', DatabaseService, 10); // High priority (low number)
serviceManager.register('yahooFinance', new YahooFinanceService(), 20); // Data service
serviceManager.register('notification', new NotificationService(), 30); // Notification service
serviceManager.register('trading', new TradingService(), 40); // Trading service (depends on others)
serviceManager.register('coinMarketCap', new CoinMarketCapService(), 25); // CoinMarketCap service

// Setup graceful shutdown (only in production or when explicitly enabled)
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_SIGNAL_HANDLERS === 'true') {
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await serviceManager.shutdownAll();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await serviceManager.shutdownAll();
    process.exit(0);
  });

  console.log('🔒 Signal handlers registered for graceful shutdown');
}

module.exports = serviceManager;