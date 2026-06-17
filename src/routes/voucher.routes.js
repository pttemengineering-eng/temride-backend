'use strict';

const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucher.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isDriver } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(isDriver);

// POST /api/vouchers/buy — Buy charging voucher
router.post('/buy', voucherController.buyVoucher);

// POST /api/vouchers/redeem — Redeem charging voucher
router.post('/redeem', voucherController.redeemVoucher);

// GET /api/vouchers/my-vouchers — List driver's vouchers
router.get('/my-vouchers', voucherController.getMyVouchers);

module.exports = router;
