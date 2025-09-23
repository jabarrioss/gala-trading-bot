# Gala Trading Bot - AI Assistant Instructions

## Architecture Overview

This is a **pure JavaScript** (no TypeScript) Express.js trading bot for GalaChain's gSwap protocol. Follow the service-oriented architecture pattern with dependency injection.

### Core Service Layer Pattern

- **Services** (`/services/`): Stateful business logic classes, require `init()` method
- **Routes** (`/routes/`): Thin Express controllers, delegate to services
- **Utils** (`/utils/`): Pure utility functions, no state
- **Config** (`/config/`): Centralized `ConfigManager` class for environment handling

Example from `routes/users.js` shows the current pattern - use this as blueprint for new service classes.

### Trading Strategy Patterns

**Golden Cross Strategy Implementation**:

```javascript
// Pattern: Fetch historical data and calculate moving averages
const yahooFinance = require("yahoo-finance2").default;

// Fetch historical price data
const history = await yahooFinance.historical("GALA-USD", {
	period1: "2025-01-01",
	period2: "2025-09-23",
	interval: "1d",
});

// Calculate moving averages (implement in utils/indicators.js)
const shortMA = calculateSMA(prices, 50); // 50-day MA
const longMA = calculateSMA(prices, 200); // 200-day MA

// Signal detection: Buy when short MA crosses above long MA
const goldenCross = shortMA > longMA && previousShortMA <= previousLongMA;
```

### Key Integration Points

**GalaChain SDK Integration**:

```javascript
const { GSwap, PrivateKeySigner } = require("@gala-chain/gswap-sdk");

// Pattern: Always connect/disconnect event socket
await GSwap.events.connectEventSocket();
const gSwap = new GSwap({
	signer: new PrivateKeySigner(process.env.PRIVATE_KEY),
});
// ... trading logic
GSwap.events.disconnectEventSocket();
```

**Yahoo Finance Integration**:

```javascript
const yahooFinance = require("yahoo-finance2").default;
// Pattern: Use for GALA-USD price data and historical analysis
// Historical data: yahooFinance.historical('GALA-USD', {period1, period2, interval})
// Real-time quotes: yahooFinance.quote('GALA-USD')
```

**Discord Webhook Notifications**:

```javascript
// Pattern: Send trade notifications and alerts
const webhook = process.env.DISCORD_WEBHOOK_URL;
const payload = {
	content: `🚀 Golden Cross detected for GALA-USD`,
	embeds: [
		{
			title: "Trade Signal",
			color: 0x00ff00, // Green for buy signal
			fields: [
				{ name: "Strategy", value: "Golden Cross", inline: true },
				{ name: "Action", value: "BUY", inline: true },
				{ name: "Price", value: `$${currentPrice}`, inline: true },
			],
			timestamp: new Date().toISOString(),
		},
	],
};

// Error handling pattern
try {
	await fetch(webhook, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
} catch (error) {
	console.error("Discord notification failed:", error);
}
```

### Database Patterns

- **SQLite with singleton**: Use `DatabaseService` class pattern
- **Schema creation**: Implement `createTables()` method with SQL DDL
- **Always async/await**: No callback patterns for database operations

### Testing Patterns

**Service Class Testing**:

```javascript
// Pattern: Unit tests for services with mocked dependencies
const TradingService = require("../services/TradingService");
const mockGSwap = { quoting: { quoteExactInput: jest.fn() } };

describe("TradingService", () => {
	beforeEach(async () => {
		service = new TradingService();
		await service.init();
	});
});
```

**API Integration Testing**:

```javascript
// Pattern: Test Express routes with supertest
const request = require("supertest");
const app = require("../app");

describe("GET /users/get-price", () => {
	it("should return GALA price data", async () => {
		const response = await request(app).get("/users/get-price").expect(200);
		expect(response.body.price).toBeDefined();
	});
});
```

### Development Workflow

**Start server**: `npm run dev` (uses nodemon for auto-reload)
**Production**: `npm start` (runs via `./bin/www`)
**Testing**: `npm test` (run test suite)
**Lint**: `npm run lint` (code quality checks)

### Deployment Workflow

**Environment Setup**:

1. Copy `.env.example` to `.env` and configure
2. Install dependencies: `npm install`
3. Initialize database: Run service init methods
4. Test configuration: `npm run dev`

**Production Deployment**:

```bash
# CI/CD Pipeline pattern
npm ci                    # Clean dependency install
npm run test             # Run test suite
npm run build            # If build step exists
pm2 start ecosystem.config.js  # Process management
```

### Environment Configuration

Required `.env` variables (create from patterns in existing routes):

```bash
PRIVATE_KEY=wallet_private_key
WALLET_ADDRESS=eth|0x123...abc
NODE_ENV=development
DRY_RUN_MODE=true
DEFAULT_SLIPPAGE=0.05
DISCORD_WEBHOOK_URL=webhook_url
```

### Security & Safety Patterns

- **Start with DRY_RUN_MODE=true** for all new trading features
- **Small amounts first**: Use conservative trade sizes during development
- **Error boundaries**: Wrap gSwap calls in try/catch with proper cleanup
- **Never commit**: `.env` files are gitignored, never commit secrets

### Component Logging

Each service should have its own logger with file transports. Follow the singleton pattern for database connections and service initialization.

### Development Process Reminders

**📋 TODO Management**: Always update `todo.md` at the end of each development phase to reflect completed features and remaining tasks.

**🔄 Version Control**: Commit all code changes using Git at the end of each development phase with descriptive commit messages.

When building new features, reference `routes/users.js` for working examples of gSwap integration patterns.
