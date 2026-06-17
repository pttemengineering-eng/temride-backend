'use strict';

const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * Verify JWT and attach user to req.user
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(error('No token provided. Please login first.'));
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json(error('Token expired. Please login again.'));
      }
      return res.status(401).json(error('Invalid token.'));
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, phone: true, email: true, role: true, status: true },
    });

    if (!user) {
      return res.status(401).json(error('User not found. Token may be stale.'));
    }

    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      return res.status(403).json(error(`Account is ${user.status.toLowerCase()}. Contact support.`));
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('authenticate middleware error:', err);
    return res.status(500).json(error('Authentication failed', err.message));
  }
};

/**
 * Optional authentication — does not block, but attaches user if token present
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, phone: true, role: true, status: true },
    });
    if (user && user.status === 'ACTIVE') {
      req.user = user;
    }
  } catch (_) {
    // silently ignore invalid token
  }
  next();
};

module.exports = { authenticate, optionalAuthenticate };
