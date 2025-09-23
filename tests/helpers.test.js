const { 
  formatNumber, 
  formatPrice, 
  calculatePercentageChange, 
  isValidWalletAddress, 
  validateTradeAmount,
  sanitizeForLog 
} = require('../utils/helpers');

describe('Helper Functions', () => {
  test('formatNumber should format numbers correctly', () => {
    expect(formatNumber(123.456)).toBe('123.46');
    expect(formatNumber(123.456, 3)).toBe('123.456');
    expect(formatNumber(123)).toBe('123.00');
  });

  test('formatPrice should format prices correctly', () => {
    expect(formatPrice(123.456)).toBe('$123.46');
    expect(formatPrice(123.456, '€')).toBe('€123.46');
    expect(formatPrice(123.456, '$', 3)).toBe('$123.456');
  });

  test('calculatePercentageChange should calculate correctly', () => {
    expect(calculatePercentageChange(100, 110)).toBe(10);
    expect(calculatePercentageChange(100, 90)).toBe(-10);
    expect(calculatePercentageChange(0, 10)).toBe(0);
  });

  test('isValidWalletAddress should validate wallet addresses', () => {
    expect(isValidWalletAddress('eth|1234567890123456789012345678901234567890')).toBe(true);
    expect(isValidWalletAddress('invalid')).toBe(false);
    expect(isValidWalletAddress('1234567890123456789012345678901234567890')).toBe(false);
    expect(isValidWalletAddress('')).toBe(false);
  });

  test('validateTradeAmount should validate trade amounts', () => {
    expect(validateTradeAmount(100, 1000)).toEqual({ valid: true });
    expect(validateTradeAmount(-10, 1000)).toEqual({ 
      valid: false, 
      error: 'Amount must be a positive number' 
    });
    expect(validateTradeAmount(1500, 1000)).toEqual({ 
      valid: false, 
      error: 'Amount exceeds maximum limit of 1000' 
    });
  });

  test('sanitizeForLog should sanitize sensitive information', () => {
    const sensitive = 'Private key: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const sanitized = sanitizeForLog(sensitive);
    expect(sanitized).toContain('0x...');
    expect(sanitized).not.toContain('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');

    const wallet = 'Wallet: eth|1234567890123456789012345678901234567890';
    const sanitizedWallet = sanitizeForLog(wallet);
    expect(sanitizedWallet).toContain('eth|...');
  });
});