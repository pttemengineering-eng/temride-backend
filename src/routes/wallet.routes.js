'use strict';

const express = require('express');
const router = express.Router();
const walletController = require('../controllers/wallet.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isDriver } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(isDriver);

// GET /api/wallet/balance — Check driver balance
router.get('/balance', walletController.getWalletBalance);

// GET /api/wallet/transactions — Transaction history
router.get('/transactions', walletController.getWalletTransactions);

// POST /api/wallet/withdraw — Request withdrawal
router.post('/withdraw', walletController.requestWithdrawal);

// GET /api/wallet/withdrawals — Withdrawal history
router.get('/withdrawals', walletController.getWithdrawals);

module.exports = router;
