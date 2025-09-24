const {
  calculatePnLPercentage,
  shouldBuyback,
  calculateExpectedBuyback,
  calculateFinalPnL,
  formatPnL
} = require('../utils/pnl');

describe('PnL Utilities', () => {
  describe('calculatePnLPercentage', () => {
    test('should calculate positive PnL correctly', () => {
      const entryPrice = 100;
      const currentPrice = 110;
      const pnl = calculatePnLPercentage(entryPrice, currentPrice);
      expect(pnl).toBe(10); // 10% profit
    });

    test('should calculate negative PnL correctly', () => {
      const entryPrice = 100;
      const currentPrice = 95;
      const pnl = calculatePnLPercentage(entryPrice, currentPrice);
      expect(pnl).toBe(-5); // 5% loss
    });

    test('should handle zero change', () => {
      const entryPrice = 100;
      const currentPrice = 100;
      const pnl = calculatePnLPercentage(entryPrice, currentPrice);
      expect(pnl).toBe(0); // 0% change
    });

    test('should throw error for invalid entry price', () => {
      expect(() => calculatePnLPercentage(0, 100)).toThrow('Entry price must be positive');
      expect(() => calculatePnLPercentage(-10, 100)).toThrow('Entry price must be positive');
    });

    test('should throw error for invalid current price', () => {
      expect(() => calculatePnLPercentage(100, -10)).toThrow('Current price must be non-negative');
    });
  });

  describe('shouldBuyback', () => {
    test('should trigger buyback on profit target', () => {
      const decision = shouldBuyback(5.5, 5.0, -2.0); // 5.5% > 5% profit target
      expect(decision.shouldBuy).toBe(true);
      expect(decision.reason).toBe('PROFIT_TARGET');
      expect(decision.description).toContain('5.50%');
    });

    test('should trigger buyback on stop loss', () => {
      const decision = shouldBuyback(-2.5, 5.0, -2.0); // -2.5% < -2% stop loss
      expect(decision.shouldBuy).toBe(true);
      expect(decision.reason).toBe('STOP_LOSS');
      expect(decision.description).toContain('-2.50%');
    });

    test('should hold position within thresholds', () => {
      const decision = shouldBuyback(3.0, 5.0, -2.0); // 3% between -2% and +5%
      expect(decision.shouldBuy).toBe(false);
      expect(decision.reason).toBe('HOLD');
      expect(decision.description).toContain('3.00%');
    });

    test('should handle exact threshold values', () => {
      const profitDecision = shouldBuyback(5.0, 5.0, -2.0); // Exactly at profit threshold
      expect(profitDecision.shouldBuy).toBe(true);
      expect(profitDecision.reason).toBe('PROFIT_TARGET');

      const lossDecision = shouldBuyback(-2.0, 5.0, -2.0); // Exactly at loss threshold
      expect(lossDecision.shouldBuy).toBe(true);
      expect(lossDecision.reason).toBe('STOP_LOSS');
    });
  });

  describe('calculateExpectedBuyback', () => {
    test('should calculate expected GALA amounts correctly', () => {
      const tokenAmount = 1000;
      const currentTokenPrice = 0.05; // 0.05 GALA per token
      const slippage = 0.05; // 5%
      
      const result = calculateExpectedBuyback(tokenAmount, currentTokenPrice, slippage);
      
      expect(result.expectedGala).toBe(50); // 1000 * 0.05 = 50 GALA
      expect(result.minimumGala).toBe(47.5); // 50 * (1 - 0.05) = 47.5 GALA
      expect(result.slippage).toBe(5); // 5%
    });

    test('should use default slippage', () => {
      const result = calculateExpectedBuyback(1000, 0.05);
      expect(result.slippage).toBe(5); // Default 5%
    });

    test('should throw error for invalid inputs', () => {
      expect(() => calculateExpectedBuyback(0, 0.05)).toThrow('Token amount must be positive');
      expect(() => calculateExpectedBuyback(1000, 0)).toThrow('Current token price must be positive');
    });
  });

  describe('calculateFinalPnL', () => {
    test('should calculate profit correctly', () => {
      const initialAmount = 100;
      const finalAmount = 110;
      
      const pnl = calculateFinalPnL(initialAmount, finalAmount);
      
      expect(pnl.initialAmount).toBe(100);
      expect(pnl.finalAmount).toBe(110);
      expect(pnl.absolutePnL).toBe(10);
      expect(pnl.percentagePnL).toBe(10); // 10% profit
      expect(pnl.isProfit).toBe(true);
    });

    test('should calculate loss correctly', () => {
      const initialAmount = 100;
      const finalAmount = 95;
      
      const pnl = calculateFinalPnL(initialAmount, finalAmount);
      
      expect(pnl.absolutePnL).toBe(-5);
      expect(pnl.percentagePnL).toBe(-5); // 5% loss
      expect(pnl.isProfit).toBe(false);
    });

    test('should handle breakeven', () => {
      const pnl = calculateFinalPnL(100, 100);
      expect(pnl.absolutePnL).toBe(0);
      expect(pnl.percentagePnL).toBe(0);
      expect(pnl.isProfit).toBe(false); // Zero is not considered profit
    });

    test('should throw error for invalid inputs', () => {
      expect(() => calculateFinalPnL(0, 100)).toThrow('Initial GALA amount must be positive');
      expect(() => calculateFinalPnL(100, -10)).toThrow('Final GALA amount must be non-negative');
    });
  });

  describe('formatPnL', () => {
    test('should format positive PnL with emoji', () => {
      const formatted = formatPnL(10.5);
      expect(formatted).toContain('📈');
      expect(formatted).toContain('+10.50%');
    });

    test('should format negative PnL with emoji', () => {
      const formatted = formatPnL(-5.25);
      expect(formatted).toContain('📉');
      expect(formatted).toContain('-5.25%');
    });

    test('should include absolute PnL when provided', () => {
      const formatted = formatPnL(10.5, 5.25);
      expect(formatted).toContain('+10.50%');
      expect(formatted).toContain('(+5.2500 GALA)');
    });

    test('should handle negative absolute PnL', () => {
      const formatted = formatPnL(-5.25, -2.625);
      expect(formatted).toContain('-5.25%');
      expect(formatted).toContain('(-2.6250 GALA)');
    });

    test('should handle zero PnL', () => {
      const formatted = formatPnL(0);
      expect(formatted).toContain('📈'); // Zero gets positive emoji
      expect(formatted).toContain('+0.00%');
    });
  });
});