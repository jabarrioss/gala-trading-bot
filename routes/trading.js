const express = require('express');
const router = express.Router();
const serviceManager = require('../services/ServiceManager');

/**
 * Trading routes - Golden Cross strategy implementation
 */

/**
 * GET /trading/analyze
 * Analyze current market conditions and generate trading signals
 * Query params: symbol (optional) - analyze specific symbol, defaults to all symbols
 */
router.get('/analyze', async (req, res) => {
  try {
    const yahooService = serviceManager.get('yahooFinance');
    const tradingService = serviceManager.get('trading');
    const databaseService = serviceManager.get('database');
    
    const requestedSymbol = req.query.symbol;
    const analysisResults = {};

    if (requestedSymbol) {
      // Analyze specific symbol
      const symbolData = await databaseService.getMonitoredSymbol(requestedSymbol);
      
      if (!symbolData || !symbolData.is_active) {
        return res.status(404).json({
          success: false,
          error: 'Symbol not found or inactive',
          symbol: requestedSymbol,
          timestamp: new Date().toISOString()
        });
      }

      // Get historical data for Golden Cross analysis
      const historicalData = await yahooService.getGoldenCrossData(symbolData.yahoo_symbol, {
        lookbackDays: 250
      });

      if (!historicalData.success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch historical data',
          symbol: requestedSymbol,
          details: historicalData.error,
          timestamp: new Date().toISOString()
        });
      }

      // Analyze using Golden Cross strategy
      const analysis = tradingService.analyzeGoldenCrossStrategy(
        historicalData.prices,
        symbolData.strategy_config?.golden_cross || {
          shortPeriod: 50,
          longPeriod: 200,
          useRSI: true
        }
      );

      // Get current price for context
      const currentPrice = await yahooService.getCurrentPrice(symbolData.yahoo_symbol);

      analysisResults[requestedSymbol] = {
        analysis,
        currentPrice: currentPrice.success ? currentPrice : null,
        historicalDataPoints: historicalData.count,
        symbolData
      };

    } else {
      // Analyze all active symbols
      const symbols = await databaseService.getTradingSymbols();
      
      if (symbols.length === 0) {
        return res.json({
          success: true,
          message: 'No active trading symbols found',
          analysisResults: {},
          timestamp: new Date().toISOString()
        });
      }

      // Analyze each symbol concurrently
      const analysisPromises = symbols.map(async (symbolData) => {
        try {
          // Get historical data for Golden Cross analysis
          const historicalData = await yahooService.getGoldenCrossData(symbolData.yahoo_symbol, {
            lookbackDays: 250
          });

          if (!historicalData.success) {
            return {
              symbol: symbolData.symbol,
              success: false,
              error: 'Failed to fetch historical data',
              details: historicalData.error
            };
          }

          // Analyze using Golden Cross strategy
          const analysis = tradingService.analyzeGoldenCrossStrategy(
            historicalData.prices,
            symbolData.strategy_config?.golden_cross || {
              shortPeriod: 50,
              longPeriod: 200,
              useRSI: true
            }
          );

          // Get current price for context
          const currentPrice = await yahooService.getCurrentPrice(symbolData.yahoo_symbol);

          return {
            symbol: symbolData.symbol,
            success: true,
            analysis,
            currentPrice: currentPrice.success ? currentPrice : null,
            historicalDataPoints: historicalData.count,
            symbolData
          };

        } catch (error) {
          return {
            symbol: symbolData.symbol,
            success: false,
            error: error.message
          };
        }
      });

      const results = await Promise.all(analysisPromises);
      
      // Convert to object keyed by symbol
      results.forEach(result => {
        analysisResults[result.symbol] = result;
      });
    }

    res.json({
      success: true,
      analysisResults: analysisResults,
      symbolCount: Object.keys(analysisResults).length,
      requestedSymbol: requestedSymbol || 'all',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error analyzing market:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /trading/execute
 * Execute a trade based on Golden Cross strategy
 * Body: { amount: number, minimumConfidence?: number, dryRun?: boolean }
 * TESTED MANUALLY - NEEDS IMPROVEMENTS
 */
router.post('/execute', async (req, res) => {
  try {
    const { amount, minimumConfidence = 0.6, dryRun } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required'
      });
    }

    const yahooService = serviceManager.get('yahooFinance');
    const tradingService = serviceManager.get('trading');
    const notificationService = serviceManager.get('notification');

    // Get fresh market analysis
    const historicalData = await yahooService.getGoldenCrossData();
    
    if (!historicalData.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch market data for analysis'
      });
    }

    const analysis = tradingService.analyzeGoldenCrossStrategy(historicalData.prices);

    // Send signal notification
    const currentPrice = await yahooService.getCurrentPrice();
    await notificationService.sendTradingSignal(analysis, currentPrice);

    // Execute trade based on analysis
    const tradeResult = await tradingService.executeGoldenCrossStrategy(
      analysis,
      amount,
      { 
        minimumConfidence,
        dryRun: dryRun !== undefined ? dryRun : tradingService.isDryRun
      }
    );

    // Send execution notification
    await notificationService.sendTradeExecution(tradeResult, analysis);

    res.json({
      success: true,
      analysis: analysis,
      tradeResult: tradeResult,
      currentPrice: currentPrice.success ? currentPrice : null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error executing trade:', error);
    
    // Send error notification
    const notificationService = serviceManager.get('notification');
    await notificationService.sendError('Trade Execution Error', error, {
      amount: req.body.amount,
      endpoint: '/trading/execute'
    });

    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /trading/quote
 * Get quote for a potential swap
 * Query params: fromToken, toToken, amount
 * TESTED MANUALLY - WORKS
 */
router.get('/quote', async (req, res) => {
  try {
    const { fromToken, toToken, amount } = req.query;

    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({
        success: false,
        error: 'fromToken, toToken, and amount are required'
      });
    }

    const tradingService = serviceManager.get('trading');
    
    const quote = await tradingService.getQuote(fromToken, toToken, parseFloat(amount));

    res.json({
      success: true,
      quote: quote,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting quote:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /trading/status
 * Get trading service status and configuration
 * TESTED MANUALLY - WORKS
 */
router.get('/status', async (req, res) => {
  try {
    const tradingService = serviceManager.get('trading');
    const yahooService = serviceManager.get('yahooFinance');
    const notificationService = serviceManager.get('notification');

    const status = {
      trading: tradingService.getStatus(),
      yahooFinance: yahooService.getStatus(),
      notification: notificationService.getStatus(),
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      status: status
    });

  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /trading/price
 * Get current GALA price and market summary
 * TESTED MANUALLY - WORKS
 */
router.get('/price', async (req, res) => {
  try {
    const yahooService = serviceManager.get('yahooFinance');

    const [currentPrice, marketSummary] = await Promise.all([
      yahooService.getCurrentPrice(),
      yahooService.getMarketSummary()
    ]);

    res.json({
      success: true,
      currentPrice: currentPrice,
      marketSummary: marketSummary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting price:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /trading/history
 * Get historical price data
 * Query params: days (optional, default 250), interval (optional, default 1d)
 * TESTED MANUALLY - NEEDS IMPROVEMENTS
 */
router.get('/history', async (req, res) => {
  try {
    const { days = 250, interval = '1d' } = req.query;
    
    const yahooService = serviceManager.get('yahooFinance');
    
    const historicalData = await yahooService.getHistoricalData({
      lookbackDays: parseInt(days),
      interval: interval
    });

    res.json({
      success: true,
      data: historicalData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting historical data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /trading/test-notification
 * Send a test notification (for testing Discord webhook)
 * TESTED MANUALLY - WORKS
 */
router.post('/test-notification', async (req, res) => {
  try {
    const notificationService = serviceManager.get('notification');
    
    const { type = 'test', message = 'Test notification from trading API' } = req.body;

    let result = false;

    switch (type) {
      case 'signal':
        const mockSignal = {
          signal: 'BUY',
          confidence: 0.75,
          reasons: ['Test Golden Cross signal'],
          goldenCross: { shortMA: 105, longMA: 100 },
          rsi: { rsi: 45, level: 'normal' }
        };
        result = await notificationService.sendTradingSignal(mockSignal);
        break;
        
      case 'trade':
        const mockTrade = {
          success: true,
          dryRun: true,
          signal: 'BUY',
          confidence: 0.75,
          trade: {
            quote: {
              inputAmount: 50,
              outputAmount: '47.5',
              quote: { feeTier: '0.3%' }
            }
          }
        };
        result = await notificationService.sendTradeExecution(mockTrade);
        break;
        
      case 'error':
        result = await notificationService.sendError('Test Error', new Error(message));
        break;
        
      default:
        result = await notificationService.sendWebhook({
          content: message,
          embeds: [{
            title: 'Test Notification',
            description: 'This is a test notification from the trading API',
            color: 0x0099ff,
            timestamp: new Date().toISOString()
          }]
        });
    }

    res.json({
      success: true,
      notificationSent: result,
      type: type,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Symbols Management Routes
 */

/**
 * GET /trading/symbols
 * Get all monitored symbols
 */
router.get('/symbols', async (req, res) => {
  try {
    const databaseService = serviceManager.get('database');
    const activeOnly = req.query.active !== 'false'; // Default to true
    
    const symbols = await databaseService.getMonitoredSymbols(activeOnly);

    res.json({
      success: true,
      symbols: symbols,
      count: symbols.length,
      activeOnly: activeOnly,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting monitored symbols:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /trading/symbols/:symbol
 * Get a specific monitored symbol
 */
router.get('/symbols/:symbol', async (req, res) => {
  try {
    const databaseService = serviceManager.get('database');
    const symbol = req.params.symbol;
    
    const symbolData = await databaseService.getMonitoredSymbol(symbol);

    if (!symbolData) {
      return res.status(404).json({
        success: false,
        error: 'Symbol not found',
        symbol: symbol,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      symbol: symbolData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting monitored symbol:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /trading/symbols
 * Add or update a monitored symbol
 */
router.post('/symbols', async (req, res) => {
  try {
    const databaseService = serviceManager.get('database');
    const symbolData = req.body;

    // Validate required fields
    if (!symbolData.symbol) {
      return res.status(400).json({
        success: false,
        error: 'Symbol is required',
        timestamp: new Date().toISOString()
      });
    }

    if (!symbolData.yahoo_symbol) {
      return res.status(400).json({
        success: false,
        error: 'Yahoo symbol is required',
        timestamp: new Date().toISOString()
      });
    }

    const result = await databaseService.upsertMonitoredSymbol(symbolData);

    res.json({
      success: true,
      result: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error adding/updating monitored symbol:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * PUT /trading/symbols/:symbol/status
 * Toggle symbol active status
 */
router.put('/symbols/:symbol/status', async (req, res) => {
  try {
    const databaseService = serviceManager.get('database');
    const symbol = req.params.symbol;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'is_active must be a boolean',
        timestamp: new Date().toISOString()
      });
    }

    const result = await databaseService.setSymbolActiveStatus(symbol, is_active);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: 'Symbol not found',
        symbol: symbol,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      result: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating symbol status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /trading/symbols/:symbol
 * Remove a monitored symbol
 */
router.delete('/symbols/:symbol', async (req, res) => {
  try {
    const databaseService = serviceManager.get('database');
    const symbol = req.params.symbol;
    
    const result = await databaseService.removeMonitoredSymbol(symbol);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: 'Symbol not found',
        symbol: symbol,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      result: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error removing monitored symbol:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /trading/prices
 * Get current prices for all monitored symbols
 */
router.get('/prices', async (req, res) => {
  try {
    const yahooService = serviceManager.get('yahooFinance');
    const useCache = req.query.cache !== 'false'; // Default to true
    
    const prices = await yahooService.getAllCurrentPrices(useCache);

    res.json({
      success: true,
      ...prices,
      useCache: useCache
    });

  } catch (error) {
    console.error('Error getting all current prices:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /trading/historical
 * Get historical data for all monitored symbols
 */
router.get('/historical', async (req, res) => {
  try {
    const yahooService = serviceManager.get('yahooFinance');
    const options = {
      period1: req.query.period1,
      period2: req.query.period2,
      interval: req.query.interval,
      useCache: req.query.cache !== 'false'
    };
    
    const historicalData = await yahooService.getAllHistoricalData(options);

    res.json({
      success: true,
      ...historicalData,
      options: options
    });

  } catch (error) {
    console.error('Error getting all historical data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;