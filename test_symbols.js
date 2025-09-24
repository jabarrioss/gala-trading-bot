const http = require('http');

// Simple HTTP client to test our API
function testAPI(path, callback) {
  const options = {
    hostname: 'localhost',
    port: 3003,
    path: path,
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        callback(null, parsed);
      } catch (err) {
        callback(null, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Connection error:', err.message);
    callback(err);
  });
  
  req.setTimeout(5000, () => {
    req.destroy();
    callback(new Error('Request timeout'));
  });

  req.end();
}

// Test the symbols endpoint
console.log('Testing /trading/symbols endpoint...');
testAPI('/trading/symbols', (err, data) => {
  if (err) {
    console.error('Error:', err.message);
    return;
  }
  
  console.log('Response:', JSON.stringify(data, null, 2));
  
  // Check if GALA symbol has both yahoo_symbol and gala_symbol
  if (Array.isArray(data)) {
    const galaSymbol = data.find(symbol => symbol.symbol === 'GALA');
    if (galaSymbol) {
      console.log('\n✅ GALA Symbol found:');
      console.log('  - yahoo_symbol:', galaSymbol.yahoo_symbol);
      console.log('  - gala_symbol:', galaSymbol.gala_symbol);
      
      if (galaSymbol.yahoo_symbol && galaSymbol.gala_symbol) {
        console.log('✅ Dual symbol support working correctly!');
      } else {
        console.log('❌ Missing symbol formats');
      }
    } else {
      console.log('❌ GALA symbol not found in response');
    }
  }
  
  process.exit(0);
});