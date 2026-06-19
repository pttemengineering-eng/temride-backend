'use strict'
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Konfigurasi tarif dasar
const BASE_RATES = {
  MOTORCYCLE: {
    basePrice: 5000,      // Rp 5.000 biaya buka
    perKm: 2500,          // Rp 2.500/km
    minFare: 8000,        // Minimum Rp 8.000
    serviceFee: 1000,     // Rp 1.000 biaya layanan
  },
  CAR: {
    basePrice: 10000,
    perKm: 4500,
    minFare: 15000,
    serviceFee: 2000,
  },
  GOSEND: {
    basePrice: 7000,
    perKm: 3000,
    minFare: 10000,
    serviceFee: 1000,
  }
}

// Surge multiplier berdasarkan demand vs supply
const calculateSurgeMultiplier = async (vehicleType) => {
  try {
    const [activeOrders, onlineDrivers] = await Promise.all([
      // Order aktif dalam 10 menit terakhir
      prisma.order.count({
        where: {
          status: { in: ['PENDING', 'SEARCHING', 'ACCEPTED', 'IN_PROGRESS'] },
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) }
        }
      }),
      // Driver online
      prisma.driverProfile.count({
        where: { isOnline: true, isVerified: true }
      })
    ])

    const demand = activeOrders
    const supply = Math.max(onlineDrivers, 1)
    const ratio = demand / supply

    // Surge tiers
    let multiplier = 1.0
    let surgeLabel = 'Normal'
    let surgeColor = 'green'

    if (ratio >= 2 && ratio < 3) {
      multiplier = 1.2
      surgeLabel = 'Ramai'
      surgeColor = 'yellow'
    } else if (ratio >= 3 && ratio < 5) {
      multiplier = 1.5
      surgeLabel = 'Sangat Ramai'
      surgeColor = 'orange'
    } else if (ratio >= 5) {
      multiplier = 2.0
      surgeLabel = 'Permintaan Tinggi'
      surgeColor = 'red'
    }

    // Time-based surge: 07:00-09:00 & 17:00-20:00 WITA
    const hour = new Date().getUTCHours() + 8 // Convert ke WITA
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20)
    if (isRushHour && multiplier < 1.3) {
      multiplier = Math.max(multiplier, 1.3)
      surgeLabel = surgeLabel === 'Normal' ? 'Jam Sibuk' : surgeLabel
      surgeColor = surgeColor === 'green' ? 'yellow' : surgeColor
    }

    return { multiplier, surgeLabel, surgeColor, demand, supply, ratio: Math.round(ratio * 10) / 10 }
  } catch {
    return { multiplier: 1.0, surgeLabel: 'Normal', surgeColor: 'green', demand: 0, supply: 0, ratio: 0 }
  }
}

// Hitung estimasi fare

// Haversine: hitung jarak km dari koordinat
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
const estimateFare = async (req, res) => {
  try {
    const { distance, vehicleType = 'MOTORCYCLE', pickupLat, pickupLng, destLat, destLng } = req.body

    const dist = parseFloat(distance) || 0
    if (dist <= 0) return res.status(400).json({ success: false, message: 'Jarak tidak valid' })

    const rates = BASE_RATES[vehicleType] || BASE_RATES.MOTORCYCLE
    const surgeData = await calculateSurgeMultiplier(vehicleType)

    // Hitung fare
    const baseFare = rates.basePrice + (dist * rates.perKm)
    const surgedFare = Math.ceil(baseFare * surgeData.multiplier)
    const totalFare = Math.max(surgedFare + rates.serviceFee, rates.minFare)

    // Breakdown
    const breakdown = {
      baseFare: rates.basePrice,
      distanceFare: Math.ceil(dist * rates.perKm),
      surgeMultiplier: surgeData.multiplier,
      surgedFare,
      serviceFee: rates.serviceFee,
      totalFare,
      driverEarnings: Math.floor(totalFare * 0.90),
      platformFee: Math.ceil(totalFare * 0.10),
    }

    res.json({
      success: true,
      fare: {
        amount: totalFare,
        currency: 'IDR',
        formatted: `Rp ${totalFare.toLocaleString('id-ID')}`,
        breakdown,
        surge: {
          isActive: surgeData.multiplier > 1,
          multiplier: surgeData.multiplier,
          label: surgeData.surgeLabel,
          color: surgeData.surgeColor,
          message: surgeData.multiplier > 1
            ? `Harga sedang ${surgeData.surgeLabel.toLowerCase()} (×${surgeData.multiplier}). Ada ${surgeData.demand} pengguna aktif dan ${surgeData.supply} driver tersedia.`
            : 'Harga normal — tidak ada lonjakan permintaan'
        },
        vehicleType,
        distance: dist,
        estimatedTime: Math.ceil(dist / 25 * 60), // asumsi 25 km/jam rata-rata kota
      }
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET current surge status (untuk ditampilkan di app)
const getSurgeStatus = async (req, res) => {
  try {
    const { vehicleType = 'MOTORCYCLE' } = req.query
    const surgeData = await calculateSurgeMultiplier(vehicleType)
    res.json({ success: true, surge: surgeData })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET tarif config (untuk admin settings)
const getRateConfig = async (req, res) => {
  res.json({ success: true, rates: BASE_RATES })
}

module.exports = { estimateFare, getSurgeStatus, getRateConfig, calculateSurgeMultiplier, BASE_RATES }
