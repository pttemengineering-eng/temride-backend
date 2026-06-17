'use strict';

const { error } = require('../utils/response.helper');

/**
 * Require DRIVER role
 */
const isDriver = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(error('Not authenticated'));
  }
  if (req.user.role !== 'DRIVER') {
    return res.status(403).json(error('Access denied. Driver role required.'));
  }
  next();
};

/**
 * Require PASSENGER role
 */
const isPassenger = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(error('Not authenticated'));
  }
  if (req.user.role !== 'PASSENGER') {
    return res.status(403).json(error('Access denied. Passenger role required.'));
  }
  next();
};

/**
 * Require ADMIN role
 */
const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(error('Not authenticated'));
  }
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json(error('Access denied. Admin role required.'));
  }
  next();
};

/**
 * Allow multiple roles
 * Usage: allowRoles('DRIVER', 'ADMIN')
 */
const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(error('Not authenticated'));
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json(error(`Access denied. Allowed roles: ${roles.join(', ')}`));
  }
  next();
};

module.exports = { isDriver, isPassenger, isAdmin, allowRoles };
