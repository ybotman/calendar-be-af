const Joi = require('joi');

// Calendar validation schemas
const calendarSchema = Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().max(500).allow(''),
    color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#3498db'),
    isDefault: Joi.boolean().default(false)
});

const updateCalendarSchema = calendarSchema.fork(['name'], (schema) => schema.optional());

// Event validation schemas
const eventSchema = Joi.object({
    title: Joi.string().min(1).max(200).required(),
    description: Joi.string().max(1000).allow(''),
    startTime: Joi.date().iso().required(),
    endTime: Joi.date().iso().greater(Joi.ref('startTime')).required(),
    isAllDay: Joi.boolean().default(false),
    location: Joi.string().max(200).allow(''),
    attendees: Joi.array().items(Joi.string().email()).default([]),
    recurrence: Joi.object({
        frequency: Joi.string().valid('daily', 'weekly', 'monthly', 'yearly'),
        interval: Joi.number().integer().min(1).default(1),
        endDate: Joi.date().iso().optional(),
        count: Joi.number().integer().min(1).optional()
    }).optional()
});

const updateEventSchema = eventSchema.fork(['title', 'startTime', 'endTime'], (schema) => schema.optional());

// Validation helper functions
function validateCalendar(data) {
    return calendarSchema.validate(data);
}

function validateUpdateCalendar(data) {
    return updateCalendarSchema.validate(data);
}

function validateEvent(data) {
    return eventSchema.validate(data);
}

function validateUpdateEvent(data) {
    return updateEventSchema.validate(data);
}

// Common response helpers
function createSuccessResponse(data, message = null, status = 200) {
    return {
        status,
        body: {
            success: true,
            data,
            message,
            timestamp: new Date().toISOString()
        }
    };
}

function createErrorResponse(error, message = 'An error occurred', status = 500) {
    return {
        status,
        body: {
            success: false,
            error: message,
            details: error?.message || error,
            timestamp: new Date().toISOString()
        }
    };
}

function createValidationErrorResponse(validationError) {
    return {
        status: 400,
        body: {
            success: false,
            error: 'Validation failed',
            details: validationError.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            })),
            timestamp: new Date().toISOString()
        }
    };
}

// Date utilities
function isValidDateRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return start < end;
}

function formatDate(date) {
    return new Date(date).toISOString();
}

// Pagination helpers
function createPaginationInfo(page = 1, limit = 20, total = 0) {
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
    
    return {
        currentPage: page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage
    };
}

module.exports = {
    // Validation schemas
    calendarSchema,
    updateCalendarSchema,
    eventSchema,
    updateEventSchema,
    
    // Validation functions
    validateCalendar,
    validateUpdateCalendar,
    validateEvent,
    validateUpdateEvent,
    
    // Response helpers
    createSuccessResponse,
    createErrorResponse,
    createValidationErrorResponse,
    
    // Utilities
    isValidDateRange,
    formatDate,
    createPaginationInfo
};