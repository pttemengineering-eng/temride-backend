'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Track connected driver/passenger socket IDs
const driverSockets = new Map(); // userId -> socketId
const passengerSockets = new Map(); // userId -> socketId

/**
 * Haversine distance for filtering drivers by radius
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initialize Socket.io handlers
 * @param {import('socket.io').Server} io
 */
function initSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ─── Driver Events ─────────────────────────────────────────────────────

    /**
     * Driver connects and registers themselves
     * Payload: { userId, token }
     */
    socket.on('driver:connect', async ({ userId } = {}) => {
      if (!userId) return;
      driverSockets.set(userId, socket.id);
      socket.join(`driver:${userId}`);
      console.log(`[Socket] Driver connected: ${userId} -> ${socket.id}`);

      // Mark driver online in DB
      try {
        await prisma.driverProfile.updateMany({
          where: { userId },
          data: { isOnline: true },
        });
      } catch (err) {
        console.error('[Socket] driver:connect DB error:', err.message);
      }

      socket.emit('driver:connected', { message: 'Connected successfully', socketId: socket.id });
    });

    /**
     * Driver sends location update
     * Payload: { userId, lat, lng, heading, speed }
     */
    socket.on('driver:location_update', async ({ userId, lat, lng, heading, speed } = {}) => {
      if (!userId || lat == null || lng == null) return;

      try {
        await prisma.driverProfile.updateMany({
          where: { userId },
          data: { currentLat: lat, currentLng: lng },
        });
      } catch (err) {
        console.error('[Socket] location_update DB error:', err.message);
      }

      // Find active order for this driver
      const activeOrder = await prisma.order.findFirst({
        where: {
          driverId: userId,
          status: { in: ['DRIVER_FOUND', 'DRIVER_ON_WAY', 'ARRIVED', 'IN_TRIP'] },
        },
      }).catch(() => null);

      if (activeOrder) {
        // Forward location to passenger
        io.to(`passenger:${activeOrder.passengerId}`).emit('order:driver_location', {
          orderId: activeOrder.id,
          lat,
          lng,
          heading,
          speed,
        });
      }

      socket.emit('driver:location_ack', { lat, lng });
    });

    /**
     * Driver updates status for an order (DRIVER_ON_WAY)
     * Payload: { userId, orderId, status }
     */
    socket.on('driver:order_status_update', async ({ userId, orderId, status } = {}) => {
      if (!userId || !orderId || !status) return;

      const validStatuses = ['DRIVER_ON_WAY'];
      if (!validStatuses.includes(status)) return;

      try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order || order.driverId !== userId) return;

        await prisma.order.update({ where: { id: orderId }, data: { status } });

        io.to(`passenger:${order.passengerId}`).emit('order:status_update', {
          orderId,
          status,
          message: 'Driver is on the way!',
        });
      } catch (err) {
        console.error('[Socket] driver:order_status_update error:', err.message);
      }
    });

    // ─── Passenger Events ──────────────────────────────────────────────────

    /**
     * Passenger connects and registers themselves
     * Payload: { userId }
     */
    socket.on('passenger:connect', ({ userId } = {}) => {
      if (!userId) return;
      passengerSockets.set(userId, socket.id);
      socket.join(`passenger:${userId}`);
      console.log(`[Socket] Passenger connected: ${userId} -> ${socket.id}`);
      socket.emit('passenger:connected', { message: 'Connected successfully', socketId: socket.id });
    });

    /**
     * Passenger cancels order
     * Payload: { userId, orderId, reason }
     */
    socket.on('passenger:cancel_order', async ({ userId, orderId, reason } = {}) => {
      if (!userId || !orderId) return;

      try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order || order.passengerId !== userId) return;

        const cancellable = ['SEARCHING', 'DRIVER_FOUND', 'DRIVER_ON_WAY', 'ARRIVED'];
        if (!cancellable.includes(order.status)) return;

        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'CANCELLED', cancelReason: reason || 'Passenger cancelled', cancelledBy: 'PASSENGER' },
        });

        if (order.driverId) {
          io.to(`driver:${order.driverId}`).emit('order:status_update', {
            orderId,
            status: 'CANCELLED',
            reason: 'Passenger cancelled the order',
          });
        }
      } catch (err) {
        console.error('[Socket] passenger:cancel_order error:', err.message);
      }
    });

    // ─── Order Broadcasting ────────────────────────────────────────────────

    /**
     * Broadcast a new order to nearby drivers
     * Called internally from order controller
     */
    socket.on('order:broadcast', async ({ orderPayload, nearbyDriverIds } = {}) => {
      if (!orderPayload || !nearbyDriverIds?.length) return;
      nearbyDriverIds.forEach((driverId) => {
        io.to(`driver:${driverId}`).emit('order:new_request', orderPayload);
      });
    });

    // ─── Disconnect ────────────────────────────────────────────────────────

    socket.on('disconnect', async () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);

      // Remove from maps
      for (const [userId, sid] of driverSockets.entries()) {
        if (sid === socket.id) {
          driverSockets.delete(userId);
          try {
            await prisma.driverProfile.updateMany({
              where: { userId },
              data: { isOnline: false },
            });
          } catch (_) {}
          console.log(`[Socket] Driver offline: ${userId}`);
          break;
        }
      }
      for (const [userId, sid] of passengerSockets.entries()) {
        if (sid === socket.id) {
          passengerSockets.delete(userId);
          break;
        }
      }
    });
  });
}

/**
 * Broadcast a new order request to specific driver user IDs
 */
function broadcastOrderToDrivers(io, driverUserIds, orderPayload) {
  driverUserIds.forEach((userId) => {
    io.to(`driver:${userId}`).emit('order:new_request', orderPayload);
  });
}

module.exports = { initSocket, broadcastOrderToDrivers, driverSockets, passengerSockets };
