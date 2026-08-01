const authRoutes = require('./auth');
const dashboardRoutes = require('./dashboard');
const adminRoutes = require('./admin');
const inventoryRoutes = require('./inventory');
const posRoutes = require('./pos');

function registerRoutes(app) {
  app.use('/', authRoutes);
  app.use('/', dashboardRoutes);
  app.use('/admin', adminRoutes);
  app.use('/inventory', inventoryRoutes);
  app.use('/', posRoutes);
}

module.exports = registerRoutes;
