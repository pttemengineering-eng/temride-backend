# TemRide Backend

Backend core untuk aplikasi ojek listrik **TemRide** — Node.js + Express + Prisma ORM.

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **ORM**: Prisma (PostgreSQL)
- **Cache**: Redis (ioredis)
- **Auth**: JWT + OTP via WhatsApp (Fonnte)
- **Payment**: Midtrans Snap
- **Maps**: Google Maps Distance Matrix API
- **Realtime**: Socket.io
- **Notifications**: Firebase Cloud Messaging (FCM)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env dengan credential Anda

# 3. Generate Prisma client
npm run generate

# 4. Run migrations (butuh PostgreSQL running)
npm run migrate

# 5. Start development server
npm run dev

# 6. Start production server
npm start
```

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/send-otp` | Kirim OTP ke WhatsApp |
| POST | `/api/auth/verify-otp` | Verifikasi OTP → JWT |
| POST | `/api/auth/register` | Daftar akun baru |
| POST | `/api/auth/login` | Login (trigger OTP) |

### Passenger
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/passengers/profile` | Profil penumpang |
| PUT | `/api/passengers/profile` | Update profil |
| GET | `/api/passengers/order-history` | Riwayat perjalanan |

### Driver
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/drivers/profile` | Profil driver |
| PUT | `/api/drivers/profile` | Update profil |
| POST | `/api/drivers/kyc` | Submit dokumen KYC |
| PUT | `/api/drivers/online-status` | Toggle online/offline |
| GET | `/api/drivers/earnings` | Rekap penghasilan |
| GET | `/api/drivers/wallet` | Dompet & transaksi |
| GET | `/api/drivers/credit-status` | Status cicilan kendaraan |
| POST | `/api/drivers/voucher/buy` | Beli voucher charging |

### Orders
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/orders/request` | Pesan ojek |
| POST | `/api/orders/calculate-fare` | Estimasi tarif |
| GET | `/api/orders/:id` | Detail order |
| POST | `/api/orders/:id/accept` | Driver terima order |
| POST | `/api/orders/:id/arrived` | Driver tiba di lokasi |
| POST | `/api/orders/:id/start` | Mulai perjalanan |
| POST | `/api/orders/:id/complete` | Selesaikan perjalanan |
| POST | `/api/orders/:id/cancel` | Batalkan order |

### Payment
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/payments/create` | Buat transaksi Midtrans |
| POST | `/api/payments/webhook` | Midtrans webhook |
| GET | `/api/payments/history` | Riwayat pembayaran |

### Voucher
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/vouchers/buy` | Beli voucher charging |
| POST | `/api/vouchers/redeem` | Redeem voucher |
| GET | `/api/vouchers/my-vouchers` | List voucher saya |

### Rating
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ratings/submit` | Submit rating |
| GET | `/api/ratings/driver/:driverId` | Rating seorang driver |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/drivers` | List semua driver |
| PUT | `/api/admin/drivers/:id/approve` | Approve/reject KYC |
| GET | `/api/admin/orders` | List semua order |
| GET | `/api/admin/revenue` | Statistik revenue |
| GET | `/api/admin/dashboard-stats` | Overview dashboard |

## Socket.io Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `driver:connect` | `{ userId }` | Driver connects |
| `driver:location_update` | `{ userId, lat, lng, heading, speed }` | Update lokasi driver |
| `driver:order_status_update` | `{ userId, orderId, status }` | Update status ke DRIVER_ON_WAY |
| `passenger:connect` | `{ userId }` | Passenger connects |
| `passenger:cancel_order` | `{ userId, orderId, reason }` | Passenger cancel |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `order:new_request` | order data | Order baru untuk driver |
| `order:accepted` | `{ orderId, driver }` | Driver diterima (→ passenger) |
| `order:driver_location` | `{ orderId, lat, lng }` | Lokasi real-time driver |
| `order:status_update` | `{ orderId, status, message }` | Update status order |
| `order:taken` | `{ orderId }` | Order sudah diambil driver lain |
| `driver:status_change` | `{ driverId, isOnline }` | Status driver berubah |

## Pricing Formula

```
totalFare = baseFare + (distanceKm × pricePerKm × surgeFactor)
platformFee = totalFare × (PLATFORM_FEE_PERCENT / 100)
driverEarnings = totalFare - platformFee
```

Default values (configurable via `.env`):
- `BASE_FARE` = Rp 5.000
- `PRICE_PER_KM` = Rp 2.500
- `PLATFORM_FEE_PERCENT` = 10%
- `DRIVER_SHARE_PERCENT` = 90%

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma        # Database schema lengkap
├── src/
│   ├── index.js             # Entry point
│   ├── config/
│   │   └── redis.js         # Redis client & geo queries
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── order.controller.js
│   │   ├── pricing.controller.js
│   │   ├── payment.controller.js
│   │   ├── driver.controller.js
│   │   ├── passenger.controller.js
│   │   ├── rating.controller.js
│   │   ├── voucher.controller.js
│   │   └── admin.controller.js
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   ├── role.middleware.js
│   │   ├── validation.middleware.js
│   │   └── error.middleware.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── passenger.routes.js
│   │   ├── driver.routes.js
│   │   ├── order.routes.js
│   │   ├── payment.routes.js
│   │   ├── voucher.routes.js
│   │   ├── rating.routes.js
│   │   └── admin.routes.js
│   ├── services/
│   │   ├── socket.service.js
│   │   ├── maps.service.js
│   │   ├── notification.service.js
│   │   └── whatsapp.service.js
│   └── utils/
│       ├── response.helper.js
│       ├── otp.helper.js
│       └── pricing.helper.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
