const BaseService = require('./BaseService');
const { GSwap, PrivateKeySigner } = require('@gala-chain/gswap-sdk');
const { detectGoldenCross, detectRSISignal, calculateRSI, analyzeDCAStrategy } = require('../utils/indicators');
const { calculatePnLPercentage, shouldBuyback, calculateExpectedBuyback, calculateFinalPnL, formatPnL } = require('../utils/pnl');

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
   * Get GALA balance from wallet
   * @returns {Promise<Object>} GALA balance information
   */
  async getGalaBalance() {
    try {
      if (!this.gSwap) {
        throw new Error('GSwap client not initialized');
      }

      if (!this.walletAddress) {
        throw new Error('Wallet address not configured');
      }

      // Get wallet assets
      const assets = await this.gSwap.assets.getUserAssets(
        this.walletAddress,
        1, // page number
        20 // limit - get more tokens to ensure we find GALA
      );

      // Find GALA token
      const galaToken = assets.tokens.find(token => 
        token.symbol === 'GALA' || token.symbol === 'GALA|Unit|none|none'
      );

      if (!galaToken) {
        return {
          success: true,
          balance: 0,
          hasGala: false,
          message: 'No GALA tokens found in wallet'
        };
      }

      const balance = parseFloat(galaToken.quantity) || 0;

      this.logger.info(`GALA Balance: ${balance} GALA`);
      
      return {
        success: true,
        balance: balance,
        hasGala: balance > 0,
        token: galaToken,
        message: `Wallet contains ${balance} GALA tokens`
      };

    } catch (error) {
      this.logger.error('Error getting GALA balance:', error);
      return {
        success: false,
        balance: 0,
        hasGala: false,
        error: error.message
      };
    }
  }

  /**
   * Check if wallet has sufficient GALA for trading
   * @param {number} requiredAmount - Required GALA amount
   * @returns {Promise<Object>} Balance check result
   */
  async checkGalaBalance(requiredAmount) {
    try {
      const balanceInfo = await this.getGalaBalance();
      
      if (!balanceInfo.success) {
        return {
          success: false,
          hasEnough: false,
          available: 0,
          required: requiredAmount,
          error: balanceInfo.error
        };
      }

      const hasEnough = balanceInfo.balance >= requiredAmount;
      
      return {
        success: true,
        hasEnough: hasEnough,
        available: balanceInfo.balance,
        required: requiredAmount,
        surplus: balanceInfo.balance - requiredAmount,
        message: hasEnough 
          ? `Sufficient GALA: ${balanceInfo.balance} available, ${requiredAmount} required`
          : `Insufficient GALA: ${balanceInfo.balance} available, ${requiredAmount} required (need ${requiredAmount - balanceInfo.balance} more)`
      };

    } catch (error) {
      this.logger.error('Error checking GALA balance:', error);
      return {
        success: false,
        hasEnough: false,
        available: 0,
        required: requiredAmount,
        error: error.message
      };
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
      // Ignore specific transaction waiter errors as they're not critical
      if (error.code === 'TRANSACTION_WAIT_FAILED' && error.details?.message === 'Transaction waiter disabled') {
        this.logger.debug('Event socket already disconnected or transaction waiter disabled');
      } else {
        this.logger.error('Failed to disconnect from GSwap event socket:', error);
      }
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
   * Analyze price data and generate trading signals using DCA (Dollar Cost Averaging) strategy
   * @param {number} currentPrice - Current price of the asset
   * @param {number[]} recentPrices - Array of recent prices for volatility analysis
   * @param {Object} options - Analysis options
   * @returns {Object} - Analysis result with signals
   */
  analyzeDCAStrategy(currentPrice, recentPrices = [], options = {}) {
    const {
      interval = 'daily', // 'daily', 'weekly', 'monthly'
      amount = 10, // DCA amount in USD
      priceThreshold = null, // Buy only if price is below this threshold
      maxVolatility = 0.1, // Max volatility threshold (10%)
      volatilityWindow = 7,
      lastExecutionTime = null
    } = options;

    try {
      const dcaAnalysis = analyzeDCAStrategy({
        interval,
        lastExecutionTime,
        amount,
        priceThreshold,
        currentPrice,
        volatilityWindow,
        prices: recentPrices,
        maxVolatility
      });

      this.logger.info('DCA Analysis completed:', {
        signal: dcaAnalysis.signal,
        shouldExecute: dcaAnalysis.shouldExecute,
        confidence: dcaAnalysis.confidence,
        reasons: dcaAnalysis.reasons,
        nextExecution: dcaAnalysis.nextExecution
      });

      return {
        signal: dcaAnalysis.signal,
        confidence: dcaAnalysis.confidence,
        reasons: dcaAnalysis.reasons,
        shouldExecute: dcaAnalysis.shouldExecute,
        strategy: 'DCA',
        interval: interval,
        amount: amount,
        currentPrice: currentPrice,
        priceThreshold: priceThreshold,
        volatility: dcaAnalysis.volatility,
        nextExecution: dcaAnalysis.nextExecution,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Error analyzing DCA strategy:', error);
      return {
        signal: null,
        confidence: 0,
        reasons: ['Analysis error: ' + error.message],
        error: error.message,
        strategy: 'DCA',
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

    let eventSocketConnected = false;

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
        // Log dry run trade
        const executedPrice = quote.outTokenAmount.dividedBy(amount).toNumber();
        const tradeId = await this.logTradeExecution({
          fromToken,
          toToken,
          amount,
          expectedPrice: executedPrice,
          expectedOutput: quote.outTokenAmount.toString(),
          slippage,
          feeTier: quote.feeTier,
          status: 'COMPLETED',
          dryRun: true,
          strategy: options.strategy || 'Manual',
          notes: 'Dry run execution - no actual swap performed'
        });

        // If this is a SELL trade (GALA -> token), create an open position for dry run tracking
        const fromSymbol = this.formatTokenName(fromToken);
        const toSymbol = this.formatTokenName(toToken);
        
        if (fromSymbol === 'GALA' && tradeId) {
          try {
            const databaseService = this.getDatabaseService();
            const positionId = await databaseService.createOpenPosition({
              strategy: options.strategy || 'Manual',
              symbol: `GALA/${toSymbol}`,
              token_symbol: toSymbol,
              gala_symbol: toToken,
              entry_trade_id: tradeId,
              entry_price: executedPrice,
              entry_amount: amount,
              token_amount: parseFloat(quote.outTokenAmount.toString()),
              notes: `DRY RUN: Position opened from trade ${tradeId}`
            });
            
            this.logger.info(`📊 DRY RUN: Open position created: ${positionId} for ${amount} GALA -> ${quote.outTokenAmount} ${toSymbol}`);
          } catch (positionError) {
            this.logger.error('Error creating dry run open position:', positionError);
            // Don't fail the trade if position tracking fails
          }
        }

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
      try {
        await this.connectEventSocket();
        eventSocketConnected = true;
        
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

        // Log successful trade
        const executedPrice = quote.outTokenAmount.dividedBy(amount).toNumber();
        const tradeId = await this.logTradeExecution({
          fromToken,
          toToken,
          amount,
          expectedPrice: executedPrice,
          expectedOutput: quote.outTokenAmount.toString(),
          slippage,
          feeTier: quote.feeTier,
          status: 'COMPLETED',
          dryRun: false,
          strategy: options.strategy || 'Manual',
          txHash: pendingTx.transactionId,
          notes: `Live trade executed successfully on ${quote.feeTier} fee tier`
        });

        // If this is a SELL trade (GALA -> token), create an open position to track for buyback
        const fromSymbol = this.formatTokenName(fromToken);
        const toSymbol = this.formatTokenName(toToken);
        
        if (fromSymbol === 'GALA' && tradeId) {
          try {
            const databaseService = this.getDatabaseService();
            const positionId = await databaseService.createOpenPosition({
              strategy: options.strategy || 'Manual',
              symbol: `GALA/${toSymbol}`,
              token_symbol: toSymbol,
              gala_symbol: toToken,
              entry_trade_id: tradeId,
              entry_price: executedPrice,
              entry_amount: amount,
              token_amount: parseFloat(quote.outTokenAmount.toString()),
              notes: `Position opened from trade ${tradeId}`
            });
            
            this.logger.info(`📊 Open position created: ${positionId} for ${amount} GALA -> ${quote.outTokenAmount} ${toSymbol}`);
          } catch (positionError) {
            this.logger.error('Error creating open position:', positionError);
            // Don't fail the trade if position tracking fails
          }
        }

        return {
          success: true,
          dryRun: false,
          transaction: pendingTx,
          quote: quoteResult,
          executedAt: new Date().toISOString()
        };

      } finally {
        // Only disconnect if we successfully connected
        if (eventSocketConnected) {
          try {
            await this.disconnectEventSocket();
          } catch (disconnectError) {
            // Silently ignore disconnection errors to prevent unhandled rejections
            this.logger.debug('Event socket disconnection error (ignored):', disconnectError.message);
          }
        }
      }

    } catch (error) {
      this.logger.error('Error executing swap:', error);
      
      // Clean up event socket connection if needed
      if (eventSocketConnected) {
        try {
          await this.disconnectEventSocket();
        } catch (cleanupError) {
          // Silently ignore cleanup errors to prevent unhandled rejections
          this.logger.debug('Event socket cleanup error (ignored):', cleanupError.message);
        }
      }
      
      // Log failed trade
      try {
        await this.logTradeExecution({
          fromToken,
          toToken,
          amount,
          expectedPrice: 0,
          expectedOutput: '0',
          slippage,
          feeTier: 'N/A',
          status: 'FAILED',
          dryRun,
          strategy: options.strategy || 'Manual',
          notes: `Trade failed: ${error.message}`
        });
      } catch (logError) {
        this.logger.error('Error logging failed trade:', logError);
      }

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
   * Execute DCA (Dollar Cost Averaging) strategy trade
   * @param {Object} analysis - DCA strategy analysis result
   * @param {Object} options - Trade options
   * @returns {Object} - Trade result
   */
  async executeDCAStrategy(analysis, options = {}) {
    const { 
      targetSymbol = 'GALA', 
      minimumConfidence = 0.5,
      recordExecution = true // Whether to record execution time in database
    } = options;

    try {
      if (!analysis || !analysis.signal) {
        return {
          success: false,
          error: 'No valid DCA signal',
          analysis
        };
      }

      if (!analysis.shouldExecute) {
        return {
          success: false,
          error: 'DCA execution not due yet',
          nextExecution: analysis.nextExecution,
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

      // DCA is always buying the target symbol with GUSDC
      const tradeResult = await this.executeSwap(
        'GUSDC|Unit|none|none', // From GUSDC
        'GALA|Unit|none|none',  // To GALA
        analysis.amount,
        {
          ...options,
          slippage: options.slippage || this.defaultSlippage
        }
      );

      // Record execution time if successful and not dry run
      if (tradeResult.success && !tradeResult.dryRun && recordExecution) {
        try {
          const databaseService = this.getDatabaseService();
          await databaseService.logTrade({
            strategy: 'DCA',
            symbol: targetSymbol,
            side: 'BUY',
            amount: analysis.amount,
            price: analysis.currentPrice,
            total_value: analysis.amount * analysis.currentPrice,
            slippage: options.slippage || this.defaultSlippage,
            status: 'COMPLETED',
            tx_hash: tradeResult.transaction?.transactionId || null,
            dry_run: false,
            executed_at: new Date().toISOString(),
            notes: `DCA ${analysis.interval} - ${analysis.reasons.join(', ')}`
          });

          this.logger.info('DCA execution recorded in database');
        } catch (dbError) {
          this.logger.warn('Failed to record DCA execution in database:', dbError);
        }
      }

      return {
        success: tradeResult?.success || false,
        strategy: 'DCA',
        signal: analysis.signal,
        confidence: analysis.confidence,
        reasons: analysis.reasons,
        interval: analysis.interval,
        amount: analysis.amount,
        currentPrice: analysis.currentPrice,
        volatility: analysis.volatility,
        nextExecution: analysis.nextExecution,
        trade: tradeResult,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Error executing DCA strategy:', error);
      return {
        success: false,
        error: error.message,
        strategy: 'DCA',
        analysis,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get the last DCA execution time for a symbol
   * @param {string} symbol - Symbol to check (default: 'GALA')
   * @returns {Promise<string|null>} - Last execution timestamp or null
   */
  async getLastDCAExecution(symbol = 'GALA') {
    try {
      const databaseService = this.getDatabaseService();
      return await databaseService.getLastTradeExecution('DCA', symbol);
    } catch (error) {
      this.logger.error(`Error getting last DCA execution for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get comprehensive DCA strategy data including analysis and execution
   * @param {number} currentPrice - Current price of the asset
   * @param {number[]} recentPrices - Array of recent prices
   * @param {Object} options - DCA options
   * @returns {Promise<Object>} - Complete DCA data
   */
  async getDCAStrategyData(currentPrice, recentPrices = [], options = {}) {
    const { symbol = 'GALA' } = options;

    try {
      // Get last execution time
      const lastExecutionTime = await this.getLastDCAExecution(symbol);
      
      // Perform analysis with execution time
      const analysis = this.analyzeDCAStrategy(currentPrice, recentPrices, {
        ...options,
        lastExecutionTime
      });

      // Get trade statistics
      const databaseService = this.getDatabaseService();
      const tradeStats = await databaseService.getTradeStats('DCA', symbol);
      const recentTrades = await databaseService.getTradeHistory('DCA', {
        symbol,
        limit: 10
      });

      return {
        analysis,
        lastExecution: lastExecutionTime,
        statistics: tradeStats,
        recentTrades,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error(`Error getting DCA strategy data for ${symbol}:`, error);
      return {
        analysis: null,
        lastExecution: null,
        statistics: null,
        recentTrades: [],
        error: error.message,
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

  /**
   * Execute a comprehensive swap with balance checks and notifications
   * @param {string} fromToken - Source token symbol (in GALA format)
   * @param {string} toToken - Target token symbol (in GALA format)
   * @param {number} amount - Amount to swap
   * @param {Object} options - Swap options
   * @returns {Promise<Object>} - Comprehensive swap result
   */
  async executeSwapWithBalanceCheck(fromToken, toToken, amount, options = {}) {
    const {
      dryRun = this.isDryRun,
      slippage = this.defaultSlippage,
      sendNotification = true,
      strategy = 'Manual'
    } = options;

    const swapResult = {
      success: false,
      timestamp: new Date().toISOString(),
      fromToken,
      toToken,
      requestedAmount: amount,
      dryRun
    };

    try {
      // Step 1: Check if we're starting with GALA
      const isStartingWithGala = fromToken.includes('GALA');
      const isEndingWithGala = toToken.includes('GALA');

      // Step 2: Check GALA balance before any operation
      let balanceCheck;
      if (isStartingWithGala) {
        // Starting with GALA - check we have enough
        balanceCheck = await this.checkGalaBalance(amount);
        if (!balanceCheck.success || !balanceCheck.hasEnough) {
          swapResult.error = 'Insufficient GALA balance';
          swapResult.balanceCheck = balanceCheck;
          
          if (sendNotification) {
            await this.sendSwapNotification(swapResult);
          }
          
          return swapResult;
        }
      } else {
        // Not starting with GALA - just get current balance for context
        balanceCheck = await this.getGalaBalance();
      }

      swapResult.initialGalaBalance = balanceCheck.balance || balanceCheck.available;

      // Step 3: Execute the swap
      const tradeResult = await this.executeSwap(fromToken, toToken, amount, { dryRun, slippage, strategy });
      
      swapResult.success = tradeResult.success;
      swapResult.trade = tradeResult;

      if (!tradeResult.success) {
        swapResult.error = tradeResult.error;
      }

      // Step 4: Check final GALA balance
      const finalBalanceCheck = await this.getGalaBalance();
      swapResult.finalGalaBalance = finalBalanceCheck.balance || 0;
      swapResult.galaBalanceChange = swapResult.finalGalaBalance - swapResult.initialGalaBalance;

      // Step 5: Send notification
      if (sendNotification) {
        try {
          await this.sendSwapNotification(swapResult);
        } catch (notificationError) {
          this.logger.warn('Failed to send swap notification:', notificationError.message);
        }
      }

      return swapResult;

    } catch (error) {
      this.logger.error('Error in executeSwapWithBalanceCheck:', error);
      
      swapResult.error = error.message;
      
      if (sendNotification) {
        try {
          await this.sendSwapNotification(swapResult);
        } catch (notificationError) {
          this.logger.warn('Failed to send error notification:', notificationError.message);
        }
      }
      
      return swapResult;
    }
  }

  /**
   * Send swap notification to Discord
   * @param {Object} swapResult - Swap result object
   */
  async sendSwapNotification(swapResult) {
    try {
      const notificationService = require('./ServiceManager').get('notification');
      if (!notificationService) {
        this.logger.warn('NotificationService not available for swap notification');
        return;
      }

      const isSuccess = swapResult.success;
      const color = isSuccess ? 0x00ff00 : 0xff0000; // Green for success, red for failure
      
      const embed = {
        title: `${isSuccess ? '✅' : '❌'} Swap ${isSuccess ? 'Executed' : 'Failed'}`,
        color: color,
        timestamp: swapResult.timestamp,
        fields: [
          {
            name: 'Token Pair',
            value: `${this.formatTokenName(swapResult.fromToken)} → ${this.formatTokenName(swapResult.toToken)}`,
            inline: true
          },
          {
            name: 'Amount',
            value: `${swapResult.requestedAmount} ${this.formatTokenName(swapResult.fromToken)}`,
            inline: true
          },
          {
            name: 'Mode',
            value: swapResult.dryRun ? '🧪 DRY RUN' : '💰 LIVE',
            inline: true
          }
        ]
      };

      // Add balance information
      if (swapResult.initialGalaBalance !== undefined) {
        embed.fields.push({
          name: 'GALA Balance',
          value: `Before: ${swapResult.initialGalaBalance}\nAfter: ${swapResult.finalGalaBalance || 'N/A'}\nChange: ${swapResult.galaBalanceChange ? (swapResult.galaBalanceChange > 0 ? '+' : '') + swapResult.galaBalanceChange : 'N/A'}`,
          inline: false
        });
      }

      // Add error information if failed
      if (!isSuccess && swapResult.error) {
        embed.fields.push({
          name: 'Error',
          value: swapResult.error.substring(0, 1000), // Limit error message length
          inline: false
        });
      }

      // Add trade details if successful
      if (isSuccess && swapResult.trade) {
        const trade = swapResult.trade;
        if (trade.expectedOutput) {
          embed.fields.push({
            name: 'Expected Output',
            value: `${trade.expectedOutput} ${this.formatTokenName(swapResult.toToken)}`,
            inline: true
          });
        }
        if (trade.quote?.feeTier) {
          embed.fields.push({
            name: 'Fee Tier',
            value: trade.quote.feeTier,
            inline: true
          });
        }
      }

      const payload = {
        embeds: [embed]
      };

      await notificationService.sendWebhook(payload);
      this.logger.info('Swap notification sent to Discord');

    } catch (error) {
      this.logger.error('Failed to send swap notification:', error);
    }
  }

  /**
   * Format token name for display
   * @param {string} tokenSymbol - Token symbol in GALA format
   * @returns {String} - Formatted token name
   */
  formatTokenName(tokenSymbol) {
    if (tokenSymbol.includes('|')) {
      return tokenSymbol.split('|')[0];
    }
    return tokenSymbol;
  }

  /**
   * Execute automated trading with comprehensive monitoring
   * Designed to be called from the monitor command
   * @param {Object} options - Trading options
   * @returns {Promise<Object>} - Trading execution result
   */
  async executeAutomatedTrading(options = {}) {
    const {
      symbols = null, // null = all symbols, or array of specific symbols
      strategy = 'dca', // 'dca' or 'golden_cross'
      minimumConfidence = 0.7,
      sendNotifications = true
    } = options;

    const result = {
      success: false,
      timestamp: new Date().toISOString(),
      strategy,
      tradesExecuted: 0,
      tradeResults: [],
      errors: []
    };

    try {
      this.logger.info(`🤖 Starting automated trading - Strategy: ${strategy.toUpperCase()}`);

      // Get symbols to analyze
      let symbolsToAnalyze;
      if (symbols) {
        // Filter specific symbols
        const allSymbols = await this.getTradingSymbols();
        symbolsToAnalyze = allSymbols.filter(s => symbols.includes(s.symbol));
      } else {
        // Get all trading symbols
        symbolsToAnalyze = await this.getTradingSymbols();
      }

      if (symbolsToAnalyze.length === 0) {
        result.error = 'No trading symbols found';
        return result;
      }

      this.logger.info(`📊 Analyzing ${symbolsToAnalyze.length} symbols for trading opportunities`);

      // Analyze each symbol and execute trades
      for (const symbolData of symbolsToAnalyze) {
        try {
          this.logger.info(`🔍 Analyzing ${symbolData.symbol}...`);

          // Get price oracle service for data
          const priceOracleService = require('./ServiceManager').get('priceOracle');
          if (!priceOracleService) {
            throw new Error('PriceOracleService not available');
          }

          // Get historical data based on strategy
          let historicalData;
          let analysis;

          if (strategy === 'dca') {
            historicalData = await priceOracleService.getDCAData(symbolData.gala_symbol, {
              lookbackDays: 365,
              interval: 'daily'
            });

            if (!historicalData.success) {
              throw new Error(`Failed to fetch DCA data: ${historicalData.error}`);
            }

            analysis = this.analyzeDCAStrategy(
              historicalData.data,
              symbolData.strategy_config?.dca || {
                investmentAmount: 100,
                interval: 'daily',
                volatilityThreshold: 0.15,
                minInvestmentPeriods: 30
              }
            );
          } else {
            // Golden Cross strategy
            historicalData = await priceOracleService.getGoldenCrossData(symbolData.gala_symbol, {
              lookbackDays: 250
            });

            if (!historicalData.success) {
              throw new Error(`Failed to fetch Golden Cross data: ${historicalData.error}`);
            }

            const prices = historicalData.data.map(item => item.close);
            analysis = this.analyzeGoldenCrossStrategy(
              prices,
              symbolData.strategy_config?.golden_cross || {
                shortPeriod: 50,
                longPeriod: 200,
                useRSI: true
              }
            );
          }

          // Check if we should execute trade
          if (analysis.signal === 'BUY' && analysis.confidence >= minimumConfidence) {
            this.logger.info(`🎯 Strong ${analysis.signal} signal for ${symbolData.symbol} (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`);

            // Execute the trade
            let tradeResult;
            const tradeAmount = symbolData.min_trade_amount || this.minTradeAmount;

            if (analysis.signal === 'BUY') {
              // Buy: GALA -> Target Token
              tradeResult = await this.executeSwapWithBalanceCheck(
                'GALA|Unit|none|none',
                symbolData.gala_symbol,
                tradeAmount,
                { 
                  sendNotification: sendNotifications,
                  strategy: `MonitorStrategy_${strategy.toUpperCase()}`
                }
              );
            }

            if (tradeResult && tradeResult.success) {
              result.tradesExecuted++;
              this.logger.info(`✅ Trade executed successfully for ${symbolData.symbol}`);
            } else {
              this.logger.error(`❌ Trade failed for ${symbolData.symbol}:`, tradeResult?.error);
            }

            result.tradeResults.push({
              symbol: symbolData.symbol,
              signal: analysis.signal,
              confidence: analysis.confidence,
              trade: tradeResult
            });

          } else {
            this.logger.info(`📉 No trade signal for ${symbolData.symbol} - Signal: ${analysis.signal}, Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);
          }

        } catch (error) {
          this.logger.error(`❌ Error analyzing ${symbolData.symbol}:`, error);
          result.errors.push({
            symbol: symbolData.symbol,
            error: error.message
          });
        }
      }

      result.success = true;
      result.message = `Automated trading completed - ${result.tradesExecuted} trades executed`;

      this.logger.info(`🎉 Automated trading completed - ${result.tradesExecuted} trades executed out of ${symbolsToAnalyze.length} symbols analyzed`);

      // Send summary notification if requested
      if (sendNotifications) {
        try {
          const notificationService = require('./ServiceManager').get('notification');
          if (notificationService) {
            await notificationService.sendTradingSummary(result);
          }
        } catch (error) {
          this.logger.error('Failed to send trading summary notification:', error);
        }
      }

      return result;

    } catch (error) {
      this.logger.error('Error in automated trading:', error);
      result.error = error.message;
      return result;
    }
  }

  /**
   * Log trade execution to database
   * @param {Object} tradeData - Trade execution data
   * @returns {Promise<number>} - Trade ID from database
   */
  async logTradeExecution(tradeData) {
    try {
      const databaseService = this.getDatabaseService();
      
      // Extract symbol from token format (e.g., "GALA|Unit|none|none" -> "GALA")
      const fromSymbol = this.formatTokenName(tradeData.fromToken);
      const toSymbol = this.formatTokenName(tradeData.toToken);
      
      // Determine trade side and symbol
      let side, symbol;
      if (fromSymbol === 'GALA') {
        side = 'SELL'; // Selling GALA
        // symbol = 'GALA';
        symbol = `GALA/${toSymbol}`;
      } else if (toSymbol === 'GALA') {
        side = 'BUY'; // Buying GALA
        symbol = `GALA/${fromSymbol}`;
      } else {
        side = 'SWAP';
        symbol = `${fromSymbol}/${toSymbol}`;
      }

      // Calculate total value
      const totalValue = tradeData.amount * tradeData.expectedPrice;

      // Prepare trade data for database
      const dbTradeData = {
        strategy: tradeData.strategy || 'Manual',
        symbol: symbol,
        side: side,
        amount: tradeData.amount,
        price: tradeData.expectedPrice,
        total_value: totalValue,
        slippage: tradeData.slippage || this.defaultSlippage,
        fee: tradeData.fee || 0,
        status: tradeData.status || 'COMPLETED',
        tx_hash: tradeData.txHash || null,
        dry_run: tradeData.dryRun || false,
        executed_at: new Date().toISOString(),
        notes: tradeData.notes || null
      };

      this.logger.info(`📝 Logging trade: ${dbTradeData.strategy} ${dbTradeData.side} ${dbTradeData.amount} ${dbTradeData.symbol}`, {
        dryRun: dbTradeData.dry_run,
        status: dbTradeData.status,
        totalValue: dbTradeData.total_value
      });

      const tradeId = await databaseService.logTrade(dbTradeData);
      
      this.logger.info(`✅ Trade logged with ID: ${tradeId}`);
      return tradeId;

    } catch (error) {
      this.logger.error('Error logging trade execution:', error);
      // Don't throw - logging should not break trade execution
      return null;
    }
  }

  /**
   * Get trade history from database
   * @param {string} strategy - Strategy name to filter by (optional)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - Array of trade records
   */
  async getTradeHistory(strategy = null, options = {}) {
    try {
      const databaseService = this.getDatabaseService();
      return await databaseService.getTradeHistory(strategy, options);
    } catch (error) {
      this.logger.error('Error getting trade history:', error);
      return [];
    }
  }

  /**
   * Get trade statistics from database
   * @param {string} strategy - Strategy name to filter by (optional)
   * @param {string} symbol - Symbol to filter by (optional)
   * @returns {Promise<Object>} - Trade statistics
   */
  async getTradeStats(strategy = null, symbol = null) {
    try {
      const databaseService = this.getDatabaseService();
      return await databaseService.getTradeStats(strategy, symbol);
    } catch (error) {
      this.logger.error('Error getting trade stats:', error);
      return {
        totalTrades: 0,
        successfulTrades: 0,
        failedTrades: 0,
        totalVolume: 0,
        averageTradeSize: 0,
        successRate: 0
      };
    }
  }

  /**
   * Monitor open positions and execute conditional buyback
   * @param {string} strategy - Strategy name to filter by (optional)
   * @returns {Promise<Object>} - Monitoring result with executed buybacks
   */
  async monitorOpenPositions(strategy = null) {
    try {
      const databaseService = this.getDatabaseService();
      const openPositions = await databaseService.getOpenPositions(strategy);
      
      if (openPositions.length === 0) {
        return {
          success: true,
          message: 'No open positions to monitor',
          positionsChecked: 0,
          buybacksExecuted: 0,
          buybacksFailed: 0,
          results: []
        };
      }

      this.logger.info(`📊 Monitoring ${openPositions.length} open positions for buyback conditions`);

      const results = [];
      let buybacksExecuted = 0;
      let buybacksFailed = 0;

      // Get price oracle service for current token prices
      const ServiceManager = require('./ServiceManager');
      const priceOracleService = ServiceManager.get('priceOracle');
      
      if (!priceOracleService) {
        throw new Error('PriceOracleService not available for position monitoring');
      }

      for (const position of openPositions) {
        try {
          const result = await this.checkPositionForBuyback(position, priceOracleService);
          results.push(result);
          
          if (result.buybackExecuted) {
            buybacksExecuted++;
          } else if (result.buybackFailed) {
            buybacksFailed++;
          }
        } catch (error) {
          this.logger.error(`Error checking position ${position.id}:`, error);
          results.push({
            positionId: position.id,
            symbol: position.symbol,
            error: error.message,
            buybackExecuted: false,
            buybackFailed: true
          });
          buybacksFailed++;
        }
      }

      const summary = {
        success: true,
        positionsChecked: openPositions.length,
        buybacksExecuted,
        buybacksFailed,
        results
      };

      this.logger.info(`📊 Position monitoring complete: ${buybacksExecuted} buybacks executed, ${buybacksFailed} failed`);
      
      return summary;

    } catch (error) {
      this.logger.error('Error monitoring open positions:', error);
      return {
        success: false,
        error: error.message,
        positionsChecked: 0,
        buybacksExecuted: 0,
        buybacksFailed: 0,
        results: []
      };
    }
  }

  /**
   * Check a single position for buyback conditions and execute if needed
   * @param {Object} position - Position record from database
   * @param {Object} priceOracleService - Price oracle service instance
   * @returns {Promise<Object>} - Check result
   */
  async checkPositionForBuyback(position, priceOracleService) {
    const {
      id: positionId,
      symbol,
      token_symbol,
      gala_symbol,
      entry_price,
      entry_amount,
      token_amount,
      profit_threshold,
      loss_threshold,
      strategy
    } = position;

    try {
      // Get current price of the token
      const priceData = await priceOracleService.getCurrentPrice(gala_symbol);
      
      if (!priceData.success) {
        throw new Error(`Failed to get current price for ${token_symbol}: ${priceData.error}`);
      }

      const currentPrice = priceData.price;
      
      // Calculate PnL
      const pnlPercentage = calculatePnLPercentage(entry_price, currentPrice);
      const buybackDecision = shouldBuyback(
        pnlPercentage, 
        profit_threshold * 100, // Convert to percentage 
        loss_threshold * 100    // Convert to percentage
      );

      this.logger.info(`📊 Position ${positionId} (${symbol}): PnL ${formatPnL(pnlPercentage)} - ${buybackDecision.description}`);

      const result = {
        positionId,
        symbol,
        token_symbol,
        entry_price,
        current_price: currentPrice,
        pnl_percentage: pnlPercentage,
        decision: buybackDecision.reason,
        description: buybackDecision.description,
        buybackExecuted: false,
        buybackFailed: false
      };

      if (buybackDecision.shouldBuy) {
        // Execute buyback
        try {
          const buybackResult = await this.executeBuyback(position, currentPrice);
          
          if (buybackResult.success) {
            result.buybackExecuted = true;
            result.buyback_trade_id = buybackResult.tradeId;
            result.final_gala_amount = buybackResult.finalGalaAmount;
            
            // Calculate final PnL
            const finalPnL = calculateFinalPnL(entry_amount, buybackResult.finalGalaAmount);
            result.final_pnl = finalPnL;
            
            this.logger.info(`✅ Buyback executed for position ${positionId}: ${formatPnL(finalPnL.percentagePnL, finalPnL.absolutePnL)}`);
          } else {
            result.buybackFailed = true;
            result.error = buybackResult.error;
            this.logger.error(`❌ Buyback failed for position ${positionId}: ${buybackResult.error}`);
          }
        } catch (buybackError) {
          result.buybackFailed = true;
          result.error = buybackError.message;
          this.logger.error(`❌ Buyback execution error for position ${positionId}:`, buybackError);
        }
      }

      return result;

    } catch (error) {
      this.logger.error(`Error checking position ${positionId}:`, error);
      return {
        positionId,
        symbol,
        error: error.message,
        buybackExecuted: false,
        buybackFailed: true
      };
    }
  }

  /**
   * Execute buyback for a position (token -> GALA)
   * @param {Object} position - Position record
   * @param {number} currentPrice - Current token price
   * @returns {Promise<Object>} - Buyback execution result
   */
  async executeBuyback(position, currentPrice) {
    const {
      id: positionId,
      symbol,
      token_symbol,
      gala_symbol,
      entry_amount,
      token_amount,
      strategy
    } = position;

    try {
      this.logger.info(`🔄 Executing buyback for position ${positionId}: ${token_amount} ${token_symbol} -> GALA`);

      // Execute the swap from token back to GALA
      const swapResult = await this.executeSwap(
        gala_symbol, // from token (e.g., 'GUSDC|Unit|none|none')
        'GALA|Unit|none|none', // to GALA
        token_amount,
        {
          strategy: strategy,
          dryRun: this.isDryRun
        }
      );

      if (!swapResult.success) {
        throw new Error(`Swap execution failed: ${swapResult.error}`);
      }

      // Calculate final GALA amount received
      const finalGalaAmount = swapResult.dryRun 
        ? parseFloat(swapResult.expectedOutput)
        : parseFloat(swapResult.quote.quote.outTokenAmount.toString());

      // Close the position in database
      const databaseService = this.getDatabaseService();
      
      // Find the trade ID from the swap result (we need to get it from the logged trade)
      // For now, we'll create a simple note with the transaction info
      const closeNotes = swapResult.dryRun 
        ? `DRY RUN: Buyback completed, would receive ${finalGalaAmount} GALA`
        : `Buyback completed: ${swapResult.transaction?.transactionId || 'N/A'}`;

      await databaseService.closePosition(positionId, null, closeNotes);

      // Send notification
      try {
        const ServiceManager = require('./ServiceManager');
        const notificationService = ServiceManager.get('notification');
        
        if (notificationService) {
          const finalPnL = calculateFinalPnL(entry_amount, finalGalaAmount);
          await notificationService.sendBuybackNotification({
            position,
            currentPrice,
            finalGalaAmount,
            finalPnL,
            swapResult
          });
        }
      } catch (notificationError) {
        this.logger.warn('Failed to send buyback notification:', notificationError.message);
      }

      return {
        success: true,
        positionId,
        symbol,
        finalGalaAmount,
        swapResult,
        tradeId: null // We'll need to enhance this later
      };

    } catch (error) {
      // Mark position as failed
      try {
        const databaseService = this.getDatabaseService();
        await databaseService.markPositionFailed(positionId, `Buyback failed: ${error.message}`);
      } catch (dbError) {
        this.logger.error('Failed to mark position as failed:', dbError);
      }

      return {
        success: false,
        positionId,
        symbol,
        error: error.message
      };
    }
  }
}

module.exports = TradingService;