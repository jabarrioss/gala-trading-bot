const BaseService = require('./BaseService');
const ConfigManager = require('../config/ConfigManager');
/**
 * CoinMarketCapService - Service for fetching cryptocurrency data from CoinMarketCap API
 */
class CoinMarketCapService extends BaseService {
  constructor() {
    super();
    this.apiKey = null;
    this.baseUrl = 'https://pro-api.coinmarketcap.com/v1';
    // this.logger = null;
  }

  async init() {
    ConfigManager.init();
    
    this.apiKey = ConfigManager.get('COINMARKETCAP_API_KEY');
    if (!this.apiKey) {
      throw new Error('CoinMarketCap API key not configured');
    }

    // this.logger.info('CoinMarketCapService initialized');
  }

  /**
   * Get current price and market data for GALA
   */
  async getGalaData() {
    try {
      const response = await fetch(`${this.baseUrl}/cryptocurrency/quotes/latest?symbol=GALA`, {
        headers: {
          'X-CMC_PRO_API_KEY': this.apiKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`CoinMarketCap API error: ${response.status}`);
      }

      const data = await response.json();
      const galaData = data.data.GALA;

      return {
        price: galaData.quote.USD.price,
        marketCap: galaData.quote.USD.market_cap,
        volume24h: galaData.quote.USD.volume_24h,
        percentChange1h: galaData.quote.USD.percent_change_1h,
        percentChange24h: galaData.quote.USD.percent_change_24h,
        percentChange7d: galaData.quote.USD.percent_change_7d,
        lastUpdated: galaData.last_updated
      };
    } catch (error) {
      // this.logger.error('Failed to fetch GALA data from CoinMarketCap:', error);
      throw error;
    }
  }

    /**
   * Get current price and market data for Any Symbol
   */
  async getCryptoData(symbol) {
    try {
      const response = await fetch(`${this.baseUrl}/cryptocurrency/quotes/latest?symbol=${symbol}`, {
        headers: {
          'X-CMC_PRO_API_KEY': this.apiKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`CoinMarketCap API error: ${response.status}`);
      }

      const data = await response.json();
      const cryptoData = data.data[symbol];

      return {
        price: cryptoData.quote.USD.price,
        marketCap: cryptoData.quote.USD.market_cap,
        volume24h: cryptoData.quote.USD.volume_24h,
        percentChange1h: cryptoData.quote.USD.percent_change_1h,
        percentChange24h: cryptoData.quote.USD.percent_change_24h,
        percentChange7d: cryptoData.quote.USD.percent_change_7d,
        lastUpdated: cryptoData.last_updated
      };
    } catch (error) {
      // this.logger.error(`Failed to fetch ${symbol} data from CoinMarketCap:`, error);
      throw error;
    }
  }

  /**
   * Get global cryptocurrency market metrics
   */
  async getGlobalMetrics() {
    try {
      const response = await fetch(`${this.baseUrl}/global-metrics/quotes/latest`, {
        headers: {
          'X-CMC_PRO_API_KEY': this.apiKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`CoinMarketCap API error: ${response.status}`);
      }

      const data = await response.json();
      const metrics = data.data;

      return {
        totalMarketCap: metrics.quote.USD.total_market_cap,
        total24hVolume: metrics.quote.USD.total_volume_24h,
        bitcoinDominance: metrics.btc_dominance,
        activeExchanges: metrics.active_exchanges,
        activeCryptocurrencies: metrics.active_cryptocurrencies
      };
    } catch (error) {
      // this.logger.error('Failed to fetch global metrics from CoinMarketCap:', error);
      throw error;
    }
  }

  async getGoldenCrossData(symbol = 'GALA', options = {}) {
    // CoinMarketCap does not provide historical data for calculating moving averages
    // This method would need to be implemented using another data source or by storing historical data over time
    throw new Error('getGoldenCrossData not implemented for CoinMarketCapService');
  }
}

module.exports = CoinMarketCapService;