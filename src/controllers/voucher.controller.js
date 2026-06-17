'use strict';

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * POST /api/vouchers/buy
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

module.exports = { buyVoucher, redeemVoucher, getMyVouchers };
