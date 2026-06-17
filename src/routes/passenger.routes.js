'use strict';

const express = require('express');
const router = express.Router();
const passengerController = require('../controllers/passenger.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isPassenger } = require('../middleware/role.middleware');

// All routes require authentication and passenger role
router.use(authenticate);
router.use(isPassenger);

// GET /api/passengers/profile
router.get('/profile', passengerController.getProfile);

// PUT /api/passengers/profile
router.put('/profile', passengerController.updateProfile);

// GET /api/passengers/order-history
router.get('/order-history', passengerController.getOrderHistory);

module.exports = router;
