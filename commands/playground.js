/**
 * This command file is for testing and experimenting with code snippets.
 */

const serviceManager = require('../services/ServiceManager');
const CoinMarketCapService = require('../services/CoinMarketCapService');
async function runPlayground() {
  console.log('🚀 Running playground...');
  const cmcService = new CoinMarketCapService();
  await cmcService.init();

  // Test fetching GALA data
  try {
    const galaData = await cmcService.getCryptoData('GALA');
    console.log('GALA Data:', galaData);
  } catch (error) {
    console.error('Error fetching GALA data:', error);
  }

  // Test fetching global metrics
  try {
    const globalMetrics = await cmcService.getGlobalMetrics();
    console.log('Global Metrics:', globalMetrics);
  } catch (error) {
    console.error('Error fetching global metrics:', error);
  }
}
runPlayground();