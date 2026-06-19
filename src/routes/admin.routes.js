'use strict';

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const voucherController = require('../controllers/voucher.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin } = require('../middleware/role.middleware');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ─── Admin Login (public — no auth required) ──────────────────────────────────
// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@temride.id';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    if (email !== ADMIN_EMAIL) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Support both plain-text and bcrypt-hashed passwords
    let passwordValid = false;
    if (ADMIN_PASSWORD.startsWith('$2')) {
      // bcrypt hash
      passwordValid = await bcrypt.compare(password, ADMIN_PASSWORD);
    } else {
      // plain-text (dev only)
      passwordValid = password === ADMIN_PASSWORD;
    }

    if (!passwordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Find or create admin user in DB so authenticate middleware can resolve userId
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    let adminUser = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL, role: 'ADMIN' } });
    if (!adminUser) {
      // Create a synthetic admin user record (no phone required — use placeholder)
      adminUser = await prisma.user.create({
        data: {
          phone: 'admin-' + Date.now(),
          email: ADMIN_EMAIL,
          name: 'Admin TemRide',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
    }
    await prisma.$disconnect();

    const token = jwt.sign(
      { userId: adminUser.id, email: ADMIN_EMAIL, role: 'ADMIN' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        token,
        admin: { id: adminUser.id, email: ADMIN_EMAIL, role: 'ADMIN' },
      },
    });
  } catch (err) {
    console.error('admin login error:', err);
    return res.status(500).json({ success: false, message: 'Login failed', error: err.message });
  }
});

// ─── All routes below require authentication + admin role ─────────────────────
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

