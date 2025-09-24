const BaseService = require('./BaseService');
const yahooFinance = require('yahoo-finance2').default;

/**
 * Yahoo Finance Service - Handles fetching price data and market information
 */
class YahooFinanceService extends BaseService {
  constructor() {
    super('YahooFinanceService');
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache timeout
    this.databaseService = null;
  }

  /**
   * Initialize the Yahoo Finance service
   */
  async onInit() {
    try {
      this.cacheTimeout = parseInt(this.config.get('PRICE_CACHE_TIMEOUT_MS', '60000'));

      this.logger.info('Yahoo Finance service configuration:', {
        cacheTimeout: this.cacheTimeout
      });

      // Test connection by fetching current price for GALA-USD (default)
      // We'll test with other symbols later when they're available
      await this.getCurrentPrice('GALA-USD');
      
    } catch (error) {
      this.logger.error('Failed to initialize YahooFinanceService:', error);
      throw error;
    }
  }

  /**
   * Get database service (lazy initialization)
   * @returns {DatabaseService} Database service instance
   */
  getDatabaseService() {
    if (!this.databaseService) {
      const { ServiceManager } = require('./ServiceManager');
      this.databaseService = ServiceManager.getService('DatabaseService');
      
      if (!this.databaseService) {
        throw new Error('DatabaseService not available');
      }
    }
    return this.databaseService;
  }

  /**
   * Get active symbols from database
   * @returns {Promise<Array>} Array of active symbols
   */
  async getActiveSymbols() {
    try {
      const databaseService = this.getDatabaseService();
      return await databaseService.getMonitoredSymbols(true);
    } catch (error) {
      this.logger.error('Error getting active symbols:', error);
      throw error;
    }
  }

  /**
   * Get cache key for a request
   * @param {string} method - Method name
   * @param {Object} params - Parameters
   * @returns {string} - Cache key
   */
  getCacheKey(method, params = {}) {
    return `${method}_${JSON.stringify(params)}`;
  }

  /**
   * Check if cached data is valid
   * @param {Object} cacheEntry - Cache entry
   * @returns {boolean} - True if valid
   */
  isCacheValid(cacheEntry) {
    return cacheEntry && Date.now() - cacheEntry.timestamp < this.cacheTimeout;
  }

  /**
   * Get current price quote for a symbol
   * @param {string} yahooSymbol - Yahoo Finance symbol (e.g., 'GALA-USD')
   * @param {boolean} useCache - Whether to use cache (default: true)
   * @returns {Object} - Price information
   */
  async getCurrentPrice(yahooSymbol = 'GALA-USD', useCache = true) {
    const cacheKey = this.getCacheKey('getCurrentPrice', { symbol: yahooSymbol });
    
    try {
      // Check cache first
      if (useCache) {
        const cached = this.cache.get(cacheKey);
        if (this.isCacheValid(cached)) {
          this.logger.debug(`Returning cached price data for ${yahooSymbol}`);
          return cached.data;
        }
      }

      this.logger.debug(`Fetching current price for ${yahooSymbol}`);
      
      const quote = await yahooFinance.quote(yahooSymbol);
      
      const result = {
        success: true,
        symbol: yahooSymbol,
        price: quote.regularMarketPrice,
        previousClose: quote.regularMarketPreviousClose,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        timestamp: new Date().toISOString(),
        rawData: quote
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      this.logger.debug('Current price fetched:', {
        price: result.price,
        change: result.change,
        changePercent: result.changePercent
      });

      return result;

    } catch (error) {
      this.logger.error('Error fetching current price:', error);
      return {
        success: false,
        error: error.message,
        symbol: this.symbol,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get historical price data for a symbol
   * @param {string} yahooSymbol - Yahoo Finance symbol (e.g., 'GALA-USD')
   * @param {Object} options - Options for historical data
   * @returns {Object} - Historical price data
   */
  async getHistoricalData(yahooSymbol = 'GALA-USD', options = {}) {
    const {
      period1 = '2024-01-01', // Start date
      period2 = new Date().toISOString().split('T')[0], // End date (today)
      interval = '1d', // Daily intervals
      useCache = true
    } = options;

    const cacheKey = this.getCacheKey('getHistoricalData', { symbol: yahooSymbol, period1, period2, interval });

    try {
      // Check cache first (longer cache for historical data)
      if (useCache) {
        const cached = this.cache.get(cacheKey);
        if (this.isCacheValid(cached)) {
          this.logger.debug(`Returning cached historical data for ${yahooSymbol}`);
          return cached.data;
        }
      }

      this.logger.debug(`Fetching historical data for ${yahooSymbol}`, {
        period1,
        period2,
        interval
      });

      const history = await yahooFinance.historical(yahooSymbol, {
        period1,
        period2,
        interval
      });

      // Transform data for easier use
      const transformedData = history.map(item => ({
        date: item.date.toISOString().split('T')[0],
        timestamp: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
        adjClose: item.adjClose
      }));

      // Sort by date (newest first for indicator calculations)
      transformedData.sort((a, b) => new Date(b.date) - new Date(a.date));

      const result = {
        success: true,
        symbol: this.symbol,
        period1,
        period2,
        interval,
        count: transformedData.length,
        data: transformedData,
        prices: transformedData.map(item => item.close), // Just closing prices for indicators
        timestamp: new Date().toISOString()
      };

      // Cache the result (historical data changes less frequently)
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      this.logger.debug('Historical data fetched:', {
        count: result.count,
        dateRange: `${period1} to ${period2}`,
        latestPrice: transformedData[0]?.close
      });

      return result;

    } catch (error) {
      this.logger.error('Error fetching historical data:', error);
      return {
        success: false,
        error: error.message,
        symbol: this.symbol,
        period1,
        period2,
        interval,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get historical data suitable for Golden Cross analysis
   * @param {string} yahooSymbol - Yahoo Finance symbol (e.g., 'GALA-USD')
   * @param {Object} options - Options
   * @returns {Object} - Historical data with sufficient lookback
   */
  async getGoldenCrossData(yahooSymbol = 'GALA-USD', options = {}) {
    const {
      lookbackDays = 250, // Need at least 200 days for 200-day MA + buffer
      interval = '1d'
    } = options;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - lookbackDays);

    return await this.getHistoricalData(yahooSymbol, {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
      interval,
      ...options
    });
  }

  /**
   * Get market summary information
   * @returns {Object} - Market summary
   */
  async getMarketSummary() {
    const cacheKey = this.getCacheKey('getMarketSummary');

    try {
      // Check cache
      const cached = this.cache.get(cacheKey);
      if (this.isCacheValid(cached)) {
        return cached.data;
      }

      const quote = await yahooFinance.quote(this.symbol);
      
      const result = {
        success: true,
        symbol: this.symbol,
        summary: {
          price: quote.regularMarketPrice,
          dayRange: {
            low: quote.regularMarketDayLow,
            high: quote.regularMarketDayHigh
          },
          fiftyTwoWeekRange: {
            low: quote.fiftyTwoWeekLow,
            high: quote.fiftyTwoWeekHigh
          },
          volume: quote.regularMarketVolume,
          avgVolume: quote.averageVolume,
          marketCap: quote.marketCap,
          peRatio: quote.trailingPE,
          eps: quote.trailingEps,
          beta: quote.beta
        },
        timestamp: new Date().toISOString()
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      this.logger.error('Error fetching market summary:', error);
      return {
        success: false,
        error: error.message,
        symbol: this.symbol,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Clear cache
   * @param {string} key - Optional specific key to clear
   */
  clearCache(key = null) {
    if (key) {
      this.cache.delete(key);
      this.logger.debug(`Cleared cache for key: ${key}`);
    } else {
      this.cache.clear();
      this.logger.debug('Cleared all cache');
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache stats
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp < this.cacheTimeout) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      cacheTimeout: this.cacheTimeout
    };
  }

  /**
   * Get current prices for all monitored symbols
   * @param {boolean} useCache - Whether to use cache (default: true)
   * @returns {Object} - Map of symbol to price data
   */
  async getAllCurrentPrices(useCache = true) {
    try {
      const symbols = await this.getActiveSymbols();
      const prices = {};
      
      // Fetch prices for all symbols concurrently
      const pricePromises = symbols.map(async (symbolData) => {
        try {
          const priceData = await this.getCurrentPrice(symbolData.yahoo_symbol, useCache);
          prices[symbolData.symbol] = {
            ...priceData,
            displayName: symbolData.display_name,
            symbolData
          };
        } catch (error) {
          this.logger.error(`Error fetching price for ${symbolData.symbol}:`, error);
          prices[symbolData.symbol] = {
            success: false,
            error: error.message,
            symbolData
          };
        }
      });

      await Promise.all(pricePromises);
      
      return {
        success: true,
        prices,
        count: Object.keys(prices).length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Error getting all current prices:', error);
      throw error;
    }
  }

  /**
   * Get historical data for all monitored symbols
   * @param {Object} options - Options for historical data
   * @returns {Object} - Map of symbol to historical data
   */
  async getAllHistoricalData(options = {}) {
    try {
      const symbols = await this.getActiveSymbols();
      const historicalData = {};
      
      // Fetch historical data for all symbols concurrently
      const dataPromises = symbols.map(async (symbolData) => {
        try {
          const data = await this.getHistoricalData(symbolData.yahoo_symbol, options);
          historicalData[symbolData.symbol] = {
            ...data,
            displayName: symbolData.display_name,
            symbolData
          };
        } catch (error) {
          this.logger.error(`Error fetching historical data for ${symbolData.symbol}:`, error);
          historicalData[symbolData.symbol] = {
            success: false,
            error: error.message,
            symbolData
          };
        }
      });

      await Promise.all(dataPromises);
      
      return {
        success: true,
        data: historicalData,
        count: Object.keys(historicalData).length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Error getting all historical data:', error);
      throw error;
    }
  }

  /**
   * Get service status
   * @returns {Object} - Service status
   */
  async getStatus() {
    try {
      const activeSymbols = await this.getActiveSymbols();
      
      return {
        serviceName: this.serviceName,
        isInitialized: this.isInitialized,
        cacheTimeout: this.cacheTimeout,
        activeSymbols: activeSymbols.map(s => ({
          symbol: s.symbol,
          yahoo_symbol: s.yahoo_symbol,
          display_name: s.display_name
        })),
        cacheStats: this.getCacheStats()
      };
    } catch (error) {
      return {
        serviceName: this.serviceName,
        isInitialized: this.isInitialized,
        cacheTimeout: this.cacheTimeout,
        error: error.message,
        cacheStats: this.getCacheStats()
      };
    }
  }
}

module.exports = YahooFinanceService;