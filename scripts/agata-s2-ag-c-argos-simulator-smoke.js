#!/usr/bin/env node
/**
 * AG-C — ARGOS simulator dry-run smoke (15 messages + meta referral).
 * Safe: no WhatsApp prod, no CRM writes when supabaseRaw is null.
 */
const { writeFile, mkdir } = require('fs/promises');
const path = require('path');
const { processInboundForArgos } = require('../argos/processInboundForArgos');

const EVIDENCE_DIR =
  process.env.EVIDENCE_DIR ||
  path.join(__dirname, '../docs/argos/evidence/ag-c-staging-simulator-20260623');

const PHONE = process.env.AG_C_PHONE_SIM || '528199971300';

const MESSAGES = [
  { id: 'A1', group: 'captación', text: 'Hola Luxetty, acabo de solicitar una valoración inicial para mi propiedad en Cumbres.', expected: 'landing_whatsapp' },
  { id: 'A2', group: 'captación', text: 'Quiero saber cuánto vale mi casa.', expected: 'landing_whatsapp' },
  { id: 'A3', group: 'captación', text: 'Quiero vender mi casa en Cumbres.', expected: 'landing_whatsapp' },
  { id: 'A4', group: 'captación', text: 'Vi su anuncio de valoración.', expected: 'unknown' },
  { id: 'A5', group: 'captación', text: 'No quiero malbaratar mi propiedad.', expected: 'landing_whatsapp' },
  { id: 'B6', group: 'propiedad', text: 'Me interesa esta propiedad.', expected: 'property_whatsapp' },
  { id: 'B7', group: 'propiedad', text: 'Precio.', expected: 'organic_direct' },
  { id: 'B8', group: 'propiedad', text: '¿Sigue disponible?', expected: 'organic_direct' },
  { id: 'B9', group: 'propiedad', text: 'Quiero verla.', expected: 'property_whatsapp' },
  { id: 'B10', group: 'propiedad', text: 'Me interesa LUX-A0470.', expected: 'property_whatsapp' },
  { id: 'C11', group: 'orgánico', text: 'Hola.', expected: 'organic_direct' },
  { id: 'C12', group: 'orgánico', text: 'Info.', expected: 'organic_direct' },
  { id: 'C13', group: 'orgánico', text: 'Quiero hablar con un asesor.', expected: 'organic_direct' },
  { id: 'D14', group: 'broker', text: 'Soy asesor inmobiliario.', expected: 'portal_broker' },
  { id: 'D15', group: 'broker', text: 'Tengo cliente para esa propiedad. ¿Comparten comisión?', expected: 'portal_broker' },
];

const META_REFERRAL_PAYLOAD = {
  entry: [{
    changes: [{
      value: {
        messages: [{
          type: 'text',
          text: { body: 'Me interesa la propiedad del anuncio' },
          referral: {
            source_type: 'ad',
            source_url: 'https://fb.me/test-ag-c-staging',
            ad_id: 'ad-ag-c-staging-001',
            campaign_id: 'camp-ag-c-staging-001',
            ctwa_clid: 'clid-ag-c-staging',
            headline: 'Valoración Cumbres — Luxetty',
          },
        }],
      },
    }],
  }],
};

function passFail(expected, detected) {
  if (expected === detected) return 'PASS';
  return 'FAIL';
}

async function runTurn({ session_id, text, raw_payload }) {
  const result = await processInboundForArgos({
    session_id,
    phone_sim: PHONE,
    text,
    raw_payload: raw_payload || null,
    flags: { crm_dry_run: true, deterministic: true },
    supabaseRaw: null,
  });
  const snap = result.conversation_snapshot || {};
  return {
    text,
    detected: snap.inbound_source_type || null,
    confidence: snap.inbound_source_confidence || null,
    organic_reason: snap.inbound_organic_reason || null,
    reply_preview: String(result.reply || '').slice(0, 160),
    crm_would_create_lead: result.crm_dry_run?.would_create_lead ?? null,
    error_code: result.error_code || null,
  };
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const results = [];

  for (const msg of MESSAGES) {
    const session_id = `ag-c-${msg.id}-${Date.now()}`;
    const row = await runTurn({ session_id, text: msg.text });
    results.push({
      id: msg.id,
      group: msg.group,
      expected: msg.expected,
      status: passFail(msg.expected, row.detected),
      ...row,
    });
  }

  const meta = await runTurn({
    session_id: `ag-c-meta-${Date.now()}`,
    text: 'Me interesa la propiedad del anuncio',
    raw_payload: META_REFERRAL_PAYLOAD,
  });
  results.push({
    id: 'META_SIM',
    group: 'meta_campaign',
    expected: 'meta_campaign',
    status: meta.detected === 'meta_campaign' ? 'PASS' : 'FAIL',
    ...meta,
  });

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const report = {
    timestamp: new Date().toISOString(),
    mode: 'local_argos_simulator_dry_run',
    perseo_note: 'PERSEO_BASE_URL_STAGING empty — smoke via in-process ARGOS simulator',
    phone_sim: PHONE,
    summary: { pass, fail, total: results.length, verdict: fail === 0 ? 'PASS' : 'FAIL' },
    results,
  };

  const out = path.join(EVIDENCE_DIR, 'simulator-smoke-report.json');
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  for (const r of results.filter((x) => x.status === 'FAIL')) {
    console.error(`FAIL ${r.id}: expected=${r.expected} detected=${r.detected}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
