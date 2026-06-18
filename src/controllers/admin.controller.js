'use strict';

const { PrismaClient } = require('@prisma/client');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * GET /api/admin/dashboard-stats
 * Full overview: users, orders, drivers, revenue
 */
const getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      totalPassengers,
      totalDrivers,
      activeDrivers,
      pendingKyc,
      totalOrders,
      todayOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue,
      totalRestaurants,
      totalFoodOrders,
      totalGoSendOrders,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'PASSENGER' } }),
      prisma.user.count({ where: { role: 'DRIVER' } }),
      prisma.driverProfile.count({ where: { isOnline: true } }),
      prisma.driverProfile.count({ where: { kycStatus: 'PENDING' } }),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.order.count({ where: { status: 'COMPLETED' } }),
      prisma.order.count({ where: { status: 'CANCELLED' } }),
      prisma.order.aggregate({
        _sum: { platformFee: true },
        where: { status: 'COMPLETED' },
      }),
      prisma.restaurant.count().catch(() => 0),
      prisma.foodOrder.count().catch(() => 0),
      prisma.goSendOrder.count().catch(() => 0),
    ]);

    return res.json(success('Dashboard stats retrieved', {
      users: { total: totalUsers, passengers: totalPassengers, drivers: totalDrivers },
      drivers: { active: activeDrivers, pendingKyc },
      orders: {
        total: totalOrders,
        today: todayOrders,
        completed: completedOrders,
        cancelled: cancelledOrders,
        completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
      },
      revenue: {
        total: totalRevenue._sum.platformFee || 0,
      },
      features: {
        restaurants: totalRestaurants,
        foodOrders: totalFoodOrders,
        goSendOrders: totalGoSendOrders,
      },
    }));
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json(error('Failed to get dashboard stats', err.message));
  }
};

/**
 * GET /api/admin/drivers
 * List all drivers with status and rating
 */
const getAllDrivers = async (req, res) => {
  const { page = 1, limit = 20, kycStatus, search, isOnline } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = { role: 'DRIVER' };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  try {
    let [drivers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          driverProfile: { include: { vehicle: true, wallet: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.user.count({ where }),
    ]);

    // Filter by kycStatus and isOnline after fetching
    if (kycStatus) {
      drivers = drivers.filter((d) => d.driverProfile?.kycStatus === kycStatus);
    }
    if (isOnline !== undefined) {
      const onlineFlag = isOnline === 'true';
      drivers = drivers.filter((d) => d.driverProfile?.isOnline === onlineFlag);
    }

    return res.json(success('Drivers retrieved', {
      drivers,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    }));
  } catch (err) {
    console.error('getAllDrivers error:', err);
    return res.status(500).json(error('Failed to get drivers', err.message));
  }
};

/**
 * POST /api/admin/drivers
 * Add a driver manually (admin creates user + driverProfile)
 */
const addDriver = async (req, res) => {
  const { name, phone, email, licenseNo, vehicleType } = req.body;

  if (!name || !phone) {
    return res.status(400).json(error('name and phone are required'));
  }

  try {
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) return res.status(409).json(error('Phone number already registered'));

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { name, phone, email, role: 'DRIVER' },
      });

      const profile = await tx.driverProfile.create({
        data: {
          userId: newUser.id,
          licenseNo,
          vehicleType,
          kycStatus: 'PENDING',
        },
      });

      await tx.driverWallet.create({
        data: { driverId: profile.id },
      });

      return newUser;
    });

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { driverProfile: true },
    });

    return res.status(201).json(success('Driver added', { driver: fullUser }));
  } catch (err) {
    console.error('addDriver error:', err);
    return res.status(500).json(error('Failed to add driver', err.message));
  }
};

/**
 * PATCH /api/admin/drivers/:id/verify
 * Approve or reject driver KYC
 */
const verifyDriver = async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  if (!['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json(error('action must be APPROVE or REJECT'));
  }

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.role !== 'DRIVER') return res.status(404).json(error('Driver not found'));

    const kycStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    const updated = await prisma.driverProfile.update({
      where: { userId: id },
      data: {
        kycStatus,
        kycRejectedReason: action === 'REJECT' ? reason : null,
      },
    });

    return res.json(success(`Driver KYC ${kycStatus.toLowerCase()}`, { driverProfile: updated }));
  } catch (err) {
    console.error('verifyDriver error:', err);
    return res.status(500).json(error('Failed to verify driver', err.message));
  }
};

/**
 * PUT /api/admin/drivers/:id/approve
 * Legacy alias for verifyDriver
 */
const approveDriver = verifyDriver;

/**
 * GET /api/admin/orders
 * All orders with filters
 */
const getAllOrders = async (req, res) => {
  const { page = 1, limit = 20, status, from, to, paymentMethod } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status) where.status = status;
  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  try {
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          passenger: { select: { id: true, name: true, phone: true } },
          driver: { select: { id: true, name: true, phone: true } },
          payment: { select: { status: true, method: true, amount: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.order.count({ where }),
    ]);

    return res.json(success('Orders retrieved', {
      orders,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    }));
  } catch (err) {
    console.error('getAllOrders error:', err);
    return res.status(500).json(error('Failed to get orders', err.message));
  }
};

/**
 * GET /api/admin/revenue
 */
const getRevenue = async (req, res) => {
  const { from, to } = req.query;

  const startDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400 * 1000);
  const endDate = to ? new Date(to) : new Date();

  try {
    const completedOrders = await prisma.order.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        totalFare: true,
        driverEarnings: true,
        platformFee: true,
        completedAt: true,
        paymentMethod: true,
      },
    });

    const totalRevenue = completedOrders.reduce((s, o) => s + o.platformFee, 0);
    const totalFare = completedOrders.reduce((s, o) => s + o.totalFare, 0);
    const totalDriverEarnings = completedOrders.reduce((s, o) => s + o.driverEarnings, 0);

    const dailyRevenue = {};
    completedOrders.forEach((o) => {
      const day = (o.completedAt || new Date()).toISOString().slice(0, 10);
      if (!dailyRevenue[day]) dailyRevenue[day] = { revenue: 0, fare: 0, orders: 0 };
      dailyRevenue[day].revenue += o.platformFee;
      dailyRevenue[day].fare += o.totalFare;
      dailyRevenue[day].orders += 1;
    });

    const paymentBreakdown = {};
    completedOrders.forEach((o) => {
      paymentBreakdown[o.paymentMethod] = (paymentBreakdown[o.paymentMethod] || 0) + 1;
    });

    return res.json(success('Revenue data retrieved', {
      period: { from: startDate, to: endDate },
      summary: { totalOrders: completedOrders.length, totalFare, totalRevenue, totalDriverEarnings },
      dailyRevenue,
      paymentBreakdown,
    }));
  } catch (err) {
    console.error('getRevenue error:', err);
    return res.status(500).json(error('Failed to get revenue', err.message));
  }
};

/**
 * GET /api/admin/restaurants
 * Manage restaurants
 */
const getAdminRestaurants = async (req, res) => {
  const { page = 1, limit = 20, search, category } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { address: { contains: search, mode: 'insensitive' } },
    ];
  }

  try {
    const [restaurants, total] = await Promise.all([
      prisma.restaurant.findMany({
        where,
        include: {
          _count: { select: { menus: true, orders: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.restaurant.count({ where }),
    ]);

    return res.json(success('Restaurants retrieved', {
      restaurants,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    }));
  } catch (err) {
    console.error('getAdminRestaurants error:', err);
    return res.status(500).json(error('Failed to get restaurants', err.message));
  }
};

/**
 * GET /api/admin/gosend
 * Manage GoSend orders
 */
const getAdminGoSend = async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
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
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    }));
  } catch (err) {
    console.error('getAdminGoSend error:', err);
    return res.status(500).json(error('Failed to get GoSend orders', err.message));
  }
};

/**
 * DELETE /api/admin/users/:id
 * Delete a user (soft delete by banning)
 */
const deleteUser = async (req, res) => {
  const { id } = req.params;
  const { permanent = false } = req.query;

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json(error('User not found'));

    if (permanent === 'true') {
      // Hard delete
      await prisma.user.delete({ where: { id } });
      return res.json(success('User permanently deleted', { userId: id }));
    } else {
      // Soft delete — ban the user
      const updated = await prisma.user.update({
        where: { id },
        data: { status: 'BANNED' },
      });
      return res.json(success('User banned', { user: { id: updated.id, status: updated.status } }));
    }
  } catch (err) {
    console.error('deleteUser error:', err);
    return res.status(500).json(error('Failed to delete user', err.message));
  }
};

/**
 * GET /api/admin/withdrawals
 * List all withdrawal requests with optional filter
 */
const getWithdrawalRequests = async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status) where.status = status;

  try {
    const [withdrawals, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        include: {
          wallet: {
            include: {
              driver: { include: { user: { select: { id: true, name: true, phone: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.withdrawalRequest.count({ where }),
    ]);

    return res.json(success('Withdrawals retrieved', {
      withdrawals,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    }));
  } catch (err) {
    console.error('getWithdrawalRequests error:', err);
    return res.status(500).json(error('Failed to get withdrawals', err.message));
  }
};

/**
 * PATCH /api/admin/withdrawals/:id
 * Approve or reject a withdrawal
 */
const processWithdrawal = async (req, res) => {
  const { id } = req.params;
  const { action, adminNote } = req.body;

  if (!['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json(error('action must be APPROVE or REJECT'));
  }

  try {
    const withdrawal = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!withdrawal) return res.status(404).json(error('Withdrawal not found'));
    if (withdrawal.status !== 'PENDING') {
      return res.status(409).json(error(`Withdrawal already ${withdrawal.status}`));
    }

    if (action === 'APPROVE') {
      await prisma.withdrawalRequest.update({
        where: { id },
        data: { status: 'APPROVED', adminNote, processedAt: new Date() },
      });
      return res.json(success('Withdrawal approved'));
    } else {
      // Reject — refund balance
      await prisma.$transaction(async (tx) => {
        await tx.withdrawalRequest.update({
          where: { id },
          data: { status: 'REJECTED', adminNote, processedAt: new Date() },
        });

        await tx.driverWallet.update({
          where: { id: withdrawal.walletId },
          data: {
            balance: { increment: withdrawal.amount },
            totalWithdrawn: { decrement: withdrawal.amount },
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: withdrawal.walletId,
            type: 'BONUS',
            amount: withdrawal.amount,
            description: `Withdrawal rejected — refund`,
          },
        });
      });

      return res.json(success('Withdrawal rejected and refunded'));
    }
  } catch (err) {
    console.error('processWithdrawal error:', err);
    return res.status(500).json(error('Failed to process withdrawal', err.message));
  }
};

/**
 * GET /api/admin/passengers
 * List all passengers (users with role PASSENGER)
 */
const getAllPassengers = async (req, res) => {
  try {
    const passengers = await prisma.user.findMany({
      where: { role: 'PASSENGER' },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({
      success: true,
      passengers,
      total: passengers.length,
    });
  } catch (err) {
    console.error('getAllPassengers error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/food-orders
 * All food orders (TFood) for admin
 */
const getAdminFoodOrders = async (req, res) => {
  try {
    const orders = await prisma.foodOrder.findMany({
      include: {
        user: { select: { name: true, phone: true } },
        restaurant: { select: { name: true } },
        driver: { select: { name: true } },
        items: { include: { menu: { select: { name: true, price: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, orders, total: orders.length });
  } catch (err) {
    console.error('getAdminFoodOrders error:', err);
    res.status(500).json({ success: false, message: err.message, orders: [] });
  }
};

/**
 * GET /api/admin/vouchers-list
 * List all vouchers/promo codes for admin
 */
const getAdminVouchers = async (req, res) => {
  try {
    const vouchers = await prisma.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, vouchers, total: vouchers.length });
  } catch (err) {
    // Try alternative model name
    try {
      const vouchers = await prisma.voucher.findMany({ orderBy: { createdAt: 'desc' } });
      res.json({ success: true, vouchers, total: vouchers.length });
    } catch {
      res.json({ success: true, vouchers: [], total: 0, note: 'No vouchers yet' });
    }
  }
};

/**
 * GET /api/admin/drivers/:driverId/metrics
 * Driver performance metrics (7-day window)
 */
const getDriverMetrics = async (req, res) => {
  try {
    const { driverId } = req.params;
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [orders, acceptedOrders, cancelledOrders, ratings] = await Promise.all([
      prisma.order.count({ where: { driverId, createdAt: { gte: weekAgo } } }),
      prisma.order.count({ where: { driverId, status: { not: 'CANCELLED' }, createdAt: { gte: weekAgo } } }),
      prisma.order.count({ where: { driverId, status: 'CANCELLED', createdAt: { gte: weekAgo } } }),
      prisma.rating.aggregate({ where: { driverId }, _avg: { rating: true }, _count: true }),
    ]);

    const acceptanceRate = orders > 0 ? Math.round((acceptedOrders / orders) * 100) : 100;
    const cancellationRate = acceptedOrders > 0 ? Math.round((cancelledOrders / acceptedOrders) * 100) : 0;
    const avgRating = ratings._avg.rating || 5.0;

    let performanceStatus = 'GOOD';
    if (avgRating < 4.0 || cancellationRate > 30) performanceStatus = 'WARNING';
    if (avgRating < 3.5 || cancellationRate > 50) performanceStatus = 'CRITICAL';

    return res.json({
      success: true,
      metrics: {
        acceptanceRate,
        cancellationRate,
        avgRating: Math.round(avgRating * 10) / 10,
        totalTrips: acceptedOrders,
        performanceStatus,
        totalRatings: ratings._count,
      },
    });
  } catch (err) {
    console.error('getDriverMetrics error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getDashboardStats,
  getAllDrivers,
  addDriver,
  verifyDriver,
  approveDriver,
  getAllOrders,
  getRevenue,
  getAdminRestaurants,
  getAdminGoSend,
  deleteUser,
  getWithdrawalRequests,
  processWithdrawal,
  getAllPassengers,
  getAdminFoodOrders,
  getAdminVouchers,
  getDriverMetrics,
};
