'use strict'
const express = require('express')
const router = express.Router()
const chatController = require('../controllers/chat.controller')
const { authenticate } = require('../middleware/auth.middleware')

router.use(authenticate)
router.get('/orders/:orderId/chat', chatController.getChatHistory)
router.post('/orders/:orderId/chat', chatController.sendMessage)

module.exports = router
