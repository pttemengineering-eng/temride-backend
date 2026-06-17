'use strict';

const { PrismaClient } = require('@prisma/client');
const midtransClient = require('midtrans-client');
const crypto = require('crypto');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

// Midtrans Snap client
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Midtrans Core API (for webhook verification)
const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

/**
 * POST /api/payments/create
 * Create Midtrans Snap transaction for an order
 */
const createPayment = async (req, res) => {
  const { orderId } = req.body;
  const userId = req.user.id;

  if (!orderId) return res.status(400).json(error('orderId is required'));

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { passenger: true },
    });

    if (!order) return res.status(404).json(error('Order not found'));
    if (order.passengerId !== userId) return res.status(403).json(error('Access denied'));
    if (order.paymentStatus !== 'PENDING') {
      return res.status(409).json(error(`Payment already ${order.paymentStatus}`));
    }

    // Check for existing payment record
    const existingPayment = await prisma.payment.findUnique({ where: { orderId } });
    if (existingPayment && existingPayment.status === 'SUCCESS') {
      return res.status(409).json(error('Order already paid'));
    }

    const midtransOrderId = `TEMRIDE-${orderId.slice(0, 8)}-${Date.now()}`;

    const parameter = {
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: Math.round(order.totalFare),
      },
      customer_details: {
        first_name: order.passenger.name || 'Passenger',
        phone: order.passenger.phone,
        email: order.passenger.email || `${order.passenger.phone}@temride.id`,
      },
      item_details: [
        {
          id: orderId,
          price: Math.round(order.totalFare),
          quantity: 1,
          name: `TemRide - ${order.pickupAddress} → ${order.destAddress}`,
        },
      ],
      enabled_payments: getEnabledPaymentChannels(order.paymentMethod),
      callbacks: {
        finish: `${process.env.APP_FRONTEND_URL || 'https://temride.id'}/payment/finish`,
        error: `${process.env.APP_FRONTEND_URL || 'https://temride.id'}/payment/error`,
        pending: `${process.env.APP_FRONTEND_URL || 'https://temride.id'}/payment/pending`,
      },
    };

    const transaction = await snap.createTransaction(parameter);

    // Upsert payment record
    const payment = await prisma.payment.upsert({
      where: { orderId },
      update: {
        midtransOrderId,
        midtransToken: transaction.token,
        snapUrl: transaction.redirect_url,
        status: 'PENDING',
      },
      create: {
        orderId,
        userId,
        amount: order.totalFare,
        method: order.paymentMethod,
        status: 'PENDING',
        midtransOrderId,
        midtransToken: transaction.token,
        snapUrl: transaction.redirect_url,
      },
    });

    return res.json(success('Payment created', {
      paymentId: payment.id,
      snapToken: transaction.token,
      redirectUrl: transaction.redirect_url,
      orderId,
      amount: order.totalFare,
    }));
  } catch (err) {
    console.error('createPayment error:', err);
    return res.status(500).json(error('Failed to create payment', err.message));
  }
};

/**
 * POST /api/payments/webhook
 * Midtrans notification handler — NO authentication required
 */
const handleWebhook = async (req, res) => {
  try {
    const notification = JSON.parse(
      Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body)
    );

    const { order_id: midtransOrderId, transaction_status, fraud_status, signature_key, gross_amount } = notification;

    // Verify Midtrans signature
    const expectedSignature = crypto
      .createHash('sha512')
      .update(`${midtransOrderId}${notification.status_code}${gross_amount}${process.env.MIDTRANS_SERVER_KEY}`)
      .digest('hex');

    if (signature_key !== expectedSignature) {
      console.warn('Invalid Midtrans signature for order:', midtransOrderId);
      return res.status(400).json(error('Invalid signature'));
    }

    // Find payment
    const payment = await prisma.payment.findFirst({
      where: { midtransOrderId },
      include: { order: true },
    });

    if (!payment) {
      console.warn('Payment not found for midtrans order:', midtransOrderId);
      return res.status(404).json(error('Payment not found'));
    }

    // Determine new status
    let newPaymentStatus = payment.status;
    let paidAt = null;

    if (transaction_status === 'capture' || transaction_status === 'settlement') {
      if (fraud_status === 'accept' || !fraud_status) {
        newPaymentStatus = 'SUCCESS';
        paidAt = new Date();
      }
    } else if (transaction_status === 'cancel' || transaction_status === 'deny' || transaction_status === 'expire') {
      newPaymentStatus = 'FAILED';
    } else if (transaction_status === 'refund' || transaction_status === 'partial_refund') {
      newPaymentStatus = 'REFUNDED';
    }

    // Update payment
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: newPaymentStatus, paidAt },
    });

    // Update order payment status
    await prisma.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: newPaymentStatus },
    });

    // If payment successful, trigger earnings split for CASH-less orders
    if (newPaymentStatus === 'SUCCESS' && payment.order.paymentMethod !== 'CASH') {
      await triggerEarningsSplit(payment.order);
    }

    return res.json({ status: 'OK' });
  } catch (err) {
    console.error('handleWebhook error:', err);
    return res.status(500).json(error('Webhook processing failed', err.message));
  }
};

/**
 * Credit driver earnings after successful digital payment
 */
async function triggerEarningsSplit(order) {
  try {
    if (!order.driverId || order.status !== 'COMPLETED') return;

    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: order.driverId },
      include: { wallet: true },
    });

    if (!driverProfile?.wallet) return;

    // Check if already credited (idempotency)
    const alreadyCredited = await prisma.walletTransaction.findFirst({
      where: { walletId: driverProfile.wallet.id, orderId: order.id, type: 'EARNING' },
    });
    if (alreadyCredited) return;

    await prisma.driverWallet.update({
      where: { id: driverProfile.wallet.id },
      data: {
        balance: { increment: order.driverEarnings },
        totalEarnings: { increment: order.driverEarnings },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: driverProfile.wallet.id,
        type: 'EARNING',
        amount: order.driverEarnings,
        description: `Digital payment received for order #${order.id.slice(0, 8)}`,
        orderId: order.id,
      },
    });
  } catch (err) {
    console.error('triggerEarningsSplit error:', err);
  }
}

/**
 * GET /api/payments/history
 */
const getPaymentHistory = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: { userId },
        include: {
          order: {
            select: { pickupAddress: true, destAddress: true, distance: true, totalFare: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.payment.count({ where: { userId } }),
    ]);

    return res.json(success('Payment history retrieved', {
      payments,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    }));
  } catch (err) {
    console.error('getPaymentHistory error:', err);
    return res.status(500).json(error('Failed to get payment history', err.message));
  }
};

/**
 * Get enabled payment channels based on preferred method
 */
function getEnabledPaymentChannels(method) {
  const channelMap = {
    GOPAY: ['gopay'],
    OVO: ['other_qris'],
    DANA: ['other_qris'],
    QRIS: ['other_qris', 'gopay'],
    VA_BNI: ['bni_va'],
    VA_BRI: ['bri_va'],
    VA_MANDIRI: ['echannel'],
    CASH: [],
  };
  return channelMap[method] || ['credit_card', 'gopay', 'other_qris', 'bni_va', 'bri_va', 'echannel'];
}

module.exports = { createPayment, handleWebhook, getPaymentHistory };
