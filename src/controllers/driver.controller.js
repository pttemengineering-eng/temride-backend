'use strict';

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * GET /api/drivers/profile
 */
const getProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        driverProfile: { include: { vehicle: true, wallet: true } },
      },
    });
    if (!user) return res.status(404).json(error('User not found'));
    return res.json(success('Driver profile retrieved', { user }));
  } catch (err) {
    return res.status(500).json(error('Failed to get profile', err.message));
  }
};

/**
 * PUT /api/drivers/profile
 */
const updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { name, email } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { name, email },
      select: { id: true, name: true, phone: true, email: true, role: true },
    });
    return res.json(success('Profile updated', { user }));
  } catch (err) {
    return res.status(500).json(error('Failed to update profile', err.message));
  }
};

/**
 * POST /api/drivers/kyc
 * Submit KYC documents
 */
const submitKYC = async (req, res) => {
  const userId = req.user.id;
  const { licenseNo, licensePhoto, vehiclePhoto, vehicleIdNo, vehicleType,
          brand, model, year, plateNo, isElectric, purchasePrice,
          creditMonthlyDeduction, creditWeeksRemaining } = req.body;

  try {
    const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!driverProfile) return res.status(404).json(error('Driver profile not found'));

    if (driverProfile.kycStatus === 'APPROVED') {
      return res.status(409).json(error('KYC already approved'));
    }

    // Update driver profile
    const updated = await prisma.driverProfile.update({
      where: { userId },
      data: {
        licenseNo,
        licensePhoto,
        vehiclePhoto,
        vehicleIdNo,
        vehicleType,
        kycStatus: 'PENDING',
      },
    });

    // Create or update vehicle
    if (brand && model && plateNo) {
      await prisma.vehicle.upsert({
        where: { driverId: driverProfile.id },
        update: { brand, model, year, plateNo, type: vehicleType || 'MOTORCYCLE', isElectric: isElectric ?? true, purchasePrice, creditMonthlyDeduction, creditWeeksRemaining },
        create: {
          driverId: driverProfile.id,
          brand, model,
          year: parseInt(year),
          plateNo,
          type: vehicleType || 'MOTORCYCLE',
          isElectric: isElectric ?? true,
          purchasePrice: parseFloat(purchasePrice) || 0,
          creditMonthlyDeduction: parseFloat(creditMonthlyDeduction) || 0,
          creditWeeksRemaining: parseInt(creditWeeksRemaining) || 0,
        },
      });
    }

    return res.json(success('KYC submitted for review', { kycStatus: updated.kycStatus }));
  } catch (err) {
    console.error('submitKYC error:', err);
    return res.status(500).json(error('Failed to submit KYC', err.message));
  }
};

/**
 * PUT /api/drivers/online-status
 * Toggle driver online/offline
 */
const toggleOnline = async (req, res) => {
  const userId = req.user.id;
  const { isOnline, lat, lng } = req.body;
  const io = req.app.get('io');

  try {
    const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!driverProfile) return res.status(404).json(error('Driver profile not found'));

    if (isOnline && driverProfile.kycStatus !== 'APPROVED') {
      return res.status(403).json(error('KYC must be approved to go online'));
    }

    const updated = await prisma.driverProfile.update({
      where: { userId },
      data: {
        isOnline,
        currentLat: lat || driverProfile.currentLat,
        currentLng: lng || driverProfile.currentLng,
      },
    });

    io.emit('driver:status_change', {
      driverId: userId,
      isOnline,
      lat: updated.currentLat,
      lng: updated.currentLng,
    });

    return res.json(success(`Driver is now ${isOnline ? 'online' : 'offline'}`, {
      isOnline: updated.isOnline,
      currentLat: updated.currentLat,
      currentLng: updated.currentLng,
    }));
  } catch (err) {
    console.error('toggleOnline error:', err);
    return res.status(500).json(error('Failed to update online status', err.message));
  }
};

/**
 * GET /api/drivers/earnings
 * Summary earnings: daily, weekly, monthly
 */
const getEarnings = async (req, res) => {
  const userId = req.user.id;
  const { period = 'daily' } = req.query;

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { wallet: true },
    });
    if (!driverProfile) return res.status(404).json(error('Driver profile not found'));
    if (!driverProfile.wallet) return res.status(404).json(error('Wallet not found'));

    const now = new Date();
    let startDate;

    if (period === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'weekly') {
      const dayOfWeek = now.getDay();
      startDate = new Date(now);
      startDate.setDate(now.getDate() - dayOfWeek);
      startDate.setHours(0, 0, 0, 0);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const transactions = await prisma.walletTransaction.findMany({
      where: {
        walletId: driverProfile.wallet.id,
        type: 'EARNING',
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalEarnings = transactions.reduce((sum, t) => sum + t.amount, 0);
    const completedOrders = transactions.length;

    // Group by day for chart data
    const dailyBreakdown = {};
    transactions.forEach((t) => {
      const day = t.createdAt.toISOString().slice(0, 10);
      dailyBreakdown[day] = (dailyBreakdown[day] || 0) + t.amount;
    });

    return res.json(success('Earnings retrieved', {
      period,
      startDate,
      totalEarnings,
      completedOrders,
      walletBalance: driverProfile.wallet.balance,
      allTimeEarnings: driverProfile.wallet.totalEarnings,
      dailyBreakdown,
      transactions,
    }));
  } catch (err) {
    console.error('getEarnings error:', err);
    return res.status(500).json(error('Failed to get earnings', err.message));
  }
};

/**
 * GET /api/drivers/wallet
 */
const getWallet = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { wallet: true },
    });
    if (!driverProfile?.wallet) return res.status(404).json(error('Wallet not found'));

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { walletId: driverProfile.wallet.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: { order: { select: { pickupAddress: true, destAddress: true } } },
      }),
      prisma.walletTransaction.count({ where: { walletId: driverProfile.wallet.id } }),
    ]);

    return res.json(success('Wallet retrieved', {
      wallet: driverProfile.wallet,
      transactions,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    }));
  } catch (err) {
    console.error('getWallet error:', err);
    return res.status(500).json(error('Failed to get wallet', err.message));
  }
};

/**
 * GET /api/drivers/credit-status
 * Vehicle credit/cicilan information
 */
const getCreditStatus = async (req, res) => {
  const userId = req.user.id;

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { vehicle: true, wallet: true },
    });
    if (!driverProfile) return res.status(404).json(error('Driver profile not found'));

    const vehicle = driverProfile.vehicle;
    if (!vehicle) return res.status(404).json(error('No vehicle registered'));

    const creditHistory = await prisma.walletTransaction.findMany({
      where: {
        walletId: driverProfile.wallet?.id,
        type: 'CREDIT_DEDUCTION',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const totalPaidAmount = vehicle.creditPaidTotal;
    const remainingAmount = Math.max(0, vehicle.purchasePrice - totalPaidAmount);
    const estimatedWeeksToPayoff = vehicle.creditMonthlyDeduction > 0
      ? Math.ceil((remainingAmount / (vehicle.creditMonthlyDeduction / 4)))
      : 0;

    return res.json(success('Credit status retrieved', {
      vehicle: {
        brand: vehicle.brand,
        model: vehicle.model,
        plateNo: vehicle.plateNo,
        isElectric: vehicle.isElectric,
      },
      credit: {
        purchasePrice: vehicle.purchasePrice,
        creditPaidTotal: totalPaidAmount,
        remainingAmount,
        weeklyDeduction: vehicle.creditMonthlyDeduction / 4,
        monthlyDeduction: vehicle.creditMonthlyDeduction,
        weeksRemaining: vehicle.creditWeeksRemaining,
        estimatedWeeksToPayoff,
        isPaidOff: vehicle.creditWeeksRemaining <= 0,
      },
      creditHistory,
    }));
  } catch (err) {
    console.error('getCreditStatus error:', err);
    return res.status(500).json(error('Failed to get credit status', err.message));
  }
};

/**
 * POST /api/drivers/voucher/buy
 * Buy a charging voucher
 */
const buyChargingVoucher = async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json(error('Amount must be positive'));
  }

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { wallet: true },
    });
    if (!driverProfile) return res.status(404).json(error('Driver profile not found'));
    if (!driverProfile.wallet) return res.status(404).json(error('Wallet not found'));

    // Default: 10% discount for purchasing voucher
    const purchasePrice = amount * 0.9;

    if (driverProfile.wallet.balance < purchasePrice) {
      return res.status(400).json(error('Insufficient wallet balance to buy voucher'));
    }

    // Generate unique voucher code
    const voucherCode = `CHRG-${uuidv4().slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    const expiryDays = parseInt(process.env.VOUCHER_EXPIRY_DAYS, 10) || 30;
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    const [voucher] = await prisma.$transaction(async (tx) => {
      const newVoucher = await tx.chargingVoucher.create({
        data: {
          code: voucherCode,
          driverId: userId,
          amount: parseFloat(amount),
          status: 'ACTIVE',
          purchasePrice,
          expiresAt,
        },
      });

      // Deduct from wallet
      await tx.driverWallet.update({
        where: { id: driverProfile.wallet.id },
        data: { balance: { decrement: purchasePrice } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: driverProfile.wallet.id,
          type: 'CREDIT_DEDUCTION',
          amount: -purchasePrice,
          description: `Charging voucher purchase: ${voucherCode}`,
        },
      });

      return [newVoucher];
    });

    return res.status(201).json(success('Charging voucher purchased', {
      voucher: {
        id: voucher.id,
        code: voucher.code,
        amount: voucher.amount,
        purchasePrice: voucher.purchasePrice,
        status: voucher.status,
        expiresAt: voucher.expiresAt,
      },
    }));
  } catch (err) {
    console.error('buyChargingVoucher error:', err);
    return res.status(500).json(error('Failed to buy charging voucher', err.message));
  }
};

module.exports = {
  getProfile,
  updateProfile,
  submitKYC,
  toggleOnline,
  getEarnings,
  getWallet,
  getCreditStatus,
  buyChargingVoucher,
};
