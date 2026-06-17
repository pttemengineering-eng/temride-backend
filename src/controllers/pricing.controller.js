'use strict';

const { getDistanceMatrix } = require('../services/maps.service');
const { calculateFareAmount } = require('../utils/pricing.helper');
const { success, error } = require('../utils/response.helper');

/**
 * POST /api/orders/calculate-fare
 * Calculate estimated fare before booking
 */
const calculateFare = async (req, res) => {
  const { pickupLat, pickupLng, destLat, destLng } = req.body;

  if (!pickupLat || !pickupLng || !destLat || !destLng) {
    return res.status(400).json(error('Pickup and destination coordinates are required'));
  }

  try {
    let distanceData;
    try {
      distanceData = await getDistanceMatrix(
        `${pickupLat},${pickupLng}`,
        `${destLat},${destLng}`
      );
    } catch (mapsErr) {
      // Fallback to haversine estimate
      const R = 6371;
      const dLat = ((destLat - pickupLat) * Math.PI) / 180;
      const dLng = ((destLng - pickupLng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((pickupLat * Math.PI) / 180) *
          Math.cos((destLat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      distanceData = {
        distanceKm: distKm,
        distanceText: `${distKm.toFixed(1)} km`,
        durationSeconds: Math.round(distKm * 3 * 60),
        durationText: `${Math.round(distKm * 3)} menit`,
      };
    }

    const surgeFactor = parseFloat(process.env.SURGE_MULTIPLIER_DEFAULT) || 1.0;
    const fareData = calculateFareAmount(distanceData.distanceKm, surgeFactor);

    return res.json(success('Fare calculated', {
      distance: distanceData.distanceKm,
      distanceText: distanceData.distanceText,
      duration: distanceData.durationSeconds,
      durationText: distanceData.durationText,
      baseFare: fareData.baseFare,
      perKmFare: fareData.perKmFare,
      surgeFactor,
      totalFare: fareData.totalFare,
      driverEarnings: fareData.driverEarnings,
      platformFee: fareData.platformFee,
    }));
  } catch (err) {
    console.error('calculateFare error:', err);
    return res.status(500).json(error('Failed to calculate fare', err.message));
  }
};

module.exports = { calculateFare };
