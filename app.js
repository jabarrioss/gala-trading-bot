var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

// Import service manager for initialization
const serviceManager = require('./services/ServiceManager');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var tradingRouter = require('./routes/trading');

var app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Add health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = await serviceManager.healthCheck();
    const statusCode = health.overall === 'healthy' ? 200 : 
                      health.overall === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({
      overall: 'error',
      error: error.message
    });
  }
});

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/trading', tradingRouter);

// Initialize services when app starts (skip during testing)
if (process.env.SKIP_SERVICE_INIT !== 'true') {
  (async () => {
    try {
      await serviceManager.initializeAll();
    } catch (error) {
      console.error('Failed to initialize services:', error);
      process.exit(1);
    }
  })();
}

module.exports = app;
