'use strict';

const express = require('express');
const router = express.Router();

// Test endpoint - cek status konfigurasi Firebase & services
router.get('/notification', async (req, res) => {
  res.json({
    firebase_configured: !!(process.env.FIREBASE_PROJECT_ID),
    project_id: process.env.FIREBASE_PROJECT_ID || 'not set',
    fonnte_configured: !!(process.env.FONNTE_API_KEY),
    midtrans_configured: !!(process.env.MIDTRANS_SERVER_KEY),
  });
});

module.exports = router;
