const express = require('express');
const { User } = require('../models');

const router = express.Router();

router.get('/login', (_req, res) => {
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({
      username: String(username || '').trim().toLowerCase(),
      password,
      isActive: true,
    }).lean();

    if (user) {
      req.session.user = user.username;
      req.session.role = user.role;
      return res.redirect('/');
    }

    res.render('login', { error: 'Invalid username or password' });
  } catch (error) {
    console.error('Login error:', error.message);
    res.render('login', { error: 'Unable to sign in right now. Please try again.' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
