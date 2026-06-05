'use strict';

/**
 * P1 — audita que todos los listings publicados activos hidraten activeProperty vía normalizeInventoryProperty.
 */

require('dotenv').config();

const propertyInventoryService = require('../services/propertyInventoryService');
const { supabase } = require('../services/supabaseService');

async function fetchPublishedRows() {
  const tiers = [
    'id, listing_id, slug, title, operation_type, price, neighborhood, city, status, is_published',
    'id, listing_id, slug, title, operation_type, price, neighborhood, city',
    'id, listing_id, slug, title, price',
  ];
  for (const columns of tiers) {
    const { data, error } = await supabase.from('properties').select(columns).limit(500);
    if (!error && Array.isArray(data)) return data;
  }
  return [];
}

async function main() {
  const rows = await fetchPublishedRows();
  const active = rows.filter((r) => {
    const status = String(r.status || '').toLowerCase();
    if (status === 'sold' || status === 'rented') return false;
    if (r.is_published === false) return false;
    return !!(r.listing_id || r.slug);
  });

  const failures = [];
  for (const row of active) {
    try {
      const ap = propertyInventoryService.normalizeInventoryProperty(row);
      if (!ap?.id || !ap?.code) {
        failures.push({ listing_id: row.listing_id, reason: 'missing_id_or_code' });
      }
    } catch (e) {
      failures.push({ listing_id: row.listing_id, reason: String(e.message || e) });
    }
  }

  console.log(`=== ACTIVE PROPERTY HYDRATION AUDIT ===`);
  console.log(`Published/active rows scanned: ${active.length}`);
  console.log(`Hydration failures: ${failures.length}`);

  if (failures.length) {
    for (const f of failures.slice(0, 20)) {
      console.log(`- ${f.listing_id || '?'}: ${f.reason}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
