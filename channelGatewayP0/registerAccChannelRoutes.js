'use strict';

const {
  isAccFacebookEnabled,
  isAccInstagramEnabled,
} = require('../config/accP0Flags');

/**
 * Rutas FB/IG Sprint 1: registradas pero inactivas (404) hasta Sprint 4.
 * No modifica GET/POST /webhook (WhatsApp legacy).
 * @param {import('express').Express} app
 */
function registerAccChannelRoutes(app) {
  const inactive = (channel) => (_req, res) => {
    res.status(404).json({
      ok: false,
      error: 'channel_not_enabled',
      channel,
      hint: 'ACC_*_ENABLED flags are OFF (Sprint 1 foundation).',
    });
  };

  app.get('/webhook/facebook', (req, res) => {
    if (!isAccFacebookEnabled()) {
      inactive('facebook')(req, res);
      return;
    }
    res.sendStatus(404);
  });

  app.post('/webhook/facebook', (req, res) => {
    if (!isAccFacebookEnabled()) {
      inactive('facebook')(req, res);
      return;
    }
    res.sendStatus(404);
  });

  app.get('/webhook/instagram', (req, res) => {
    if (!isAccInstagramEnabled()) {
      inactive('instagram')(req, res);
      return;
    }
    res.sendStatus(404);
  });

  app.post('/webhook/instagram', (req, res) => {
    if (!isAccInstagramEnabled()) {
      inactive('instagram')(req, res);
      return;
    }
    res.sendStatus(404);
  });
}

module.exports = { registerAccChannelRoutes };
