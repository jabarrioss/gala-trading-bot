/**
 * DCA Strategy Demo - Demonstrates Dollar Cost Averaging strategy execution
 */

const serviceManager = require('../services/ServiceManager');
const CoinMarketCapService = require('../services/CoinMarketCapService');
const TradingService = require('../services/TradingService');

async function runDCADemo() {
  console.log('💰 DCA (Dollar Cost Averaging) Strategy Demo');
  console.log('='.repeat(50));
  
  try {
    // Initialize services
    await serviceManager.initializeAll();
    
    const cmcService = new CoinMarketCapService();
    await cmcService.init();
    
    const tradingService = new TradingService();
    await tradingService.init();
    
    // Get current GALA price
    const galaData = await cmcService.getCryptoData('GALA');
    console.log(`\n📊 Current GALA Price: $${galaData.price.toFixed(6)}`);
    
    // Generate mock price history for volatility analysis
    const currentPrice = galaData.price;
    const recentPrices = Array.from({ length: 14 }, (_, i) => {
      const variation = (Math.random() - 0.5) * 0.2; // ±10% variation
      return currentPrice * (1 + variation);
    });
    
    console.log(`\n📈 Price Volatility Analysis (last 14 periods):`);
    console.log(`   Min: $${Math.min(...recentPrices).toFixed(6)}`);
    console.log(`   Max: $${Math.max(...recentPrices).toFixed(6)}`);
    console.log(`   Avg: $${(recentPrices.reduce((a, b) => a + b) / recentPrices.length).toFixed(6)}`);
    
    // Test different DCA scenarios
    const scenarios = [
      {
        name: 'Daily DCA - $10',
        options: {
          interval: 'daily',
          amount: 10,
          priceThreshold: null,
          maxVolatility: 0.15
        }
      },
      {
        name: 'Weekly DCA - $50 (Conservative)',
        options: {
          interval: 'weekly',
          amount: 50,
          priceThreshold: currentPrice * 1.05, // Only buy if price is within 5% of current
          maxVolatility: 0.10
        }
      },
      {
        name: 'Monthly DCA - $200 (Aggressive)',
        options: {
          interval: 'monthly',
          amount: 200,
          priceThreshold: null,
          maxVolatility: 0.20
        }
      }
    ];
    
    for (const scenario of scenarios) {
      console.log(`\n${'-'.repeat(40)}`);
      console.log(`🎯 ${scenario.name}`);
      console.log(`${'-'.repeat(40)}`);
      
      // Analyze DCA strategy
      const analysis = tradingService.analyzeDCAStrategy(currentPrice, recentPrices, scenario.options);
      
      console.log(`Signal: ${analysis.signal || 'WAIT'}`);
      console.log(`Should Execute: ${analysis.shouldExecute ? 'YES ✅' : 'NO ❌'}`);
      console.log(`Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);
      console.log(`Amount: $${analysis.amount}`);
      console.log(`Interval: ${analysis.interval}`);
      if (analysis.volatility) {
        console.log(`Volatility: ${(analysis.volatility * 100).toFixed(2)}%`);
      }
      if (analysis.nextExecution) {
        console.log(`Next Execution: ${new Date(analysis.nextExecution).toLocaleString()}`);
      }
      console.log(`Reasons:`);
      analysis.reasons.forEach(reason => console.log(`  • ${reason}`));
      
      // Demo execution (dry run)
      if (analysis.shouldExecute && analysis.signal) {
        console.log(`\n🔄 Demo Execution (DRY RUN):`);
        const executionResult = await tradingService.executeDCAStrategy(analysis, {
          dryRun: true,
          recordExecution: false // Don't record demo executions
        });
        
        if (executionResult.success) {
          console.log(`  ✅ Execution would succeed`);
          console.log(`  📈 Strategy: ${executionResult.strategy}`);
          console.log(`  💵 Amount: $${executionResult.amount}`);
          console.log(`  💰 Price: $${executionResult.currentPrice?.toFixed(6) || 'N/A'}`);
        } else {
          console.log(`  ❌ Execution would fail: ${executionResult.error}`);
        }
      }
    }
    
    // Show overall DCA strategy benefits
    console.log(`\n${'='.repeat(50)}`);
    console.log(`💡 DCA Strategy Benefits:`);
    console.log(`${'='.repeat(50)}`);
    console.log(`• Reduces impact of volatility through time averaging`);
    console.log(`• Removes emotional decision-making from trading`);
    console.log(`• Consistent accumulation regardless of price movements`);
    console.log(`• Lower average cost basis over time in trending markets`);
    console.log(`• Configurable intervals and amounts for different risk profiles`);
    console.log(`• Built-in volatility and price threshold protections`);
    
    console.log(`\n✨ Demo completed successfully!`);
    
  } catch (error) {
    console.error('❌ Error in DCA demo:', error);
    process.exit(1);
  }
}

// Run the demo
if (require.main === module) {
  runDCADemo();
}

module.exports = { runDCADemo };