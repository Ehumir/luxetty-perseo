'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const PREV_ARGOS = process.env.PERSEO_ARGOS_ENABLED;
const PREV_SECRET = process.env.ARGOS_SERVICE_SECRET;
const PREV_V3 = process.env.PERSEO_V3_ENABLED;

const { app } = require('../index');
const { clearAllSessionsForTests } = require('../argos/argosSessionStore');

function listenOnce() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function requestJson(server, method, path, body, headers = {}) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe('argosInternalApi', () => {
  let server;

  before(async () => {
    process.env.PERSEO_ARGOS_ENABLED = 'true';
    process.env.ARGOS_SERVICE_SECRET = 'test-argos-secret';
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_CRM_EXECUTE = 'false';
    server = await listenOnce();
  });

  after(() => {
    clearAllSessionsForTests();
    process.env.PERSEO_ARGOS_ENABLED = PREV_ARGOS;
    process.env.ARGOS_SERVICE_SECRET = PREV_SECRET;
    process.env.PERSEO_V3_ENABLED = PREV_V3;
    return new Promise((resolve) => server.close(resolve));
  });

  it('GET /internal/argos/health requires secret unless public', async () => {
    const bad = await requestJson(server, 'GET', '/internal/argos/health', null, {});
    assert.equal(bad.status, 401);

    const ok = await requestJson(server, 'GET', '/internal/argos/health', null, {
      'X-Argos-Service-Secret': 'test-argos-secret',
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
    assert.equal(ok.json.argos_enabled, true);
  });

  it('POST simulate-turn returns session_id and debug_trace', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/internal/argos/simulate-turn',
      {
        phone_sim: '5218100000001',
        text: 'Hola',
        flags: { deterministic_mode: true, crm_dry_run: true },
      },
      { 'X-Argos-Service-Secret': 'test-argos-secret' },
    );
    assert.equal(res.status, 200);
    assert.ok(res.json.session_id);
    assert.ok(typeof res.json.reply === 'string');
    assert.ok(Array.isArray(res.json.debug_trace));
    assert.ok(res.json.debug_trace.some((row) => row.type === 'whatsapp_blocked'));
  });

  it('POST reset-session mode crm', async () => {
    const turn = await requestJson(
      server,
      'POST',
      '/internal/argos/simulate-turn',
      { phone_sim: '5218100000002', text: 'Hola' },
      { 'X-Argos-Service-Secret': 'test-argos-secret' },
    );
    const reset = await requestJson(
      server,
      'POST',
      '/internal/argos/reset-session',
      { session_id: turn.json.session_id, mode: 'crm' },
      { 'X-Argos-Service-Secret': 'test-argos-secret' },
    );
    assert.equal(reset.status, 200);
    assert.equal(reset.json.ok, true);
    assert.equal(reset.json.mode, 'crm');
  });
});
