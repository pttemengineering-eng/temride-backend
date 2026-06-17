'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { validateSendOTP, validateVerifyOTP, validateRegister, validateLogin } = require('../middleware/validation.middleware');

// POST /api/auth/send-otp
router.post('/send-otp', validateSendOTP, authController.sendOTP);

// POST /api/auth/verify-otp
router.post('/verify-otp', validateVerifyOTP, authController.verifyOTP);

// POST /api/auth/register
router.post('/register', validateRegister, authController.register);

// POST /api/auth/login
router.post('/login', validateLogin, authController.login);

module.exports = router;
