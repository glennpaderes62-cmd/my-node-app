const { User } = require('../models');

async function seedDefaults() {
  const existing = await User.findOne({ username: 'superadmin' });
  if (existing) return;

  await User.create({
    username: 'superadmin',
    password: 'admin123',
    role: 'superadmin',
  });

  console.log('Default superadmin account created');
}

module.exports = seedDefaults;
