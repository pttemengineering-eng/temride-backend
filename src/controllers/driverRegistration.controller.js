'use strict';

const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

// ─── Fonnte WhatsApp Helper ────────────────────────────────────────────────────
async function sendWhatsApp(target, message) {
  try {
    const token = process.env.FONNTE_TOKEN;
    if (!token) {
      console.warn('[WA] FONNTE_TOKEN not set, skipping WhatsApp notification');
      return;
    }
    const phone = target.replace(/[^0-9]/g, '').replace(/^0/, '62');
    await axios.post(
      'https://api.fonnte.com/send',
      { target: phone, message },
      { headers: { Authorization: token } }
    );
    console.log(`[WA] Message sent to ${phone}`);
  } catch (err) {
    console.error('[WA] Failed to send WhatsApp:', err.message);
  }
}

// ─── POST /api/driver-registration/submit ─────────────────────────────────────
const submitRegistration = async (req, res) => {
  try {
    const {
      // Data diri
      fullName, nik, phone, email, birthDate, address, city,
      // Kendaraan
      vehicleType, hasOwnVehicle,
      vehicleBrand, vehicleModel, vehicleYear, vehiclePlate,
      // Kredit
      requestCredit, creditPackage,
      // Dokumen URLs
      ktpPhotoUrl, simPhotoUrl, selfiePhotoUrl, stnkPhotoUrl,
      bankBookUrl, kkPhotoUrl, salarySlipUrl,
    } = req.body;

    // Validate required fields
    if (!fullName || !nik || !phone || !city || !vehicleType) {
      return res.status(400).json(error('Field wajib tidak lengkap: fullName, nik, phone, city, vehicleType'));
    }

    // Generate registration number
    const timestamp = Date.now();
    const registrationNumber = `TRD-${timestamp}`;

    // Save to database
    const application = await prisma.driverApplication.create({
      data: {
        registrationNumber,
        fullName: fullName.trim(),
        nik: nik.toString().trim(),
        phone: phone.toString().trim(),
        email: email || null,
        birthDate: birthDate || null,
        address: address || null,
        city: city.toUpperCase(),
        vehicleType: vehicleType.toUpperCase(),
        hasOwnVehicle: Boolean(hasOwnVehicle),
        vehicleBrand: vehicleBrand || null,
        vehicleModel: vehicleModel || null,
        vehicleYear: vehicleYear ? vehicleYear.toString() : null,
        vehiclePlate: vehiclePlate || null,
        requestCredit: Boolean(requestCredit),
        creditPackage: creditPackage || null,
        ktpPhotoUrl: ktpPhotoUrl || null,
        simPhotoUrl: simPhotoUrl || null,
        selfiePhotoUrl: selfiePhotoUrl || null,
        stnkPhotoUrl: stnkPhotoUrl || null,
        bankBookUrl: bankBookUrl || null,
        kkPhotoUrl: kkPhotoUrl || null,
        salarySlipUrl: salarySlipUrl || null,
        status: 'PENDING',
      },
    });

    // Notif WA ke admin TemRide
    const adminMsg =
      `📋 *PENDAFTARAN DRIVER BARU*\n\n` +
      `Nama: ${fullName}\n` +
      `HP: ${phone}\n` +
      `Kota: ${city}\n` +
      `Jenis: ${vehicleType}\n` +
      `Kredit: ${requestCredit ? 'Ya' : 'Tidak'}\n` +
      `No Reg: ${registrationNumber}\n\n` +
      `Silakan review di admin dashboard`;

    await sendWhatsApp('6281383058143', adminMsg);

    // Konfirmasi WA ke calon driver
    const driverMsg =
      `Halo *${fullName}*! Pendaftaran TemRide berhasil 🎉\n\n` +
      `No Registrasi: *${registrationNumber}*\n\n` +
      `Tim kami akan menghubungi dalam 1x24 jam.\n` +
      `Info: wa.me/6281383058143`;

    await sendWhatsApp(phone, driverMsg);

    return res.status(201).json(success('Pendaftaran berhasil dikirim', {
      registrationNumber,
      status: 'PENDING',
      message: 'Pendaftaran berhasil! Tim TemRide akan menghubungi dalam 1x24 jam.',
    }));
  } catch (err) {
    console.error('[DriverReg] submitRegistration error:', err);
    if (err.code === 'P2002') {
      return res.status(409).json(error('NIK atau nomor telepon sudah terdaftar'));
    }
    return res.status(500).json(error('Gagal memproses pendaftaran', err.message));
  }
};

// ─── GET /api/driver-registration/status/:registrationNumber ──────────────────
const checkStatus = async (req, res) => {
  try {
    const { registrationNumber } = req.params;

    const application = await prisma.driverApplication.findUnique({
      where: { registrationNumber },
      select: {
        registrationNumber: true,
        fullName: true,
        phone: true,
        city: true,
        vehicleType: true,
        requestCredit: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!application) {
      return res.status(404).json(error('Nomor pendaftaran tidak ditemukan'));
    }

    return res.json(success('Status pendaftaran ditemukan', application));
  } catch (err) {
    console.error('[DriverReg] checkStatus error:', err);
    return res.status(500).json(error('Gagal mengambil status pendaftaran'));
  }
};

// ─── PATCH /api/driver-registration/:id/review ───────────────────────────────
const reviewApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['PENDING', 'DOCUMENT_CHECK', 'INTERVIEW', 'CREDIT_CHECK', 'APPROVED', 'REJECTED'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json(error(`Status tidak valid. Gunakan: ${validStatuses.join(', ')}`));
    }

    const application = await prisma.driverApplication.update({
      where: { id },
      data: {
        status,
        notes: notes || null,
        reviewedBy: req.user?.id || 'admin',
        reviewedAt: new Date(),
      },
    });

    // Kirim notif WA ke driver sesuai status
    const statusMessages = {
      DOCUMENT_CHECK: `Halo *${application.fullName}*! 📋\n\nPendaftaran TemRide Anda (${application.registrationNumber}) sedang dalam tahap verifikasi dokumen.\n\nMohon pastikan semua dokumen sudah lengkap dan jelas.\n\nInfo: wa.me/6281383058143`,
      INTERVIEW: `Halo *${application.fullName}*! 🎯\n\nSelamat! Pendaftaran TemRide Anda (${application.registrationNumber}) lolos seleksi dokumen.\n\nAnda diundang untuk interview/orientasi. Tim kami akan menghubungi segera.\n\nInfo: wa.me/6281383058143`,
      CREDIT_CHECK: `Halo *${application.fullName}*! 💳\n\nPengajuan kredit kendaraan Anda (${application.registrationNumber}) sedang dalam proses pengecekan.\n\nTim kredit kami akan menghubungi dalam 1-2 hari kerja.\n\nInfo: wa.me/6281383058143`,
      APPROVED: `Halo *${application.fullName}*! 🎉\n\nSELAMAT! Pendaftaran TemRide Anda (${application.registrationNumber}) telah DISETUJUI!\n\nAnda resmi menjadi mitra driver TemRide. Tim kami akan menghubungi untuk langkah selanjutnya.\n\nInfo: wa.me/6281383058143`,
      REJECTED: `Halo *${application.fullName}*! 😔\n\nMaaf, pendaftaran TemRide Anda (${application.registrationNumber}) tidak dapat diproses saat ini.\n\n${notes ? `Alasan: ${notes}\n\n` : ''}Anda dapat mendaftar kembali setelah memenuhi persyaratan.\n\nInfo: wa.me/6281383058143`,
    };

    if (statusMessages[status]) {
      await sendWhatsApp(application.phone, statusMessages[status]);
    }

    return res.json(success('Status pendaftaran berhasil diperbarui', {
      id: application.id,
      registrationNumber: application.registrationNumber,
      status: application.status,
      updatedAt: application.updatedAt,
    }));
  } catch (err) {
    console.error('[DriverReg] reviewApplication error:', err);
    if (err.code === 'P2025') {
      return res.status(404).json(error('Pendaftaran tidak ditemukan'));
    }
    return res.status(500).json(error('Gagal memperbarui status pendaftaran'));
  }
};

// ─── GET /api/driver-registration (Admin list) ────────────────────────────────
const listApplications = async (req, res) => {
  try {
    const { status, city, vehicleType, page = 1, limit = 20 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (city) where.city = city.toUpperCase();
    if (vehicleType) where.vehicleType = vehicleType.toUpperCase();

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [applications, total] = await Promise.all([
      prisma.driverApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.driverApplication.count({ where }),
    ]);

    // Count stats
    const [totalPending, totalApproved, totalRejected] = await Promise.all([
      prisma.driverApplication.count({ where: { status: 'PENDING' } }),
      prisma.driverApplication.count({ where: { status: 'APPROVED' } }),
      prisma.driverApplication.count({ where: { status: 'REJECTED' } }),
    ]);

    return res.json({
      success: true,
      message: 'Daftar pendaftaran driver',
      data: applications,
      stats: {
        total: await prisma.driverApplication.count(),
        pending: totalPending,
        approved: totalApproved,
        rejected: totalRejected,
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[DriverReg] listApplications error:', err);
    return res.status(500).json(error('Gagal mengambil daftar pendaftaran'));
  }
};

// ─── GET /api/driver-registration/:id (Admin detail) ─────────────────────────
const getApplicationDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const application = await prisma.driverApplication.findUnique({
      where: { id },
    });

    if (!application) {
      return res.status(404).json(error('Pendaftaran tidak ditemukan'));
    }

    return res.json(success('Detail pendaftaran', application));
  } catch (err) {
    console.error('[DriverReg] getApplicationDetail error:', err);
    return res.status(500).json(error('Gagal mengambil detail pendaftaran'));
  }
};

module.exports = {
  submitRegistration,
  checkStatus,
  reviewApplication,
  listApplications,
  getApplicationDetail,
};
