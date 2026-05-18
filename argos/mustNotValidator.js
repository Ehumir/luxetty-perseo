'use strict';

const { normalizeText } = require('../utils/text');
const { isGlobalIntentMenu, replySignature } = require('../conversation/v3/composer/openingVariantPicker');
const { FORBIDDEN_COMPOSER_PATTERNS } = require('../conversation/v3/types/constants');

const DEFAULT_ALLOWED_URL_HOSTS = [
  'luxetty.com',
  'www.luxetty.com',
  'propiedades.luxetty.com',
];

function extractListingCodes(text) {
  const codes = new Set();
  const re = /\b(?:LUX[-_]?)?([A-Z]{1,3}[-_]?\d{3,6})\b/gi;
  let m;
  const raw = String(text || '');
  while ((m = re.exec(raw)) !== null) {
    codes.add(String(m[0]).toUpperCase().replace(/_/g, '-'));
  }
  return [...codes];
}

function extractMoneyMentions(text) {
  const amounts = [];
  const raw = String(text || '');
  const re = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(millones?|m\b|mxn|pesos?)?/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let n = Number(String(m[1]).replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    if (/millones?/i.test(m[2] || '')) n *= 1_000_000;
    amounts.push(n);
  }
  return amounts;
}

function extractUrls(text) {
  const urls = [];
  const re = /https?:\/\/[^\s]+/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    urls.push(m[0]);
  }
  return urls;
}

function hostAllowed(url, allowedHosts) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   replyText: string,
 *   must_not?: object,
 *   facts?: object,
 * }} input
 */
function validateMustNotReply(input) {
  const must_not = input.must_not || {};
  const facts = input.facts || {};
  const reply = String(input.replyText || '');
  const violations = [];
  const allowedHosts = facts.allowedUrlHosts || DEFAULT_ALLOWED_URL_HOSTS;
  const knownCodes = new Set((facts.knownListingCodes || []).map((c) => String(c).toUpperCase()));
  const knownPrices = (facts.knownPrices || []).map(Number).filter(Number.isFinite);
  const knownUrls = facts.knownUrls || [];

  if (must_not.invent_property) {
    const mentioned = extractListingCodes(reply);
    for (const code of mentioned) {
      if (knownCodes.size > 0 && !knownCodes.has(code)) {
        violations.push({
          constraint: 'must_not.invent_property',
          detail: `Mentioned listing code ${code} not in inventory facts`,
          severity: 'critical',
        });
      }
    }
    if (facts.propertyLookupAttempted && !facts.propertyFound && mentioned.length > 0) {
      violations.push({
        constraint: 'must_not.invent_property',
        detail: 'Reply references property codes after failed inventory lookup',
        severity: 'critical',
      });
    }
  }

  if (must_not.invent_price) {
    const amounts = extractMoneyMentions(reply);
    const deniesUncertainty =
      /no puedo confirmar|sin inventar|no tengo (?:el |un )?precio|asesor.*confirm/i.test(reply);
    if (amounts.length && !deniesUncertainty && knownPrices.length) {
      const tolerance = 0.05;
      for (const amount of amounts) {
        const match = knownPrices.some(
          (kp) => Math.abs(kp - amount) <= Math.max(1000, kp * tolerance),
        );
        if (!match) {
          violations.push({
            constraint: 'must_not.invent_price',
            detail: `Reply price ${amount} not in known facts [${knownPrices.join(', ')}]`,
            severity: 'critical',
          });
        }
      }
    }
  }

  if (must_not.invent_link) {
    for (const url of extractUrls(reply)) {
      if (!hostAllowed(url, allowedHosts) && !knownUrls.includes(url)) {
        violations.push({
          constraint: 'must_not.invent_link',
          detail: `URL not allowlisted: ${url}`,
          severity: 'high',
        });
      }
    }
  }

  if (must_not.fabricated_availability) {
    const claimsAvailable =
      /\b(disponible|te la aparto|est[aá] libre|sigue disponible)\b/i.test(normalizeText(reply));
    if (claimsAvailable && facts.propertyFound && facts.available === false) {
      violations.push({
        constraint: 'must_not.fabricated_availability',
        detail: 'Claims availability but inventory marks unavailable',
        severity: 'critical',
      });
    }
    if (claimsAvailable && facts.propertyLookupAttempted && !facts.propertyFound) {
      violations.push({
        constraint: 'must_not.fabricated_availability',
        detail: 'Claims availability without property facts',
        severity: 'critical',
      });
    }
  }

  if (must_not.robotic_response) {
    for (const p of FORBIDDEN_COMPOSER_PATTERNS) {
      if (p.test(reply)) {
        violations.push({
          constraint: 'must_not.robotic_response',
          detail: 'Forbidden composer pattern matched',
          severity: 'medium',
        });
        break;
      }
    }
  }

  if (must_not.flow_restart && facts.suppressGlobalMenu === true && isGlobalIntentMenu(reply)) {
    violations.push({
      constraint: 'must_not.flow_restart',
      detail: 'Global intent menu after sticky flow established',
      severity: 'high',
    });
  }

  if (must_not.repeated_phrase && facts.previousReplySignature) {
    const prev = String(facts.previousReplySignature || '');
    const cur = replySignature(reply);
    if (prev && cur === prev) {
      violations.push({
        constraint: 'must_not.repeated_phrase',
        detail: 'Assistant reply identical to previous turn',
        severity: 'high',
      });
    }
  }

  if (must_not.repeated_question && facts.previousQuestionSignature) {
    const qSig = questionSignature(reply);
    if (qSig && qSig === facts.previousQuestionSignature) {
      violations.push({
        constraint: 'must_not.repeated_question',
        detail: 'Assistant repeated the same slot question',
        severity: 'high',
      });
    }
  }

  if (must_not.slot_reask_when_filled) {
    const lower = normalizeText(reply);
    if (facts.known_zone && /\b(en qu[eé] zona|qu[eé] zona|zona te gustar[ií]a)\b/.test(lower)) {
      violations.push({
        constraint: 'must_not.slot_reask_when_filled',
        detail: 'Re-asked location while zone already captured',
        severity: 'high',
      });
    }
    if (
      facts.known_budget != null &&
      /\?/.test(reply) &&
      /\b(qu[eé]\s+presupuesto|presupuesto\s+aproximado|presupuesto\s+tienes|presupuesto\s+manejas)\b/.test(lower) &&
      !/\btom[eé]\b/.test(lower)
    ) {
      violations.push({
        constraint: 'must_not.slot_reask_when_filled',
        detail: 'Re-asked budget while budget already captured',
        severity: 'high',
      });
    }
    if (facts.known_name && /\b(nombre|llamas|te llamas)\b/.test(lower) && /\?/.test(reply)) {
      violations.push({
        constraint: 'must_not.slot_reask_when_filled',
        detail: 'Re-asked name while name already captured',
        severity: 'high',
      });
    }
  }

  if (must_not.forced_handoff && facts.qualificationIncomplete === true) {
    if (
      /\b(un asesor|asesor de luxetty).{0,80}(contact|contacte|contacten|te contact)\b/i.test(reply) ||
      /\bsi te parece.{0,40}asesor\b/i.test(reply)
    ) {
      violations.push({
        constraint: 'must_not.forced_handoff',
        detail: 'Offered advisor handoff before qualification complete',
        severity: 'high',
      });
    }
  }

  return violations;
}

/**
 * @param {string} reply
 */
function questionSignature(reply) {
  const t = normalizeText(String(reply || ''));
  if (!/\?/.test(t)) return '';
  if (/\b(zona|presupuesto|nombre|llamas)\b/.test(t)) {
    return t.replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return '';
}

module.exports = {
  validateMustNotReply,
  extractListingCodes,
  extractMoneyMentions,
  extractUrls,
  replySignature,
  questionSignature,
};
