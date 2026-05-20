'use strict';

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} ms
 * @param {T} [fallback]
 * @returns {Promise<T>}
 */
async function runWithTimeout(fn, ms, fallback = undefined) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { runWithTimeout };
