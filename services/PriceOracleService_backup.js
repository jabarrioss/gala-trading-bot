/**
 * Class to fetch price data from Gala       if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the response
      this.cache[cacheKey] = {
        data,
        timestamp: Date.now()
      };

      return data;
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${symbol} (API symbol: ${apiSymbol}): ${error.message}`, error);
      throw error;
    }
  }
const ORACLE_URL = 'https://dex-backend-prod1.defi.gala.com/price-oracle/fetch-price';

const BaseService = require('./BaseService');
const ConfigManager = require('../config/ConfigManager');
class PriceOracleService extends BaseService {
  constructor() {
    super();
    this.cacheTimestamp = 0;
    this.cacheTimeout = 60000; // Default cache timeout 60 seconds
  }

  /**
   * Fetch the current price for a specific cryptocurrency symbol using gala_symbol
   * The ORACLE_URL is a get endpoint that accepts 4 query parameters:
   * - token: The symbol of the cryptocurrency (e.g., GALA, BTC, ETH) in gala_symbol format
   * - page: Page number for pagination (default: 1)
   * - limit: Number of results per page (maximum: 50, default: 1)
   * - from: 2025-09-03T12:30:45Z (ISO 8601 format) - Start date for fetching historical prices
   * 
   */
  async fetchPrice(symbol) {
    // Convert pipe symbols to dollar symbols for API calls
    // Database uses GALA|Unit|none|none for swaps, but API expects GALA$Unit$none$none for prices
    const apiSymbol = symbol.replace(/\|/g, '$');
    
    try {
      // Check cache first
      const cacheKey = `price_${symbol}`;
      if (this.cache[cacheKey] && (Date.now() - this.cache[cacheKey].timestamp) < this.cacheTimeout) {
        return this.cache[cacheKey].data;
      }

      // Build query parameters
      const params = new URLSearchParams({
        token: apiSymbol,
        page: 1,
        limit: 1
      });

      const response = await fetch(`${ORACLE_URL}?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the response
      this.cache[cacheKey] = {
        data,
        timestamp: Date.now()
      };

      return data;
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${symbol} (API symbol: ${apiSymbol}): ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Get current price in Yahoo Finance compatible format
   * @param {string} galaSymbol - Gala symbol format (e.g., 'GALA|Unit|none|none')
   * @param {boolean} useCache - Whether to use cached data
   * @returns {Object} - Price data in Yahoo Finance format
   */
  async getCurrentPrice(galaSymbol, useCache = true) {
    try {
      // Check for null or undefined gala_symbol
      if (!galaSymbol) {
        return {
          success: false,
          error: 'gala_symbol is null or undefined',
          symbol: galaSymbol
        };
      }

      // Use the full gala_symbol format directly
      const data = await this.fetchPrice(galaSymbol);
      
      if (!data || !data.data || data.data.length === 0) {
        return {
          success: false,
          error: `No price data found for ${galaSymbol}`,
          symbol: galaSymbol
        };
      }

      const priceData = data.data[0];
      
      return {
        success: true,
        symbol: galaSymbol,
        price: parseFloat(priceData.price),
        previousClose: parseFloat(priceData.price), // Oracle doesn't provide previous close
        change: 0, // Oracle doesn't provide change data
        changePercent: 0, // Oracle doesn't provide change percentage
        volume: 0, // Oracle doesn't provide volume
        marketCap: 0, // Oracle doesn't provide market cap
        timestamp: priceData.createdAt || new Date().toISOString(),
        rawData: priceData
      };

    } catch (error) {
      this.logger.error(`Failed to get current price for ${galaSymbol}:`, error);
      return {
        success: false,
        error: error.message,
        symbol: galaSymbol
      };
    }
  }

  /**
   * Get historical data for Golden Cross analysis
   * @param {string} galaSymbol - Gala symbol format
   * @param {Object} options - Options including lookbackDays
   * @returns {Object} - Historical data compatible with Golden Cross analysis
   */
  async getGoldenCrossData(galaSymbol, options = {}) {
    const {
      lookbackDays = 250
    } = options;

    try {
      // Check for null or undefined gala_symbol
      if (!galaSymbol) {
        return {
          success: false,
          error: 'gala_symbol is null or undefined',
          symbol: galaSymbol
        };
      }

      // Use the full gala_symbol format directly
      // Calculate start date
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - lookbackDays);

      // Convert pipe symbols to dollar symbols for API calls
      const apiSymbol = galaSymbol.replace(/\|/g, '$');
      
      // Build query parameters for historical data
      const params = new URLSearchParams({
        token: apiSymbol,
        page: 1,
        limit: 50, // Maximum allowed
        from: startDate.toISOString()
      });

      const response = await fetch(`${ORACLE_URL}?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data || !data.data || data.data.length === 0) {
        return {
          success: false,
          error: `No historical data found for ${galaSymbol}`,
          symbol: galaSymbol
        };
      }

      // Convert to format expected by Golden Cross analysis
      // Note: Oracle data might be limited, so we'll work with what we have
      const prices = data.data.map(item => parseFloat(item.price)).reverse(); // Newest first
      
      if (prices.length < 50) {
        this.logger.warn(`Limited historical data for ${galaSymbol}: only ${prices.length} data points`);
      }

      return {
        success: true,
        symbol: galaSymbol,
        prices: prices,
        count: prices.length,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        rawData: data.data
      };

    } catch (error) {
      this.logger.error(`Failed to get Golden Cross data for ${galaSymbol}:`, error);
      return {
        success: false,
        error: error.message,
        symbol: galaSymbol
      };
    }
  }

  /**
   * Initialize the service
   */
  async init() {
    await super.init();
    this.cache = {};
    this.logger.info('PriceOracleService initialized');
  }
}

module.exports = PriceOracleService;
