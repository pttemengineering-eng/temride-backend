'use strict';

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * POST /api/vouchers/buy
 * Driver buys a charging voucher from wallet balance
 */
const buyVoucher = async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;

  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json(error('Valid amount is required'));
  }

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { wallet: true },
    });
    if (!driverProfile?.wallet) return res.status(404).json(error('Wallet not found'));

    const purchasePrice = parseFloat(amount) * 0.9; // 10% discount
    if (driverProfile.wallet.balance < purchasePrice) {
      return res.status(400).json(error(`Insufficient balance. Need Rp ${purchasePrice.toLocaleString()}, have Rp ${driverProfile.wallet.balance.toLocaleString()}`));
    }

    const code = `CHRG-${uuidv4().slice(0, 8).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + (parseInt(process.env.VOUCHER_EXPIRY_DAYS) || 30) * 86400 * 1000);

    const [voucher] = await prisma.$transaction(async (tx) => {
      const v = await tx.chargingVoucher.create({
        data: { code, driverId: userId, amount: parseFloat(amount), status: 'ACTIVE', purchasePrice, expiresAt },
      });
      await tx.driverWallet.update({
        where: { id: driverProfile.wallet.id },
        data: { balance: { decrement: purchasePrice } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: driverProfile.wallet.id,
          type: 'CREDIT_DEDUCTION',
          amount: -purchasePrice,
          description: `Purchased charging voucher ${code}`,
        },
      });
      return [v];
    });

    return res.status(201).json(success('Voucher purchased', { voucher }));
  } catch (err) {
    console.error('buyVoucher error:', err);
    return res.status(500).json(error('Failed to buy voucher', err.message));
  }
};

/**
 * POST /api/vouchers/redeem
 * Redeem a charging voucher
 */
const redeemVoucher = async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json(error('Voucher code is required'));

  try {
    const voucher = await prisma.chargingVoucher.findUnique({ where: { code } });
    if (!voucher) return res.status(404).json(error('Voucher not found'));
    if (voucher.status === 'USED') return res.status(409).json(error('Voucher already used'));
    if (voucher.status === 'EXPIRED' || voucher.expiresAt < new Date()) {
      await prisma.chargingVoucher.update({ where: { code }, data: { status: 'EXPIRED' } });
      return res.status(410).json(error('Voucher has expired'));
    }

    const updated = await prisma.chargingVoucher.update({
      where: { code },
      data: { status: 'USED', usedAt: new Date() },
    });

    return res.json(success('Voucher redeemed successfully', {
      voucher: { code: updated.code, amount: updated.amount, usedAt: updated.usedAt },
    }));
  } catch (err) {
    console.error('redeemVoucher error:', err);
    return res.status(500).json(error('Failed to redeem voucher', err.message));
  }
};

/**
 * GET /api/vouchers/my-vouchers
 * List driver's charging vouchers
 */
const getMyVouchers = async (req, res) => {
  const userId = req.user.id;
  const { status } = req.query;

  const where = { driverId: userId };
  if (status) where.status = status;

  try {
    // Expire any outdated vouchers
    await prisma.chargingVoucher.updateMany({
      where: { driverId: userId, status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    const vouchers = await prisma.chargingVoucher.findMany({
      where,
      orderBy: { purchasedAt: 'desc' },
    });

    return res.json(success('Vouchers retrieved', { vouchers, total: vouchers.length }));
  } catch (err) {
    console.error('getMyVouchers error:', err);
    return res.status(500).json(error('Failed to get vouchers', err.message));
  }
};

// ─── PROMO CODE ENDPOINTS ─────────────────────────────────────────────────────

/**
 * POST /api/vouchers/validate
 * Validate a promo code for an order
 */
const validatePromoCode = async (req, res) => {
  const { code, orderAmount } = req.body;

  if (!code) return res.status(400).json(error('Promo code is required'));

  try {
    const promo = await prisma.promoCode.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });

    if (!promo) {
      return res.status(404).json(error('Promo code not found or expired'));
    }

    if (promo.usedCount >= promo.usageLimit) {
      return res.status(409).json(error('Promo code usage limit reached'));
    }

    const orderAmt = parseFloat(orderAmount) || 0;
    if (promo.minOrder > 0 && orderAmt < promo.minOrder) {
      return res.status(400).json(error(
        `Minimum order for this promo is Rp ${promo.minOrder.toLocaleString('id-ID')}`
      ));
    }

    // Calculate discount
    let discountAmount = 0;
    if (promo.type === 'PERCENT') {
      discountAmount = (orderAmt * promo.value) / 100;
      if (promo.maxDiscount) {
        discountAmount = Math.min(discountAmount, promo.maxDiscount);
      }
    } else {
      discountAmount = Math.min(promo.value, orderAmt);
    }

    discountAmount = Math.round(discountAmount);
    const finalAmount = Math.max(0, orderAmt - discountAmount);

    return res.json(success('Promo code valid', {
      promo: {
        code: promo.code,
        type: promo.type,
        value: promo.value,
        description: promo.description,
        maxDiscount: promo.maxDiscount,
        expiresAt: promo.expiresAt,
      },
      discount: discountAmount,
      finalAmount,
      originalAmount: orderAmt,
    }));
  } catch (err) {
    console.error('validatePromoCode error:', err);
    return res.status(500).json(error('Failed to validate promo code', err.message));
  }
};

/**
 * GET /api/vouchers/active
 * List active promo codes available for users
 */
const getActivePromos = async (req, res) => {
  try {
    const promos = await prisma.promoCode.findMany({
      where: {
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        maxDiscount: true,
        minOrder: true,
        description: true,
        expiresAt: true,
        usageLimit: true,
        usedCount: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(success('Active promos retrieved', { promos, total: promos.length }));
  } catch (err) {
    console.error('getActivePromos error:', err);
    return res.status(500).json(error('Failed to get promos', err.message));
  }
};

/**
 * POST /api/admin/vouchers
 * Admin creates a new promo code
 */
const createPromoCode = async (req, res) => {
  const {
    code,
    type,
    value,
    maxDiscount,
    minOrder = 0,
    usageLimit = 100,
    expiresAt,
    description,
  } = req.body;

  if (!code || !type || !value || !expiresAt) {
    return res.status(400).json(error('Missing required fields: code, type, value, expiresAt'));
  }

  if (!['PERCENT', 'FIXED'].includes(type)) {
    return res.status(400).json(error('type must be PERCENT or FIXED'));
  }

  try {
    const existing = await prisma.promoCode.findUnique({ where: { code: code.toUpperCase() } });
    if (existing) return res.status(409).json(error('Promo code already exists'));

    const promo = await prisma.promoCode.create({
      data: {
        code: code.toUpperCase(),
        type,
        value: parseFloat(value),
        maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
        minOrder: parseFloat(minOrder),
        usageLimit: parseInt(usageLimit),
        expiresAt: new Date(expiresAt),
        description,
        isActive: true,
      },
    });

    return res.status(201).json(success('Promo code created', { promo }));
  } catch (err) {
    console.error('createPromoCode error:', err);
    return res.status(500).json(error('Failed to create promo code', err.message));
  }
};

module.exports = {
  buyVoucher,
  redeemVoucher,
  getMyVouchers,
  validatePromoCode,
  getActivePromos,
  createPromoCode,
};
