'use strict'
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// GET riwayat chat per order
const getChatHistory = async (req, res) => {
  try {
    const { orderId } = req.params
    const { userId, role } = req.user

    // Validasi: user harus bagian dari order ini
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { passengerId: true, driverId: true }
    })

    if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' })

    const isAllowed = order.passengerId === userId || order.driverId === userId || role === 'ADMIN'
    if (!isAllowed) return res.status(403).json({ success: false, message: 'Tidak diizinkan' })

    // Ambil pesan
    let messages = []
    try {
      messages = await prisma.message.findMany({
        where: { orderId },
        include: { sender: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'asc' }
      })
    } catch {
      // Jika tabel Message belum ada, return empty
      messages = []
    }

    res.json({ success: true, messages, orderId })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// POST kirim pesan (REST fallback)
const sendMessage = async (req, res) => {
  try {
    const { orderId } = req.params
    const { message } = req.body
    const { userId, role } = req.user

    if (!message?.trim()) return res.status(400).json({ success: false, message: 'Pesan kosong' })

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { passengerId: true, driverId: true, status: true }
    })

    if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' })

    const isAllowed = order.passengerId === userId || order.driverId === userId || role === 'ADMIN'
    if (!isAllowed) return res.status(403).json({ success: false, message: 'Tidak diizinkan' })

    let savedMessage = {
      id: Date.now().toString(),
      orderId,
      senderId: userId,
      message: message.trim(),
      createdAt: new Date(),
      sender: { id: userId, role }
    }

    try {
      savedMessage = await prisma.message.create({
        data: { orderId, senderId: userId, message: message.trim() },
        include: { sender: { select: { id: true, name: true, role: true } } }
      })
    } catch {
      // Tabel belum ada, kirim via socket saja
    }

    // Broadcast via Socket.io ke room chat
    if (global.io) {
      global.io.to(`chat_${orderId}`).emit('chat:new_message', {
        ...savedMessage,
        senderRole: role
      })
    }

    res.json({ success: true, message: savedMessage })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

module.exports = { getChatHistory, sendMessage }
