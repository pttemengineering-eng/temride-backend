'use strict';

const express = require('express');
const router = express.Router();
const ratingController = require('../controllers/rating.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

// POST /api/ratings/submit — Submit rating for completed order
router.post('/submit', ratingController.submitRating);

// GET /api/ratings/driver/:driverId — Get driver ratings
router.get('/driver/:driverId', ratingController.getDriverRatings);

module.exports = router;
