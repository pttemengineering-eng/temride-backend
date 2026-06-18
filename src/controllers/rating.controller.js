'use strict';

const { PrismaClient } = require('@prisma/client');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * POST /api/ratings
 * Passenger rates a driver (1-5 stars + comment)
 */
const submitRating = async (req, res) => {
  const { orderId, score, comment } = req.body;
  const raterId = req.user.id;

  if (!orderId || !score) {
    return res.status(400).json(error('orderId and score are required'));
  }
  if (score < 1 || score > 5) {
    return res.status(400).json(error('Score must be between 1 and 5'));
  }

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json(error('Order not found'));
    if (order.status !== 'COMPLETED') {
      return res.status(409).json(error('Can only rate completed orders'));
    }

    const isPassenger = order.passengerId === raterId;
    const isDriver = order.driverId === raterId;
    if (!isPassenger && !isDriver) {
      return res.status(403).json(error('Access denied'));
    }

    // Determine who is being rated
    const ratedId = isPassenger ? order.driverId : order.passengerId;
    if (!ratedId) return res.status(400).json(error('Cannot determine rated user'));

    // Check if already rated
    const existing = await prisma.rating.findUnique({ where: { orderId } });
    if (existing) return res.status(409).json(error('Order already rated'));

    const rating = await prisma.rating.create({
      data: { orderId, raterId, ratedId, score: parseInt(score), comment },
    });

    // Update driver's average rating automatically
    if (isPassenger && order.driverId) {
      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId: order.driverId },
      });
      if (driverProfile) {
        const allRatings = await prisma.rating.findMany({
          where: { ratedId: order.driverId },
          select: { score: true },
        });
        const avg = allRatings.reduce((s, r) => s + r.score, 0) / allRatings.length;
        await prisma.driverProfile.update({
          where: { userId: order.driverId },
          data: { rating: Math.round(avg * 10) / 10 },
        });
      }
    }

    return res.status(201).json(success('Rating submitted', { rating }));
  } catch (err) {
    console.error('submitRating error:', err);
    return res.status(500).json(error('Failed to submit rating', err.message));
  }
};

/**
 * GET /api/ratings/driver/:driverId
 * Get all ratings for a specific driver
 */
const getDriverRatings = async (req, res) => {
  const { driverId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const [ratings, total] = await Promise.all([
      prisma.rating.findMany({
        where: { ratedId: driverId },
        include: { rater: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.rating.count({ where: { ratedId: driverId } }),
    ]);

    // Calculate average from all ratings, not just this page
    const allScores = await prisma.rating.findMany({
      where: { ratedId: driverId },
      select: { score: true },
    });
    const avgScore = allScores.length > 0
      ? allScores.reduce((s, r) => s + r.score, 0) / allScores.length
      : 0;

    return res.json(success('Driver ratings retrieved', {
      ratings,
      averageScore: Math.round(avgScore * 10) / 10,
      total,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }));
  } catch (err) {
    console.error('getDriverRatings error:', err);
    return res.status(500).json(error('Failed to get driver ratings', err.message));
  }
};

/**
 * GET /api/ratings/my
 * Get ratings given by the logged-in passenger
 */
const getMyRatings = async (req, res) => {
  const raterId = req.user.id;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const [ratings, total] = await Promise.all([
      prisma.rating.findMany({
        where: { raterId },
        include: {
          rated: { select: { id: true, name: true } },
          order: { select: { id: true, pickupAddress: true, destAddress: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.rating.count({ where: { raterId } }),
    ]);

    return res.json(success('My ratings retrieved', {
      ratings,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }));
  } catch (err) {
    console.error('getMyRatings error:', err);
    return res.status(500).json(error('Failed to get my ratings', err.message));
  }
};

module.exports = { submitRating, getDriverRatings, getMyRatings };
