/**
 * Test the PriceOracleService directly
 */

const PriceOracleService = require('./services/PriceOracleService');

async function testPriceOracleService() {
  console.log('🔍 Testing PriceOracleService class...');
  
  const priceOracle = new PriceOracleService();
  await priceOracle.init();
  
  const gala_symbol = 'GALA|Unit|none|none';
  
  console.log(`\n📊 Testing getCurrentPrice with symbol: ${gala_symbol}`);
  try {
    const currentPrice = await priceOracle.getCurrentPrice(gala_symbol);
    console.log('✅ Current price result:', currentPrice);
  } catch (error) {
    console.log('❌ Current price error:', error.message);
  }
  
  console.log(`\n📈 Testing getGoldenCrossData with symbol: ${gala_symbol}`);
  try {
    const goldenCrossData = await priceOracle.getGoldenCrossData(gala_symbol);
    console.log('✅ Golden cross data result:', goldenCrossData);
  } catch (error) {
    console.log('❌ Golden cross data error:', error.message);
  }
}

testPriceOracleService().catch(console.error);