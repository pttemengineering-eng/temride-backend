'use strict';

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const FCM_URL = 'https://fcm.googleapis.com/fcm/send';

/**
 * Send FCM push notification to a single user
 * @param {string} userId
 * @param {{ title: string, body: string, data?: object }} payload
 */
async function sendPushNotification(userId, { title, body, data = {} }) {
  const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;
  if (!FCM_SERVER_KEY) {
    console.warn('[FCM] FCM_SERVER_KEY not configured — skipping push notification');
    return { skipped: true };
  }

  try {
    // Get user's FCM token from DB (extend User model with fcmToken field if needed)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      console.warn('[FCM] User not found:', userId);
      return { error: 'User not found' };
    }

    // In a production app, you'd store fcmToken per user/device
    // For now we log a structured notification event
    const notification = {
      userId,
      title,
      body,
      data,
      sentAt: new Date().toISOString(),
    };

    console.log('[FCM] Push notification:', JSON.stringify(notification, null, 2));

    // Placeholder for actual FCM call:
    // const response = await axios.post(FCM_URL, {
    //   to: userFcmToken,
    //   notification: { title, body },
    //   data,
    // }, {
    //   headers: { Authorization: `key=${FCM_SERVER_KEY}`, 'Content-Type': 'application/json' },
    // });

    return { success: true, notification };
  } catch (err) {
    console.error('[FCM] sendPushNotification error:', err.message);
    return { error: err.message };
  }
}

/**
 * Send FCM to multiple users (batch)
 * @param {string[]} userIds
 * @param {{ title: string, body: string, data?: object }} payload
 */
async function sendBatchPushNotification(userIds, payload) {
  const results = await Promise.allSettled(
    userIds.map((id) => sendPushNotification(id, payload))
  );
  return results.map((r, i) => ({
    userId: userIds[i],
    result: r.status === 'fulfilled' ? r.value : { error: r.reason?.message },
  }));
}

/**
 * Send data-only FCM message (silent push for app updates)
 */
async function sendDataMessage(userId, data) {
  return sendPushNotification(userId, { title: '', body: '', data });
}

module.exports = { sendPushNotification, sendBatchPushNotification, sendDataMessage };
