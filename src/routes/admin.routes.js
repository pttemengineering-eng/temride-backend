'use strict';

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const voucherController = require('../controllers/voucher.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(isAdmin);

// ─── Dashboard ────────────────────────────────────────────────────────────────
// GET /api/admin/dashboard-stats
router.get('/dashboard-stats', adminController.getDashboardStats);

// ─── Revenue ──────────────────────────────────────────────────────────────────
// GET /api/admin/revenue
router.get('/revenue', adminController.getRevenue);

// ─── Drivers ─────────────────────────────────────────────────────────────────
// GET /api/admin/drivers — List all drivers + status + rating
router.get('/drivers', adminController.getAllDrivers);

// GET /api/admin/drivers/:driverId/metrics — Driver performance metrics
router.get('/drivers/:driverId/metrics', adminController.getDriverMetrics);

// POST /api/admin/drivers — Add driver manually
router.post('/drivers', adminController.addDriver);

// PATCH /api/admin/drivers/:id/verify — Approve/reject driver
router.patch('/drivers/:id/verify', adminController.verifyDriver);

// PUT /api/admin/drivers/:id/approve — Legacy alias
router.put('/drivers/:id/approve', adminController.approveDriver);

// ─── Orders ───────────────────────────────────────────────────────────────────
// GET /api/admin/orders — All orders with filter
router.get('/orders', adminController.getAllOrders);

// ─── Restaurants ─────────────────────────────────────────────────────────────
// GET /api/admin/restaurants — Manage restaurants
router.get('/restaurants', adminController.getAdminRestaurants);

// ─── GoSend ───────────────────────────────────────────────────────────────────
// GET /api/admin/gosend — Manage GoSend orders
router.get('/gosend', adminController.getAdminGoSend);

// GET /api/admin/food-orders — TFood orders
router.get('/food-orders', adminController.getAdminFoodOrders);

// GET /api/admin/vouchers-list — List all vouchers/promo codes
router.get('/vouchers-list', adminController.getAdminVouchers);

// ─── Users ────────────────────────────────────────────────────────────────────
// GET /api/admin/passengers — List all passengers
router.get('/passengers', adminController.getAllPassengers);

// DELETE /api/admin/users/:id — Delete/ban user
router.delete('/users/:id', adminController.deleteUser);

// ─── Withdrawals ─────────────────────────────────────────────────────────────
// GET /api/admin/withdrawals — List withdrawal requests
router.get('/withdrawals', adminController.getWithdrawalRequests);

// PATCH /api/admin/withdrawals/:id — Approve or reject withdrawal
router.patch('/withdrawals/:id', adminController.processWithdrawal);

// ─── Vouchers / Promo Codes ───────────────────────────────────────────────────
// POST /api/admin/vouchers — Create promo code
router.post('/vouchers', voucherController.createPromoCode);

module.exports = router;
