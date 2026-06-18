'use strict';

const express = require('express');
const router = express.Router();
const gosendController = require('../controllers/gosend.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

// POST /api/gosend/order — Create GoSend order
router.post('/order', gosendController.createGoSendOrder);

// GET /api/gosend/orders — List user's GoSend orders
router.get('/orders', gosendController.getMyGoSendOrders);

// GET /api/gosend/price-estimate — Estimate price
router.get('/price-estimate', gosendController.getPriceEstimate);

// GET /api/gosend/orders/:id — Get GoSend order detail
router.get('/orders/:id', gosendController.getGoSendOrderById);

// PATCH /api/gosend/orders/:id/status — Update GoSend order status
router.patch('/orders/:id/status', gosendController.updateGoSendStatus);

module.exports = router;
