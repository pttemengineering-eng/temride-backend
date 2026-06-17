'use strict';

const { error } = require('../utils/response.helper');

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res) => {
  return res.status(404).json(error(`Route ${req.method} ${req.path} not found`));
};

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  console.error('[ErrorHandler]', err);

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json(error('Duplicate entry. Record already exists.', {
      field: err.meta?.target,
    }));
  }
  if (err.code === 'P2025') {
    return res.status(404).json(error('Record not found'));
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json(error('Invalid token'));
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json(error('Token expired'));
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(422).json(error(err.message));
  }

  // Default
  const statusCode = err.status || err.statusCode || 500;
  return res.status(statusCode).json(error(
    err.message || 'Internal Server Error',
    process.env.NODE_ENV !== 'production' ? err.stack : undefined
  ));
};

module.exports = { notFoundHandler, errorHandler };
