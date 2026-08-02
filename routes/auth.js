const express = require('express');
const { User } = require('../models');

const router = express.Router();

router.get('/login', async (_req, res) => {
  try {
    const { Setting } = require('../models');
    const settingsRows = await Setting.find().lean();
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });
    res.render('login', { error: null, settings });
  } catch (err) {
    console.error('Login render settings error:', err.message);
    res.render('login', { error: null });
  }
});


router.post('/login', async (req, res) => {
  try {

    const { username, password } = req.body;

    console.log("INPUT USER:", username);
    console.log("INPUT PASSWORD:", password);

console.log("TOTAL USERS:", await User.countDocuments());

    const user = await User.findOne({
      username: String(username || '').trim().toLowerCase()
    }).lean();


    console.log("DATABASE USER:", user);


    if (!user) {
      const { Setting } = require('../models');
      const settingsRows = await Setting.find().lean();
      const settings = {};
      settingsRows.forEach(r => { settings[r.key] = r.value; });
      return res.render('login', { 
        error: 'User not found',
        settings
      });
    }


    if (user.password !== password) {
      const { Setting } = require('../models');
      const settingsRows = await Setting.find().lean();
      const settings = {};
      settingsRows.forEach(r => { settings[r.key] = r.value; });
      return res.render('login', { 
        error: 'Wrong password',
        settings
      });
    }


    req.session.user = user.username;
    req.session.role = user.role;


    return res.redirect('/');


  } catch (error) {

    console.error('Login error:', error.message);

    try {
      const { Setting } = require('../models');
      const settingsRows = await Setting.find().lean();
      const settings = {};
      settingsRows.forEach(r => { settings[r.key] = r.value; });
      res.render('login', { error: 'Unable to sign in right now. Please try again.', settings });
    } catch (_) {
      res.render('login', { error: 'Unable to sign in right now. Please try again.' });
    }

  }
});


router.get('/logout', (req, res) => {

  req.session.destroy(() => {
    res.redirect('/login');
  });

});


module.exports = router;