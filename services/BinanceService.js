const BaseService = require('./BaseService');
const ConfigManager = require('../config/ConfigManager');

class BinanceService extends BaseService {
  constructor() {
    super();
    this.client = null;
    this.isInitialized = false;
  }

  async init() {
    try {
      // Import Binance API client
      const { Spot } = require('@binance/connector');
      
      const config = ConfigManager.getInstance();
      const apiKey = config.get('BINANCE_API_KEY');
      const apiSecret = config.get('BINANCE_API_SECRET');
      
      if (!apiKey || !apiSecret) {
        throw new Error('Binance API credentials not found in environment');
      }

      // Initialize Binance client
      this.client = new Spot(apiKey, apiSecret, {
        baseURL: config.get('BINANCE_BASE_URL', 'https://api.binance.com')
      });

      this.isInitialized = true;
      this.logger.info('BinanceService initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize BinanceService:', error);
      throw error;
    }
  }

  async getPrice(symbol = 'GALAUSDT') {
    if (!this.isInitialized) {
      throw new Error('BinanceService not initialized');
    }

    try {
      const response = await this.client.tickerPrice(symbol);
      return {
        symbol: response.data.symbol,
        price: parseFloat(response.data.price),
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error(`Failed to get price for ${symbol}:`, error);
      throw error;
    }
  }

  async getKlines(symbol = 'GALAUSDT', interval = '1d', limit = 200) {
    if (!this.isInitialized) {
      throw new Error('BinanceService not initialized');
    }

    try {
      const response = await this.client.klines(symbol, interval, { limit });
      return response.data.map(kline => ({
        openTime: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        closeTime: kline[6]
      }));
    } catch (error) {
      this.logger.error(`Failed to get klines for ${symbol}:`, error);
      throw error;
    }
  }

  async get24hrStats(symbol = 'GALAUSDT') {
    if (!this.isInitialized) {
      throw new Error('BinanceService not initialized');
    }

    try {
      const response = await this.client.ticker24hr(symbol);
      return {
        symbol: response.data.symbol,
        priceChange: parseFloat(response.data.priceChange),
        priceChangePercent: parseFloat(response.data.priceChangePercent),
        weightedAvgPrice: parseFloat(response.data.weightedAvgPrice),
        lastPrice: parseFloat(response.data.lastPrice),
        volume: parseFloat(response.data.volume),
        high: parseFloat(response.data.highPrice),
        low: parseFloat(response.data.lowPrice),
        openPrice: parseFloat(response.data.openPrice),
        timestamp: response.data.closeTime
      };
    } catch (error) {
      this.logger.error(`Failed to get 24hr stats for ${symbol}:`, error);
      throw error;
    }
  }

  async shutdown() {
    this.isInitialized = false;
    this.logger.info('BinanceService shut down');
  }

  async getGoldenCrossData(symbol = 'GALAUSDT', options = {}) {
    const {
      lookbackDays = 250, // Need at least 200 days for 200-day MA + buffer
      interval = '1d'
    } = options;
    const klines = await this.getKlines(symbol, interval, lookbackDays);
    if (klines.length < 200) {
      throw new Error('Not enough data to calculate moving averages');
    }
    const closingPrices = klines.map(k => k.close);

    const calculateSMA = (data, period) => {
      const sma = [];
      for (let i = 0; i <= data.length - period; i++) {
        const slice = data.slice(i, i + period);
        const sum = slice.reduce((acc, val) => acc + val, 0);
        sma.push(sum / period);
      }
      return sma;
    };
    const sma50 = calculateSMA(closingPrices, 50);
    const sma200 = calculateSMA(closingPrices, 200);
    const alignedSMA200 = sma200.slice(sma200.length - sma50.length);

    let goldenCross = null;
    for (let i = 1; i < sma50.length; i++) {
      if (sma50[i - 1] < alignedSMA200[i - 1] && sma50[i] >= alignedSMA200[i]) {
        goldenCross = {
          date: new Date(klines[i + 199].closeTime),
          price: closingPrices[i + 199]
        };
        break;
      }
  }

    return {
      goldenCross
    };
  }

}

module.exports = BinanceService;