'use strict';

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticate } = require('../middleware/auth.middleware');

// POST /api/payments/create — Create Midtrans Snap transaction
router.post('/create', authenticate, paymentController.createPayment);

// POST /api/payments/webhook — Midtrans notification (no auth required — Midtrans calls this)
router.post('/webhook', paymentController.handleWebhook);

// GET /api/payments/history — Payment history for logged in user
router.get('/history', authenticate, paymentController.getPaymentHistory);

module.exports = router;
