const TradingService = require('../services/TradingService');
const config = require('../config/ConfigManager');

// Mock the GSwap SDK
jest.mock('@gala-chain/gswap-sdk', () => ({
  GSwap: jest.fn().mockImplementation(() => ({
    quoting: {
      quoteExactInput: jest.fn()
    },
    swaps: {
      swap: jest.fn()
    }
  })),
  PrivateKeySigner: jest.fn(),
  events: {
    connectEventSocket: jest.fn(),
    disconnectEventSocket: jest.fn()
  }
}));

describe('TradingService', () => {
  let tradingService;
  let mockGSwap;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock config
    config.init = jest.fn();
    config.get = jest.fn((key, defaultValue) => {
      const mockConfig = {
        'DRY_RUN_MODE': 'true',
        'DEFAULT_SLIPPAGE': '0.05',
        'MIN_TRADE_AMOUNT': '1',
        'MAX_TRADE_AMOUNT': '100',
        'MIN_TIME_BETWEEN_TRADES_MS': '3600000',
        'PRIVATE_KEY': 'mock_private_key'
      };
      return mockConfig[key] || defaultValue;
    });

    // Create service instance
    tradingService = new TradingService();
    
    // Mock the GSwap instance
    const { GSwap } = require('@gala-chain/gswap-sdk');
    mockGSwap = {
      quoting: {
        quoteExactInput: jest.fn()
      },
      swaps: {
        swap: jest.fn()
      }
    };
    GSwap.mockImplementation(() => mockGSwap);

    await tradingService.init();
  });

  describe('initialization', () => {
    it('should initialize with correct default values', () => {
      expect(tradingService.isInitialized).toBe(true);
      expect(tradingService.isDryRun).toBe(true);
      expect(tradingService.defaultSlippage).toBe(0.05);
      expect(tradingService.minTradeAmount).toBe(1);
      expect(tradingService.maxTradeAmount).toBe(100);
    });

    it('should throw error if PRIVATE_KEY is missing', async () => {
      config.get.mockImplementation((key, defaultValue) => {
        if (key === 'PRIVATE_KEY') return null;
        return defaultValue;
      });

      const newService = new TradingService();
      await expect(newService.init()).rejects.toThrow('PRIVATE_KEY environment variable is required');
    });
  });

  describe('analyzeGoldenCrossStrategy', () => {
    it('should analyze golden cross strategy correctly', () => {
      // Create mock price data that would trigger a golden cross
      const prices = new Array(250).fill(0).map((_, i) => {
        if (i < 50) return 100 + i * 0.1; // Recent upward trend
        return 95 + i * 0.02; // Slower upward trend for older prices
      });

      const result = tradingService.analyzeGoldenCrossStrategy(prices);
      
      expect(result).toHaveProperty('signal');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasons');
      expect(result).toHaveProperty('goldenCross');
      expect(result).toHaveProperty('timestamp');
    });

    it('should handle insufficient data gracefully', () => {
      const prices = new Array(100).fill(10); // Not enough for 200-day MA
      
      const result = tradingService.analyzeGoldenCrossStrategy(prices);
      
      expect(result.signal).toBeNull();
      expect(result.confidence).toBe(0);
      // Check that reasons array contains the error message
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons.some(reason => reason.includes('Insufficient historical data'))).toBe(true);
    });

    it('should combine RSI and Golden Cross signals', () => {
      // Create price data with enough history
      const prices = new Array(250).fill(10);
      
      const result = tradingService.analyzeGoldenCrossStrategy(prices, { useRSI: true });
      
      expect(result).toHaveProperty('rsi');
    });
  });

  describe('getQuote', () => {
    it('should get quote successfully', async () => {
      const mockQuote = {
        outTokenAmount: { toString: () => '95.5' },
        feeTier: '0.3%',
        priceImpact: 0.01
      };
      
      mockGSwap.quoting.quoteExactInput.mockResolvedValue(mockQuote);

      const result = await tradingService.getQuote(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        100
      );

      expect(result.success).toBe(true);
      expect(result.quote).toBe(mockQuote);
      expect(mockGSwap.quoting.quoteExactInput).toHaveBeenCalledWith(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        100
      );
    });

    it('should handle quote errors', async () => {
      mockGSwap.quoting.quoteExactInput.mockRejectedValue(new Error('Quote failed'));

      const result = await tradingService.getQuote(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        100
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Quote failed');
    });
  });

  describe('executeSwap', () => {
    it('should execute dry run successfully', async () => {
      const mockQuote = {
        outTokenAmount: { 
          toString: () => '95.5',
          multipliedBy: jest.fn().mockReturnValue({ toString: () => '90.7' })
        },
        feeTier: '0.3%'
      };
      
      mockGSwap.quoting.quoteExactInput.mockResolvedValue(mockQuote);

      const result = await tradingService.executeSwap(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        50,
        { dryRun: true }
      );

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.message).toContain('Dry run completed');
    });

    it('should validate trade amount', async () => {
      const result = await tradingService.executeSwap(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        500 // Above max amount
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside allowed range');
    });

    it('should respect minimum time between trades', async () => {
      // Set last trade time to recent
      tradingService.lastTradeTime = Date.now() - 30000; // 30 seconds ago
      
      const result = await tradingService.executeSwap(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        50
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Must wait');
    });
  });

  describe('executeGoldenCrossStrategy', () => {
    it('should execute strategy with sufficient confidence', async () => {
      const mockAnalysis = {
        signal: 'BUY',
        confidence: 0.8,
        reasons: ['Golden Cross detected'],
        goldenCross: { shortMA: 105, longMA: 100 }
      };

      const mockQuote = {
        outTokenAmount: { 
          toString: () => '95.5',
          multipliedBy: jest.fn().mockReturnValue({ toString: () => '90.7' })
        },
        feeTier: '0.3%'
      };
      
      mockGSwap.quoting.quoteExactInput.mockResolvedValue(mockQuote);

      const result = await tradingService.executeGoldenCrossStrategy(mockAnalysis, 50);

      expect(result.success).toBe(true);
      expect(result.signal).toBe('BUY');
      expect(result.confidence).toBe(0.8);
    });

    it('should reject low confidence signals', async () => {
      const mockAnalysis = {
        signal: 'BUY',
        confidence: 0.3, // Below default minimum of 0.6
        reasons: ['Weak signal']
      };

      const result = await tradingService.executeGoldenCrossStrategy(mockAnalysis, 50);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Confidence 0.30 below minimum');
    });

    it('should handle missing signal', async () => {
      const mockAnalysis = {
        signal: null,
        confidence: 0,
        reasons: ['No signal detected']
      };

      const result = await tradingService.executeGoldenCrossStrategy(mockAnalysis, 50);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No valid trading signal');
    });
  });

  describe('getStatus', () => {
    it('should return current status', () => {
      const status = tradingService.getStatus();

      expect(status).toHaveProperty('serviceName');
      expect(status).toHaveProperty('isInitialized');
      expect(status).toHaveProperty('isDryRun');
      expect(status).toHaveProperty('configuration');
      expect(status).toHaveProperty('canTrade');
      
      expect(status.serviceName).toBe('TradingService');
      expect(status.isInitialized).toBe(true);
      expect(status.isDryRun).toBe(true);
    });
  });
});