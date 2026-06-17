'use strict';

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(isAdmin);

// GET /api/admin/drivers — List all drivers with filters
router.get('/drivers', adminController.getAllDrivers);

// PUT /api/admin/drivers/:id/approve — Approve or reject driver KYC
router.put('/drivers/:id/approve', adminController.approveDriver);

// GET /api/admin/orders — List all orders with filters
router.get('/orders', adminController.getAllOrders);

// GET /api/admin/revenue — Revenue statistics
router.get('/revenue', adminController.getRevenue);

// GET /api/admin/dashboard-stats — Dashboard overview
router.get('/dashboard-stats', adminController.getDashboardStats);

module.exports = router;
