# 🔄 Conditional BUY Back Feature

## Overview

The conditional buyback feature ensures that all trades **start with GALA and end with GALA**. When the bot sells GALA for another token, it automatically tracks the position and monitors price conditions to execute a buyback under specific circumstances.

## Flow Overview

```
GALA → Token (SELL) → Monitor PnL → Token → GALA (Conditional BUY)
```

### Trading Cycle
1. **SELL Phase**: Execute GALA → token swap
2. **Track Phase**: Create open position in database
3. **Monitor Phase**: Continuously check PnL against thresholds
4. **BUY Phase**: Execute token → GALA swap when conditions are met

## PnL Thresholds

### Automatic Buyback Triggers
- **Profit Target**: +5% or greater → Execute buyback
- **Stop Loss**: -2% or lower → Execute buyback
- **Hold Zone**: Between -2% and +5% → Continue monitoring

### PnL Calculation
```javascript
PnL% = ((currentPrice - entryPrice) / entryPrice) * 100
```

## Database Schema

### Open Positions Table
```sql
CREATE TABLE open_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  symbol TEXT NOT NULL,                    -- e.g., 'GALA/GUSDC'
  token_symbol TEXT NOT NULL,              -- e.g., 'GUSDC'
  gala_symbol TEXT NOT NULL,               -- e.g., 'GUSDC|Unit|none|none'
  entry_trade_id INTEGER NOT NULL,        -- Reference to SELL trade
  entry_price REAL NOT NULL,               -- Price when GALA was sold
  entry_amount REAL NOT NULL,              -- Amount of GALA sold
  token_amount REAL NOT NULL,              -- Amount of tokens received
  profit_threshold REAL DEFAULT 0.05,     -- +5% profit threshold
  loss_threshold REAL DEFAULT -0.02,      -- -2% loss threshold
  status TEXT DEFAULT 'OPEN',             -- OPEN, CLOSED, FAILED
  close_trade_id INTEGER,                 -- Reference to BUY trade
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  notes TEXT
);
```

## Key Components

### 1. PnL Utilities (`utils/pnl.js`)
```javascript
const { calculatePnLPercentage, shouldBuyback, formatPnL } = require('./utils/pnl');

// Calculate PnL percentage
const pnl = calculatePnLPercentage(entryPrice, currentPrice);

// Check buyback conditions
const decision = shouldBuyback(pnl, 5.0, -2.0);

// Format for display
const formatted = formatPnL(pnl, absoluteAmount);
```

### 2. Position Tracking (`services/DatabaseService.js`)
```javascript
// Create position when selling GALA
const positionId = await databaseService.createOpenPosition({
  strategy: 'dca',
  symbol: 'GALA/GUSDC',
  token_symbol: 'GUSDC',
  gala_symbol: 'GUSDC|Unit|none|none',
  entry_trade_id: sellTradeId,
  entry_price: 0.05,
  entry_amount: 100,
  token_amount: 2000
});

// Monitor and close positions
const positions = await databaseService.getOpenPositions();
await databaseService.closePosition(positionId, buyTradeId);
```

### 3. Conditional Monitoring (`services/TradingService.js`)
```javascript
// Monitor all open positions
const result = await tradingService.monitorOpenPositions('dca');

// Check individual position
const positionResult = await tradingService.checkPositionForBuyback(position, priceOracle);

// Execute buyback when conditions are met
const buybackResult = await tradingService.executeBuyback(position, currentPrice);
```

## Integration Points

### Automated Trading Cycle
The monitor command now includes position monitoring:

```javascript
// 1. Check open positions first
const positionResult = await tradingService.monitorOpenPositions('dca');

// 2. Execute new trading analysis
const tradingResult = await tradingService.executeAutomatedTrading({
  strategy: 'dca',
  minimumConfidence: 0.7
});
```

### Discord Notifications
Buyback events trigger rich Discord notifications:

```javascript
await notificationService.sendBuybackNotification({
  position,
  currentPrice,
  finalGalaAmount,
  finalPnL,
  swapResult
});
```

## Example Scenarios

### Scenario 1: Profit Target Reached
```
Initial: 100 GALA → 2000 GUSDC (at 0.05 GALA/GUSDC)
Price increases to 0.053 GALA/GUSDC (+6%)
Trigger: Profit target reached (+6% > +5%)
Action: 2000 GUSDC → ~106 GALA
Result: +6 GALA profit (+6%)
```

### Scenario 2: Stop Loss Triggered
```
Initial: 100 GALA → 2000 GUSDC (at 0.05 GALA/GUSDC)
Price decreases to 0.049 GALA/GUSDC (-2%)
Trigger: Stop loss activated (-2% <= -2%)
Action: 2000 GUSDC → ~98 GALA
Result: -2 GALA loss (-2%)
```

### Scenario 3: Hold Position
```
Initial: 100 GALA → 2000 GUSDC (at 0.05 GALA/GUSDC)
Price at 0.051 GALA/GUSDC (+2%)
Trigger: Within thresholds (-2% < +2% < +5%)
Action: Continue monitoring
Result: Position remains open
```

## Error Handling

### Failed Buyback Attempts
- Position marked as `FAILED` in database
- Discord notification sent
- Position continues monitoring until successful or manual intervention

### Network/API Failures
- Errors logged but don't stop monitoring
- Retry logic for transient failures
- Graceful degradation when external services unavailable

## Configuration

### Environment Variables
```bash
# Trading thresholds (optional - uses defaults)
PROFIT_THRESHOLD=0.05     # 5% profit target
LOSS_THRESHOLD=-0.02      # 2% stop loss

# Monitoring interval
MONITOR_INTERVAL_MINUTES=5

# Safety settings
DRY_RUN_MODE=true         # Start with dry run for testing
```

### Strategy-Specific Thresholds
Thresholds can be customized per position:
```javascript
await databaseService.createOpenPosition({
  // ... other fields
  profit_threshold: 0.08,   // 8% profit target
  loss_threshold: -0.015,   // 1.5% stop loss
});
```

## Testing

### Unit Tests
- PnL calculation functions (`tests/pnl.test.js`)
- 21 comprehensive test cases covering edge cases
- 100% test coverage for utility functions

### Integration Tests
- Mock buyback flow demonstration (`test-buyback-mock.js`)
- Complete SELL → Monitor → BUY cycle testing
- Database position lifecycle validation

### Manual Testing
```bash
# Run the mock test to see the complete flow
node test-buyback-mock.js

# Run with monitoring to see live position tracking
npm run monitor
```

## Monitoring Dashboard

### Command Line Output
```
📊 Position monitoring: 3 checked, 1 buybacks executed
💰 Buyback Results:
   GALA/GUSDC: PROFIT_TARGET - Final PnL: +6.25%
```

### Database Queries
```sql
-- View open positions
SELECT * FROM open_positions WHERE status = 'OPEN';

-- View position history with PnL
SELECT 
  p.*,
  sell_trade.price as entry_price,
  buy_trade.price as exit_price,
  (buy_trade.total_value - sell_trade.total_value) as pnl
FROM open_positions p
JOIN trades sell_trade ON p.entry_trade_id = sell_trade.id
LEFT JOIN trades buy_trade ON p.close_trade_id = buy_trade.id;
```

## Security Considerations

### Dry Run Mode
- All new installations default to `DRY_RUN_MODE=true`
- Position tracking works in dry run mode
- Safe for testing complete flow without real trades

### Position Limits
- Inherits existing trade amount limits
- Position monitoring respects rate limits
- Slippage protection on buyback execution

### Error Recovery
- Failed positions can be manually resolved
- Database integrity maintained through foreign keys
- No orphaned positions or trades

## Performance Impact

### Database
- New `open_positions` table with indexed columns
- Efficient queries for position monitoring
- Foreign key relationships maintain data integrity

### Monitoring Overhead
- Minimal CPU impact per position check
- Price oracle requests cached appropriately
- Scales to hundreds of concurrent positions

### Network Usage
- Position monitoring reuses existing price data
- Buyback execution follows same patterns as regular trades
- No additional external service dependencies

## Future Enhancements

### Planned Features
- Variable thresholds based on volatility
- Time-based position aging (close after X days)
- Portfolio-level position limits
- Advanced notification templates

### API Extensions
- REST endpoints for position management
- Real-time position status updates
- Position performance analytics

This feature ensures that the trading bot maintains proper risk management while maximizing the opportunity for profitable trades by automatically executing buybacks when favorable conditions are met.