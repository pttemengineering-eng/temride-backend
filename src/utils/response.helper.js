'use strict';

/**
 * Standard API success response
 * @param {string} message
 * @param {*} data
 * @param {number} statusCode
 */
const success = (message = 'Success', data = null, statusCode = 200) => ({
  success: true,
  message,
  data,
  statusCode,
  timestamp: new Date().toISOString(),
});

/**
 * Standard API error response
 * @param {string} message
 * @param {*} details - optional error details (omitted in production)
 */
const error = (message = 'An error occurred', details = null) => ({
  success: false,
  message,
  error: process.env.NODE_ENV !== 'production' ? details : undefined,
  timestamp: new Date().toISOString(),
});

/**
 * Validation error response (from express-validator)
 * @param {Array} errors - validationResult().array()
 */
const validationError = (errors) => ({
  success: false,
  message: 'Validation failed',
  errors: errors.map((e) => ({ field: e.path || e.param, message: e.msg, value: e.value })),
  timestamp: new Date().toISOString(),
});

/**
 * Paginated response wrapper
 */
const paginated = (message, items, total, page, limit) => ({
  success: true,
  message,
  data: items,
  pagination: {
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / parseInt(limit)),
    hasNext: parseInt(page) * parseInt(limit) < total,
    hasPrev: parseInt(page) > 1,
  },
  timestamp: new Date().toISOString(),
});

module.exports = { success, error, validationError, paginated };
