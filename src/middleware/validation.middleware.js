'use strict';

const { body, param, query } = require('express-validator');

// ─── Auth Validations ────────────────────────────────────────────────────────

const validateSendOTP = [
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .isMobilePhone('id-ID').withMessage('Invalid Indonesian phone number')
    .customSanitizer((v) => v.replace(/^0/, '62').replace(/\s+/g, '')),
  body('purpose')
    .optional()
    .isIn(['LOGIN', 'REGISTER', 'RESET']).withMessage('Invalid purpose'),
];

const validateVerifyOTP = [
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .customSanitizer((v) => v.replace(/^0/, '62').replace(/\s+/g, '')),
  body('code')
    .notEmpty().withMessage('OTP code is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must be numeric'),
  body('purpose')
    .optional()
    .isIn(['LOGIN', 'REGISTER', 'RESET']).withMessage('Invalid purpose'),
];

const validateRegister = [
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .customSanitizer((v) => v.replace(/^0/, '62').replace(/\s+/g, '')),
  body('name')
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters')
    .trim(),
  body('email')
    .optional({ nullable: true, checkFalsy: true })
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  body('role')
    .optional()
    .isIn(['PASSENGER', 'DRIVER']).withMessage('Role must be PASSENGER or DRIVER'),
];

const validateLogin = [
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .customSanitizer((v) => v.replace(/^0/, '62').replace(/\s+/g, '')),
];

// ─── Order Validations ───────────────────────────────────────────────────────

const validateRequestOrder = [
  body('pickupLat').isFloat({ min: -90, max: 90 }).withMessage('Invalid pickup latitude'),
  body('pickupLng').isFloat({ min: -180, max: 180 }).withMessage('Invalid pickup longitude'),
  body('pickupAddress').notEmpty().withMessage('Pickup address is required').trim(),
  body('destLat').isFloat({ min: -90, max: 90 }).withMessage('Invalid destination latitude'),
  body('destLng').isFloat({ min: -180, max: 180 }).withMessage('Invalid destination longitude'),
  body('destAddress').notEmpty().withMessage('Destination address is required').trim(),
  body('paymentMethod')
    .optional()
    .isIn(['QRIS', 'GOPAY', 'OVO', 'DANA', 'VA_BNI', 'VA_BRI', 'VA_MANDIRI', 'CASH'])
    .withMessage('Invalid payment method'),
];

// ─── Rating Validations ──────────────────────────────────────────────────────

const validateSubmitRating = [
  body('orderId').isUUID().withMessage('Invalid order ID'),
  body('score')
    .isInt({ min: 1, max: 5 }).withMessage('Score must be between 1 and 5'),
  body('comment')
    .optional({ nullable: true })
    .isLength({ max: 500 }).withMessage('Comment max 500 characters')
    .trim(),
];

// ─── Voucher Validations ─────────────────────────────────────────────────────

const validateBuyVoucher = [
  body('amount')
    .isFloat({ min: 10000 }).withMessage('Minimum voucher amount is Rp 10.000'),
];

module.exports = {
  validateSendOTP,
  validateVerifyOTP,
  validateRegister,
  validateLogin,
  validateRequestOrder,
  validateSubmitRating,
  validateBuyVoucher,
};
