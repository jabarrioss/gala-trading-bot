const BaseService = require('./BaseService');
const { GSwap, PrivateKeySigner } = require('@gala-chain/gswap-sdk');
const { detectGoldenCross, detectRSISignal, calculateRSI } = require('../utils/indicators');

/**
 * Trading Service - Handles trade execution and strategy implementation
 * Follows the Golden Cross strategy for GALA trading
 */
class TradingService extends BaseService {
  constructor() {
    super('TradingService');
    this.gSwap = null;
    this.isDryRun = true; // Default to dry run for safety
    this.defaultSlippage = 0.05; // 5% default slippage
    this.minTradeAmount = 1; // Minimum GALA amount to trade
    this.maxTradeAmount = 100; // Maximum GALA amount to trade
    this.lastTradeTime = null;
    this.minTimeBetweenTrades = 60 * 60 * 1000; // 1 hour minimum between trades
    this.databaseService = null;
    this.walletAddress = null;
  }

  /**
   * Get database service (lazy initialization)
   * @returns {DatabaseService} Database service instance
   */
  getDatabaseService() {
    if (!this.databaseService) {
      const ServiceManager = require('./ServiceManager');
      this.databaseService = ServiceManager.get('database');
      if (!this.databaseService) {
        throw new Error('DatabaseService not available');
      }
    }
    return this.databaseService;
  }

  /**
   * Get trading symbols from database
   * @returns {Promise<Array>} Array of trading-enabled symbols with gala_symbol
   */
  async getTradingSymbols() {
    try {
      const databaseService = this.getDatabaseService();
      return await databaseService.getTradingSymbols();
    } catch (error) {
      this.logger.error('Error getting trading symbols:', error);
      throw error;
    }
  }

  /**
   * Initialize the trading service
   */
  async onInit() {
    try {
      // Initialize configuration
      this.isDryRun = this.config.get('DRY_RUN_MODE', 'true') === 'true';
      this.defaultSlippage = parseFloat(this.config.get('DEFAULT_SLIPPAGE', '0.05'));
      this.minTradeAmount = parseFloat(this.config.get('MIN_TRADE_AMOUNT', '1'));
      this.maxTradeAmount = parseFloat(this.config.get('MAX_TRADE_AMOUNT', '100'));
      this.minTimeBetweenTrades = parseInt(this.config.get('MIN_TIME_BETWEEN_TRADES_MS', '3600000'));
      this.walletAddress = this.config.get('WALLET_ADDRESS');

      this.logger.info('Trading configuration:', {
        isDryRun: this.isDryRun,
        defaultSlippage: this.defaultSlippage,
        minTradeAmount: this.minTradeAmount,
        maxTradeAmount: this.maxTradeAmount,
        minTimeBetweenTrades: this.minTimeBetweenTrades
      });

      // Validate required environment variables
      const privateKey = this.config.get('PRIVATE_KEY');
      if (!privateKey) {
        throw new Error('PRIVATE_KEY environment variable is required');
      }

      // Initialize GSwap connection (but don't connect event socket yet)
      this.gSwap = new GSwap({
        signer: new PrivateKeySigner(privateKey),
      });

      this.logger.info('GSwap client initialized');

    } catch (error) {
      this.logger.error('Failed to initialize TradingService:', error);
      throw error;
    }
  }

  /**
   * Connect to GSwap event socket
   */
  async connectEventSocket() {
    try {
      await GSwap.events.connectEventSocket();
      this.logger.info('Connected to GSwap event socket');
    } catch (error) {
      this.logger.error('Failed to connect to GSwap event socket:', error);
      throw error;
    }
  }

  /**
   * Disconnect from GSwap event socket
   */
  async disconnectEventSocket() {
    try {
      GSwap.events.disconnectEventSocket();
      this.logger.info('Disconnected from GSwap event socket');
    } catch (error) {
      this.logger.error('Failed to disconnect from GSwap event socket:', error);
    }
  }

  /**
   * Analyze price data and generate trading signals using Golden Cross strategy
   * @param {number[]} prices - Array of historical prices (newest first)
   * @param {Object} options - Analysis options
   * @returns {Object} - Analysis result with signals
   */
  analyzeGoldenCrossStrategy(prices, options = {}) {
    const {
      shortPeriod = 50,
      longPeriod = 200,
      useRSI = true,
      rsiPeriod = 14
    } = options;

    try {
      // Detect Golden Cross signal
      const goldenCrossSignal = detectGoldenCross(prices, shortPeriod, longPeriod);
      
      // Calculate RSI for additional confirmation
      let rsiSignal = null;
      if (useRSI) {
        const rsi = calculateRSI(prices, rsiPeriod);
        rsiSignal = detectRSISignal(rsi);
      }

      // Combine signals for final decision
      let finalSignal = null;
      let confidence = 0;
      let reasons = [];

      if (goldenCrossSignal.signal === 'BUY') {
        finalSignal = 'BUY';
        confidence += 0.7; // Golden Cross has high weight
        reasons.push(goldenCrossSignal.reason);

        // RSI confirmation
        if (rsiSignal && rsiSignal.signal === 'BUY') {
          confidence += 0.3;
          reasons.push(rsiSignal.reason);
        } else if (rsiSignal && rsiSignal.signal === 'SELL') {
          confidence -= 0.2; // Conflicting signal reduces confidence
          reasons.push(`RSI conflict: ${rsiSignal.reason}`);
        }
      } else if (goldenCrossSignal.signal === 'SELL') {
        finalSignal = 'SELL';
        confidence += 0.7;
        reasons.push(goldenCrossSignal.reason);

        // RSI confirmation
        if (rsiSignal && rsiSignal.signal === 'SELL') {
          confidence += 0.3;
          reasons.push(rsiSignal.reason);
        } else if (rsiSignal && rsiSignal.signal === 'BUY') {
          confidence -= 0.2;
          reasons.push(`RSI conflict: ${rsiSignal.reason}`);
        }
      }

      return {
        signal: finalSignal,
        confidence: Math.min(confidence, 1.0), // Cap at 1.0
        reasons: reasons,
        goldenCross: goldenCrossSignal,
        rsi: rsiSignal,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Error analyzing Golden Cross strategy:', error);
      return {
        signal: null,
        confidence: 0,
        reasons: ['Analysis error: ' + error.message],
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get quote for exact input swap
   * @param {string} fromToken - From token identifier
   * @param {string} toToken - To token identifier  
   * @param {number} amount - Amount to swap
   * @returns {Object} - Quote information
   */
  async getQuote(fromToken, toToken, amount) {
    try {
      if (!this.gSwap) {
        throw new Error('GSwap not initialized');
      }

      const quote = await this.gSwap.quoting.quoteExactInput(
        fromToken,
        toToken,
        amount
      );

      this.logger.debug('Quote received:', {
        fromToken,
        toToken,
        inputAmount: amount,
        outputAmount: quote.outTokenAmount.toString(),
        feeTier: quote.feeTier
      });

      return {
        success: true,
        quote: quote,
        inputAmount: amount,
        outputAmount: quote.outTokenAmount,
        feeTier: quote.feeTier,
        priceImpact: quote.priceImpact
      };

    } catch (error) {
      this.logger.error('Error getting quote:', error);
      return {
        success: false,
        error: error.message,
        quote: null
      };
    }
  }

  /**
   * Get quote for a monitored symbol (GALA to GUSDC by default)
   * @param {string} symbol - Symbol identifier (e.g., 'GALA')
   * @param {number} amount - Amount to quote
   * @param {string} toToken - Target token (default: 'GUSDC|Unit|none|none')
   * @returns {Object} - Quote information with symbol context
   */
  async getQuoteForSymbol(symbol, amount, toToken = 'GUSDC|Unit|none|none') {
    try {
      const databaseService = this.getDatabaseService();
      const symbolData = await databaseService.getMonitoredSymbol(symbol);
      
      if (!symbolData) {
        throw new Error(`Symbol ${symbol} not found in monitored symbols`);
      }

      if (!symbolData.is_active || !symbolData.trading_enabled) {
        throw new Error(`Symbol ${symbol} is not enabled for trading`);
      }

      if (!symbolData.gala_symbol) {
        throw new Error(`Symbol ${symbol} missing gala_symbol for trading`);
      }

      // Validate amount against symbol limits
      if (amount < symbolData.min_trade_amount) {
        throw new Error(`Amount ${amount} below minimum ${symbolData.min_trade_amount} for ${symbol}`);
      }

      if (amount > symbolData.max_trade_amount) {
        throw new Error(`Amount ${amount} above maximum ${symbolData.max_trade_amount} for ${symbol}`);
      }

      const quote = await this.getQuote(symbolData.gala_symbol, toToken, amount);
      
      return {
        ...quote,
        symbol: symbol,
        symbolData: symbolData,
        fromToken: symbolData.gala_symbol,
        toToken: toToken
      };

    } catch (error) {
      this.logger.error(`Error getting quote for symbol ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        symbol: symbol
      };
    }
  }

  /**
   * Execute a swap trade
   * @param {string} fromToken - From token identifier
   * @param {string} toToken - To token identifier
   * @param {number} amount - Amount to swap
   * @param {Object} options - Trade options
   * @returns {Object} - Trade execution result
   */
  async executeSwap(fromToken, toToken, amount, options = {}) {
    const {
      slippage = this.defaultSlippage,
      dryRun = this.isDryRun
    } = options;

    try {
      // Validate trade amount
      if (amount < this.minTradeAmount || amount > this.maxTradeAmount) {
        throw new Error(`Trade amount ${amount} outside allowed range [${this.minTradeAmount}, ${this.maxTradeAmount}]`);
      }

      // Check minimum time between trades
      if (this.lastTradeTime && Date.now() - this.lastTradeTime < this.minTimeBetweenTrades) {
        const timeLeft = Math.ceil((this.minTimeBetweenTrades - (Date.now() - this.lastTradeTime)) / 60000);
        throw new Error(`Must wait ${timeLeft} minutes before next trade`);
      }

      // Get quote first
      const quoteResult = await this.getQuote(fromToken, toToken, amount);
      if (!quoteResult.success) {
        throw new Error(`Failed to get quote: ${quoteResult.error}`);
      }

      const quote = quoteResult.quote;
      const minimumOutput = quote.outTokenAmount.multipliedBy(1 - slippage);

      this.logger.info('Executing swap:', {
        fromToken,
        toToken,
        amount,
        expectedOutput: quote.outTokenAmount.toString(),
        minimumOutput: minimumOutput.toString(),
        slippage: slippage * 100 + '%',
        feeTier: quote.feeTier,
        dryRun
      });

      if (dryRun) {
        this.logger.info('DRY RUN: Trade would be executed with above parameters');
        return {
          success: true,
          dryRun: true,
          quote: quoteResult,
          expectedOutput: quote.outTokenAmount.toString(),
          minimumOutput: minimumOutput.toString(),
          message: 'Dry run completed successfully'
        };
      }

      // Execute actual swap
      await this.connectEventSocket();
      
      try {
        const pendingTx = await this.gSwap.swaps.swap(
          fromToken,
          toToken,
          quote.feeTier,
          {
            exactIn: amount,
            amountOutMinimum: minimumOutput
          }
          , this.walletAddress
        );

        this.lastTradeTime = Date.now();

        this.logger.info('Trade executed successfully:', {
          transactionId: pendingTx.transactionId,
          fromToken,
          toToken,
          amount,
          feeTier: quote.feeTier
        });

        return {
          success: true,
          dryRun: false,
          transaction: pendingTx,
          quote: quoteResult,
          executedAt: new Date().toISOString()
        };

      } finally {
        await this.disconnectEventSocket();
      }

    } catch (error) {
      this.logger.error('Error executing swap:', error);
      return {
        success: false,
        error: error.message,
        dryRun,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Execute a swap for a monitored symbol
   * @param {string} symbol - Symbol identifier (e.g., 'GALA')
   * @param {number} amount - Amount to swap
   * @param {Object} options - Trade options
   * @returns {Object} - Trade execution result with symbol context
   */
  async executeSwapForSymbol(symbol, amount, options = {}) {
    const { toToken = 'GUSDC|Unit|none|none', dryRun = this.isDryRun } = options;
    
    try {
      const databaseService = this.getDatabaseService();
      const symbolData = await databaseService.getMonitoredSymbol(symbol);
      
      if (!symbolData) {
        throw new Error(`Symbol ${symbol} not found in monitored symbols`);
      }

      if (!symbolData.is_active || !symbolData.trading_enabled) {
        throw new Error(`Symbol ${symbol} is not enabled for trading`);
      }

      if (!symbolData.gala_symbol) {
        throw new Error(`Symbol ${symbol} missing gala_symbol for trading`);
      }

      // Use symbol-specific trade limits if not overridden
      const effectiveAmount = Math.min(
        Math.max(amount, symbolData.min_trade_amount),
        symbolData.max_trade_amount
      );

      if (effectiveAmount !== amount) {
        this.logger.warn(`Amount adjusted for ${symbol}: ${amount} -> ${effectiveAmount}`);
      }

      const result = await this.executeSwap(symbolData.gala_symbol, toToken, effectiveAmount, {
        ...options,
        dryRun
      });
      
      return {
        ...result,
        symbol: symbol,
        symbolData: symbolData,
        fromToken: symbolData.gala_symbol,
        toToken: toToken,
        effectiveAmount: effectiveAmount,
        originalAmount: amount
      };

    } catch (error) {
      this.logger.error(`Error executing swap for symbol ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        symbol: symbol
      };
    }
  }

  /**
   * Execute Golden Cross strategy trade
   * @param {Object} analysis - Strategy analysis result
   * @param {number} amount - Trade amount
   * @param {Object} options - Trade options
   * @returns {Object} - Trade result
   */
  async executeGoldenCrossStrategy(analysis, amount, options = {}) {
    const { minimumConfidence = 0.6 } = options;

    try {
      if (!analysis || !analysis.signal) {
        return {
          success: false,
          error: 'No valid trading signal',
          analysis
        };
      }

      if (analysis.confidence < minimumConfidence) {
        return {
          success: false,
          error: `Confidence ${analysis.confidence.toFixed(2)} below minimum ${minimumConfidence}`,
          analysis
        };
      }

      let tradeResult;

      if (analysis.signal === 'BUY') {
        // Buy GALA with GUSDC
        tradeResult = await this.executeSwap(
          'GUSDC|Unit|none|none',
          'GALA|Unit|none|none',
          amount,
          options
        );
      } else if (analysis.signal === 'SELL') {
        // Sell GALA for GUSDC
        tradeResult = await this.executeSwap(
          'GALA|Unit|none|none',
          'GUSDC|Unit|none|none',
          amount,
          options
        );
      }

      return {
        success: tradeResult?.success || false,
        signal: analysis.signal,
        confidence: analysis.confidence,
        reasons: analysis.reasons,
        trade: tradeResult,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Error executing Golden Cross strategy:', error);
      return {
        success: false,
        error: error.message,
        analysis,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get current trading status and configuration
   * @returns {Object} - Trading service status
   */
  getStatus() {
    return {
      serviceName: this.serviceName,
      isInitialized: this.isInitialized,
      isDryRun: this.isDryRun,
      configuration: {
        defaultSlippage: this.defaultSlippage,
        minTradeAmount: this.minTradeAmount,
        maxTradeAmount: this.maxTradeAmount,
        minTimeBetweenTrades: this.minTimeBetweenTrades
      },
      lastTradeTime: this.lastTradeTime,
      canTrade: !this.lastTradeTime || Date.now() - this.lastTradeTime >= this.minTimeBetweenTrades
    };
  }
}

module.exports = TradingService;