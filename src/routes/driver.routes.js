'use strict';

const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driver.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isDriver } = require('../middleware/role.middleware');

// All routes require authentication and driver role
router.use(authenticate);
router.use(isDriver);

// GET /api/drivers/profile
router.get('/profile', driverController.getProfile);

// PUT /api/drivers/profile
router.put('/profile', driverController.updateProfile);

// POST /api/drivers/kyc
router.post('/kyc', driverController.submitKYC);

// PUT /api/drivers/online-status
router.put('/online-status', driverController.toggleOnline);

// GET /api/drivers/earnings
router.get('/earnings', driverController.getEarnings);

// GET /api/drivers/wallet
router.get('/wallet', driverController.getWallet);

// GET /api/drivers/credit-status
router.get('/credit-status', driverController.getCreditStatus);

// POST /api/drivers/voucher/buy
router.post('/voucher/buy', driverController.buyChargingVoucher);

module.exports = router;
