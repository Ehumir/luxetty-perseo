'use strict';

const { ARGOS_BLOCKED_TABLES, ARGOS_BLOCKED_RPC_PREFIXES, ARGOS_ERROR_CODES } = require('./constants');

function isBlockedTable(table) {
  return ARGOS_BLOCKED_TABLES.has(String(table || '').trim());
}

function isBlockedRpc(fnName) {
  const name = String(fnName || '');
  return ARGOS_BLOCKED_RPC_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function throwBlocked(kind, detail) {
  const err = new Error(`ARGOS side-effect blocked: ${kind} ${detail || ''}`.trim());
  err.code = ARGOS_ERROR_CODES.SIDE_EFFECT_BLOCKED;
  err.argos_blocked = { kind, detail };
  throw err;
}

/**
 * Proxy Supabase client: SELECT allowed on operational tables; mutations blocked.
 * @param {object} client
 * @param {{ onMutationAttempt?: (detail: object) => void }} hooks
 */
function createArgosNoWriteSupabase(client, hooks = {}) {
  if (!client || typeof client.from !== 'function') {
    return client;
  }

  const mutationAttempts = [];

  function wrapBuilder(table, builder) {
    const blocked = isBlockedTable(table);
    const handler = {
      get(target, prop) {
        const val = target[prop];
        if (typeof val !== 'function') return val;
        if (
          blocked &&
          ['insert', 'update', 'upsert', 'delete'].includes(prop)
        ) {
          return (...args) => {
            const detail = { table, op: prop, args };
            mutationAttempts.push(detail);
            if (typeof hooks.onMutationAttempt === 'function') {
              hooks.onMutationAttempt(detail);
            }
            throwBlocked(prop, table);
          };
        }
        return (...args) => val.apply(target, args);
      },
    };
    return new Proxy(builder, handler);
  }

  return {
    from(table) {
      return wrapBuilder(table, client.from(table));
    },
    rpc(fnName, params, opts) {
      if (isBlockedRpc(fnName)) {
        const detail = { rpc: fnName, params };
        mutationAttempts.push(detail);
        if (typeof hooks.onMutationAttempt === 'function') {
          hooks.onMutationAttempt(detail);
        }
        throwBlocked('rpc', fnName);
      }
      return client.rpc(fnName, params, opts);
    },
    getMutationAttempts() {
      return [...mutationAttempts];
    },
    clearMutationAttempts() {
      mutationAttempts.length = 0;
    },
    /** @deprecated use underlying client only outside argos */
    _raw: client,
  };
}

module.exports = {
  createArgosNoWriteSupabase,
  isBlockedTable,
  throwBlocked,
};
