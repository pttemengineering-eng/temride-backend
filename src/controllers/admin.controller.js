'use strict';

const { PrismaClient } = require('@prisma/client');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * GET /api/admin/drivers
 */
const getAllDrivers = async (req, res) => {
  const { page = 1, limit = 20, kycStatus, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = { role: 'DRIVER' };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const driverWhere = {};
  if (kycStatus) driverWhere.driverProfile = { kycStatus };

  try {
    const [drivers, total] = await Promise.all([
      prisma.user.findMany({
        where: { ...where },
        include: {
          driverProfile: { include: { vehicle: true, wallet: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.user.count({ where }),
    ]);

    const filtered = kycStatus
      ? drivers.filter((d) => d.driverProfile?.kycStatus === kycStatus)
      : drivers;

    return res.json(success('Drivers retrieved', {
      drivers: filtered,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    }));
  } catch (err) {
    console.error('getAllDrivers error:', err);
    return res.status(500).json(error('Failed to get drivers', err.message));
  }
};

/**
 * PUT /api/admin/drivers/:id/approve
 */
const approveDriver = async (req, res) => {
  const { id } = req.params; // userId
  const { action, reason } = req.body; // action: 'APPROVE' | 'REJECT'

  if (!['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json(error('Action must be APPROVE or REJECT'));
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
    console.error('approveDriver error:', err);
    return res.status(500).json(error('Failed to update driver KYC', err.message));
  }
};

/**
 * GET /api/admin/orders
 */
const getAllOrders = async (req, res) => {
  const { page = 1, limit = 20, status, from, to } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status) where.status = status;
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
  const { from, to, period = 'daily' } = req.query;

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

    // Group by day
    const dailyRevenue = {};
    completedOrders.forEach((o) => {
      const day = (o.completedAt || new Date()).toISOString().slice(0, 10);
      if (!dailyRevenue[day]) dailyRevenue[day] = { revenue: 0, fare: 0, orders: 0 };
      dailyRevenue[day].revenue += o.platformFee;
      dailyRevenue[day].fare += o.totalFare;
      dailyRevenue[day].orders += 1;
    });

    // Payment method breakdown
    const paymentBreakdown = {};
    completedOrders.forEach((o) => {
      paymentBreakdown[o.paymentMethod] = (paymentBreakdown[o.paymentMethod] || 0) + 1;
    });

    return res.json(success('Revenue data retrieved', {
      period: { from: startDate, to: endDate },
      summary: {
        totalOrders: completedOrders.length,
        totalFare,
        totalRevenue,
        totalDriverEarnings,
      },
      dailyRevenue,
      paymentBreakdown,
    }));
  } catch (err) {
    console.error('getRevenue error:', err);
    return res.status(500).json(error('Failed to get revenue', err.message));
  }
};

/**
 * GET /api/admin/dashboard-stats
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
    }));
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json(error('Failed to get dashboard stats', err.message));
  }
};

module.exports = { getAllDrivers, approveDriver, getAllOrders, getRevenue, getDashboardStats };
