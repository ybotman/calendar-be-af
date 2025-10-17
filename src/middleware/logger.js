// src/middleware/logger.js
// Structured logging middleware for Azure Functions
// Provides consistent logging format with correlation IDs and metadata

/**
 * Log levels
 */
const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

/**
 * Logger class with structured logging support
 */
class Logger {
  constructor(context, correlationId = null) {
    this.context = context;
    this.correlationId = correlationId;
    this.functionName = context.invocationId ? context.functionName : 'unknown';
  }

  /**
   * Format log entry with structured data
   */
  _formatLog(level, message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      functionName: this.functionName,
      correlationId: this.correlationId,
      message,
      ...metadata
    };

    // For local development, pretty print
    if (process.env.NODE_ENV === 'development') {
      return JSON.stringify(logEntry, null, 2);
    }

    // For production, single line JSON
    return JSON.stringify(logEntry);
  }

  /**
   * Log debug message
   */
  debug(message, metadata = {}) {
    const formatted = this._formatLog(LogLevel.DEBUG, message, metadata);
    this.context.log(formatted);
  }

  /**
   * Log info message
   */
  info(message, metadata = {}) {
    const formatted = this._formatLog(LogLevel.INFO, message, metadata);
    this.context.log(formatted);
  }

  /**
   * Log warning message
   */
  warn(message, metadata = {}) {
    const formatted = this._formatLog(LogLevel.WARN, message, metadata);
    this.context.log(formatted);  // Azure Functions v4: use context.log() for all levels
  }

  /**
   * Log error message
   */
  error(message, error = null, metadata = {}) {
    const errorData = error ? {
      errorMessage: error.message,
      errorStack: error.stack,
      errorName: error.name
    } : {};

    const formatted = this._formatLog(LogLevel.ERROR, message, {
      ...errorData,
      ...metadata
    });

    this.context.log(formatted);  // Azure Functions v4: use context.log() for all levels
  }

  /**
   * Log HTTP request details
   */
  logRequest(request) {
    this.info('HTTP Request received', {
      method: request.method,
      url: request.url,
      headers: this._sanitizeHeaders(request.headers),
      query: Object.fromEntries(request.query.entries()),
      userAgent: request.headers.get('user-agent')
    });
  }

  /**
   * Log HTTP response details
   */
  logResponse(statusCode, duration) {
    this.info('HTTP Response sent', {
      statusCode,
      duration: `${duration}ms`
    });
  }

  /**
   * Sanitize headers to remove sensitive data
   */
  _sanitizeHeaders(headers) {
    const sanitized = {};
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

    for (const [key, value] of headers.entries()) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

/**
 * Logging middleware wrapper
 * Adds structured logging to any Azure Function
 */
function loggingMiddleware(handler) {
  return async (request, context) => {
    const startTime = Date.now();

    // Get correlation ID from request or generate new one
    const correlationId = request.headers.get('x-correlation-id') ||
                          context.invocationId;

    // Create logger instance
    const logger = new Logger(context, correlationId);

    // Attach logger to context for use in handler
    context.logger = logger;

    try {
      // Log incoming request
      logger.logRequest(request);

      // Call the actual handler
      const response = await handler(request, context);

      // Log response
      const duration = Date.now() - startTime;
      logger.logResponse(response.status, duration);

      // Add correlation ID to response headers
      if (!response.headers) {
        response.headers = {};
      }
      response.headers['x-correlation-id'] = correlationId;

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Function execution failed', error, {
        duration: `${duration}ms`
      });

      // Re-throw to be handled by error middleware
      throw error;
    }
  };
}

/**
 * Create a logger instance (for use outside middleware)
 */
function createLogger(context, correlationId = null) {
  return new Logger(context, correlationId);
}

module.exports = {
  Logger,
  LogLevel,
  loggingMiddleware,
  createLogger
};
