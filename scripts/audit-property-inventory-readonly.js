#!/usr/bin/env node
'use strict';

/**
 * Auditoría de inventario (solo lectura): lista propiedades con columnas disponibles.
 * No modifica datos. Usa variables SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY del .env.
 *
 * Uso: node scripts/audit-property-inventory-readonly.js [--limit=5]
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = require('../config/env');

const propertyInventoryService = require('../services/propertyInventoryService');

const argLimit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 5;

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const tiers = propertyInventoryService.SELECT_TIERS;

  for (let tier = 0; tier < tiers.length; tier++) {
    const { data, error } = await db.from('properties').select(tiers[tier]).limit(argLimit);
    if (!error) {
      if (tier > 0) {
        console.warn('property_inventory_select_fallback', { reason: 'audit_used_tier', tier });
      }
      printRows(data);
      return;
    }
    console.warn('audit_inventory_tier_error', { tier, message: error.message });
  }

  const { data: idOnly, error: idErr } = await db.from('properties').select('id').limit(argLimit);
  if (!idErr && Array.isArray(idOnly)) {
    console.warn('property_inventory_select_fallback', { reason: 'audit_id_only', message: 'minimal id select' });
    printRows(idOnly);
    return;
  }

  console.error('audit_inventory_error', idErr?.message || 'all select tiers failed');
  process.exit(1);
}

function printRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  console.log(JSON.stringify({ count: list.length, rows: list.map(normalizeRow) }, null, 2));
}

function normalizeRow(row) {
  const n = propertyInventoryService.normalizeInventoryProperty(row);
  return n || { id: row?.id, error: 'normalize_failed' };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
