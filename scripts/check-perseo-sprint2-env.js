#!/usr/bin/env node
'use strict';

/**
 * P0 — Ejecutar en el MISMO host/proceso donde corre el webhook PERSEO (o con el mismo .env cargado).
 * No imprime secretos; solo flags y ref derivado de SUPABASE_URL.
 *
 *   node scripts/check-perseo-sprint2-env.js
 */

require('dotenv').config();

const url = String(process.env.SUPABASE_URL || '').trim();
let projectRef = null;
try {
  const m = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  projectRef = m ? m[1] : null;
} catch {
  projectRef = null;
}

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const v2Raw = process.env.PERSEO_POLICY_V2_ENABLED;
const debugRaw = process.env.PERSEO_POLICY_DEBUG_LOG;

const out = {
  PERSEO_POLICY_V2_ENABLED_raw: v2Raw === undefined || v2Raw === '' ? '(unset)' : v2Raw,
  perseo_policy_v2_reads_global_settings: v2Raw === 'true',
  PERSEO_POLICY_DEBUG_LOG_raw: debugRaw === undefined || debugRaw === '' ? '(unset)' : debugRaw,
  perseo_policy_debug_log_active: debugRaw === 'true',
  SUPABASE_URL_set: Boolean(url),
  supabase_project_ref_from_url: projectRef || '(no se pudo derivar; revisa formato https://<ref>.supabase.co)',
  SUPABASE_SERVICE_ROLE_KEY_set: Boolean(key && String(key).length > 20),
};

console.log(JSON.stringify(out, null, 2));
console.error(
  '\nCompara `supabase_project_ref_from_url` con el proyecto de ATENA donde ejecutas el SQL de ai_conversation_channel_settings.\n' +
    'Tras cambiar .env: reinicia PERSEO y busca en logs `server_started` → perseo_policy_v2_reads_global_settings.\n'
);
