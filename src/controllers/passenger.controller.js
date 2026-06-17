'use strict';

const { PrismaClient } = require('@prisma/client');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * GET /api/passengers/profile
 */
const getProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, phone: true, email: true,
        role: true, status: true, createdAt: true,
      },
    });
    if (!user) return res.status(404).json(error('User not found'));
    return res.json(success('Profile retrieved', { user }));
  } catch (err) {
    return res.status(500).json(error('Failed to get profile', err.message));
  }
};

/**
 * PUT /api/passengers/profile
 */
const updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { name, email } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { name, email },
      select: { id: true, name: true, phone: true, email: true },
    });
    return res.json(success('Profile updated', { user }));
  } catch (err) {
    return res.status(500).json(error('Failed to update profile', err.message));
  }
};

/**
 * GET /api/passengers/order-history
 */
const getOrderHistory = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = { passengerId: userId };
  if (status) where.status = status;

  try {
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          driver: { select: { id: true, name: true, phone: true } },
          payment: { select: { status: true, method: true, amount: true } },
          rating: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.order.count({ where }),
    ]);

    return res.json(success('Order history retrieved', {
      orders,
      pagination: {
        total, page: parseInt(page), limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }));
  } catch (err) {
    return res.status(500).json(error('Failed to get order history', err.message));
  }
};

module.exports = { getProfile, updateProfile, getOrderHistory };
