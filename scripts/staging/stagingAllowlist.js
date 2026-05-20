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
const LOCAL_ALLOWLIST_B1 = path.join(
  __dirname,
  '../../docs/argos/whatsapp-smoke/m4-02/allowlist-b1.local.yaml',
);

function getDefaultMinPilots() {
  const envMin = Number(process.env.M4_WA_ALLOWLIST_MIN);
  return Number.isFinite(envMin) && envMin > 0 ? envMin : 10;
}

function resolveAllowlistPath(custom, minPilots = getDefaultMinPilots()) {
  if (custom) return path.resolve(custom);
  if (process.env.M4_WA_ALLOWLIST_PATH) return path.resolve(process.env.M4_WA_ALLOWLIST_PATH);
  if (minPilots <= 3 && fs.existsSync(LOCAL_ALLOWLIST_B1)) return LOCAL_ALLOWLIST_B1;
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
  return /X{3,}/i.test(p) || (p.includes('0000000') && p.length < 14);
}

function normalizeMxWa(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('521') && digits.length === 13) return digits;
  if (digits.startsWith('52') && digits.length === 12) return `521${digits.slice(2)}`;
  if (digits.length === 10) return `521${digits}`;
  return digits;
}

function loadAllowlist(opts = {}) {
  const minPilots = opts.minPilots ?? getDefaultMinPilots();
  const filePath = resolveAllowlistPath(opts.path, minPilots);
  const content = fs.readFileSync(filePath, 'utf8');
  const pilots = parseSimpleYamlPhones(content);
  return { filePath, pilots, minPilots };
}

function validateAllowlist(opts = {}) {
  const minPilots = opts.minPilots ?? getDefaultMinPilots();
  const maxPilots = opts.maxPilots ?? 10;
  const { filePath, pilots } = loadAllowlist({ ...opts, minPilots });

  const errors = [];
  const valid = [];
  const phones = new Set();

  for (const p of pilots) {
    if (isPlaceholderPhone(p.phone)) {
      errors.push(`${p.id}: placeholder phone ${p.phone}`);
      continue;
    }
    const norm = normalizeMxWa(p.phone);
    if (norm.length < 12) {
      errors.push(`${p.id}: invalid phone length ${p.phone}`);
      continue;
    }
    if (phones.has(norm)) {
      errors.push(`${p.id}: duplicate phone ${norm}`);
      continue;
    }
    phones.add(norm);
    valid.push({ ...p, phone_normalized: norm });
  }

  if (valid.length < minPilots) {
    errors.push(`need at least ${minPilots} valid pilots, found ${valid.length}`);
  }
  if (valid.length > maxPilots) {
    errors.push(`max ${maxPilots} pilots allowed, found ${valid.length}`);
  }

  const tier = minPilots <= 3 ? 'b1' : 'b2';

  return {
    ok: errors.length === 0,
    filePath,
    pilots: valid.slice(0, maxPilots),
    all_parsed: pilots.length,
    valid_count: valid.length,
    min_required: minPilots,
    tier,
    errors,
  };
}

module.exports = {
  DEFAULT_ALLOWLIST,
  LOCAL_ALLOWLIST,
  LOCAL_ALLOWLIST_B1,
  getDefaultMinPilots,
  resolveAllowlistPath,
  loadAllowlist,
  validateAllowlist,
  isPlaceholderPhone,
  normalizeMxWa,
};
