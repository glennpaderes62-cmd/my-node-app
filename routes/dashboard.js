const express = require('express');
const {
  Product,
  Prescription,
  Sale,
  Setting,
  User,
  UserPermission,
} = require('../models');
const { isAuthenticated } = require('../middleware/auth');
const {
  toLegacyProduct,
  toLegacyPrescription,
  toLegacySale,
  toLegacyUser,
} = require('../utils/legacyFormat');

const router = express.Router();

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const [products, prescriptions, sales, settingsRows, usersList, permissionsRows] =
      await Promise.all([
        Product.find().sort({ name: 1 }).lean(),
        Prescription.find().sort({ createdAt: -1 }).lean(),
        Sale.find().sort({ soldAt: -1 }).lean(),
        Setting.find().lean(),
        User.find().sort({ createdAt: 1 }).lean(),
        UserPermission.find().lean(),
      ]);

    const settings = {};
    settingsRows.forEach((row) => {
      settings[row.key] = row.value;
    });

    const allProducts = products.map(toLegacyProduct);
    const lowStockThreshold = 10;
    const inventorySummary = {
      totalProducts: allProducts.length,
      totalStockValue: allProducts.reduce((sum, p) => sum + p.price * p.stock, 0),
      lowStockCount: allProducts.filter((p) => p.stock <= lowStockThreshold).length,
      prescriptionCount: allProducts.filter(
        (p) => p.requires_prescription === 1 || p.requires_prescription === '1'
      ).length,
      categoryCounts: allProducts.reduce((counts, p) => {
        const category = p.category || 'Unspecified';
        counts[category] = (counts[category] || 0) + 1;
        return counts;
      }, {}),
      lowStockThreshold,
    };

    const allPages = ['pos', 'inventory', 'prescriptions', 'sales', 'end_of_day', 'admin', 'users'];
    const userPermissions = {};

    permissionsRows.forEach((row) => {
      const usernameKey = String(row.username || '').trim();
      if (!userPermissions[usernameKey]) userPermissions[usernameKey] = [];
      userPermissions[usernameKey].push(row.pageName);
    });

    const currentUser = String(req.session.user || '').trim();
    const currentRole = String(req.session.role || '').trim().toLowerCase();
    const allowedPages = ['superadmin', 'admin'].includes(currentRole)
      ? allPages
      : userPermissions[currentUser] || [];

    res.render('dashboard', {
      user: currentUser,
      role: currentRole,
      products: allProducts,
      prescriptions: prescriptions.map(toLegacyPrescription),
      sales: sales.map(toLegacySale),
      settings,
      inventorySummary,
      usersList: usersList.map(toLegacyUser),
      userPermissions,
      allowedPages,
    });
  } catch (error) {
    console.error('Dashboard load error:', error.message);
    res.status(500).send('Unable to load dashboard.');
  }
});

module.exports = router;
