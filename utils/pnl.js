/**
 * PnL (Profit and Loss) Utilities
 * Functions for calculating position performance and determining buyback conditions
 */

/**
 * Calculate percentage change from entry price to current price
 * @param {number} entryPrice - Price when position was opened (GALA price when sold)
 * @param {number} currentPrice - Current price of the token
 * @returns {number} - Percentage change (positive = profit, negative = loss)
 */
function calculatePnLPercentage(entryPrice, currentPrice) {
  if (!entryPrice || entryPrice <= 0) {
    throw new Error('Entry price must be positive');
  }
  
  if (!currentPrice || currentPrice < 0) {
    throw new Error('Current price must be non-negative');
  }

  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

/**
 * Check if position meets buyback conditions
 * @param {number} pnlPercentage - Current PnL percentage
 * @param {number} profitThreshold - Profit threshold (default: 5.0 = +5%)
 * @param {number} lossThreshold - Loss threshold (default: -2.0 = -2%)
 * @returns {Object} - Buyback decision and reason
 */
function shouldBuyback(pnlPercentage, profitThreshold = 5.0, lossThreshold = -2.0) {
  if (pnlPercentage >= profitThreshold) {
    return {
      shouldBuy: true,
      reason: 'PROFIT_TARGET',
      description: `Profit target reached: ${pnlPercentage.toFixed(2)}% >= ${profitThreshold}%`
    };
  }
  
  if (pnlPercentage <= lossThreshold) {
    return {
      shouldBuy: true,
      reason: 'STOP_LOSS',
      description: `Stop loss triggered: ${pnlPercentage.toFixed(2)}% <= ${lossThreshold}%`
    };
  }
  
  return {
    shouldBuy: false,
    reason: 'HOLD',
    description: `Position within thresholds: ${pnlPercentage.toFixed(2)}% (${lossThreshold}% to ${profitThreshold}%)`
  };
}

/**
 * Calculate expected GALA amount from buyback
 * @param {number} tokenAmount - Amount of tokens to sell back
 * @param {number} currentTokenPrice - Current price of token in GALA
 * @param {number} slippage - Expected slippage (default: 0.05 = 5%)
 * @returns {Object} - Expected and minimum GALA amounts
 */
function calculateExpectedBuyback(tokenAmount, currentTokenPrice, slippage = 0.05) {
  if (!tokenAmount || tokenAmount <= 0) {
    throw new Error('Token amount must be positive');
  }
  
  if (!currentTokenPrice || currentTokenPrice <= 0) {
    throw new Error('Current token price must be positive');
  }

  const expectedGalaAmount = tokenAmount * currentTokenPrice;
  const minimumGalaAmount = expectedGalaAmount * (1 - slippage);

  return {
    expectedGala: expectedGalaAmount,
    minimumGala: minimumGalaAmount,
    slippage: slippage * 100
  };
}

/**
 * Calculate final trade PnL after buyback
 * @param {number} initialGalaAmount - Initial GALA amount sold
 * @param {number} finalGalaAmount - Final GALA amount received from buyback
 * @returns {Object} - Final PnL metrics
 */
function calculateFinalPnL(initialGalaAmount, finalGalaAmount) {
  if (!initialGalaAmount || initialGalaAmount <= 0) {
    throw new Error('Initial GALA amount must be positive');
  }
  
  if (!finalGalaAmount || finalGalaAmount < 0) {
    throw new Error('Final GALA amount must be non-negative');
  }

  const absolutePnL = finalGalaAmount - initialGalaAmount;
  const percentagePnL = (absolutePnL / initialGalaAmount) * 100;

  return {
    initialAmount: initialGalaAmount,
    finalAmount: finalGalaAmount,
    absolutePnL: absolutePnL,
    percentagePnL: percentagePnL,
    isProfit: absolutePnL > 0
  };
}

/**
 * Format PnL for display
 * @param {number} pnlPercentage - PnL percentage
 * @param {number} absolutePnL - Absolute PnL amount (optional)
 * @returns {string} - Formatted PnL string
 */
function formatPnL(pnlPercentage, absolutePnL = null) {
  const sign = pnlPercentage >= 0 ? '+' : '';
  const emoji = pnlPercentage >= 0 ? '📈' : '📉';
  
  let result = `${emoji} ${sign}${pnlPercentage.toFixed(2)}%`;
  
  if (absolutePnL !== null) {
    const absSign = absolutePnL >= 0 ? '+' : '';
    result += ` (${absSign}${absolutePnL.toFixed(4)} GALA)`;
  }
  
  return result;
}

module.exports = {
  calculatePnLPercentage,
  shouldBuyback,
  calculateExpectedBuyback,
  calculateFinalPnL,
  formatPnL
};