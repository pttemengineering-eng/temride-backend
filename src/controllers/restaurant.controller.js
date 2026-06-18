'use strict';

const { PrismaClient } = require('@prisma/client');
const { success, error } = require('../utils/response.helper');

const prisma = new PrismaClient();

const DELIVERY_FEE_PER_KM = parseInt(process.env.DELIVERY_FEE_PER_KM) || 3000;
const DELIVERY_BASE_FEE = parseInt(process.env.DELIVERY_BASE_FEE) || 5000;

// ─── RESTAURANT ENDPOINTS ────────────────────────────────────────────────────

/**
 * GET /api/restaurants
 * List all active restaurants
 */
const getRestaurants = async (req, res) => {
  const { category, search, page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = { isOpen: true };
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { address: { contains: search, mode: 'insensitive' } },
    ];
  }

  try {
    const [restaurants, total] = await Promise.all([
      prisma.restaurant.findMany({
        where,
        select: {
          id: true,
          name: true,
          address: true,
          category: true,
          imageUrl: true,
          isOpen: true,
          rating: true,
          phone: true,
          _count: { select: { menus: { where: { isAvailable: true } } } },
        },
        orderBy: { rating: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.restaurant.count({ where }),
    ]);

    return res.json(success('Restaurants retrieved', {
      restaurants,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }));
  } catch (err) {
    console.error('getRestaurants error:', err);
    return res.status(500).json(error('Failed to get restaurants', err.message));
  }
};

/**
 * GET /api/restaurants/:id
 * Get restaurant detail with menu
 */
const getRestaurantById = async (req, res) => {
  const { id } = req.params;

  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
      include: {
        menus: {
          where: { isAvailable: true },
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
      },
    });

    if (!restaurant) return res.status(404).json(error('Restaurant not found'));

    // Group menus by category
    const menusByCategory = {};
    restaurant.menus.forEach((menu) => {
      const cat = menu.category || 'Others';
      if (!menusByCategory[cat]) menusByCategory[cat] = [];
      menusByCategory[cat].push(menu);
    });

    return res.json(success('Restaurant retrieved', {
      restaurant: { ...restaurant, menusByCategory },
    }));
  } catch (err) {
    console.error('getRestaurantById error:', err);
    return res.status(500).json(error('Failed to get restaurant', err.message));
  }
};

/**
 * POST /api/restaurants
 * Register a new restaurant (merchant)
 */
const createRestaurant = async (req, res) => {
  const { name, address, phone, category, imageUrl } = req.body;

  if (!name || !address || !phone || !category) {
    return res.status(400).json(error('Missing required fields: name, address, phone, category'));
  }

  try {
    const restaurant = await prisma.restaurant.create({
      data: { name, address, phone, category, imageUrl },
    });

    return res.status(201).json(success('Restaurant registered', { restaurant }));
  } catch (err) {
    console.error('createRestaurant error:', err);
    return res.status(500).json(error('Failed to register restaurant', err.message));
  }
};

/**
 * POST /api/restaurants/:id/menus
 * Add menu item to restaurant
 */
const addMenuItem = async (req, res) => {
  const { id: restaurantId } = req.params;
  const { name, description, price, imageUrl, category } = req.body;

  if (!name || !price) {
    return res.status(400).json(error('name and price are required'));
  }

  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) return res.status(404).json(error('Restaurant not found'));

    const menu = await prisma.menu.create({
      data: { restaurantId, name, description, price: parseInt(price), imageUrl, category },
    });

    return res.status(201).json(success('Menu item added', { menu }));
  } catch (err) {
    console.error('addMenuItem error:', err);
    return res.status(500).json(error('Failed to add menu item', err.message));
  }
};

// ─── FOOD ORDER ENDPOINTS ────────────────────────────────────────────────────

/**
 * POST /api/food-orders
 * Create a new food order
 */
const createFoodOrder = async (req, res) => {
  const {
    restaurantId,
    items,
    deliveryAddress,
    paymentMethod = 'CASH',
    notes,
    estimatedDistanceKm,
  } = req.body;

  const passengerId = req.user.id;

  if (!restaurantId || !items || !Array.isArray(items) || items.length === 0 || !deliveryAddress) {
    return res.status(400).json(error('Missing required fields: restaurantId, items, deliveryAddress'));
  }

  try {
    // Validate restaurant
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) return res.status(404).json(error('Restaurant not found'));
    if (!restaurant.isOpen) return res.status(409).json(error('Restaurant is currently closed'));

    // Validate and price items
    const menuIds = items.map((i) => i.menuId);
    const menus = await prisma.menu.findMany({
      where: { id: { in: menuIds }, restaurantId, isAvailable: true },
    });

    if (menus.length !== menuIds.length) {
      return res.status(400).json(error('One or more menu items are unavailable or do not belong to this restaurant'));
    }

    const menuMap = {};
    menus.forEach((m) => { menuMap[m.id] = m; });

    let subtotal = 0;
    const orderItems = items.map((item) => {
      const menu = menuMap[item.menuId];
      const qty = parseInt(item.qty) || 1;
      const itemSubtotal = menu.price * qty;
      subtotal += itemSubtotal;
      return {
        menuId: item.menuId,
        qty,
        price: menu.price,
        subtotal: itemSubtotal,
      };
    });

    const distKm = parseFloat(estimatedDistanceKm) || 3;
    const deliveryFee = DELIVERY_BASE_FEE + Math.round(distKm * DELIVERY_FEE_PER_KM);
    const totalAmount = subtotal + deliveryFee;

    // Create food order with items in transaction
    const foodOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.foodOrder.create({
        data: {
          passengerId,
          restaurantId,
          deliveryAddress,
          paymentMethod,
          notes,
          subtotal,
          deliveryFee,
          totalAmount,
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          items: {
            create: orderItems,
          },
        },
        include: {
          restaurant: { select: { id: true, name: true, address: true, phone: true } },
          items: { include: { menu: { select: { name: true } } } },
        },
      });
      return order;
    });

    return res.status(201).json(success('Food order created', { order: foodOrder }));
  } catch (err) {
    console.error('createFoodOrder error:', err);
    return res.status(500).json(error('Failed to create food order', err.message));
  }
};

/**
 * GET /api/food-orders
 * List food orders for logged-in user
 */
const getMyFoodOrders = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const isDriver = req.user.role === 'DRIVER';
  const where = isDriver ? { driverId: userId } : { passengerId: userId };
  if (status) where.status = status;

  try {
    const [orders, total] = await Promise.all([
      prisma.foodOrder.findMany({
        where,
        include: {
          restaurant: { select: { id: true, name: true, imageUrl: true } },
          items: {
            include: { menu: { select: { name: true, imageUrl: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.foodOrder.count({ where }),
    ]);

    return res.json(success('Food orders retrieved', {
      orders,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }));
  } catch (err) {
    console.error('getMyFoodOrders error:', err);
    return res.status(500).json(error('Failed to get food orders', err.message));
  }
};

/**
 * GET /api/food-orders/:id
 * Get detail of a specific food order
 */
const getFoodOrderById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const order = await prisma.foodOrder.findUnique({
      where: { id },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true } },
        restaurant: true,
        items: {
          include: { menu: { select: { name: true, price: true, imageUrl: true } } },
        },
      },
    });

    if (!order) return res.status(404).json(error('Food order not found'));
    if (
      order.passengerId !== userId &&
      order.driverId !== userId &&
      req.user.role !== 'ADMIN'
    ) {
      return res.status(403).json(error('Access denied'));
    }

    return res.json(success('Food order retrieved', { order }));
  } catch (err) {
    console.error('getFoodOrderById error:', err);
    return res.status(500).json(error('Failed to get food order', err.message));
  }
};

/**
 * PATCH /api/food-orders/:id/status
 * Update food order status (driver or restaurant/admin)
 * Valid transitions: PENDING → CONFIRMED → PREPARING → PICKED_UP → DELIVERED | CANCELLED
 */
const updateFoodOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status, driverId } = req.body;
  const userId = req.user.id;
  const io = req.app.get('io');

  const validStatuses = ['CONFIRMED', 'PREPARING', 'PICKED_UP', 'DELIVERED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json(error(`Status must be one of: ${validStatuses.join(', ')}`));
  }

  try {
    const order = await prisma.foodOrder.findUnique({ where: { id } });
    if (!order) return res.status(404).json(error('Food order not found'));

    // Permissions: passenger only cancel, driver/admin update all
    if (
      req.user.role === 'PASSENGER' &&
      order.passengerId !== userId &&
      status !== 'CANCELLED'
    ) {
      return res.status(403).json(error('Access denied'));
    }

    const updateData = { status };

    // If driver is picking up — assign driver
    if (status === 'PICKED_UP' && req.user.role === 'DRIVER' && !order.driverId) {
      updateData.driverId = userId;
    }

    if (status === 'DELIVERED') {
      updateData.paymentStatus = order.paymentMethod === 'CASH' ? 'PAID' : order.paymentStatus;
    }

    const updatedOrder = await prisma.foodOrder.update({
      where: { id },
      data: updateData,
    });

    // Notify passenger
    io.to(`passenger:${order.passengerId}`).emit('food_order:status_update', {
      orderId: id,
      status,
    });

    return res.json(success('Food order status updated', { order: updatedOrder }));
  } catch (err) {
    console.error('updateFoodOrderStatus error:', err);
    return res.status(500).json(error('Failed to update food order status', err.message));
  }
};

module.exports = {
  getRestaurants,
  getRestaurantById,
  createRestaurant,
  addMenuItem,
  createFoodOrder,
  getMyFoodOrders,
  getFoodOrderById,
  updateFoodOrderStatus,
};
