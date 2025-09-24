/**
 * Technical Indicators Utility Functions
 * Pure functions for calculating various technical indicators
 */

/**
 * Calculate Simple Moving Average (SMA)
 * @param {number[]} prices - Array of prices (newest first)
 * @param {number} period - Number of periods to calculate SMA
 * @returns {number|null} - SMA value or null if insufficient data
 */
function calculateSMA(prices, period) {
  if (!Array.isArray(prices) || prices.length < period || period <= 0) {
    return null;
  }

  const relevantPrices = prices.slice(0, period);
  const sum = relevantPrices.reduce((acc, price) => acc + price, 0);
  return sum / period;
}

/**
 * Calculate multiple SMA values for different periods
 * @param {number[]} prices - Array of prices (newest first)
 * @param {number[]} periods - Array of periods to calculate
 * @returns {Object} - Object with period as key and SMA as value
 */
function calculateMultipleSMA(prices, periods) {
  const result = {};
  periods.forEach(period => {
    result[period] = calculateSMA(prices, period);
  });
  return result;
}

/**
 * Calculate SMA for historical data with timestamps
 * @param {Array} historicalData - Array of {date, close} objects (newest first)
 * @param {number} period - Number of periods
 * @returns {Array} - Array of {date, sma} objects
 */
function calculateSMAHistory(historicalData, period) {
  if (!Array.isArray(historicalData) || historicalData.length < period) {
    return [];
  }

  const result = [];
  for (let i = 0; i <= historicalData.length - period; i++) {
    const slice = historicalData.slice(i, i + period);
    const sum = slice.reduce((acc, item) => acc + item.close, 0);
    const sma = sum / period;
    
    result.push({
      date: historicalData[i].date,
      sma: sma
    });
  }
  
  return result;
}

/**
 * Detect Golden Cross pattern
 * @param {number[]} prices - Array of prices (newest first)
 * @param {number} shortPeriod - Short MA period (default: 50)
 * @param {number} longPeriod - Long MA period (default: 200)
 * @returns {Object} - Signal information
 */
function detectGoldenCross(prices, shortPeriod = 50, longPeriod = 200) {
  if (prices.length < longPeriod + 1) {
    return {
      signal: null,
      reason: 'Insufficient historical data',
      shortMA: null,
      longMA: null,
      previousShortMA: null,
      previousLongMA: null
    };
  }

  // Current MAs
  const currentShortMA = calculateSMA(prices, shortPeriod);
  const currentLongMA = calculateSMA(prices, longPeriod);
  
  // Previous MAs (using prices from yesterday)
  const previousPrices = prices.slice(1);
  const previousShortMA = calculateSMA(previousPrices, shortPeriod);
  const previousLongMA = calculateSMA(previousPrices, longPeriod);

  if (!currentShortMA || !currentLongMA || !previousShortMA || !previousLongMA) {
    return {
      signal: null,
      reason: 'Unable to calculate moving averages',
      shortMA: currentShortMA,
      longMA: currentLongMA,
      previousShortMA: previousShortMA,
      previousLongMA: previousLongMA
    };
  }

  // Detect Golden Cross: Short MA crosses above Long MA
  const goldenCross = currentShortMA > currentLongMA && previousShortMA <= previousLongMA;
  
  // Detect Death Cross: Short MA crosses below Long MA
  const deathCross = currentShortMA < currentLongMA && previousShortMA >= previousLongMA;

  let signal = null;
  let reason = 'No crossover detected';

  if (goldenCross) {
    signal = 'BUY';
    reason = 'Golden Cross detected: Short MA crossed above Long MA';
  } else if (deathCross) {
    signal = 'SELL';
    reason = 'Death Cross detected: Short MA crossed below Long MA';
  }

  return {
    signal,
    reason,
    shortMA: currentShortMA,
    longMA: currentLongMA,
    previousShortMA,
    previousLongMA,
    crossoverStrength: Math.abs(currentShortMA - currentLongMA) / currentLongMA // Percentage difference
  };
}

/**
 * Calculate Relative Strength Index (RSI)
 * @param {number[]} prices - Array of prices (newest first)
 * @param {number} period - RSI period (default: 14)
 * @returns {number|null} - RSI value (0-100) or null if insufficient data
 */
function calculateRSI(prices, period = 14) {
  if (!Array.isArray(prices) || prices.length < period + 1) {
    return null;
  }

  // Calculate price changes (gains and losses)
  const changes = [];
  for (let i = 0; i < prices.length - 1; i++) {
    changes.push(prices[i] - prices[i + 1]); // Current - Previous (newest first)
  }

  // Separate gains and losses
  const gains = changes.map(change => change > 0 ? change : 0);
  const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);

  // Calculate average gain and loss for the period
  const avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
  const avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

  if (avgLoss === 0) return 100; // No losses = RSI of 100

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

/**
 * Detect overbought/oversold conditions using RSI
 * @param {number} rsi - RSI value
 * @param {number} overboughtLevel - Overbought threshold (default: 70)
 * @param {number} oversoldLevel - Oversold threshold (default: 30)
 * @returns {Object} - Signal information
 */
function detectRSISignal(rsi, overboughtLevel = 70, oversoldLevel = 30) {
  if (rsi === null || rsi === undefined) {
    return {
      signal: null,
      reason: 'RSI value not available',
      rsi: null
    };
  }

  let signal = null;
  let reason = 'RSI within normal range';

  if (rsi >= overboughtLevel) {
    signal = 'SELL';
    reason = `RSI overbought (${rsi.toFixed(2)} >= ${overboughtLevel})`;
  } else if (rsi <= oversoldLevel) {
    signal = 'BUY';
    reason = `RSI oversold (${rsi.toFixed(2)} <= ${oversoldLevel})`;
  }

  return {
    signal,
    reason,
    rsi: rsi,
    level: rsi >= overboughtLevel ? 'overbought' : rsi <= oversoldLevel ? 'oversold' : 'normal'
  };
}

/**
 * Analyze DCA (Dollar Cost Averaging) strategy
 * @param {Object} options - DCA configuration options
 * @returns {Object} - DCA analysis result
 */
function analyzeDCAStrategy(options = {}) {
  const {
    interval = 'daily', // 'daily', 'weekly', 'monthly'
    lastExecutionTime = null,
    amount = 10, // Default DCA amount
    priceThreshold = null, // Optional: only buy if price is below threshold
    currentPrice = null,
    volatilityWindow = 7, // Days to check for volatility
    prices = [], // Recent prices for volatility check
    maxVolatility = 0.1 // 10% max volatility threshold
  } = options;

  const now = new Date();
  const intervalMs = getIntervalMs(interval);
  
  // Check if enough time has passed since last execution
  const shouldExecute = !lastExecutionTime || 
    (now.getTime() - new Date(lastExecutionTime).getTime()) >= intervalMs;

  if (!shouldExecute) {
    const timeLeft = Math.ceil((intervalMs - (now.getTime() - new Date(lastExecutionTime).getTime())) / (1000 * 60 * 60));
    return {
      signal: null,
      reason: `Next DCA execution in ${timeLeft} hours`,
      shouldExecute: false,
      nextExecution: new Date(new Date(lastExecutionTime).getTime() + intervalMs).toISOString(),
      confidence: 0
    };
  }

  let signal = 'BUY'; // DCA is always buy
  let confidence = 0.8; // Base confidence for DCA
  let reasons = [`DCA ${interval} interval reached`];

  // Check price threshold if specified
  if (priceThreshold && currentPrice && currentPrice > priceThreshold) {
    return {
      signal: null,
      reason: `Current price ${currentPrice.toFixed(4)} above threshold ${priceThreshold.toFixed(4)}`,
      shouldExecute: false,
      confidence: 0,
      priceCheck: 'above_threshold'
    };
  }

  // Check volatility if we have price history
  if (prices && prices.length >= volatilityWindow) {
    const recentPrices = prices.slice(0, volatilityWindow);
    const avgPrice = recentPrices.reduce((sum, p) => sum + p, 0) / volatilityWindow;
    const volatility = Math.sqrt(
      recentPrices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / volatilityWindow
    ) / avgPrice;

    if (volatility > maxVolatility) {
      confidence *= 0.7; // Reduce confidence during high volatility
      reasons.push(`High volatility detected: ${(volatility * 100).toFixed(2)}%`);
    } else {
      reasons.push(`Normal volatility: ${(volatility * 100).toFixed(2)}%`);
    }
  }

  // Price threshold bonus
  if (priceThreshold && currentPrice && currentPrice <= priceThreshold) {
    confidence += 0.1; // Bonus confidence for good price
    reasons.push(`Price ${currentPrice.toFixed(4)} below threshold ${priceThreshold.toFixed(4)}`);
  }

  return {
    signal,
    confidence: Math.min(confidence, 1.0),
    reasons,
    shouldExecute: true,
    amount,
    interval,
    nextExecution: new Date(now.getTime() + intervalMs).toISOString(),
    volatility: prices.length >= volatilityWindow ? 
      calculateVolatility(prices.slice(0, volatilityWindow)) : null,
    timestamp: now.toISOString()
  };
}

/**
 * Get interval in milliseconds
 * @param {string} interval - Interval string ('daily', 'weekly', 'monthly')
 * @returns {number} - Milliseconds
 */
function getIntervalMs(interval) {
  const intervals = {
    'daily': 24 * 60 * 60 * 1000,
    'weekly': 7 * 24 * 60 * 60 * 1000,
    'monthly': 30 * 24 * 60 * 60 * 1000
  };
  return intervals[interval] || intervals['daily'];
}

/**
 * Calculate price volatility
 * @param {number[]} prices - Array of recent prices
 * @returns {number} - Volatility ratio
 */
function calculateVolatility(prices) {
  if (prices.length < 2) return 0;
  
  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
  return Math.sqrt(variance) / avg;
}

module.exports = {
  calculateSMA,
  calculateMultipleSMA,
  calculateSMAHistory,
  detectGoldenCross,
  calculateRSI,
  detectRSISignal,
  analyzeDCAStrategy,
  getIntervalMs,
  calculateVolatility
};