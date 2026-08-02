const express = require('express');
const { Setting, User, UserPermission } = require('../models');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

async function upsertSetting(key, value) {
  await Setting.findOneAndUpdate(
    { key },
    { key, value: String(value ?? '') },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

router.post('/branding', isAuthenticated, async (req, res) => {
  try {
    const { app_name, app_logo_url, app_address, app_tin } = req.body;
    await upsertSetting('app_name', app_name);
    await upsertSetting('app_logo_url', app_logo_url || '');
    await upsertSetting('app_address', app_address || '');
    await upsertSetting('app_tin', app_tin || '');
    res.redirect('/');
  } catch (error) {
    console.error('Branding update error:', error.message);
    res.redirect('/');
  }
});

router.post('/maintenance', isAuthenticated, async (req, res) => {
  try {
    const val = req.body.maintenance_mode ? '1' : '0';
    await upsertSetting('maintenance_mode', val);
    res.redirect('/');
  } catch (error) {
    console.error('Maintenance update error:', error.message);
    res.redirect('/');
  }
});

router.post('/create-user', isAuthenticated, async (req, res) => {
  try {
    const { username, password, role, allowed_pages } = req.body;
    const pages = Array.isArray(allowed_pages)
      ? allowed_pages
      : allowed_pages
        ? [allowed_pages]
        : [];

    await User.create({
      username: String(username || '').trim().toLowerCase(),
      password,
      role,
    });

    if (pages.length > 0) {
      await UserPermission.insertMany(
        pages.map((pageName) => ({
          username: String(username || '').trim().toLowerCase(),
          pageName,
        }))
      );
    }

    res.redirect('/');
  } catch (error) {
    console.error('Create user error:', error.message);
    res.redirect('/');
  }
});

router.post('/update-user-access', isAuthenticated, async (req, res) => {
  try {
    const { username, allowed_pages } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const pages = Array.isArray(allowed_pages)
      ? allowed_pages
      : allowed_pages
        ? [allowed_pages]
        : [];

    await UserPermission.deleteMany({ username: normalizedUsername });

    if (pages.length > 0) {
      await UserPermission.insertMany(
        pages.map((pageName) => ({
          username: normalizedUsername,
          pageName,
        }))
      );
    }

    res.redirect('/');
  } catch (error) {
    console.error('Update user access error:', error.message);
    res.redirect('/');
  }
});

module.exports = router;

// Superadmin actions: delete user, sale, product
router.post('/delete-user', isAuthenticated, async (req, res) => {
  try {
    if (String(req.session.role || '').toLowerCase() !== 'superadmin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Missing username' });
    await User.deleteOne({ username: String(username).trim().toLowerCase() });
    await UserPermission.deleteMany({ username: String(username).trim().toLowerCase() });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to delete user' });
  }
});

router.post('/delete-sale', isAuthenticated, async (req, res) => {
  try {
    if (String(req.session.role || '').toLowerCase() !== 'superadmin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const { saleId } = req.body;
    if (!saleId) return res.status(400).json({ success: false, message: 'Missing sale id' });
    const { Sale } = require('../models');
    await Sale.deleteOne({ id: saleId });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete sale error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to delete sale' });
  }
});

router.post('/delete-product', isAuthenticated, async (req, res) => {
  try {
    if (String(req.session.role || '').toLowerCase() !== 'superadmin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: 'Missing product id' });
    const { Product } = require('../models');
    await Product.deleteOne({ _id: productId });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete product error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to delete product' });
  }
});
