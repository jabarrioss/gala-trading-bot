/**
 * Jest setup file for test environment
 */

// Set up test environment variables before any modules are loaded
process.env.NODE_ENV = 'test';
process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
process.env.WALLET_ADDRESS = 'eth|1234567890123456789012345678901234567890';
process.env.DRY_RUN_MODE = 'true';
process.env.DEFAULT_SLIPPAGE = '0.05';
process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during testing

// Prevent actual service initialization in app.js during testing
process.env.SKIP_SERVICE_INIT = 'true';