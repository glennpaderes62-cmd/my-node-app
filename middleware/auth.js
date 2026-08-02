function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

function isSuperadmin(req, res, next) {
  if (String(req.session.role || '').toLowerCase() === 'superadmin') return next();
  // For AJAX/API callers respond with JSON forbidden, otherwise redirect
  if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(403).json({ success: false, message: 'Forbidden' });
  return res.status(403).send('Forbidden');
}

module.exports = {
  isAuthenticated,
  isSuperadmin,
};
