'use strict';

const admin = require('firebase-admin');
const path = require('path');

let firebaseApp = null;

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  try {
    // Try service account file first
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (saPath && require('fs').existsSync(path.resolve(saPath))) {
      const serviceAccount = require(path.resolve(saPath));
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
      // Use env vars (Railway production)
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      console.warn('[FCM] Firebase not configured — push notifications disabled');
      return null;
    }
    console.log('[FCM] Firebase Admin initialized');
  } catch (err) {
    console.error('[FCM] Init error:', err.message);
    return null;
  }
  return firebaseApp;
}

/**
 * Send push notification via FCM V1
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  const app = getFirebaseApp();
  if (!app) {
    console.warn('[FCM] Skipping push — Firebase not configured');
    return { skipped: true };
  }

  if (!fcmToken) {
    console.warn('[FCM] No FCM token provided');
    return { skipped: true };
  }

  try {
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'temride_default' },
      },
    };

    const result = await admin.messaging(app).send(message);
    console.log(`[FCM] Sent to ${fcmToken.slice(0, 20)}...: ${result}`);
    return { success: true, messageId: result };
  } catch (err) {
    console.error('[FCM] Send error:', err.message);
    return { error: err.message };
  }
}

/**
 * Send order status notification to passenger
 */
async function notifyOrderStatus(fcmToken, status, orderId) {
  const statusMap = {
    ACCEPTED: { title: '✅ Driver Ditemukan!', body: 'Driver sedang menuju lokasi Anda.' },
    PICKED_UP: { title: '🛵 Perjalanan Dimulai', body: 'Driver sudah menjemput Anda.' },
    COMPLETED: { title: '🎉 Sampai Tujuan!', body: 'Terima kasih telah menggunakan TemRide.' },
    CANCELLED: { title: '❌ Order Dibatalkan', body: 'Order Anda telah dibatalkan.' },
  };
  const notif = statusMap[status] || { title: 'Update Order', body: `Status: ${status}` };
  return sendPushNotification(fcmToken, notif.title, notif.body, { orderId, status });
}

/**
 * Send new order notification to driver
 */
async function notifyNewOrder(fcmToken, passengerName, pickup, destination) {
  return sendPushNotification(
    fcmToken,
    '🛵 Order Baru!',
    `${passengerName}: ${pickup} → ${destination}`,
    { type: 'NEW_ORDER' }
  );
}

module.exports = { sendPushNotification, notifyOrderStatus, notifyNewOrder };
