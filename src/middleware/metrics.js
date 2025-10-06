// src/middleware/metrics.js
// API usage tracking and metrics collection
// Tracks requests, response times, and errors for monitoring

/**
 * In-memory metrics storage (will be replaced with Application Insights later)
 */
class MetricsCollector {
  constructor() {
    this.metrics = {
      requests: [],
      errors: [],
      responseTime: []
    };
    this.maxEntries = 1000; // Keep last 1000 entries in memory
  }

  /**
   * Record an API request
   */
  recordRequest(data) {
    const entry = {
      timestamp: new Date().toISOString(),
      functionName: data.functionName,
      method: data.method,
      path: data.path,
      statusCode: data.statusCode,
      duration: data.duration,
      correlationId: data.correlationId,
      appId: data.appId,
      userAgent: data.userAgent
    };

    this.metrics.requests.push(entry);

    // Keep only last N entries
    if (this.metrics.requests.length > this.maxEntries) {
      this.metrics.requests.shift();
    }
  }

  /**
   * Record an error
   */
  recordError(data) {
    const entry = {
      timestamp: new Date().toISOString(),
      functionName: data.functionName,
      errorType: data.errorType,
      errorMessage: data.errorMessage,
      statusCode: data.statusCode,
      correlationId: data.correlationId,
      path: data.path
    };

    this.metrics.errors.push(entry);

    // Keep only last N entries
    if (this.metrics.errors.length > this.maxEntries) {
      this.metrics.errors.shift();
    }
  }

  /**
   * Get metrics summary
   */
  getSummary() {
    const now = Date.now();
    const last5Minutes = now - (5 * 60 * 1000);
    const lastHour = now - (60 * 60 * 1000);

    const recentRequests = this.metrics.requests.filter(r =>
      new Date(r.timestamp).getTime() > last5Minutes
    );

    const recentErrors = this.metrics.errors.filter(e =>
      new Date(e.timestamp).getTime() > last5Minutes
    );

    return {
      last5Minutes: {
        totalRequests: recentRequests.length,
        totalErrors: recentErrors.length,
        errorRate: recentRequests.length > 0
          ? (recentErrors.length / recentRequests.length * 100).toFixed(2) + '%'
          : '0%',
        avgResponseTime: this._calculateAvgResponseTime(recentRequests)
      },
      byFunction: this._groupByFunction(recentRequests),
      byStatusCode: this._groupByStatusCode(recentRequests),
      slowestEndpoints: this._getSlowes tEndpoints(recentRequests, 10)
    };
  }

  /**
   * Calculate average response time
   */
  _calculateAvgResponseTime(requests) {
    if (requests.length === 0) return 0;

    const total = requests.reduce((sum, r) => sum + (r.duration || 0), 0);
    return Math.round(total / requests.length);
  }

  /**
   * Group requests by function name
   */
  _groupByFunction(requests) {
    const grouped = {};

    requests.forEach(r => {
      if (!grouped[r.functionName]) {
        grouped[r.functionName] = {
          count: 0,
          avgDuration: 0,
          durations: []
        };
      }

      grouped[r.functionName].count++;
      grouped[r.functionName].durations.push(r.duration || 0);
    });

    // Calculate averages
    Object.keys(grouped).forEach(fn => {
      const durations = grouped[fn].durations;
      grouped[fn].avgDuration = Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length
      );
      delete grouped[fn].durations; // Remove raw data
    });

    return grouped;
  }

  /**
   * Group requests by status code
   */
  _groupByStatusCode(requests) {
    const grouped = {};

    requests.forEach(r => {
      const code = r.statusCode || 'unknown';
      grouped[code] = (grouped[code] || 0) + 1;
    });

    return grouped;
  }

  /**
   * Get slowest endpoints
   */
  _getSlowestEndpoints(requests, limit = 10) {
    return requests
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, limit)
      .map(r => ({
        functionName: r.functionName,
        path: r.path,
        duration: r.duration,
        timestamp: r.timestamp
      }));
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics = {
      requests: [],
      errors: [],
      responseTime: []
    };
  }
}

// Singleton instance
const metricsCollector = new MetricsCollector();

/**
 * Metrics middleware wrapper
 * Tracks API usage for all functions
 */
function metricsMiddleware(handler) {
  return async (request, context) => {
    const startTime = Date.now();

    try {
      // Execute handler
      const response = await handler(request, context);
      const duration = Date.now() - startTime;

      // Extract metadata
      const appId = request.query.get('appId') || 'unknown';
      const correlationId = context.logger?.correlationId || context.invocationId;

      // Record successful request
      metricsCollector.recordRequest({
        functionName: context.functionName,
        method: request.method,
        path: request.url,
        statusCode: response.status,
        duration,
        correlationId,
        appId,
        userAgent: request.headers.get('user-agent')
      });

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      const correlationId = context.logger?.correlationId || context.invocationId;

      // Record error
      metricsCollector.recordError({
        functionName: context.functionName,
        errorType: error.name,
        errorMessage: error.message,
        statusCode: error.statusCode || 500,
        correlationId,
        path: request.url
      });

      // Re-throw for error handler
      throw error;
    }
  };
}

/**
 * Get current metrics summary
 */
function getMetricsSummary() {
  return metricsCollector.getSummary();
}

/**
 * Clear all metrics
 */
function clearMetrics() {
  metricsCollector.clear();
}

/**
 * Export metrics to Application Insights (when configured)
 */
function exportToAppInsights(context) {
  // TODO: Implement Application Insights export when connection configured
  // For now, just log metrics
  const summary = metricsCollector.getSummary();

  if (context.logger) {
    context.logger.info('Metrics summary', summary);
  } else {
    context.log('Metrics summary:', JSON.stringify(summary, null, 2));
  }
}

module.exports = {
  MetricsCollector,
  metricsMiddleware,
  getMetricsSummary,
  clearMetrics,
  exportToAppInsights,
  // Export singleton for direct access
  metrics: metricsCollector
};
