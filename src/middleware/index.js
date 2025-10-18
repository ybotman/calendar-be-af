// src/middleware/index.js
// Central export for all middleware

const { loggingMiddleware, createLogger, LogLevel } = require('./logger');
const {
  errorHandlerMiddleware,
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  DatabaseError,
  handleMongoError,
  asyncHandler
} = require('./errorHandler');
const {
  metricsMiddleware,
  getMetricsSummary,
  clearMetrics,
  exportToAppInsights
} = require('./metrics');

/**
 * Compose multiple middleware functions into one
 * Executes middleware in order: logging -> metrics -> error handling -> handler
 */
function composeMiddleware(...middlewares) {
  return (handler) => {
    // Apply middleware in reverse order so they execute in correct order
    return middlewares.reduceRight(
      (wrapped, middleware) => middleware(wrapped),
      handler
    );
  };
}

/**
 * Standard middleware stack for all HTTP functions
 * Includes: logging, metrics, and error handling
 */
function standardMiddleware(handler) {
  return composeMiddleware(
    errorHandlerMiddleware,  // Outermost: catches all errors
    metricsMiddleware,       // Middle: tracks request metrics
    loggingMiddleware        // Innermost: logs request/response
  )(handler);
}

/**
 * Lightweight middleware stack (no metrics)
 * For health checks and low-traffic endpoints
 */
function lightweightMiddleware(handler) {
  return composeMiddleware(
    errorHandlerMiddleware,
    loggingMiddleware
  )(handler);
}

module.exports = {
  // Middleware functions
  loggingMiddleware,
  errorHandlerMiddleware,
  metricsMiddleware,

  // Middleware composers
  composeMiddleware,
  standardMiddleware,
  lightweightMiddleware,

  // Logger exports
  createLogger,
  LogLevel,

  // Error classes
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  DatabaseError,

  // Utilities
  handleMongoError,
  asyncHandler,
  getMetricsSummary,
  clearMetrics,
  exportToAppInsights
};
