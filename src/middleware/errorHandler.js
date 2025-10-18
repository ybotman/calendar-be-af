// src/middleware/errorHandler.js
// Centralized error handling middleware for Azure Functions
// Provides consistent error responses and logging

/**
 * Custom error classes for different error types
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400);
    this.details = details;
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 503);
    this.originalError = originalError;
  }
}

/**
 * Determine if error is operational (expected) or programming error
 */
function isOperationalError(error) {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Format error response
 */
function formatErrorResponse(error, includeStack = false) {
  const response = {
    success: false,
    error: {
      message: error.message,
      type: error.name,
      timestamp: new Date().toISOString()
    }
  };

  // Add details for validation errors
  if (error instanceof ValidationError && error.details) {
    response.error.details = error.details;
  }

  // Include stack trace only in development
  if (includeStack && process.env.NODE_ENV === 'development') {
    response.error.stack = error.stack;
  }

  return response;
}

/**
 * Error handling middleware wrapper
 * Catches all errors and returns consistent error responses
 */
function errorHandlerMiddleware(handler) {
  return async (request, context) => {
    try {
      // Execute the handler
      const response = await handler(request, context);
      return response;

    } catch (error) {
      const logger = context.logger || context;

      // Determine status code
      let statusCode = 500;
      if (error instanceof AppError) {
        statusCode = error.statusCode;
      } else if (error.name === 'MongoServerError' || error.name === 'MongoNetworkError') {
        statusCode = 503;
      } else if (error.name === 'ValidationError') {
        statusCode = 400;
      }

      // Log the error
      if (isOperationalError(error)) {
        logger.warn('Operational error occurred', {
          errorType: error.name,
          errorMessage: error.message,
          statusCode
        });
      } else {
        logger.error('Unexpected error occurred', error, {
          statusCode,
          isOperational: false
        });
      }

      // Format error response
      const includeStack = process.env.NODE_ENV === 'development';
      const errorResponse = formatErrorResponse(error, includeStack);

      // Return error response
      return {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(errorResponse)
      };
    }
  };
}

/**
 * Handle MongoDB errors specifically
 */
function handleMongoError(error) {
  if (error.name === 'MongoServerError') {
    if (error.code === 11000) {
      // Duplicate key error
      return new ValidationError('Duplicate record found', {
        field: Object.keys(error.keyPattern)[0]
      });
    }
    return new DatabaseError('Database operation failed', error);
  }

  if (error.name === 'MongoNetworkError') {
    return new DatabaseError('Database connection failed', error);
  }

  return error;
}

/**
 * Async handler wrapper to catch promise rejections
 */
function asyncHandler(fn) {
  return (request, context) => {
    return Promise.resolve(fn(request, context)).catch(error => {
      throw error;
    });
  };
}

module.exports = {
  // Error classes
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  DatabaseError,

  // Middleware
  errorHandlerMiddleware,

  // Utilities
  isOperationalError,
  formatErrorResponse,
  handleMongoError,
  asyncHandler
};
