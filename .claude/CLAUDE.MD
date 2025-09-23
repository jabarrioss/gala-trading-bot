# GALA TRADING BOT

## TECHNOLOGY SPECS
* VueJS
* Material Design
* Javascript
* NOT TYPESCRIPT
* ExpressJs
* SQLite
* Redis

## Project Overview

This is a Node.js Express trading bot for GalaChain's gSwap protocol, featuring a multi-strategy trading system with comprehensive risk management, monitoring, and alerting capabilities. **Pure JavaScript project (no TypeScript)** 

### Service Layer Pattern

The application follows a service-oriented architecture with dependency injection:

- **Services** (`/services/`): Core business logic, stateful classes with initialization
- **Routes** (`/routes/`): Thin Express API controllers (Express.js routes in `/api/*`)
- **Utils** (`/utils/`): Stateless utility functions and configurations
- **Config** (`/config/`): Centralized configuration management with `ConfigManager` class

### Key Integration Points

- **gSwap SDK**: All blockchain interactions go through `services/gswap.js`
- **Yahoo Finance**: All data querying interactions go through `services/yahoo.js`
- **Alert Service**: Single-channel notifications (Discord webhook)

### Database Patterns

- **SQLite with singleton**: `DatabaseService` uses singleton pattern for connection management
- **Schema-first**: Tables created via `createTables()` method with SQL DDL
- **Async/await**: All database operations use Promise-based async patterns
- **Component logging**: Each service has its own logger with file transports

### Environment Configuration

- Use `.env` for all configuration (see existing services for patterns)
- Default to safe values (dry run mode, conservative limits)
- Support both development and production modes

#### Required Environment Variables

```bash
# Blockchain Configuration
PRIVATE_KEY=your_wallet_private_key_here
WALLET_ADDRESS=eth|123...abc

# Environment Settings
NODE_ENV=development|production
DRY_RUN_MODE=true

# Trading Parameters
DEFAULT_SLIPPAGE=0.05
MAX_TRADE_SIZE=1000
DAILY_LOSS_LIMIT=500

# Notification Settings
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Current Project Status

- **Some examples are written in routes\users.js**: These examples are completely functional and should be used as a blueprint to build the service classes


## Integration Dependencies

- **@gala-chain/gswap-sdk**: Primary blockchain interface
- **yahoo-finance2**: Datasource for financial data

### Security Best Practices

- Never commit private keys or `.env` files to version control
- Use environment-specific configuration files
- Implement proper error boundaries to prevent information leakage
- Start with small trade amounts and scale gradually

