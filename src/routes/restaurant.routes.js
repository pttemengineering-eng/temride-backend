'use strict';

const express = require('express');
const router = express.Router();
const restaurantController = require('../controllers/restaurant.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin, allowRoles } = require('../middleware/role.middleware');

// ─── Restaurant Routes ────────────────────────────────────────────────────────

// GET /api/restaurants — List active restaurants (public)
router.get('/restaurants', restaurantController.getRestaurants);

// GET /api/restaurants/:id — Get restaurant detail + menu (public)
router.get('/restaurants/:id', restaurantController.getRestaurantById);

// POST /api/restaurants — Register restaurant (auth required)
router.post('/restaurants', authenticate, restaurantController.createRestaurant);

// POST /api/restaurants/:id/menus — Add menu item to restaurant
router.post('/restaurants/:id/menus', authenticate, restaurantController.addMenuItem);

// ─── Food Order Routes ────────────────────────────────────────────────────────

// POST /api/food-orders — Create food order (passenger)
router.post('/food-orders', authenticate, restaurantController.createFoodOrder);

// GET /api/food-orders — List food orders for user
router.get('/food-orders', authenticate, restaurantController.getMyFoodOrders);

// GET /api/food-orders/:id — Get food order detail
router.get('/food-orders/:id', authenticate, restaurantController.getFoodOrderById);

// PATCH /api/food-orders/:id/status — Update food order status (driver/restaurant/admin)
router.patch('/food-orders/:id/status', authenticate, restaurantController.updateFoodOrderStatus);

module.exports = router;
