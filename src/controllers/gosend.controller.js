'use strict';

const { PrismaClient } = require('@prisma/client');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

// Base fare for GoSend
const GOSEND_BASE_FARE = parseInt(process.env.GOSEND_BASE_FARE) || 8000;
const GOSEND_PER_KM = parseInt(process.env.GOSEND_PER_KM) || 2000;
const GOSEND_PER_KG = parseInt(process.env.GOSEND_PER_KG) || 1000;

/**
 * Haversine distance estimate (rough km from address string not supported — use fixed estimate)
 */
function estimateFare(distanceKm, weightKg) {
  const distance = parseFloat(distanceKm) || 3;
  const weight = parseFloat(weightKg) || 1;
  const fare = GOSEND_BASE_FARE + (distance * GOSEND_PER_KM) + (weight * GOSEND_PER_KG);
  return Math.round(fare);
}

/**
 * POST /api/gosend/order
 * Create a new GoSend (package delivery) order
 */
const createGoSendOrder = async (req, res) => {
  const {
    pickupAddress,
    destinationAddress,
    packageDesc,
    packageWeight = 1,
    senderName,
    recipientName,
    recipientPhone,
    paymentMethod = 'CASH',
    estimatedDistanceKm,
  } = req.body;

  const passengerId = req.user.id;

  // Validate required fields
  if (!pickupAddress || !destinationAddress || !packageDesc || !senderName || !recipientName || !recipientPhone) {
    return res.status(400).json(error('Missing required fields: pickupAddress, destinationAddress, packageDesc, senderName, recipientName, recipientPhone'));
  }

  try {
    const fare = estimateFare(estimatedDistanceKm, packageWeight);

    const order = await prisma.goSendOrder.create({
      data: {
        passengerId,
        pickupAddress,
        destinationAddress,
        packageDesc,
        packageWeight: parseFloat(packageWeight),
        senderName,
        recipientName,
        recipientPhone,
        fare,
        paymentMethod,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
      },
    });

    return res.status(201).json(success('GoSend order created', { order }));
  } catch (err) {
    console.error('createGoSendOrder error:', err);
    return res.status(500).json(error('Failed to create GoSend order', err.message));
  }
};

/**
 * GET /api/gosend/orders
 * List GoSend orders for the logged-in user
 */
const getMyGoSendOrders = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const isDriver = req.user.role === 'DRIVER';

  const where = isDriver
    ? { driverId: userId }
    : { passengerId: userId };

  if (status) where.status = status;

  try {
    const [orders, total] = await Promise.all([
      prisma.goSendOrder.findMany({
        where,
        include: {
          passenger: { select: { id: true, name: true, phone: true } },
          driver: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.goSendOrder.count({ where }),
    ]);

    return res.json(success('GoSend orders retrieved', {
      orders,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }));
  } catch (err) {
    console.error('getMyGoSendOrders error:', err);
    return res.status(500).json(error('Failed to get GoSend orders', err.message));
  }
};

/**
 * GET /api/gosend/price-estimate
 * Estimate GoSend price based on distance and weight
 */
const getPriceEstimate = async (req, res) => {
  const { distanceKm = 3, weightKg = 1 } = req.query;

  try {
    const fare = estimateFare(parseFloat(distanceKm), parseFloat(weightKg));

    return res.json(success('Price estimate calculated', {
      estimate: {
        distanceKm: parseFloat(distanceKm),
        weightKg: parseFloat(weightKg),
        baseFare: GOSEND_BASE_FARE,
        distanceFare: parseFloat(distanceKm) * GOSEND_PER_KM,
        weightFare: parseFloat(weightKg) * GOSEND_PER_KG,
        totalFare: fare,
        currency: 'IDR',
      },
    }));
  } catch (err) {
    console.error('getPriceEstimate error:', err);
    return res.status(500).json(error('Failed to estimate price', err.message));
  }
};

/**
 * GET /api/gosend/orders/:id
 * Get detail of a specific GoSend order
 */
const getGoSendOrderById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const order = await prisma.goSendOrder.findUnique({
      where: { id },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!order) return res.status(404).json(error('GoSend order not found'));
    if (order.passengerId !== userId && order.driverId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json(error('Access denied'));
    }

    return res.json(success('GoSend order retrieved', { order }));
  } catch (err) {
    console.error('getGoSendOrderById error:', err);
    return res.status(500).json(error('Failed to get GoSend order', err.message));
  }
};

/**
 * PATCH /api/gosend/orders/:id/status
 * Update GoSend order status (driver)
 */
const updateGoSendStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userId = req.user.id;
  const io = req.app.get('io');

  const validStatuses = ['ACCEPTED', 'PICKED_UP', 'DELIVERED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json(error(`Status must be one of: ${validStatuses.join(', ')}`));
  }

  try {
    const order = await prisma.goSendOrder.findUnique({ where: { id } });
    if (!order) return res.status(404).json(error('GoSend order not found'));

    // Only assigned driver or admin can update
    if (order.driverId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json(error('Access denied'));
    }

    const updateData = { status };
    if (status === 'ACCEPTED' && !order.driverId) {
      updateData.driverId = userId;
    }

    const updatedOrder = await prisma.goSendOrder.update({
      where: { id },
      data: updateData,
    });

    io.to(`passenger:${order.passengerId}`).emit('gosend:status_update', {
      orderId: id,
      status,
    });

    return res.json(success('GoSend status updated', { order: updatedOrder }));
  } catch (err) {
    console.error('updateGoSendStatus error:', err);
    return res.status(500).json(error('Failed to update GoSend status', err.message));
  }
};

module.exports = {
  createGoSendOrder,
  getMyGoSendOrders,
  getPriceEstimate,
  getGoSendOrderById,
  updateGoSendStatus,
};
