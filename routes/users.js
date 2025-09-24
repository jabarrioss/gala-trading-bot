var express = require('express');
var {GSwap, PrivateKeySigner} = require('@gala-chain/gswap-sdk');
var router = express.Router();
var dotenv = require('dotenv');
dotenv.config();
const yahooFinance = require('yahoo-finance2').default;
/* GET users listing. */
router.get('/', async function(req, res, next) {
  await GSwap.events.connectEventSocket();
  const gSwap = new GSwap({
    signer: new PrivateKeySigner(process.env.PRIVATE_KEY),
  });

  const GALA_SELLING_AMOUNT = 10; // Amount of GALA to sell

  // Quote how much $GALA you can get for 100 GALA
  const quote = await gSwap.quoting.quoteExactInput(
    'GALA|Unit|none|none',
    'GUSDC|Unit|none|none',
    GALA_SELLING_AMOUNT,
  );
  console.log(`Best rate found on ${quote.feeTier} fee tier pool`);
  // Execute a swap using the best fee tier from the quote
  const pendingTx = await gSwap.swaps.swap(
    'GALA|Unit|none|none', // gala_symbol
    'GUSDC|Unit|none|none',
    quote.feeTier,
    {
      exactIn: GALA_SELLING_AMOUNT,
      amountOutMinimum: quote.outTokenAmount.multipliedBy(0.95), // 5% slippage
    },
    process.env.WALLET_ADDRESS,
  );
  console.log('************ pendingTx: ',  pendingTx);
  const result = await pendingTx.wait();
  console.log('Transaction completed!', result);
  // Application cleanup
  GSwap.events.disconnectEventSocket();
  res.send('respond with a resource');
});

router.get('/get-balance', async function(req, res, next) {
const gSwap = new GSwap();

// Get wallet's token balances
const assets = await gSwap.assets.getUserAssets(
  process.env.WALLET_ADDRESS,
  1, // page number (optional, default: 1)
  20, // limit per page (optional, default: 10)
);

console.log(`Wallet has ${assets.count} different tokens`);

// Display each token
assets.tokens.forEach((token) => {
  console.log(`${token.symbol}: ${token.quantity} (${token.name})`);
  console.log(`  Decimals: ${token.decimals}`);
  console.log(`  Image: ${token.image}`);
});
  res.send({
    assets,
    asset_count: assets.count,
  });
});

router.get('/get-gala-balance', async function(req, res, next) {
  try {
    const serviceManager = require('../services/ServiceManager');
    
    // Get the trading service (should be initialized from app.js)
    const tradingService = serviceManager.get('trading');
    if (!tradingService || !tradingService.isReady()) {
      return res.status(503).json({
        success: false,
        error: 'TradingService not available or not initialized'
      });
    }

    // Get GALA balance
    const balanceResult = await tradingService.getGalaBalance();
    
    console.log('GALA Balance Check:', balanceResult);
    
    res.json({
      success: balanceResult.success,
      gala_balance: balanceResult.balance,
      has_gala: balanceResult.hasGala,
      message: balanceResult.message,
      error: balanceResult.error,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting GALA balance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/get-price', async function(req, res, next) {
  yahooFinance.suppressNotices(['yahooSurvey']);
  const results = await yahooFinance.quote('GALA-USD');
  res.send({
    price: results.regularMarketPrice,
    currency: results.currency,
    time: results.regularMarketTime,
  });
});

router.get('/get-history', async function(req, res, next) {
  const results = await yahooFinance.historical('GALA-USD', {period1: '2025-01-01', period2: '2025-09-23', interval: '1d'});
  res.send({
    history: results
  });
});

router.post('/execute-swap', async function(req, res, next) {
  try {
    const { fromToken, toToken, amount, dryRun } = req.body;
    
    // Validate required parameters
    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: fromToken, toToken, amount'
      });
    }

    const serviceManager = require('../services/ServiceManager');
    
    // Get the trading service (should be initialized from app.js)
    const tradingService = serviceManager.get('trading');
    if (!tradingService || !tradingService.isReady()) {
      return res.status(503).json({
        success: false,
        error: 'TradingService not available or not initialized'
      });
    }

    console.log(`🔄 Executing swap: ${amount} ${fromToken} → ${toToken}`);
    console.log(`🧪 Dry Run: ${dryRun ? 'YES' : 'NO'}`);

    // Execute swap with balance check and notifications
    const swapResult = await tradingService.executeSwapWithBalanceCheck(
      fromToken,
      toToken,
      parseFloat(amount),
      {
        dryRun: dryRun === true || dryRun === 'true',
        sendNotification: true
      }
    );

    console.log('Swap Result:', swapResult);

    res.json({
      success: swapResult.success,
      swap_result: swapResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error executing swap:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/trade-history', async function(req, res, next) {
  try {
    const { strategy, limit = 50, offset = 0 } = req.query;
    
    const serviceManager = require('../services/ServiceManager');
    
    // Get the trading service (should be initialized from app.js)
    const tradingService = serviceManager.get('trading');
    if (!tradingService || !tradingService.isReady()) {
      return res.status(503).json({
        success: false,
        error: 'TradingService not available or not initialized'
      });
    }

    console.log(`📊 Fetching trade history - Strategy: ${strategy || 'All'}, Limit: ${limit}`);

    // Get trade history
    const trades = await tradingService.getTradeHistory(strategy, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Get trade statistics
    const stats = await tradingService.getTradeStats(strategy);

    console.log(`✅ Retrieved ${trades.length} trades with stats:`, stats);

    res.json({
      success: true,
      trades: trades,
      stats: stats,
      query: {
        strategy: strategy || 'All',
        limit: parseInt(limit),
        offset: parseInt(offset)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting trade history:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/trade-stats', async function(req, res, next) {
  try {
    const { strategy, symbol } = req.query;
    
    const serviceManager = require('../services/ServiceManager');
    
    // Get the trading service (should be initialized from app.js)
    const tradingService = serviceManager.get('trading');
    if (!tradingService || !tradingService.isReady()) {
      return res.status(503).json({
        success: false,
        error: 'TradingService not available or not initialized'
      });
    }

    console.log(`📈 Fetching trade stats - Strategy: ${strategy || 'All'}, Symbol: ${symbol || 'All'}`);

    // Get trade statistics
    const stats = await tradingService.getTradeStats(strategy, symbol);

    console.log(`✅ Trade statistics:`, stats);

    res.json({
      success: true,
      stats: stats,
      query: {
        strategy: strategy || 'All',
        symbol: symbol || 'All'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting trade stats:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
