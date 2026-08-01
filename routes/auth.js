const express = require('express');
const { User } = require('../models');

const router = express.Router();

router.get('/login', (_req, res) => {
  res.render('login', { error: null });
});


router.post('/login', async (req, res) => {
  try {

    const { username, password } = req.body;

    console.log("INPUT USER:", username);
    console.log("INPUT PASSWORD:", password);


    const user = await User.findOne({
      username: String(username || '').trim().toLowerCase()
    }).lean();


    console.log("DATABASE USER:", user);


    if (!user) {
      return res.render('login', { 
        error: 'User not found' 
      });
    }


    if (user.password !== password) {
      return res.render('login', { 
        error: 'Wrong password' 
      });
    }


    req.session.user = user.username;
    req.session.role = user.role;


    return res.redirect('/');


  } catch (error) {

    console.error('Login error:', error.message);

    res.render('login', { 
      error: 'Unable to sign in right now. Please try again.' 
    });

  }
});


router.get('/logout', (req, res) => {

  req.session.destroy(() => {
    res.redirect('/login');
  });

});


module.exports = router;