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
    const allowedCodes = new Set(
      [...knownCodes, ...(facts.userMentionedCodes || []), facts.activePropertyCode]
        .filter(Boolean)
        .map((c) => String(c).toUpperCase()),
    );
    for (const code of mentioned) {
      const norm = String(code).toUpperCase();
      if (allowedCodes.size > 0 && !allowedCodes.has(norm)) {
        violations.push({
          constraint: 'must_not.invent_property',
          detail: `Mentioned listing code ${code} not in inventory facts`,
          severity: 'critical',
        });
      }
    }
  }

  if (must_not.invent_price) {
    const listingCodes = extractListingCodes(reply);
    const amounts = extractMoneyMentions(reply).filter((amount) => {
      if (!Number.isFinite(amount) || amount < 10_000) return false;
      const asStr = String(Math.round(amount));
      for (const code of listingCodes) {
        if (String(code).replace(/\D/g, '').includes(asStr)) return false;
      }
      return true;
    });
    const deniesUncertainty =
      /no puedo confirmar|sin inventar|no tengo (?:el |un )?precio|no encuentro|no invento|asesor.*confirm/i.test(
        reply,
      );
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

  if (must_not.hallucinated_availability) {
    const claimsAvailable =
      /\b(disponible|te la aparto|est[aá] libre|sigue disponible)\b/i.test(normalizeText(reply));
    if (claimsAvailable && facts.propertyFound && facts.available === false) {
      violations.push({
        constraint: 'must_not.hallucinated_availability',
        detail: 'Claims availability but inventory marks unavailable',
        severity: 'critical',
      });
    }
    if (claimsAvailable && facts.propertyLookupAttempted && !facts.propertyFound) {
      violations.push({
        constraint: 'must_not.hallucinated_availability',
        detail: 'Claims availability without property facts',
        severity: 'critical',
      });
    }
  }

  if (must_not.fake_link) {
    for (const url of extractUrls(reply)) {
      if (!hostAllowed(url, allowedHosts) && !knownUrls.includes(url)) {
        violations.push({
          constraint: 'must_not.fake_link',
          detail: `URL not allowlisted: ${url}`,
          severity: 'high',
        });
      }
    }
  }

  if (must_not.empathy_missing) {
    const t = normalizeText(reply);
    const userUrgent = facts.userExpressedUrgency === true;
    if (userUrgent && !/\b(entiendo|te escucho|con calma|sé que|comprendo|tranquil)\b/.test(t)) {
      violations.push({
        constraint: 'must_not.empathy_missing',
        detail: 'User expressed urgency but reply lacks brief empathy',
        severity: 'medium',
      });
    }
  }

  if (must_not.sticky_context_trap) {
    if (
      facts.explicitFlowSwitch === true &&
      facts.stickyLeadFlow &&
      facts.leadFlow === facts.stickyLeadFlow
    ) {
      violations.push({
        constraint: 'must_not.sticky_context_trap',
        detail: 'Explicit flow switch but sticky lead flow unchanged',
        severity: 'critical',
      });
    }
  }

  if (must_not.offer_to_demand_without_confirmation) {
    if (facts.stickyLeadFlow === 'offer' && facts.leadFlow === 'demand' && !facts.explicitFlowSwitch) {
      violations.push({
        constraint: 'must_not.offer_to_demand_without_confirmation',
        detail: 'Flipped offer→demand without explicit switch',
        severity: 'critical',
      });
    }
  }

  if (must_not.demand_to_offer_without_confirmation) {
    if (facts.stickyLeadFlow === 'demand' && facts.leadFlow === 'offer' && !facts.explicitFlowSwitch) {
      violations.push({
        constraint: 'must_not.demand_to_offer_without_confirmation',
        detail: 'Flipped demand→offer without explicit switch',
        severity: 'critical',
      });
    }
  }

  if (must_not.context_wipe_without_reset) {
    if (
      facts.userSoftTopicDismissal === true &&
      facts.sessionResetAtTurn == null &&
      facts.hadKnownNameBeforeDismissal === true &&
      !facts.known_name
    ) {
      violations.push({
        constraint: 'must_not.context_wipe_without_reset',
        detail: 'Soft topic dismissal cleared captured name without reset',
        severity: 'high',
      });
    }
  }

  if (must_not.stale_context_after_reset) {
    if (facts.sessionResetAtTurn != null && facts.turnIndex > facts.sessionResetAtTurn) {
      for (const zone of facts.preResetZones || []) {
        if (
          !zone ||
          String(zone).toLowerCase() === String(facts.known_zone || '').toLowerCase()
        ) {
          continue;
        }
        if (zone && new RegExp(`\\b${String(zone).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(reply)) {
          violations.push({
            constraint: 'must_not.stale_context_after_reset',
            detail: `Reply mentions pre-reset zone ${zone}`,
            severity: 'high',
          });
          break;
        }
      }
      for (const budget of facts.preResetBudgets || []) {
        const amounts = extractMoneyMentions(reply);
        if (amounts.some((a) => Math.abs(a - budget) <= Math.max(50000, budget * 0.02))) {
          violations.push({
            constraint: 'must_not.stale_context_after_reset',
            detail: `Reply mentions pre-reset budget ${budget}`,
            severity: 'high',
          });
          break;
        }
      }
    }
  }

  if (must_not.flow_restart_incorrect) {
    if (facts.suppressGlobalMenu === true && isGlobalIntentMenu(reply)) {
      violations.push({
        constraint: 'must_not.flow_restart_incorrect',
        detail: 'Global intent menu while flow should continue',
        severity: 'high',
      });
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

  if (must_not.verbose_response && facts.userTurnWasCurt === true) {
    if (String(reply || '').length > 340) {
      violations.push({
        constraint: 'must_not.verbose_response',
        detail: 'Reply too long after curt user message',
        severity: 'medium',
      });
    }
  }

  if (must_not.property_context_loss && facts.activePropertyCode) {
    const active = String(facts.activePropertyCode).toUpperCase();
    const mentioned = extractListingCodes(reply);
    const userIntroduced = new Set(
      (facts.userMentionedCodes || []).map((c) => String(c).toUpperCase()),
    );
    for (const code of mentioned) {
      const norm = code.toUpperCase();
      if (norm === active) continue;
      if (userIntroduced.has(norm)) continue;
      violations.push({
        constraint: 'must_not.property_context_loss',
        detail: `Reply referenced ${norm} while active context is ${active}`,
        severity: 'critical',
      });
      break;
    }
  }

  if (must_not.offer_to_demand && facts.stickyLeadFlow === 'offer') {
    if (facts.leadFlow === 'demand' && !facts.explicitFlowSwitch) {
      violations.push({
        constraint: 'must_not.offer_to_demand',
        detail: 'Lead flow flipped from offer to demand without explicit switch',
        severity: 'critical',
      });
    }
  }

  if (must_not.demand_to_offer && facts.stickyLeadFlow === 'demand') {
    if (facts.leadFlow === 'offer' && !facts.explicitFlowSwitch) {
      violations.push({
        constraint: 'must_not.demand_to_offer',
        detail: 'Lead flow flipped from demand to offer without explicit switch',
        severity: 'critical',
      });
    }
  }

  if (must_not.forced_price_requirement && (facts.valuationRequested || facts.priceUnknown)) {
    const lower = normalizeText(reply);
    if (
      /\?/.test(reply) &&
      /\b(qu[eé]\s+precio\s+esperado|precio\s+esperado\s+manejas|cu[aá]nto\s+pides|precio\s+quieres\s+pedir)\b/.test(
        lower,
      ) &&
      !/\bvaluaci[oó]n|sin\s+precio\s+fijo|no\s+tienes\s+precio\b/.test(lower)
    ) {
      violations.push({
        constraint: 'must_not.forced_price_requirement',
        detail: 'Insisted on expected price after valuation / unknown price path',
        severity: 'high',
      });
    }
  }

  if (must_not.hard_template_response && facts.suppressGlobalMenu === true && isGlobalIntentMenu(reply)) {
    violations.push({
      constraint: 'must_not.hard_template_response',
      detail: 'Global intent menu while offer/demand flow is active',
      severity: 'high',
    });
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

  if (must_not.promise_below_minimum_capture) {
    const lower = normalizeText(reply);
    if (
      /\b(te ayudamos a vender|podemos captar|agendamos visita|publicamos tu propiedad)\b/i.test(lower) &&
      !/\bpol[ií]tica comercial|no podemos avanzar|desde \$|desde usd\b/i.test(lower)
    ) {
      violations.push({
        constraint: 'must_not.promise_below_minimum_capture',
        detail: 'Promised capture while below commercial minimum',
        severity: 'critical',
      });
    }
  }

  if (must_not.invented_from_media) {
    const amounts = extractMoneyMentions(reply);
    const userAmounts = (facts.userMoneyMentions || []).map(Number).filter(Number.isFinite);
    for (const n of amounts) {
      if (n >= 100_000 && !userAmounts.some((u) => Math.abs(u - n) / Math.max(u, 1) < 0.15)) {
        violations.push({
          constraint: 'must_not.invented_from_media',
          detail: `Price ${n} not present in user text or transcript`,
          severity: 'critical',
        });
        break;
      }
    }
    if (
      /\b(\d{2,4}\s*m2|metros cuadrados|recamaras|ba[nñ]os)\b/i.test(reply) &&
      !facts.userMentionedArea
    ) {
      violations.push({
        constraint: 'must_not.invented_from_media',
        detail: 'Structural detail from image not confirmed in user text',
        severity: 'high',
      });
    }
  }

  if (must_not.fake_transcript) {
    if (facts.mediaIntakeMode === 'audio_no_transcript') {
      const lower = normalizeText(reply);
      if (
        /\b(entend[ií]|tom[eé]|anot[eé]|registr[eé]).{0,40}(millones?|cumbres|jorge|san pedro)\b/i.test(
          lower,
        ) &&
        !/\b(escrito|texto|confirmas|confirmar|frase)\b/i.test(lower)
      ) {
        violations.push({
          constraint: 'must_not.fake_transcript',
          detail: 'Acted on specific slots without transcript',
          severity: 'critical',
        });
      }
    }
  }

  if (must_not.hallucinated_visual_detail) {
    const lower = normalizeText(reply);
    if (
      (/\b(cuesta|vale|precio es|desde \$|usd)\b/i.test(lower) ||
        /\b(\d{2,3}\s*mil\s*m2|\d+\s*metros)\b/i.test(lower)) &&
      facts.inboundMedia?.kind === 'image' &&
      !facts.userMentionedPrice &&
      !facts.userMentionedArea
    ) {
      violations.push({
        constraint: 'must_not.hallucinated_visual_detail',
        detail: 'Invented price or area from image hints',
        severity: 'critical',
      });
    }
  }

  if (must_not.media_no_fallback) {
    const modesNeedingFallback = new Set([
      'audio_no_transcript',
      'audio_low_confidence',
      'image_illegible',
    ]);
    if (modesNeedingFallback.has(facts.mediaIntakeMode)) {
      const lower = normalizeText(reply);
      const hasFallbackCue =
        /\b(escrito|texto|confirmas|confirmar|frase|no (puedo|alcance)|referencia visual|sin descripci[oó]n|claridad)\b/i.test(
          lower,
        );
      if (!hasFallbackCue) {
        violations.push({
          constraint: 'must_not.media_no_fallback',
          detail: 'Missing honest media fallback language',
          severity: 'critical',
        });
      }
    }
  }

  if (must_not.no_search_reopen) {
    const { isLegacySearchReopenReply } = require('../conversation/v3/runtime/closureIntegrity');
    if (isLegacySearchReopenReply(reply)) {
      violations.push({
        constraint: 'must_not.no_search_reopen',
        detail: 'Post-handoff search/qualification flow reopened',
        severity: 'critical',
      });
    }
    const lower = normalizeText(reply);
    if (
      facts.closureActive === true &&
      /\b(seguimos con tu b[uú]squeda|afinar\s+(?:rec[aá]maras|presupuesto|zona)|me confirmas tu presupuesto)\b/i.test(
        lower,
      )
    ) {
      violations.push({
        constraint: 'must_not.no_search_reopen',
        detail: 'Commercial search prompt after conversational closure',
        severity: 'critical',
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
