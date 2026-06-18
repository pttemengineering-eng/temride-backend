'use strict'
const express = require('express')
const router = express.Router()
const { estimateFare, getSurgeStatus, getRateConfig } = require('../controllers/pricing.controller')
const { authenticate } = require('../middleware/auth.middleware')

router.post('/fare/estimate', authenticate, estimateFare)
router.get('/fare/surge', getSurgeStatus) // Public — bisa diakses tanpa login
router.get('/fare/rates', getRateConfig)  // Public — tampilkan tarif ke penumpang

module.exports = router
