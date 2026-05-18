'use strict';

const { isArgosEnabled, getArgosServiceSecret } = require('../../config/argosFlags');
const { ARGOS_ERROR_CODES } = require('../constants');

function argosAuthMiddleware(req, res, next) {
  if (!isArgosEnabled()) {
    return res.status(403).json({
      ok: false,
      error_code: ARGOS_ERROR_CODES.DISABLED,
      message: 'PERSEO_ARGOS_ENABLED is not true',
    });
  }

  const healthPublic =
    process.env.ARGOS_HEALTH_PUBLIC === 'true' &&
    req.method === 'GET' &&
    req.path === '/health';

  if (!healthPublic) {
    const secret = getArgosServiceSecret();
    const header = String(req.headers['x-argos-service-secret'] || '').trim();
    if (!secret || header !== secret) {
      return res.status(401).json({
        ok: false,
        error_code: ARGOS_ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid X-Argos-Service-Secret',
      });
    }
  }

  req.argosAdminUserId = req.headers['x-argos-admin-user-id'] || null;
  next();
}

module.exports = {
  argosAuthMiddleware,
};
