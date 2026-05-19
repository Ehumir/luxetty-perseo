'use strict';

const fs = require('node:fs');
const path = require('node:path');

const POLICY_DIR = path.join(__dirname, '../../../config/policy');

let _cache = null;

function loadPolicyBundle() {
  if (_cache) return _cache;
  const read = (name) => JSON.parse(fs.readFileSync(path.join(POLICY_DIR, name), 'utf8'));
  _cache = {
    commercial: read('commercial-policy.v1.json'),
    zones: read('active-zones.v1.json'),
    templates: read('decline-templates.v1.json'),
  };
  return _cache;
}

function clearPolicyConfigCache() {
  _cache = null;
}

module.exports = {
  loadPolicyBundle,
  clearPolicyConfigCache,
};
