/**
 * Class to fetch price data from Gala Exchange API
 */
const ORACLE_URL = 'https://dex-backend-prod1.defi.gala.com/price-oracle/fetch-price';

const fetch = require('node-fetch');
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
    try {
      // Check cache first
      const cacheKey = `price_${symbol}`;
      if (this.cache[cacheKey] && (Date.now() - this.cache[cacheKey].timestamp) < this.cacheTimeout) {
        return this.cache[cacheKey].data;
      }

      // Build query parameters
      const params = new URLSearchParams({
        token: symbol,
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
      this.logger.error(`Failed to fetch price for ${symbol}:`, error);
      throw error;
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
