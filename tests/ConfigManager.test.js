const config = require('../config/ConfigManager');

describe('ConfigManager', () => {
  beforeEach(() => {
    // Reset singleton state for testing
    config.isInitialized = false;
    config.config = {};
  });

  test('should initialize with test values', () => {
    const result = config.init();
    
    expect(result).toBeDefined();
    expect(result.NODE_ENV).toBe('test');
    expect(result.DRY_RUN_MODE).toBe(true); // Should default to true for safety
    expect(result.DEFAULT_SLIPPAGE).toBe(0.05);
    expect(result.WALLET_ADDRESS).toBe('eth|1234567890123456789012345678901234567890');
  });

  test('should validate required configuration', () => {
    // Mock environment without required values
    const originalEnv = process.env;
    process.env = { NODE_ENV: 'test' }; // Keep NODE_ENV but remove others

    expect(() => {
      config.init();
    }).toThrow('Missing required configuration');

    // Restore environment
    process.env = originalEnv;
  });

  test('should provide helper methods', () => {
    config.init();
    
    expect(typeof config.isDevelopment()).toBe('boolean');
    expect(typeof config.isProduction()).toBe('boolean');
    expect(typeof config.isDryRun()).toBe('boolean');
    expect(config.isDryRun()).toBe(true); // Should be true in test
  });

  test('should mask sensitive configuration', () => {
    config.init();
    const masked = config.getMaskedConfig();
    
    expect(masked.PRIVATE_KEY).toMatch(/^0x123456.+\.\.\.$/);
    expect(masked.DISCORD_WEBHOOK_URL).toContain('...');
  });

  afterAll(() => {
    // Clean up
    config.isInitialized = false;
    config.config = {};
  });
});