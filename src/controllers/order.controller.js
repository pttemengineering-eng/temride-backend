'use strict';

const { PrismaClient } = require('@prisma/client');
const { success, error } = require('../utils/response.helper');
const { calculateFareAmount } = require('../utils/pricing.helper');
const { getDistanceMatrix } = require('../services/maps.service');
const { sendPushNotification } = require('../services/notification.service');

const prisma = new PrismaClient();

const BROADCAST_RADIUS_KM = parseFloat(process.env.ORDER_BROADCAST_RADIUS_KM) || 3;
const ACCEPT_TIMEOUT_SECONDS = parseInt(process.env.ORDER_ACCEPT_TIMEOUT_SECONDS, 10) || 30;

/**
 * Haversine formula — get distance in km between two lat/lng points
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * POST /api/orders/request
 * Passenger requests a new ride
 */
const requestOrder = async (req, res) => {
  const {
    pickupLat,
    pickupLng,
    pickupAddress,
    destLat,
    destLng,
    destAddress,
    paymentMethod = 'CASH',
    promoCode,
  } = req.body;

  const passengerId = req.user.id;
  const io = req.app.get('io');

  try {
    // Check if passenger already has an active order
    const activeOrder = await prisma.order.findFirst({
      where: {
        passengerId,
        status: { in: ['SEARCHING', 'DRIVER_FOUND', 'DRIVER_ON_WAY', 'ARRIVED', 'IN_TRIP'] },
      },
    });
    if (activeOrder) {
      return res.status(409).json(error('You already have an active order', { orderId: activeOrder.id }));
    }

    // Get distance/duration from Google Maps
    let distanceData;
    try {
      distanceData = await getDistanceMatrix(
        `${pickupLat},${pickupLng}`,
        `${destLat},${destLng}`
      );
    } catch (mapsErr) {
      console.warn('Maps API failed, using fallback estimate:', mapsErr.message);
      const distKm = haversineDistance(pickupLat, pickupLng, destLat, destLng);
      distanceData = {
        distanceKm: distKm,
        distanceText: `${distKm.toFixed(1)} km`,
        durationSeconds: Math.round(distKm * 3 * 60),
        durationText: `${Math.round(distKm * 3)} mins`,
      };
    }

    // Check promo code
    let promoDiscount = 0;
    let promoRecord = null;
    if (promoCode) {
      promoRecord = await prisma.promoCode.findFirst({
        where: {
          code: promoCode,
          isActive: true,
          expiresAt: { gt: new Date() },
          usedCount: { lt: prisma.promoCode.fields.usageLimit },
        },
      });
    }

    // Calculate fare
    const surgeFactor = parseFloat(process.env.SURGE_MULTIPLIER_DEFAULT) || 1.0;
    const fareData = calculateFareAmount(distanceData.distanceKm, surgeFactor);

    if (promoRecord) {
      if (promoRecord.type === 'PERCENT') {
        promoDiscount = Math.min(
          (fareData.totalFare * promoRecord.value) / 100,
          promoRecord.maxDiscount || Infinity
        );
      } else {
        promoDiscount = Math.min(promoRecord.value, fareData.totalFare);
      }
      // Increment usage
      await prisma.promoCode.update({
        where: { id: promoRecord.id },
        data: { usedCount: { increment: 1 } },
      });
    }

    const finalFare = Math.max(0, fareData.totalFare - promoDiscount);
    const platformFee = finalFare * (parseFloat(process.env.PLATFORM_FEE_PERCENT) / 100 || 0.1);
    const driverEarnings = finalFare - platformFee;

    // Create order
    const order = await prisma.order.create({
      data: {
        passengerId,
        status: 'SEARCHING',
        pickupLat,
        pickupLng,
        pickupAddress,
        destLat,
        destLng,
        destAddress,
        distance: distanceData.distanceKm,
        duration: distanceData.durationSeconds,
        baseFare: fareData.baseFare,
        perKmFare: fareData.perKmFare,
        surgeFactor,
        totalFare: finalFare,
        driverEarnings,
        platformFee,
        promoCode: promoCode || null,
        promoDiscount,
        paymentMethod,
      },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
      },
    });

    // Find online drivers within broadcast radius
    const onlineDrivers = await prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        kycStatus: 'APPROVED',
        currentLat: { not: null },
        currentLng: { not: null },
      },
      include: { user: { select: { id: true, name: true } } },
    });

    const nearbyDrivers = onlineDrivers.filter((d) => {
      if (!d.currentLat || !d.currentLng) return false;
      const dist = haversineDistance(pickupLat, pickupLng, d.currentLat, d.currentLng);
      return dist <= BROADCAST_RADIUS_KM;
    });

    // Broadcast order to nearby drivers via Socket.io
    const orderPayload = {
      orderId: order.id,
      passenger: order.passenger,
      pickup: { lat: pickupLat, lng: pickupLng, address: pickupAddress },
      destination: { lat: destLat, lng: destLng, address: destAddress },
      distance: distanceData.distanceKm,
      duration: distanceData.durationSeconds,
      totalFare: finalFare,
      driverEarnings,
      paymentMethod,
      timeoutSeconds: ACCEPT_TIMEOUT_SECONDS,
    };

    nearbyDrivers.forEach((driver) => {
      io.to(`driver:${driver.userId}`).emit('order:new_request', orderPayload);
    });

    // Set timeout — if not accepted, cancel order
    setTimeout(async () => {
      const stillSearching = await prisma.order.findFirst({
        where: { id: order.id, status: 'SEARCHING' },
      });
      if (stillSearching) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED', cancelReason: 'No driver available', cancelledBy: 'SYSTEM' },
        });
        io.to(`passenger:${passengerId}`).emit('order:status_update', {
          orderId: order.id,
          status: 'CANCELLED',
          reason: 'No driver available nearby',
        });
      }
    }, ACCEPT_TIMEOUT_SECONDS * 1000);

    return res.status(201).json(success('Order created. Looking for drivers...', {
      order: {
        id: order.id,
        status: order.status,
        pickup: pickupAddress,
        destination: destAddress,
        distance: distanceData.distanceKm,
        duration: distanceData.durationSeconds,
        totalFare: finalFare,
        driverEarnings,
        platformFee,
        promoDiscount,
        paymentMethod,
        driversNotified: nearbyDrivers.length,
        timeoutSeconds: ACCEPT_TIMEOUT_SECONDS,
      },
    }));
  } catch (err) {
    console.error('requestOrder error:', err);
    return res.status(500).json(error('Failed to create order', err.message));
  }
};

/**
 * GET /api/orders/:id
 */
const getOrder = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        driver: {
          select: {
            id: true, name: true, phone: true,
            driverProfile: {
              select: { rating: true, totalTrips: true, currentLat: true, currentLng: true, vehicle: true },
            },
          },
        },
        payment: true,
        rating: true,
      },
    });

    if (!order) return res.status(404).json(error('Order not found'));

    // Only passenger or driver of the order can view it
    if (order.passengerId !== userId && order.driverId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json(error('Access denied'));
    }

    return res.json(success('Order retrieved', { order }));
  } catch (err) {
    console.error('getOrder error:', err);
    return res.status(500).json(error('Failed to get order', err.message));
  }
};

/**
 * POST /api/orders/:id/accept
 * Driver accepts order
 */
const acceptOrder = async (req, res) => {
  const { id } = req.params;
  const driverId = req.user.id;
  const io = req.app.get('io');

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
    });
    if (!driverProfile) return res.status(404).json(error('Driver profile not found'));
    if (driverProfile.kycStatus !== 'APPROVED') {
      return res.status(403).json(error('KYC not approved. Cannot accept orders.'));
    }

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json(error('Order not found'));
    if (order.status !== 'SEARCHING') {
      return res.status(409).json(error(`Order is no longer available (status: ${order.status})`));
    }

    // Assign driver to order
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        driverId,
        status: 'DRIVER_FOUND',
      },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        driver: {
          select: {
            id: true, name: true, phone: true,
            driverProfile: { select: { rating: true, currentLat: true, currentLng: true, vehicle: true } },
          },
        },
      },
    });

    // Notify passenger
    io.to(`passenger:${order.passengerId}`).emit('order:accepted', {
      orderId: id,
      status: 'DRIVER_FOUND',
      driver: updatedOrder.driver,
    });

    // Notify other drivers to dismiss the order
    io.emit('order:taken', { orderId: id });

    // Push notification
    await sendPushNotification(order.passengerId, {
      title: 'Driver Found!',
      body: `${updatedOrder.driver.name} is on the way`,
      data: { orderId: id, type: 'ORDER_ACCEPTED' },
    });

    return res.json(success('Order accepted', { order: updatedOrder }));
  } catch (err) {
    console.error('acceptOrder error:', err);
    return res.status(500).json(error('Failed to accept order', err.message));
  }
};

/**
 * POST /api/orders/:id/arrived
 * Driver arrived at pickup point
 */
const driverArrived = async (req, res) => {
  const { id } = req.params;
  const driverId = req.user.id;
  const io = req.app.get('io');

  try {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json(error('Order not found'));
    if (order.driverId !== driverId) return res.status(403).json(error('Access denied'));
    if (order.status !== 'DRIVER_ON_WAY') {
      return res.status(409).json(error(`Cannot mark arrived from status: ${order.status}`));
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { status: 'ARRIVED' },
    });

    io.to(`passenger:${order.passengerId}`).emit('order:status_update', {
      orderId: id,
      status: 'ARRIVED',
      message: 'Driver has arrived at pickup location',
    });

    await sendPushNotification(order.passengerId, {
      title: 'Driver Arrived!',
      body: 'Your driver is waiting at the pickup point',
      data: { orderId: id, type: 'DRIVER_ARRIVED' },
    });

    return res.json(success('Arrived status updated', { order: updatedOrder }));
  } catch (err) {
    console.error('driverArrived error:', err);
    return res.status(500).json(error('Failed to update arrived status', err.message));
  }
};

/**
 * POST /api/orders/:id/start
 * Driver starts the trip
 */
const startTrip = async (req, res) => {
  const { id } = req.params;
  const driverId = req.user.id;
  const io = req.app.get('io');

  try {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json(error('Order not found'));
    if (order.driverId !== driverId) return res.status(403).json(error('Access denied'));
    if (!['ARRIVED', 'DRIVER_FOUND'].includes(order.status)) {
      return res.status(409).json(error(`Cannot start trip from status: ${order.status}`));
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { status: 'IN_TRIP' },
    });

    io.to(`passenger:${order.passengerId}`).emit('order:status_update', {
      orderId: id,
      status: 'IN_TRIP',
      message: 'Trip started! Enjoy your ride.',
    });

    return res.json(success('Trip started', { order: updatedOrder }));
  } catch (err) {
    console.error('startTrip error:', err);
    return res.status(500).json(error('Failed to start trip', err.message));
  }
};

/**
 * POST /api/orders/:id/complete
 * Driver completes the trip — earnings are split and credited
 */
const completeOrder = async (req, res) => {
  const { id } = req.params;
  const driverId = req.user.id;
  const io = req.app.get('io');

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { driver: { include: { driverProfile: { include: { wallet: true } } } } },
    });

    if (!order) return res.status(404).json(error('Order not found'));
    if (order.driverId !== driverId) return res.status(403).json(error('Access denied'));
    if (order.status !== 'IN_TRIP') {
      return res.status(409).json(error(`Cannot complete from status: ${order.status}`));
    }

    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
      include: { wallet: true },
    });

    // Use transaction for atomic wallet update
    const [updatedOrder] = await prisma.$transaction(async (tx) => {
      // Update order
      const completedOrder = await tx.order.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Credit driver wallet
      if (driverProfile.wallet) {
        // Deduct weekly credit if applicable
        let creditDeduction = 0;
        const vehicle = await tx.vehicle.findUnique({ where: { driverId: driverProfile.id } });
        if (vehicle && vehicle.creditWeeksRemaining > 0) {
          creditDeduction = vehicle.creditMonthlyDeduction / 4; // weekly
        }

        const netEarnings = order.driverEarnings - creditDeduction;

        await tx.driverWallet.update({
          where: { id: driverProfile.wallet.id },
          data: {
            balance: { increment: netEarnings },
            totalEarnings: { increment: order.driverEarnings },
            totalCreditDeducted: { increment: creditDeduction },
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: driverProfile.wallet.id,
            type: 'EARNING',
            amount: order.driverEarnings,
            description: `Earnings from order #${id.slice(0, 8)}`,
            orderId: id,
          },
        });

        if (creditDeduction > 0) {
          await tx.walletTransaction.create({
            data: {
              walletId: driverProfile.wallet.id,
              type: 'CREDIT_DEDUCTION',
              amount: -creditDeduction,
              description: `Weekly vehicle credit deduction`,
              orderId: id,
            },
          });

          // Update vehicle credit
          if (vehicle) {
            await tx.vehicle.update({
              where: { id: vehicle.id },
              data: {
                creditPaidTotal: { increment: creditDeduction },
                creditWeeksRemaining: { decrement: 1 },
              },
            });
          }
        }
      }

      // Update driver stats
      await tx.driverProfile.update({
        where: { id: driverProfile.id },
        data: { totalTrips: { increment: 1 } },
      });

      return [completedOrder];
    });

    io.to(`passenger:${order.passengerId}`).emit('order:status_update', {
      orderId: id,
      status: 'COMPLETED',
      message: 'Trip completed. Thank you for riding with TemRide!',
    });

    await sendPushNotification(order.passengerId, {
      title: 'Trip Completed!',
      body: `You have arrived at ${order.destAddress}. Total: Rp ${order.totalFare.toLocaleString()}`,
      data: { orderId: id, type: 'ORDER_COMPLETED' },
    });

    return res.json(success('Order completed', {
      order: updatedOrder,
      earnings: {
        driverEarnings: order.driverEarnings,
        platformFee: order.platformFee,
        totalFare: order.totalFare,
      },
    }));
  } catch (err) {
    console.error('completeOrder error:', err);
    return res.status(500).json(error('Failed to complete order', err.message));
  }
};

/**
 * POST /api/orders/:id/cancel
 * Cancel an active order
 */
const cancelOrder = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { reason } = req.body;
  const io = req.app.get('io');

  try {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json(error('Order not found'));

    const cancellableStatuses = ['SEARCHING', 'DRIVER_FOUND', 'DRIVER_ON_WAY', 'ARRIVED'];
    if (!cancellableStatuses.includes(order.status)) {
      return res.status(409).json(error(`Cannot cancel order with status: ${order.status}`));
    }

    // Determine who is cancelling
    const isPassengerCancelling = order.passengerId === userId;
    const isDriverCancelling = order.driverId === userId;

    if (!isPassengerCancelling && !isDriverCancelling && req.user.role !== 'ADMIN') {
      return res.status(403).json(error('Access denied'));
    }

    const cancelledBy = isPassengerCancelling ? 'PASSENGER' : isDriverCancelling ? 'DRIVER' : 'ADMIN';

    // Penalty logic: if driver cancels after accepting, note it (could implement penalty deduction)
    let penaltyApplied = false;
    if (isDriverCancelling && ['DRIVER_FOUND', 'DRIVER_ON_WAY', 'ARRIVED'].includes(order.status)) {
      penaltyApplied = true;
      // Could deduct from driver rating or wallet here
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelReason: reason || 'User cancelled',
        cancelledBy,
      },
    });

    // Notify the other party
    if (isPassengerCancelling && order.driverId) {
      io.to(`driver:${order.driverId}`).emit('order:status_update', {
        orderId: id,
        status: 'CANCELLED',
        reason: reason || 'Passenger cancelled',
      });
    }

    if (isDriverCancelling) {
      io.to(`passenger:${order.passengerId}`).emit('order:status_update', {
        orderId: id,
        status: 'CANCELLED',
        reason: 'Driver cancelled. Please try booking again.',
      });
    }

    return res.json(success('Order cancelled', { order: updatedOrder, penaltyApplied }));
  } catch (err) {
    console.error('cancelOrder error:', err);
    return res.status(500).json(error('Failed to cancel order', err.message));
  }
};

module.exports = {
  requestOrder,
  getOrder,
  acceptOrder,
  driverArrived,
  startTrip,
  completeOrder,
  cancelOrder,
};
