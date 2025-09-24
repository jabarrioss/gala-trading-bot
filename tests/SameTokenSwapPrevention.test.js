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

describe('TradingService - Same Token Swap Prevention', () => {
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
    
    // Initialize the service
    await tradingService.init();
  });

  afterEach(async () => {
    if (tradingService) {
      await tradingService.shutdown();
    }
  });

  describe('getQuote validation', () => {
    test('should reject identical fromToken and toToken', async () => {
      const result = await tradingService.getQuote(
        'GALA|Unit|none|none', 
        'GALA|Unit|none|none', 
        10
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot create pool of same tokens');
      expect(result.error).toContain('fromToken and toToken must be different');
    });

    test('should allow different tokens', async () => {
      // Mock successful quote response
      mockGSwap.quoting.quoteExactInput.mockResolvedValue({
        outTokenAmount: { 
          toString: () => '9.5', 
          multipliedBy: (factor) => ({ toString: () => (9.5 * factor).toString() }) 
        },
        feeTier: '0.3%',
        priceImpact: 0.01
      });

      const result = await tradingService.getQuote(
        'GALA|Unit|none|none', 
        'GUSDC|Unit|none|none', 
        10
      );

      expect(result.success).toBe(true);
      expect(result.quote).toBeDefined();
      expect(mockGSwap.quoting.quoteExactInput).toHaveBeenCalledWith(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        10
      );
    });
  });

  describe('executeAutomatedTrading GALA symbol handling', () => {
    test('should skip GALA-to-GALA trades in automated trading', async () => {
      // Mock database service getTradingSymbols to return GALA symbol
      tradingService.getDatabaseService = jest.fn().mockReturnValue({
        getTradingSymbols: jest.fn().mockResolvedValue([{
          symbol: 'GALA',
          display_name: 'Gala Games',
          yahoo_symbol: 'GALA-USD',
          gala_symbol: 'GALA|Unit|none|none',
          is_active: true,
          trading_enabled: true,
          min_trade_amount: 1,
          max_trade_amount: 100
        }])
      });

      // Mock the price oracle service
      const mockPriceOracleService = {
        getDCAData: jest.fn().mockResolvedValue({
          success: true,
          data: { prices: [100, 102, 105] }
        })
      };
      
      // Mock ServiceManager to return the price oracle service
      const ServiceManager = require('../services/ServiceManager');
      const originalGet = ServiceManager.get;
      ServiceManager.get = jest.fn((serviceName) => {
        if (serviceName === 'priceOracle') {
          return mockPriceOracleService;
        }
        return originalGet ? originalGet.call(ServiceManager, serviceName) : null;
      });

      // Mock the DCA analysis to return a BUY signal
      jest.doMock('../utils/indicators', () => ({
        analyzeDCAStrategy: jest.fn().mockReturnValue({
          signal: 'BUY',
          confidence: 0.8,
          reasons: ['Strong upward trend']
        })
      }));

      // Execute automated trading with DCA strategy
      const result = await tradingService.executeAutomatedTrading({
        strategy: 'dca',
        minimumConfidence: 0.7,
        sendNotifications: false
      });

      expect(result.success).toBe(true);
      expect(result.tradesExecuted).toBe(0); // No trades should be executed
      expect(result.tradeResults).toHaveLength(1);
      expect(result.tradeResults[0].symbol).toBe('GALA');
      expect(result.tradeResults[0].trade.success).toBe(false);
      expect(result.tradeResults[0].trade.error).toContain('Cannot swap GALA for GALA');
      expect(result.tradeResults[0].trade.skipped).toBe(true);

      // Restore original ServiceManager.get
      ServiceManager.get = originalGet;
    });
  });
});