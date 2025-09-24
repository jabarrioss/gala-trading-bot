#!/usr/bin/env node

/**
 * Trading Command Script
 * Standalone script for automated trading operations
 */

const path = require('path');
const serviceManager = require('../services/ServiceManager');

async function initializeServices() {
  console.log('🚀 Initializing trading services...');
  
  try {
    await serviceManager.initializeAll();
    console.log('✅ All services initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    return false;
  }
}

async function runTradingAnalysis(symbol = null) {
  try {
    const priceOracleService = serviceManager.get('priceOracle');
    const tradingService = serviceManager.get('trading');
    const databaseService = serviceManager.get('database');
    // const binanceService = serviceManager.get('binance');

    // Ensure services are initialized
    if (!priceOracleService || !tradingService || !databaseService) {
      throw new Error('Required services are not available');
    }
    
    const analysisResults = {};

    if (symbol) {
      // Analyze specific symbol
      console.log(`📊 Analyzing symbol: ${symbol}`);
      
      const symbolData = await databaseService.getMonitoredSymbol(symbol);
      
      if (!symbolData || !symbolData.is_active) {
        console.error(`❌ Symbol ${symbol} not found or inactive`);
        return null;
      }

      if (!symbolData.gala_symbol) {
        console.error(`❌ Symbol ${symbol} has no gala_symbol configured`);
        return null;
      }

      // Get historical data for DCA analysis
      const historicalData = await priceOracleService.getDCAData(symbolData.gala_symbol, {
        lookbackDays: 365,
        interval: 'daily'
      });

      if (!historicalData.success) {
        console.error(`❌ Failed to fetch historical data for ${symbol}:`, historicalData.error);
        return null;
      }

      // Analyze using DCA strategy
      const analysis = tradingService.analyzeDCAStrategy(
        historicalData.data,
        symbolData.strategy_config?.dca || {
          investmentAmount: 100,
          interval: 'daily',
          volatilityThreshold: 0.15,
          minInvestmentPeriods: 30
        }
      );

      // Get current price for context
      const currentPrice = await priceOracleService.getCurrentPrice(symbolData.gala_symbol);

      analysisResults[symbol] = {
        analysis,
        currentPrice: currentPrice.success ? currentPrice : null,
        historicalDataPoints: historicalData.count,
        symbolData
      };

      console.log(`✅ Analysis complete for ${symbol}`);
      console.log(`   Signal: ${analysis.signal}`);
      console.log(`   Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);
      if (currentPrice.success) {
        console.log(`   Current Price: $${currentPrice.price}`);
      }

    } else {
      // Analyze all active symbols
      console.log('📊 Analyzing all active trading symbols...');
      
      const symbols = await databaseService.getTradingSymbols();
      
      if (symbols.length === 0) {
        console.log('⚠️ No active trading symbols found');
        return {};
      }

      console.log(`Found ${symbols.length} active symbols to analyze`);

      // Analyze each symbol
      for (const symbolData of symbols) {
        try {
          console.log(`   Analyzing ${symbolData.symbol}...`);
          
          // Skip symbols without gala_symbol
          if (!symbolData.gala_symbol) {
            console.log(`   ⚠️ Skipping ${symbolData.symbol}: no gala_symbol configured`);
            analysisResults[symbolData.symbol] = {
              success: false,
              error: 'No gala_symbol configured',
              details: 'This symbol requires gala_symbol to be set for price oracle integration'
            };
            continue;
          }
          
          // Get historical data for DCA analysis
          const historicalData = await priceOracleService.getDCAData(symbolData.gala_symbol, {
            lookbackDays: 365,
            interval: 'daily'
          });

          if (!historicalData.success) {
            console.error(`   ❌ Failed to fetch data for ${symbolData.symbol}: ${historicalData.error}`);
            
            // For now, create a placeholder analysis indicating data unavailable
            analysisResults[symbolData.symbol] = {
              success: false,
              error: 'Price oracle data unavailable',
              details: historicalData.error,
              note: 'The Gala price oracle may not have data for this token, or the API may be experiencing issues'
            };
            continue;
          }

          // Analyze using DCA strategy
          const analysis = tradingService.analyzeDCAStrategy(
            historicalData.data,
            symbolData.strategy_config?.dca || {
              investmentAmount: 100,
              interval: 'daily',
              volatilityThreshold: 0.15,
              minInvestmentPeriods: 30
            }
          );

          // Get current price for context
          const currentPrice = await priceOracleService.getCurrentPrice(symbolData.gala_symbol);

          analysisResults[symbolData.symbol] = {
            success: true,
            analysis,
            currentPrice: currentPrice.success ? currentPrice : null,
            historicalDataPoints: historicalData.count,
            symbolData
          };

          console.log(`   ✅ ${symbolData.symbol}: ${analysis.signal} (${(analysis.confidence * 100).toFixed(1)}% confidence)`);

        } catch (error) {
          console.error(`   ❌ Error analyzing ${symbolData.symbol}:`, error.message);
          analysisResults[symbolData.symbol] = {
            success: false,
            error: error.message
          };
        }
      }
    }

    return analysisResults;

  } catch (error) {
    console.error('❌ Error during trading analysis:', error);
    return null;
  }
}

async function executeTradingStrategy() {
  console.log('🚀 Executing automated trading strategy...');
  
  const tradingService = serviceManager.get('trading');
  const notificationService = serviceManager.get('notification');
  
  try {
    // Run analysis first
    const analysisResults = await runTradingAnalysis();
    
    if (!analysisResults) {
      console.log('❌ No analysis results available');
      return;
    }

    // Check for strong buy signals
    const buySignals = Object.entries(analysisResults).filter(([symbol, result]) => {
      return result.success && 
             result.analysis.signal === 'BUY' && 
             result.analysis.confidence >= 0.7;
    });

    if (buySignals.length === 0) {
      console.log('📊 No strong buy signals detected');
      return;
    }

    console.log(`🎯 Found ${buySignals.length} strong buy signal(s)`);

    // Execute trades for strong signals
    for (const [symbol, result] of buySignals) {
      try {
        console.log(`💰 Executing trade for ${symbol}...`);
        
        const tradeResult = await tradingService.executeSwapForSymbol(
          symbol,
          result.symbolData.min_trade_amount,
          {
            dryRun: process.env.DRY_RUN_MODE === 'true'
          }
        );

        if (tradeResult.success) {
          console.log(`✅ Trade executed successfully for ${symbol}`);
          
          // Send notification
          await notificationService.sendTradeNotification({
            symbol: symbol,
            action: 'BUY',
            amount: tradeResult.effectiveAmount,
            price: result.currentPrice?.price,
            confidence: result.analysis.confidence,
            analysis: result.analysis
          });
          
        } else {
          console.error(`❌ Trade failed for ${symbol}:`, tradeResult.error);
        }
        
      } catch (error) {
        console.error(`❌ Error executing trade for ${symbol}:`, error.message);
      }
    }

  } catch (error) {
    console.error('❌ Error in trading strategy execution:', error);
  }
}

async function main() {
  console.log('🎯 Gala Trading Bot - Command Line Interface');
  console.log('==========================================');
  
  // Initialize services
  const initialized = await initializeServices();
  if (!initialized) {
    process.exit(1);
  }

  // Get command line arguments
  const args = process.argv.slice(2);
  const command = args[0];
  const symbol = args[1];

  try {
    switch (command) {
      case 'analyze':
        console.log('📊 Running market analysis...');
        const results = await runTradingAnalysis(symbol);
        if (results) {
          console.log('\n📈 Analysis Results:');
          console.log(JSON.stringify(results, null, 2));
        }
        break;

      case 'trade':
        console.log('💰 Executing trading strategy...');
        await executeTradingStrategy();
        break;

      case 'monitor':
        console.log('👀 Starting continuous monitoring...');
        console.log('Press Ctrl+C to stop');
        
        // Run analysis every 5 minutes
        setInterval(async () => {
          console.log(`\n⏰ ${new Date().toLocaleTimeString()} - Running scheduled analysis...`);
          await runTradingAnalysis();
        }, 5 * 60 * 1000);
        
        // Keep the process alive
        process.on('SIGINT', () => {
          console.log('\n👋 Stopping monitor...');
          process.exit(0);
        });
        
        // Run initial analysis
        await runTradingAnalysis();
        break;

      default:
        console.log(`
Usage: node commands/trading.js <command> [symbol]

Commands:
  analyze [symbol]  - Analyze market conditions (all symbols or specific symbol)
  trade            - Execute automated trading strategy based on signals
  monitor          - Continuously monitor and analyze market conditions

Examples:
  node commands/trading.js analyze          # Analyze all symbols
  node commands/trading.js analyze GALA     # Analyze specific symbol
  node commands/trading.js trade            # Execute trades based on signals
  node commands/trading.js monitor          # Start continuous monitoring
        `);
        break;
    }
  } catch (error) {
    console.error('❌ Command execution failed:', error);
    process.exit(1);
  }

  // Exit if not monitoring
  if (command !== 'monitor') {
    process.exit(0);
  }
}

// Handle uncaught errors gracefully
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  initializeServices,
  runTradingAnalysis,
  executeTradingStrategy
};