const { Setting } = require('../models');

async function maintenanceGuard(req, res, next) {
  if (req.path === '/login' || req.path === '/logout' || req.path === '/health') {
    return next();
  }

  try {
    const setting = await Setting.findOne({ key: 'maintenance_mode' }).lean();
    const isMaintenance = setting && setting.value === '1';

    if (isMaintenance) {
      if (req.session.user === 'superadmin' || req.session.user === 'creator') {
        return next();
      }

      return res.send(`
        <div style="text-align:center; margin-top:100px; font-family:sans-serif;">
          <h1>System Under Maintenance</h1>
          <p>Kasalukuyang inaayos ang sistema ng creator. Mangyaring bumalik mamaya.</p>
        </div>
      `);
    }

    next();
  } catch (error) {
    console.error('Maintenance check error:', error.message);
    next();
  }
}

module.exports = maintenanceGuard;
