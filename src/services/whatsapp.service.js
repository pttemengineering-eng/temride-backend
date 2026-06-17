'use strict';

const axios = require('axios');

const FONNTE_API_URL = 'https://api.fonnte.com/send';

/**
 * Send WhatsApp message via Fonnte API
 * @param {string} phone - recipient phone number (e.g. "628123456789")
 * @param {string} message - text message
 * @returns {object} Fonnte response
 */
async function sendWhatsApp(phone, message) {
  const apiKey = process.env.FONNTE_API_KEY;

  if (!apiKey) {
    console.warn('[WhatsApp] FONNTE_API_KEY not configured — skipping WA message');
    console.log(`[WhatsApp Dev] Would send to ${phone}: ${message}`);
    return { skipped: true, phone, message };
  }

  try {
    const response = await axios.post(
      FONNTE_API_URL,
      {
        target: phone,
        message,
        countryCode: '62',
      },
      {
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    console.log(`[WhatsApp] Message sent to ${phone}:`, response.data);
    return response.data;
  } catch (err) {
    console.error('[WhatsApp] Failed to send message:', err.message);
    throw new Error(`WhatsApp send failed: ${err.message}`);
  }
}

/**
 * Send OTP via WhatsApp
 * @param {string} phone
 * @param {string} otp
 */
async function sendWhatsAppOTP(phone, otp) {
  const message =
    `🔐 *Kode OTP TemRide Anda*\n\n` +
    `Kode: *${otp}*\n\n` +
    `Berlaku selama 5 menit.\n` +
    `Jangan bagikan kode ini kepada siapapun.\n\n` +
    `_Tim TemRide_`;

  return sendWhatsApp(phone, message);
}

/**
 * Send order notification via WhatsApp
 * @param {string} phone
 * @param {{ passengerName, pickupAddress, destAddress, totalFare }} orderData
 */
async function sendOrderNotificationWA(phone, orderData) {
  const { passengerName, pickupAddress, destAddress, totalFare } = orderData;
  const message =
    `🛵 *Order Baru TemRide*\n\n` +
    `Penumpang: *${passengerName}*\n` +
    `Dari: ${pickupAddress}\n` +
    `Ke: ${destAddress}\n` +
    `Tarif: *Rp ${totalFare.toLocaleString('id-ID')}*\n\n` +
    `Buka aplikasi untuk menerima order.`;

  return sendWhatsApp(phone, message);
}

module.exports = { sendWhatsApp, sendWhatsAppOTP, sendOrderNotificationWA };
