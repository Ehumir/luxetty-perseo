// Temporary schema probe — safe to delete after diagnosis
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectTable(table) {
  const { data, error } = await sb.from(table).select('*').limit(1);
  if (error) {
    console.log(`${table.toUpperCase()} ERROR: ${error.message}`);
    return;
  }
  const row = data && data[0];
  if (!row) {
    console.log(`${table.toUpperCase()} -> (no rows — cannot infer columns)`);
    return;
  }
  const cols = Object.keys(row);
  const jsonbCols = cols.filter(
    (k) => row[k] !== null && typeof row[k] === 'object' && !Array.isArray(row[k])
  );
  console.log(`\n${table.toUpperCase()}`);
  console.log('  All columns :', cols.join(', '));
  console.log('  Object/JSONB cols:', jsonbCols.length ? jsonbCols.join(', ') : '(none)');
  jsonbCols.forEach((k) => {
    console.log(`    ${k}:`, JSON.stringify(row[k]));
  });
}

async function main() {
  for (const t of ['conversations', 'conversation_messages', 'leads', 'contacts']) {
    await inspectTable(t);
  }
}
main().catch(console.error);
