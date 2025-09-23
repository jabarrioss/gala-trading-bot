const express = require('express');
const router = express.Router();
const serviceManager = require('../services/ServiceManager');

/**
 * Trading routes - Golden Cross strategy implementation
 */

/**
 * GET /trading/analyze
 * Analyze current market conditions and generate trading signals
 * MANUALLY - WORKS
 */
router.get('/analyze', async (req, res) => {
  try {
    const yahooService = serviceManager.get('yahooFinance');
    const tradingService = serviceManager.get('trading');

    // Get historical data for Golden Cross analysis
    const historicalData = await yahooService.getGoldenCrossData({
      lookbackDays: 250
    });

    if (!historicalData.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch historical data',
        details: historicalData.error
      });
    }

    // Analyze using Golden Cross strategy
    const analysis = tradingService.analyzeGoldenCrossStrategy(
      historicalData.prices,
      {
        shortPeriod: 50,
        longPeriod: 200,
        useRSI: true
      }
    );

    // Get current price for context
    const currentPrice = await yahooService.getCurrentPrice();

    res.json({
      success: true,
      analysis: analysis,
      currentPrice: currentPrice.success ? currentPrice : null,
      historicalDataPoints: historicalData.count,
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

module.exports = router;