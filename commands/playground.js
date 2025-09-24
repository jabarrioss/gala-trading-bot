/**
 * This command file is for testing and experimenting with code snippets.
 */

const serviceManager = require('../services/ServiceManager');
const CoinMarketCapService = require('../services/CoinMarketCapService');
const TradingService = require('../services/TradingService');

async function runPlayground() {
  console.log('🚀 Running playground...');
  
  // Initialize ServiceManager first
  await serviceManager.initializeAll();
  
  // Test CoinMarketCap service
  const cmcService = new CoinMarketCapService();
  await cmcService.init();

  // Test fetching GALA data
  try {
    const galaData = await cmcService.getCryptoData('GALA');
    console.log('GALA Data:', galaData);

    // Test DCA strategy
    console.log('\n📊 Testing DCA Strategy...');
    const tradingService = new TradingService();
    await tradingService.init();

    // Generate some mock recent prices for volatility analysis
    const currentPrice = galaData.price;
    const recentPrices = Array.from({ length: 10 }, (_, i) => 
      currentPrice * (0.95 + Math.random() * 0.1) // ±5% variation
    );

    // Test DCA analysis
    const dcaOptions = {
      interval: 'daily',
      amount: 10, // $10 DCA
      priceThreshold: null, // No price threshold
      maxVolatility: 0.15, // 15% max volatility
      lastExecutionTime: null // No previous execution
    };

    const dcaAnalysis = tradingService.analyzeDCAStrategy(currentPrice, recentPrices, dcaOptions);
    console.log('DCA Analysis Result:', JSON.stringify(dcaAnalysis, null, 2));

    // Test comprehensive DCA data
    const dcaData = await tradingService.getDCAStrategyData(currentPrice, recentPrices, dcaOptions);
    console.log('DCA Strategy Data:', JSON.stringify(dcaData, null, 2));

  } catch (error) {
    console.error('Error in DCA testing:', error);
  }

  // Test fetching global metrics
  try {
    const globalMetrics = await cmcService.getGlobalMetrics();
    console.log('\nGlobal Metrics:', globalMetrics);
  } catch (error) {
    console.error('Error fetching global metrics:', error);
  }
}

runPlayground();