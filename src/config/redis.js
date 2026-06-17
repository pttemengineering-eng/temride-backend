'use strict';

const Redis = require('ioredis');

let client = null;

/**
 * Get Redis client (lazy initialized singleton)
 */
function getRedisClient() {
  if (client) return client;

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    lazyConnect: true,
    enableReadyCheck: true,
    reconnectOnError(err) {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) return true;
      return false;
    },
  });

  client.on('connect', () => console.log('[Redis] Connected'));
  client.on('error', (err) => console.error('[Redis] Error:', err.message));
  client.on('close', () => console.warn('[Redis] Connection closed'));

  return client;
}

// ─── Key Namespaces ───────────────────────────────────────────────────────────
const KEYS = {
  driverLocation: (driverId) => `driver:loc:${driverId}`,
  onlineDrivers: () => 'drivers:online',
  orderBroadcast: (orderId) => `order:broadcast:${orderId}`,
  otpAttempts: (phone) => `otp:attempts:${phone}`,
  rateLimit: (ip) => `ratelimit:${ip}`,
  session: (userId) => `session:${userId}`,
};

/**
 * Set driver location in Redis geo set
 * @param {string} driverId
 * @param {number} lat
 * @param {number} lng
 */
async function setDriverLocation(driverId, lat, lng) {
  const redis = getRedisClient();
  await redis.geoadd('drivers:geo', lng, lat, driverId);
  await redis.setex(KEYS.driverLocation(driverId), 300, JSON.stringify({ lat, lng, updatedAt: Date.now() }));
}

/**
 * Get nearby drivers using Redis GEO
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusKm
 * @returns {string[]} array of driver IDs
 */
async function getNearbyDrivers(lat, lng, radiusKm = 3) {
  const redis = getRedisClient();
  try {
    const results = await redis.georadius('drivers:geo', lng, lat, radiusKm, 'km', 'ASC', 'COUNT', 20);
    return results;
  } catch (err) {
    console.error('[Redis] getNearbyDrivers error:', err.message);
    return [];
  }
}

/**
 * Cache order broadcast to prevent duplicate notifications
 * @param {string} orderId
 * @param {number} ttlSeconds
 */
async function markOrderBroadcast(orderId, ttlSeconds = 60) {
  const redis = getRedisClient();
  await redis.setex(KEYS.orderBroadcast(orderId), ttlSeconds, '1');
}

/**
 * Increment OTP attempt counter
 */
async function incrementOTPAttempts(phone) {
  const redis = getRedisClient();
  const key = KEYS.otpAttempts(phone);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600); // 1 hour window
  return count;
}

module.exports = {
  getRedisClient,
  KEYS,
  setDriverLocation,
  getNearbyDrivers,
  markOrderBroadcast,
  incrementOTPAttempts,
};
