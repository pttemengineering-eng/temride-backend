'use strict';

const crypto = require('crypto');

/**
 * Generate a 6-digit numeric OTP
 * @returns {string} 6-digit OTP as string
 */
function generateOTP() {
  // Use crypto for secure random
  const randomBytes = crypto.randomBytes(3); // 3 bytes = 0-16777215
  const num = randomBytes.readUIntBE(0, 3) % 1000000;
  return num.toString().padStart(6, '0');
}

/**
 * Generate a numeric OTP of custom length
 * @param {number} length
 * @returns {string}
 */
function generateOTPOfLength(length = 6) {
  const max = Math.pow(10, length);
  const bytes = Math.ceil(Math.log2(max) / 8);
  const randomBytes = crypto.randomBytes(bytes);
  const num = randomBytes.readUIntBE(0, bytes) % max;
  return num.toString().padStart(length, '0');
}

/**
 * Check if OTP is expired
 * @param {Date} expiresAt
 * @returns {boolean}
 */
function isOTPExpired(expiresAt) {
  return new Date() > new Date(expiresAt);
}

/**
 * Get OTP expiry Date object
 * @param {number} minutesFromNow
 * @returns {Date}
 */
function getOTPExpiry(minutesFromNow = 5) {
  return new Date(Date.now() + minutesFromNow * 60 * 1000);
}

module.exports = { generateOTP, generateOTPOfLength, isOTPExpired, getOTPExpiry };
