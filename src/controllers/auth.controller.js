'use strict';

const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { generateOTP } = require('../utils/otp.helper');
const { success, error, validationError } = require('../utils/response.helper');
const { sendWhatsAppOTP } = require('../services/whatsapp.service');

const prisma = new PrismaClient();

/**
 * POST /api/auth/send-otp
 * Generate and send OTP via WhatsApp (Fonnte)
 */
const sendOTP = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json(validationError(errors.array()));

  const { phone, purpose = 'LOGIN' } = req.body;

  try {
    // Invalidate previous unused OTPs for this phone+purpose
    await prisma.oTPCode.updateMany({
      where: { phone, purpose, isUsed: false },
      data: { isUsed: true },
    });

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await prisma.oTPCode.create({
      data: { phone, code, purpose, expiresAt },
    });

    // Send via WhatsApp
    const waResult = await sendWhatsAppOTP(phone, code);

    if (process.env.NODE_ENV !== 'production') {
      // Expose OTP in dev for easy testing
      return res.json(success('OTP sent successfully', { otpDev: code, expiresAt }));
    }

    return res.json(success('OTP sent to your WhatsApp number', { expiresAt }));
  } catch (err) {
    console.error('sendOTP error:', err);
    return res.status(500).json(error('Failed to send OTP', err.message));
  }
};

/**
 * POST /api/auth/verify-otp
 * Verify OTP and return JWT if valid
 */
const verifyOTP = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json(validationError(errors.array()));

  const { phone, code, purpose = 'LOGIN' } = req.body;

  try {
    const otpRecord = await prisma.oTPCode.findFirst({
      where: {
        phone,
        code,
        purpose,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      return res.status(400).json(error('Invalid or expired OTP'));
    }

    // Mark OTP as used
    await prisma.oTPCode.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    // Find or create user
    let user = await prisma.user.findUnique({ where: { phone } });

    if (!user && purpose === 'LOGIN') {
      return res.status(404).json(error('User not found. Please register first.'));
    }

    if (!user && purpose === 'REGISTER') {
      // User will be created in /register — just return OTP verified
      return res.json(success('OTP verified. Proceed to complete registration.', { phone, verified: true }));
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, phone: user.phone, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json(success('Login successful', {
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    }));
  } catch (err) {
    console.error('verifyOTP error:', err);
    return res.status(500).json(error('OTP verification failed', err.message));
  }
};

/**
 * POST /api/auth/register
 * Create a new user account
 */
const register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json(validationError(errors.array()));

  const { phone, name, email, role = 'PASSENGER' } = req.body;

  try {
    // Check existing user
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return res.status(409).json(error('Phone number already registered'));
    }

    if (email) {
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) {
        return res.status(409).json(error('Email already registered'));
      }
    }

    // Create user
    const user = await prisma.user.create({
      data: { phone, name, email, role },
    });

    // If registering as driver, create DriverProfile + Wallet
    if (role === 'DRIVER') {
      const driverProfile = await prisma.driverProfile.create({
        data: { userId: user.id },
      });
      await prisma.driverWallet.create({
        data: { driverId: driverProfile.id },
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, phone: user.phone, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(201).json(success('Registration successful', {
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
      },
    }));
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json(error('Registration failed', err.message));
  }
};

/**
 * POST /api/auth/login
 * Trigger OTP send — actual auth happens in verify-otp
 */
const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json(validationError(errors.array()));

  const { phone } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(404).json(error('Phone number not registered. Please register first.'));
    }

    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      return res.status(403).json(error(`Account is ${user.status.toLowerCase()}. Contact support.`));
    }

    // Send OTP
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.oTPCode.updateMany({
      where: { phone, purpose: 'LOGIN', isUsed: false },
      data: { isUsed: true },
    });

    await prisma.oTPCode.create({
      data: { phone, code, purpose: 'LOGIN', expiresAt, userId: user.id },
    });

    await sendWhatsAppOTP(phone, code);

    if (process.env.NODE_ENV !== 'production') {
      return res.json(success('OTP sent. Verify to complete login.', { otpDev: code, expiresAt }));
    }

    return res.json(success('OTP sent to your WhatsApp. Please verify to login.', { expiresAt }));
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json(error('Login failed', err.message));
  }
};

module.exports = { sendOTP, verifyOTP, register, login };
