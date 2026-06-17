'use strict';

/**
 * Calculate ride fare
 *
 * Formula:
 *   totalFare = baseFare + (distanceKm * pricePerKm * surgeFactor)
 *   platformFee = totalFare * (PLATFORM_FEE_PERCENT / 100)
 *   driverEarnings = totalFare - platformFee
 */

/**
 * @param {number} distanceKm
 * @param {number} surgeFactor - default 1.0
 * @returns {{ baseFare, perKmFare, surgeFactor, totalFare, driverEarnings, platformFee }}
 */
function calculateFareAmount(distanceKm, surgeFactor = 1.0) {
  const BASE_FARE = parseFloat(process.env.BASE_FARE) || 5000;
  const PRICE_PER_KM = parseFloat(process.env.PRICE_PER_KM) || 2500;
  const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT) || 10;
  const DRIVER_SHARE_PERCENT = parseFloat(process.env.DRIVER_SHARE_PERCENT) || 90;

  const perKmFare = PRICE_PER_KM * distanceKm * surgeFactor;
  const rawFare = BASE_FARE + perKmFare;
  const totalFare = Math.round(rawFare / 1000) * 1000; // Round to nearest 1000

  const platformFee = Math.round((totalFare * PLATFORM_FEE_PERCENT) / 100);
  const driverEarnings = totalFare - platformFee;

  return {
    baseFare: BASE_FARE,
    perKmFare: Math.round(perKmFare),
    surgeFactor,
    totalFare,
    platformFee,
    driverEarnings,
    breakdown: {
      baseComponent: BASE_FARE,
      distanceComponent: Math.round(perKmFare),
      surgeApplied: surgeFactor > 1.0,
      platformFeePercent: PLATFORM_FEE_PERCENT,
      driverSharePercent: DRIVER_SHARE_PERCENT,
    },
  };
}

/**
 * Calculate fare with promo discount applied
 * @param {number} distanceKm
 * @param {number} surgeFactor
 * @param {{ type: 'PERCENT'|'FIXED', value: number, maxDiscount?: number, minOrder?: number }} promo
 */
function calculateFareWithPromo(distanceKm, surgeFactor = 1.0, promo = null) {
  const fareData = calculateFareAmount(distanceKm, surgeFactor);

  if (!promo) return { ...fareData, promoDiscount: 0, finalFare: fareData.totalFare };

  if (fareData.totalFare < (promo.minOrder || 0)) {
    return { ...fareData, promoDiscount: 0, finalFare: fareData.totalFare, promoError: 'Minimum order not met' };
  }

  let discount = 0;
  if (promo.type === 'PERCENT') {
    discount = (fareData.totalFare * promo.value) / 100;
    if (promo.maxDiscount) discount = Math.min(discount, promo.maxDiscount);
  } else {
    discount = Math.min(promo.value, fareData.totalFare);
  }

  const finalFare = Math.max(0, fareData.totalFare - discount);
  const platformFee = Math.round((finalFare * (parseFloat(process.env.PLATFORM_FEE_PERCENT) || 10)) / 100);
  const driverEarnings = finalFare - platformFee;

  return {
    ...fareData,
    promoDiscount: Math.round(discount),
    finalFare,
    platformFee,
    driverEarnings,
  };
}

/**
 * Estimate surge factor based on demand (simple version)
 * @param {number} activeOrders - number of active orders in area
 * @param {number} availableDrivers - number of online drivers in area
 * @returns {number} surge multiplier
 */
function estimateSurgeFactor(activeOrders, availableDrivers) {
  const BASE_SURGE = parseFloat(process.env.SURGE_MULTIPLIER_DEFAULT) || 1.0;
  if (availableDrivers === 0) return Math.min(BASE_SURGE * 2, 3.0);
  const ratio = activeOrders / availableDrivers;
  if (ratio > 3) return Math.min(BASE_SURGE * 1.5, 2.5);
  if (ratio > 2) return Math.min(BASE_SURGE * 1.25, 2.0);
  if (ratio > 1.5) return Math.min(BASE_SURGE * 1.1, 1.5);
  return BASE_SURGE;
}

module.exports = { calculateFareAmount, calculateFareWithPromo, estimateSurgeFactor };
