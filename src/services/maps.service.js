'use strict';

// maps.service.js — OpenStreetMap implementation (NO API KEY NEEDED)
// Geocoding: Nominatim (nominatim.openstreetmap.org)
// Routing:   OSRM     (router.project-osrm.org)

const axios = require('axios');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OSRM_URL = 'https://router.project-osrm.org';

// User-Agent wajib untuk Nominatim sesuai usage policy
const NOMINATIM_HEADERS = {
  'User-Agent': 'TemRide/1.0 (contact@temride.id)',
};

/**
 * Geocode: alamat → { lat, lng, displayName }
 * @param {string} address
 * @returns {{ lat: number, lng: number, displayName: string }}
 */
async function geocode(address) {
  const res = await axios.get(`${NOMINATIM_URL}/search`, {
    params: { q: address, format: 'json', limit: 1 },
    headers: NOMINATIM_HEADERS,
    timeout: 10000,
  });
  if (!res.data.length) throw new Error('Alamat tidak ditemukan');
  return {
    lat: parseFloat(res.data[0].lat),
    lng: parseFloat(res.data[0].lon),
    displayName: res.data[0].display_name,
  };
}

/**
 * Reverse geocode: { lat, lng } → alamat string
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
async function reverseGeocode(lat, lng) {
  const res = await axios.get(`${NOMINATIM_URL}/reverse`, {
    params: { lat, lon: lng, format: 'json' },
    headers: NOMINATIM_HEADERS,
    timeout: 10000,
  });
  return res.data.display_name || `${lat}, ${lng}`;
}

/**
 * Distance matrix: origin → destination via OSRM
 * @param {number} originLat
 * @param {number} originLng
 * @param {number} destLat
 * @param {number} destLng
 * @returns {{ distanceKm, durationMinutes, distanceMeters, durationSeconds }}
 */
async function getDistanceMatrix(originLat, originLng, destLat, destLng) {
  const url = `${OSRM_URL}/route/v1/driving/${originLng},${originLat};${destLng},${destLat}`;
  const res = await axios.get(url, {
    params: { overview: 'false' },
    timeout: 10000,
  });
  if (!res.data.routes || !res.data.routes.length) {
    throw new Error('Route tidak ditemukan');
  }
  const route = res.data.routes[0];
  return {
    distanceKm: Math.round(route.distance / 100) / 10,
    durationMinutes: Math.round(route.duration / 60),
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
}

/**
 * Calculate fare based on distance
 * @param {number} distanceKm
 * @param {number} surgeFactor
 * @returns {{ totalFare, platformFee, driverEarnings }}
 */
function calculateFare(distanceKm, surgeFactor = 1.0) {
  const BASE_FARE = parseInt(process.env.BASE_FARE) || 5000;
  const PRICE_PER_KM = parseInt(process.env.PRICE_PER_KM) || 2500;
  const PLATFORM_FEE_PERCENT = parseInt(process.env.PLATFORM_FEE_PERCENT) || 10;

  const totalFare = Math.round((BASE_FARE + distanceKm * PRICE_PER_KM) * surgeFactor);
  const platformFee = Math.round((totalFare * PLATFORM_FEE_PERCENT) / 100);
  const driverEarnings = totalFare - platformFee;

  return { totalFare, platformFee, driverEarnings };
}

module.exports = { geocode, reverseGeocode, getDistanceMatrix, calculateFare };
