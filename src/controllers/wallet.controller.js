'use strict';

const { PrismaClient } = require('@prisma/client');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

/**
 * GET /api/wallet/balance
 * Get driver wallet balance and summary
 */
const getWalletBalance = async (req, res) => {
  const userId = req.user.id;

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { wallet: true },
    });

    if (!driverProfile) {
      return res.status(404).json(error('Driver profile not found'));
    }

    // Auto-create wallet if not exists
    let wallet = driverProfile.wallet;
    if (!wallet) {
      wallet = await prisma.driverWallet.create({
        data: { driverId: driverProfile.id },
      });
    }

    return res.json(success('Wallet balance retrieved', {
      wallet: {
        id: wallet.id,
        balance: wallet.balance,
        totalEarnings: wallet.totalEarnings,
        totalWithdrawn: wallet.totalWithdrawn,
        totalCreditDeducted: wallet.totalCreditDeducted,
        updatedAt: wallet.updatedAt,
      },
    }));
  } catch (err) {
    console.error('getWalletBalance error:', err);
    return res.status(500).json(error('Failed to get wallet balance', err.message));
  }
};

/**
 * GET /api/wallet/transactions
 * Get wallet transaction history for driver
 */
const getWalletTransactions = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, type } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { wallet: true },
    });

    if (!driverProfile?.wallet) {
      return res.status(404).json(error('Wallet not found'));
    }

    const where = { walletId: driverProfile.wallet.id };
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          order: { select: { id: true, pickupAddress: true, destAddress: true } },
        },
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    return res.json(success('Transactions retrieved', {
      transactions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }));
  } catch (err) {
    console.error('getWalletTransactions error:', err);
    return res.status(500).json(error('Failed to get transactions', err.message));
  }
};

/**
 * POST /api/wallet/withdraw
 * Request withdrawal to bank account
 */
const requestWithdrawal = async (req, res) => {
  const userId = req.user.id;
  const { amount, bankName, accountNumber, accountName } = req.body;

  if (!amount || !bankName || !accountNumber || !accountName) {
    return res.status(400).json(error('Missing required fields: amount, bankName, accountNumber, accountName'));
  }

  const withdrawAmount = parseFloat(amount);
  if (withdrawAmount <= 0) {
    return res.status(400).json(error('Invalid withdrawal amount'));
  }

  const MIN_WITHDRAW = parseFloat(process.env.MIN_WITHDRAWAL) || 50000;
  if (withdrawAmount < MIN_WITHDRAW) {
    return res.status(400).json(error(`Minimum withdrawal is Rp ${MIN_WITHDRAW.toLocaleString('id-ID')}`));
  }

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { wallet: true },
    });

    if (!driverProfile?.wallet) {
      return res.status(404).json(error('Wallet not found'));
    }

    if (driverProfile.wallet.balance < withdrawAmount) {
      return res.status(400).json(error(
        `Insufficient balance. Available: Rp ${driverProfile.wallet.balance.toLocaleString('id-ID')}`
      ));
    }

    // Check for pending withdrawal
    const pendingWithdrawal = await prisma.withdrawalRequest.findFirst({
      where: { walletId: driverProfile.wallet.id, status: 'PENDING' },
    });
    if (pendingWithdrawal) {
      return res.status(409).json(error('You already have a pending withdrawal request'));
    }

    // Create withdrawal request and deduct balance atomically
    const [withdrawal] = await prisma.$transaction(async (tx) => {
      const w = await tx.withdrawalRequest.create({
        data: {
          walletId: driverProfile.wallet.id,
          amount: withdrawAmount,
          bankName,
          accountNumber,
          accountName,
          status: 'PENDING',
        },
      });

      await tx.driverWallet.update({
        where: { id: driverProfile.wallet.id },
        data: {
          balance: { decrement: withdrawAmount },
          totalWithdrawn: { increment: withdrawAmount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: driverProfile.wallet.id,
          type: 'WITHDRAWAL',
          amount: -withdrawAmount,
          description: `Withdrawal to ${bankName} - ${accountNumber}`,
        },
      });

      return [w];
    });

    return res.status(201).json(success('Withdrawal request submitted', {
      withdrawal: {
        id: withdrawal.id,
        amount: withdrawal.amount,
        bankName: withdrawal.bankName,
        accountNumber: withdrawal.accountNumber,
        accountName: withdrawal.accountName,
        status: withdrawal.status,
        createdAt: withdrawal.createdAt,
      },
      message: 'Your withdrawal request is being processed (1-2 business days)',
    }));
  } catch (err) {
    console.error('requestWithdrawal error:', err);
    return res.status(500).json(error('Failed to request withdrawal', err.message));
  }
};

/**
 * GET /api/wallet/withdrawals
 * Get withdrawal history
 */
const getWithdrawals = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { wallet: true },
    });

    if (!driverProfile?.wallet) {
      return res.status(404).json(error('Wallet not found'));
    }

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where: { walletId: driverProfile.wallet.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.withdrawalRequest.count({ where: { walletId: driverProfile.wallet.id } }),
    ]);

    return res.json(success('Withdrawals retrieved', {
      withdrawals,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }));
  } catch (err) {
    console.error('getWithdrawals error:', err);
    return res.status(500).json(error('Failed to get withdrawals', err.message));
  }
};

module.exports = { getWalletBalance, getWalletTransactions, requestWithdrawal, getWithdrawals };
