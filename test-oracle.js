/**
 * Simple test for the Price Oracle API
 */

async function testPriceOracle() {
  console.log('🔍 Testing Gala Price Oracle API...');
  
  const ORACLE_URL = 'https://dex-backend-prod1.defi.gala.com/price-oracle/fetch-price';
  
  // Test current price - try different formats
  console.log('\n📊 Testing current price fetch...');
  
  // Try 1: With full symbol
  console.log('\n🔍 Test 1: Full symbol GALA$Unit$none$none');
  let params = new URLSearchParams({
    token: 'GALA$Unit$none$none',
    page: 1,
    limit: 1
  });

  try {
    const response = await fetch(`${ORACLE_URL}?${params}`);
    console.log(`Response status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Full symbol success:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log('❌ Full symbol failed:', errorText);
    }
  } catch (error) {
    console.error('❌ Full symbol error:', error);
  }

  // Try 2: With just GALA
  console.log('\n🔍 Test 2: Just GALA token');
  params = new URLSearchParams({
    token: 'GALA',
    page: 1,
    limit: 1
  });

  try {
    const response = await fetch(`${ORACLE_URL}?${params}`);
    console.log(`Response status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ GALA token success:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log('❌ GALA token failed:', errorText);
    }
  } catch (error) {
    console.error('❌ GALA token error:', error);
  }

  // Try 3: No token parameter - get all prices
  console.log('\n🔍 Test 3: All prices (no token filter)');
  params = new URLSearchParams({
    page: 1,
    limit: 5
  });

  try {
    const response = await fetch(`${ORACLE_URL}?${params}`);
    console.log(`Response status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ All prices success:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log('❌ All prices failed:', errorText);
    }
  } catch (error) {
    console.error('❌ All prices error:', error);
  }

  // Test historical data
  console.log('\n📈 Testing historical data fetch...');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7); // 7 days ago
  
  const histParams = new URLSearchParams({
    token: 'GALA$Unit$none$none',
    page: 1,
    limit: 10,
    from: startDate.toISOString()
  });

  try {
    const response = await fetch(`${ORACLE_URL}?${histParams}`);
    console.log(`Response status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Historical data:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log('Error response:', errorText);
    }
  } catch (error) {
    console.error('Fetch error:', error);
  }
}

testPriceOracle().catch(console.error);