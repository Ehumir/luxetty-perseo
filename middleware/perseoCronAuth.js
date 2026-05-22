'use strict';

function perseoCronAuthMiddleware(req, res, next) {
  const expected = String(process.env.PERSEO_CRON_SECRET || '').trim();
  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'PERSEO_CRON_SECRET_not_configured',
    });
  }

  const header = String(req.headers['x-perseo-cron-secret'] || '').trim();
  const bearer = String(req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const provided = header || bearer;

  if (!provided || provided !== expected) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  next();
}

module.exports = {
  perseoCronAuthMiddleware,
};
