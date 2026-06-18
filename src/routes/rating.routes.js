'use strict';

const express = require('express');
const router = express.Router();
const ratingController = require('../controllers/rating.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

// POST /api/ratings — Submit rating for completed order (passenger rates driver)
router.post('/', ratingController.submitRating);

// POST /api/ratings/submit — legacy alias
router.post('/submit', ratingController.submitRating);

// GET /api/ratings/my — Get ratings given by the logged-in user
router.get('/my', ratingController.getMyRatings);

// GET /api/ratings/driver/:driverId — Get ratings for a specific driver
router.get('/driver/:driverId', ratingController.getDriverRatings);

module.exports = router;
