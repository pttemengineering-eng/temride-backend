'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/driverRegistration.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin } = require('../middleware/role.middleware');

// Public routes
router.post('/submit', ctrl.submitRegistration);
router.get('/status/:registrationNumber', ctrl.checkStatus);

// Admin routes
router.get('/', authenticate, isAdmin, ctrl.listApplications);
router.get('/:id', authenticate, isAdmin, ctrl.getApplicationDetail);
router.patch('/:id/review', authenticate, isAdmin, ctrl.reviewApplication);

module.exports = router;
