const BaseService = require('./BaseService');

/**
 * Notification Service - Handles Discord webhook notifications and alerts
 */
class NotificationService extends BaseService {
  constructor() {
    super('NotificationService');
    this.webhookUrl = null;
    this.enabled = false;
    this.rateLimitQueue = [];
    this.lastSentTime = 0;
    this.minInterval = 1000; // Minimum 1 second between messages
  }

  /**
   * Initialize the notification service
   */
  async onInit() {
    try {
      this.webhookUrl = this.config.get('DISCORD_WEBHOOK_URL');
      this.enabled = !!this.webhookUrl;
      this.minInterval = parseInt(this.config.get('NOTIFICATION_MIN_INTERVAL_MS', '1000'));

      if (!this.enabled) {
        this.logger.warn('Discord webhook not configured - notifications disabled');
      } else {
        this.logger.info('Discord notifications enabled');
        
        // Test webhook connection
        await this.sendTestNotification();
      }

    } catch (error) {
      this.logger.error('Failed to initialize NotificationService:', error);
      // Don't throw - notifications are not critical
      this.enabled = false;
    }
  }

  /**
   * Send a test notification
   */
  async sendTestNotification() {
    try {
      const testPayload = {
        content: '🤖 Gala Trading Bot - Notification Service Initialized',
        embeds: [{
          title: 'System Status',
          description: 'Discord webhook connection successful',
          color: 0x00ff00, // Green
          timestamp: new Date().toISOString(),
          footer: {
            text: 'Gala Trading Bot'
          }
        }]
      };

      await this.sendWebhook(testPayload);
      this.logger.info('Test notification sent successfully');

    } catch (error) {
      this.logger.error('Test notification failed:', error);
      this.enabled = false;
    }
  }

  /**
   * Send webhook message with rate limiting
   * @param {Object} payload - Discord webhook payload
   * @returns {Promise<boolean>} - Success status
   */
  async sendWebhook(payload) {
    if (!this.enabled) {
      this.logger.debug('Notifications disabled, skipping webhook');
      return false;
    }

    try {
      // Rate limiting
      const now = Date.now();
      if (now - this.lastSentTime < this.minInterval) {
        const waitTime = this.minInterval - (now - this.lastSentTime);
        this.logger.debug(`Rate limiting: waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      this.lastSentTime = Date.now();

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      this.logger.debug('Webhook sent successfully');
      return true;

    } catch (error) {
      this.logger.error('Failed to send webhook:', error);
      return false;
    }
  }

  /**
   * Send trading signal notification
   * @param {Object} signal - Trading signal data
   * @param {Object} priceData - Current price data
   * @returns {Promise<boolean>} - Success status
   */
  async sendTradingSignal(signal, priceData = null) {
    if (!this.enabled) return false;

    try {
      const color = signal.signal === 'BUY' ? 0x00ff00 : signal.signal === 'SELL' ? 0xff0000 : 0xffa500;
      const emoji = signal.signal === 'BUY' ? '🚀' : signal.signal === 'SELL' ? '📉' : '⚠️';

      const embed = {
        title: `${emoji} Trading Signal: ${signal.signal || 'HOLD'}`,
        description: signal.reasons ? signal.reasons.join('\n') : 'No specific reason provided',
        color: color,
        fields: [
          {
            name: 'Confidence',
            value: `${(signal.confidence * 100).toFixed(1)}%`,
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Golden Cross Strategy'
        }
      };

      // Add price information if available
      if (priceData && priceData.success) {
        embed.fields.push(
          {
            name: 'Current Price',
            value: `$${priceData.price?.toFixed(4) || 'N/A'}`,
            inline: true
          },
          {
            name: 'Change',
            value: `${priceData.changePercent ? (priceData.changePercent > 0 ? '+' : '') : ''}${priceData.changePercent?.toFixed(2) || 'N/A'}%`,
            inline: true
          }
        );
      }

      // Add technical analysis details
      if (signal.goldenCross) {
        const gc = signal.goldenCross;
        embed.fields.push(
          {
            name: 'Short MA (50d)',
            value: gc.shortMA ? gc.shortMA.toFixed(4) : 'N/A',
            inline: true
          },
          {
            name: 'Long MA (200d)',
            value: gc.longMA ? gc.longMA.toFixed(4) : 'N/A',
            inline: true
          }
        );

        if (gc.crossoverStrength) {
          embed.fields.push({
            name: 'Crossover Strength',
            value: `${(gc.crossoverStrength * 100).toFixed(2)}%`,
            inline: true
          });
        }
      }

      // Add RSI information
      if (signal.rsi && signal.rsi.rsi !== null) {
        embed.fields.push({
          name: 'RSI',
          value: `${signal.rsi.rsi.toFixed(1)} (${signal.rsi.level})`,
          inline: true
        });
      }

      const payload = {
        content: `${emoji} **GALA Trading Signal Detected**`,
        embeds: [embed]
      };

      return await this.sendWebhook(payload);

    } catch (error) {
      this.logger.error('Failed to send trading signal notification:', error);
      return false;
    }
  }

  /**
   * Send trade execution notification
   * @param {Object} tradeResult - Trade execution result
   * @param {Object} analysis - Original analysis that triggered the trade
   * @returns {Promise<boolean>} - Success status
   */
  async sendTradeExecution(tradeResult, analysis = null) {
    if (!this.enabled) return false;

    try {
      const isSuccess = tradeResult.success;
      const isDryRun = tradeResult.dryRun;
      const color = isSuccess ? (isDryRun ? 0x0099ff : 0x00ff00) : 0xff0000;
      const emoji = isSuccess ? (isDryRun ? '🧪' : '✅') : '❌';

      const title = isDryRun ? 
        `${emoji} Dry Run Trade ${isSuccess ? 'Simulated' : 'Failed'}` :
        `${emoji} Trade ${isSuccess ? 'Executed' : 'Failed'}`;

      const embed = {
        title: title,
        color: color,
        fields: [],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Gala Trading Bot'
        }
      };

      if (isSuccess) {
        // Successful trade details
        if (tradeResult.signal) {
          embed.fields.push({
            name: 'Signal',
            value: tradeResult.signal,
            inline: true
          });
        }

        if (tradeResult.confidence) {
          embed.fields.push({
            name: 'Confidence',
            value: `${(tradeResult.confidence * 100).toFixed(1)}%`,
            inline: true
          });
        }

        if (tradeResult.trade && tradeResult.trade.quote) {
          const quote = tradeResult.trade.quote;
          embed.fields.push(
            {
              name: 'Input Amount',
              value: quote.inputAmount?.toString() || 'N/A',
              inline: true
            },
            {
              name: 'Expected Output',
              value: quote.outputAmount?.toString() || 'N/A',
              inline: true
            }
          );

          if (quote.quote && quote.quote.feeTier) {
            embed.fields.push({
              name: 'Fee Tier',
              value: quote.quote.feeTier,
              inline: true
            });
          }
        }

        if (!isDryRun && tradeResult.trade && tradeResult.trade.transaction) {
          embed.fields.push({
            name: 'Transaction ID',
            value: tradeResult.trade.transaction.transactionId || 'N/A',
            inline: false
          });
        }

      } else {
        // Failed trade details
        embed.description = tradeResult.error || 'Unknown error occurred';
        
        if (analysis) {
          embed.fields.push({
            name: 'Original Signal',
            value: `${analysis.signal || 'N/A'} (${((analysis.confidence || 0) * 100).toFixed(1)}% confidence)`,
            inline: true
          });
        }
      }

      const payload = {
        content: isDryRun ? '🧪 **Dry Run Trade**' : '💰 **Live Trade**',
        embeds: [embed]
      };

      return await this.sendWebhook(payload);

    } catch (error) {
      this.logger.error('Failed to send trade execution notification:', error);
      return false;
    }
  }

  /**
   * Send error notification
   * @param {string} title - Error title
   * @param {Error|string} error - Error object or message
   * @param {Object} context - Additional context
   * @returns {Promise<boolean>} - Success status
   */
  async sendError(title, error, context = {}) {
    if (!this.enabled) return false;

    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : null;

      const embed = {
        title: `🚨 ${title}`,
        description: errorMessage,
        color: 0xff0000, // Red
        fields: [],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Gala Trading Bot Error'
        }
      };

      // Add context fields
      Object.entries(context).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          embed.fields.push({
            name: key,
            value: String(value),
            inline: true
          });
        }
      });

      // Add stack trace for development
      if (stack && this.config.get('NODE_ENV') === 'development') {
        embed.fields.push({
          name: 'Stack Trace',
          value: '```\n' + stack.substring(0, 1000) + '\n```',
          inline: false
        });
      }

      const payload = {
        content: '🚨 **System Error**',
        embeds: [embed]
      };

      return await this.sendWebhook(payload);

    } catch (webhookError) {
      this.logger.error('Failed to send error notification:', webhookError);
      return false;
    }
  }

  /**
   * Send daily summary notification
   * @param {Object} summary - Daily trading summary
   * @returns {Promise<boolean>} - Success status
   */
  async sendDailySummary(summary) {
    if (!this.enabled) return false;

    try {
      const embed = {
        title: '📊 Daily Trading Summary',
        color: 0x0099ff, // Blue
        fields: [
          {
            name: 'Signals Generated',
            value: summary.signalsGenerated || 0,
            inline: true
          },
          {
            name: 'Trades Executed',
            value: summary.tradesExecuted || 0,
            inline: true
          },
          {
            name: 'Success Rate',
            value: summary.successRate ? `${summary.successRate.toFixed(1)}%` : 'N/A',
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Daily Summary'
        }
      };

      if (summary.pnl !== undefined) {
        embed.fields.push({
          name: 'P&L',
          value: summary.pnl > 0 ? `+${summary.pnl.toFixed(2)}` : summary.pnl.toFixed(2),
          inline: true
        });
      }

      if (summary.currentPrice) {
        embed.fields.push({
          name: 'Current GALA Price',
          value: `$${summary.currentPrice.toFixed(4)}`,
          inline: true
        });
      }

      const payload = {
        content: '📊 **Daily Trading Summary**',
        embeds: [embed]
      };

      return await this.sendWebhook(payload);

    } catch (error) {
      this.logger.error('Failed to send daily summary notification:', error);
      return false;
    }
  }

  /**
   * Get service status
   * @returns {Object} - Service status
   */
  getStatus() {
    return {
      serviceName: this.serviceName,
      isInitialized: this.isInitialized,
      enabled: this.enabled,
      webhookConfigured: !!this.webhookUrl,
      minInterval: this.minInterval,
      lastSentTime: this.lastSentTime
    };
  }

  /**
   * Send automated trading summary notification
   * @param {Object} summary - Trading summary result
   * @returns {Promise<boolean>} - Success status
   */
  async sendTradingSummary(summary) {
    if (!this.enabled) {
      this.logger.debug('Notifications disabled, skipping trading summary');
      return false;
    }

    try {
      const isSuccessful = summary.success && summary.tradesExecuted > 0;
      const color = isSuccessful ? 0x00ff00 : (summary.success ? 0xffff00 : 0xff0000); // Green, Yellow, Red
      
      let title, description;
      if (isSuccessful) {
        title = `🎯 Automated Trading - ${summary.tradesExecuted} Trade${summary.tradesExecuted > 1 ? 's' : ''} Executed`;
        description = `Successfully executed ${summary.tradesExecuted} trades using ${summary.strategy.toUpperCase()} strategy`;
      } else if (summary.success) {
        title = '📊 Automated Trading - No Trades Executed';
        description = `Analysis completed but no trades met the criteria (${summary.strategy.toUpperCase()} strategy)`;
      } else {
        title = '❌ Automated Trading - Failed';
        description = `Trading cycle failed: ${summary.error}`;
      }

      const embed = {
        title: title,
        description: description,
        color: color,
        timestamp: summary.timestamp,
        fields: [
          {
            name: 'Strategy',
            value: summary.strategy.toUpperCase(),
            inline: true
          },
          {
            name: 'Trades Executed',
            value: summary.tradesExecuted.toString(),
            inline: true
          }
        ]
      };

      // Add trade results if any
      if (summary.tradeResults && summary.tradeResults.length > 0) {
        const successfulTrades = summary.tradeResults.filter(t => t.trade?.success);
        const failedTrades = summary.tradeResults.filter(t => !t.trade?.success);

        if (successfulTrades.length > 0) {
          embed.fields.push({
            name: '✅ Successful Trades',
            value: successfulTrades.map(t => 
              `**${t.symbol}**: ${t.signal} (${(t.confidence * 100).toFixed(1)}%)`
            ).join('\n').substring(0, 1000),
            inline: false
          });
        }

        if (failedTrades.length > 0) {
          embed.fields.push({
            name: '❌ Failed Trades',
            value: failedTrades.map(t => 
              `**${t.symbol}**: ${t.trade?.error || 'Unknown error'}`
            ).join('\n').substring(0, 1000),
            inline: false
          });
        }
      }

      // Add errors if any
      if (summary.errors && summary.errors.length > 0) {
        embed.fields.push({
          name: '⚠️ Analysis Errors',
          value: summary.errors.map(e => 
            `**${e.symbol}**: ${e.error}`
          ).join('\n').substring(0, 1000),
          inline: false
        });
      }

      const payload = {
        embeds: [embed]
      };

      const result = await this.sendWebhook(payload);
      if (result) {
        this.logger.info('Trading summary notification sent successfully');
      }
      return result;

    } catch (error) {
      this.logger.error('Failed to send trading summary notification:', error);
      return false;
    }
  }
}

module.exports = NotificationService;