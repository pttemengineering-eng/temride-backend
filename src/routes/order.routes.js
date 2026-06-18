'use strict';

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isPassenger, isDriver } = require('../middleware/role.middleware');

router.use(authenticate);

// POST /api/orders/request — Passenger requests a ride
router.post('/request', isPassenger, orderController.requestOrder);

// GET /api/orders/:id — Get order detail
router.get('/:id', orderController.getOrder);

// POST /api/orders/:id/accept — Driver accepts order
router.post('/:id/accept', isDriver, orderController.acceptOrder);

// POST /api/orders/:id/arrived — Driver arrived at pickup
router.post('/:id/arrived', isDriver, orderController.driverArrived);

// POST /api/orders/:id/start — Driver starts trip
router.post('/:id/start', isDriver, orderController.startTrip);

// POST /api/orders/:id/complete — Driver completes trip
router.post('/:id/complete', isDriver, orderController.completeOrder);

// POST /api/orders/:id/cancel — Cancel order (passenger or driver)
router.post('/:id/cancel', orderController.cancelOrder);

// POST /api/orders/:id/sos — SOS/Emergency button (passenger only)
router.post('/:id/sos', isPassenger, orderController.sosEmergency);

module.exports = router;
