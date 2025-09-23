/**
 * Collection of pure utility functions for common operations
 */

/**
 * Format number to specified decimal places
 * @param {number} num - Number to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted number
 */
function formatNumber(num, decimals = 2) {
  return Number(num).toFixed(decimals);
}

/**
 * Format price with currency symbol
 * @param {number} price - Price value
 * @param {string} currency - Currency symbol (default: '$')
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted price
 */
function formatPrice(price, currency = '$', decimals = 2) {
  return `${currency}${formatNumber(price, decimals)}`;
}

/**
 * Calculate percentage change
 * @param {number} oldValue - Original value
 * @param {number} newValue - New value
 * @returns {number} Percentage change
 */
function calculatePercentageChange(oldValue, newValue) {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate wallet address format
 * @param {string} address - Wallet address to validate
 * @returns {boolean} True if valid format
 */
function isValidWalletAddress(address) {
  return typeof address === 'string' && address.startsWith('eth|') && address.length > 10;
}

/**
 * Validate trade amount
 * @param {number} amount - Trade amount to validate
 * @param {number} maxAmount - Maximum allowed amount
 * @returns {Object} Validation result {valid: boolean, error?: string}
 */
function validateTradeAmount(amount, maxAmount) {
  if (typeof amount !== 'number' || amount <= 0) {
    return { valid: false, error: 'Amount must be a positive number' };
  }
  
  if (amount > maxAmount) {
    return { valid: false, error: `Amount exceeds maximum limit of ${maxAmount}` };
  }
  
  return { valid: true };
}

/**
 * Generate timestamp string
 * @param {Date} date - Date object (default: current date)
 * @returns {string} ISO timestamp string
 */
function getTimestamp(date = new Date()) {
  return date.toISOString();
}

/**
 * Retry async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} baseDelay - Base delay in milliseconds (default: 1000)
 * @returns {Promise<any>} Function result
 */
async function retry(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
}

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if object is empty
 * @param {Object} obj - Object to check
 * @returns {boolean} True if empty
 */
function isEmpty(obj) {
  return Object.keys(obj).length === 0;
}

/**
 * Sanitize string for logging (remove sensitive data)
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeForLog(str) {
  if (typeof str !== 'string') return str;
  
  // Replace private keys, wallet addresses, etc.
  return str
    .replace(/[a-fA-F0-9]{64}/g, '0x...') // Private keys
    .replace(/eth\|[a-fA-F0-9]+/g, 'eth|...') // Wallet addresses
    .replace(/https:\/\/discord\.com\/api\/webhooks\/[^\s]+/g, 'https://discord.com/api/webhooks/...'); // Discord webhooks
}

module.exports = {
  formatNumber,
  formatPrice,
  calculatePercentageChange,
  sleep,
  isValidWalletAddress,
  validateTradeAmount,
  getTimestamp,
  retry,
  deepClone,
  isEmpty,
  sanitizeForLog
};