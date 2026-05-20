#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Validate Railway staging webhook reachability + DB worker heartbeat.
 * Requires: PERSEO_BASE_URL_STAGING, VERIFY_TOKEN (webhook probe), SUPABASE_* (heartbeat)
 *
 * Usage:
 *   PERSEO_BASE_URL_STAGING=https://... PERSEO_STAGING_CONFIRMED=true node scripts/staging-railway-check.js
 */

require('dotenv').config();

const { VERIFY_TOKEN } = require('../config/env');
const { supabase } = require('../services/supabaseService');
const { getStagingBaseUrl } = require('./staging/stagingEnv');
const { parseArgs, assertStagingSafe, printResult, exitCode, maskUrl } = require('./staging/stagingLib');

async function probeWebhook(baseUrl) {
  const url = new URL('/webhook', baseUrl);
  url.searchParams.set('hub.mode', 'subscribe');
  url.searchParams.set('hub.verify_token', VERIFY_TOKEN || 'luxetty_token');
  url.searchParams.set('hub.challenge', 'm4-staging-probe');

  const res = await fetch(url.toString(), { method: 'GET' });
  const body = await res.text();
  return {
    ok: res.status === 200 && body === 'm4-staging-probe',
    status: res.status,
    body_preview: body.slice(0, 80),
    url: maskUrl(url.origin),
  };
}

async function probeWorkerHeartbeats() {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('crm_worker_heartbeats')
    .select('worker_id, last_seen_at, metadata')
    .gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false })
    .limit(10);

  if (error) return { ok: false, error: error.message };
  return {
    ok: Array.isArray(data) && data.length > 0,
    count: data?.length || 0,
    recent: data || [],
    window_minutes: 15,
  };
}

async function probeOutboxQueue() {
  const { count: pending } = await supabase
    .from('crm_outbox')
    .select('*', { count: 'exact', head: true })
    .in('status', ['pending', 'processing', 'failed']);
  const { count: dlq } = await supabase.from('crm_dead_letters').select('*', { count: 'exact', head: true });
  return { pending_or_active: pending ?? 0, dead_letter_count: dlq ?? 0 };
}

async function main() {
  const args = parseArgs();
  assertStagingSafe(args);

  const baseUrl = getStagingBaseUrl();
  if (!baseUrl) {
    const result = {
      ok: false,
      error: 'Set PERSEO_BASE_URL_STAGING (or PERSEO_BASE_URL) to the Railway staging webhook service',
    };
    printResult('staging-railway-check', result, args.json);
    exitCode(result);
    return;
  }

  let webhook = { ok: false, skipped: true, reason: 'fetch unavailable' };
  try {
    webhook = await probeWebhook(baseUrl);
  } catch (err) {
    webhook = { ok: false, error: String(err?.message || err) };
  }

  const heartbeats = await probeWorkerHeartbeats();
  const queue = await probeOutboxQueue();

  const result = {
    ok: webhook.ok === true,
    details: {
      base_url: maskUrl(baseUrl),
      webhook_probe: webhook,
      worker_heartbeats_15m: heartbeats,
      outbox_queue: queue,
      note: 'Worker heartbeats require Railway service: node workers/crmOutboxRailwayWorker.js with Fase 2 flags',
    },
  };

  if (process.env.M4_RAILWAY_REQUIRE_HEARTBEAT === 'true') {
    result.ok = result.ok && heartbeats.ok === true;
  }

  printResult('staging-railway-check', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
