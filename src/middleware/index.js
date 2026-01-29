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
const {
  requireRegionalAdmin,
  checkRAPermission,
  forbiddenResponse
} = require('./requireRegionalAdmin');

/**
 * CORS preflight middleware
 * Automatically handles OPTIONS requests with 200 OK
 */
function corsMiddleware(handler) {
  return async (request, context) => {
    // Handle OPTIONS (CORS preflight) requests
    if (request.method === 'OPTIONS') {
      return {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400' // 24 hours
        },
        body: ''
      };
    }

    // For non-OPTIONS requests, call the handler
    return handler(request, context);
  };
}

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
 * Includes: CORS, logging, metrics, and error handling
 */
function standardMiddleware(handler) {
  return composeMiddleware(
    corsMiddleware,          // Outermost: handles CORS preflight
    errorHandlerMiddleware,  // Second: catches all errors
    metricsMiddleware,       // Third: tracks request metrics
    loggingMiddleware        // Innermost: logs request/response
  )(handler);
}

/**
 * Lightweight middleware stack (no metrics)
 * For health checks and low-traffic endpoints
 */
function lightweightMiddleware(handler) {
  return composeMiddleware(
    corsMiddleware,
    errorHandlerMiddleware,
    loggingMiddleware
  )(handler);
}

module.exports = {
  // Middleware functions
  corsMiddleware,
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
  exportToAppInsights,

  // Regional Admin middleware
  requireRegionalAdmin,
  checkRAPermission,
  forbiddenResponse
};
