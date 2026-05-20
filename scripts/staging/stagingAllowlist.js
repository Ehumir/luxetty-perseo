'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOWLIST = path.join(
  __dirname,
  '../../docs/argos/whatsapp-smoke/m4-02/allowlist-10.yaml',
);
const LOCAL_ALLOWLIST = path.join(
  __dirname,
  '../../docs/argos/whatsapp-smoke/m4-02/allowlist-10.local.yaml',
);

function resolveAllowlistPath(custom) {
  if (custom) return path.resolve(custom);
  if (process.env.M4_WA_ALLOWLIST_PATH) return path.resolve(process.env.M4_WA_ALLOWLIST_PATH);
  if (fs.existsSync(LOCAL_ALLOWLIST)) return LOCAL_ALLOWLIST;
  return DEFAULT_ALLOWLIST;
}

function parseSimpleYamlPhones(content) {
  const pilots = [];
  const blocks = content.split(/\n\s*-\s+id:\s*/).slice(1);
  for (const block of blocks) {
    const idMatch = block.match(/^(\S+)/);
    const phoneMatch = block.match(/phone:\s*["']?([^"'\n]+)["']?/);
    const carrilMatch = block.match(/carril:\s*(\S+)/);
    const objetivoMatch = block.match(/objetivo:\s*(.+)/);
    const mediaMatch = block.match(/media_cases:\s*\[([^\]]*)\]/);
    if (!idMatch || !phoneMatch) continue;
    pilots.push({
      id: idMatch[1].trim(),
      phone: phoneMatch[1].trim(),
      carril: carrilMatch ? carrilMatch[1].trim() : null,
      objetivo: objetivoMatch ? objetivoMatch[1].trim() : null,
      media_cases: mediaMatch
        ? mediaMatch[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    });
  }
  return pilots;
}

function isPlaceholderPhone(phone) {
  const p = String(phone || '');
  return /X{3,}/i.test(p) || p.includes('0000000') && p.length < 14;
}

function normalizeMxWa(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('521') && digits.length === 13) return digits;
  if (digits.startsWith('52') && digits.length === 12) return `521${digits.slice(2)}`;
  if (digits.length === 10) return `521${digits}`;
  return digits;
}

function loadAllowlist(opts = {}) {
  const filePath = resolveAllowlistPath(opts.path);
  const content = fs.readFileSync(filePath, 'utf8');
  const pilots = parseSimpleYamlPhones(content);
  return { filePath, pilots };
}

function validateAllowlist(opts = {}) {
  const { filePath, pilots } = loadAllowlist(opts);
  const errors = [];
  if (pilots.length !== 10) {
    errors.push(`expected 10 pilots, found ${pilots.length}`);
  }
  const phones = new Set();
  for (const p of pilots) {
    if (isPlaceholderPhone(p.phone)) {
      errors.push(`${p.id}: placeholder phone ${p.phone}`);
    }
    const norm = normalizeMxWa(p.phone);
    if (phones.has(norm)) errors.push(`${p.id}: duplicate phone ${norm}`);
    phones.add(norm);
    p.phone_normalized = norm;
  }
  return {
    ok: errors.length === 0,
    filePath,
    pilots,
    errors,
  };
}

module.exports = {
  DEFAULT_ALLOWLIST,
  LOCAL_ALLOWLIST,
  resolveAllowlistPath,
  loadAllowlist,
  validateAllowlist,
  isPlaceholderPhone,
  normalizeMxWa,
};
