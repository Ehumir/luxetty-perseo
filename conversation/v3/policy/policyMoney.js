'use strict';

const { normalizeText } = require('../../../utils/text');
const { parseMoneyAmount } = require('../interpreter/moneyParser');

/**
 * @param {string} text
 * @returns {{ amount: number, currency: 'MXN'|'USD', operationType: 'sale'|'rent'|null }|null}
 */
function parsePolicyMoney(text) {
  const raw = String(text || '');
  const t = normalizeText(raw);
  if (!t) return null;

  const rentHint = /\b(renta|rentar|alquiler|arrendar|mensual(?:es)?)\b/i.test(t);
  const saleHint = /\b(vend|venta|vender|vendo)\b/i.test(t);
  const operationType = rentHint && !saleHint ? 'rent' : saleHint ? 'sale' : null;

  const usdMil = t.match(
    /(\d+(?:[.,]\d+)?)\s*mil\s*(?:usd|u\.?\s*s\.?\s*d\.?|dolar(?:es)?)/i,
  );
  if (usdMil) {
    const n = Number(usdMil[1].replace(',', '.')) * 1000;
    if (Number.isFinite(n) && n > 0) {
      return { amount: Math.round(n), currency: 'USD', operationType };
    }
  }

  const usdMatch = t.match(
    /(?:usd|u\.?\s*s\.?\s*d\.?|dolar(?:es)?)\s*[\$]?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)|(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(?:usd|u\.?\s*s\.?\s*d\.?|dolar(?:es)?)/i,
  );
  if (usdMatch) {
    const numStr = usdMatch[1] || usdMatch[2];
    let n = Number(String(numStr).replace(/,/g, ''));
    if (/\b(\d+)\s*k\b/i.test(t) && n < 1000) n *= 1000;
    if (Number.isFinite(n) && n > 0) {
      return { amount: Math.round(n), currency: 'USD', operationType };
    }
  }

  const mil = t.match(/\b(\d+(?:[.,]\d+)?)\s*mil\b/);
  if (mil) {
    const n = Number(mil[1].replace(',', '.')) * 1000;
    if (Number.isFinite(n) && n > 0) {
      return { amount: Math.round(n), currency: 'MXN', operationType };
    }
  }

  const mxn = parseMoneyAmount(raw);
  if (mxn != null) {
    return { amount: mxn, currency: 'MXN', operationType };
  }

  const plain = t.match(/\b(\d{1,3}(?:[.,]\d{3})+)\b/);
  if (plain) {
    const n = Number(plain[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) {
      return { amount: n, currency: 'MXN', operationType };
    }
  }

  return null;
}

module.exports = {
  parsePolicyMoney,
};
