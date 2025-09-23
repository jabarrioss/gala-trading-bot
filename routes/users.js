var express = require('express');
var {GSwap, PrivateKeySigner} = require('@gala-chain/gswap-sdk');
var router = express.Router();
var dotenv = require('dotenv');
dotenv.config();

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
    'GALA|Unit|none|none',
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
module.exports = router;
