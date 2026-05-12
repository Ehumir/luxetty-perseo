'use strict';

const { processSprint1QaInbound, parseSprint1StrictCommand } = require('./qaSprint1Commands');
const { normalizeAiState: normalizeAiStateFromModule } = require('./aiState');

/**
 * PERSEO — Comandos internos de QA
 *
 * Permiten a testers/admins probar conversaciones en producción sin
 * contaminar contexto ni crear basura operativa.
 *
 * Comandos soportados:
 *   !reset            — limpia contexto conversacional activo
 *   !close            — marca la sesión de prueba como cerrada
 *   !case <nombre>    — etiqueta la sesión de prueba con un nombre
 *
 * Seguridad:
 *   • Solo funcionan si el número de WhatsApp está en QA_ALLOWED_WHATSAPP_NUMBERS.
 *   • Números no autorizados continúan el flujo normal (no saben que el comando existe).
 *   • Toda ejecución se persiste en conversation_events (auditoría técnica).
 *
 * No elimina: histórico real en conversation_messages, contactos ni leads en Supabase
 * (solo reemplaza ai_state y vacía memoria RAM corta del proceso).
 */

// ─── Parser ───────────────────────────────────────────────────────────────────

const QA_COMMAND_PATTERN = /^!(reset|close|case)\s*(.*)?$/i;
const VALID_COMMANDS = new Set(['reset', 'close', 'case']);
const CASE_NAME_MAX_LENGTH = 120;

function normalizeQaInput(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .trim();
}

function maskPhoneForLog(phone) {
  const value = normalizePhoneForAllowlist(phone);
  if (!value) return null;
  if (value.length <= 4) return `***${value}`;
  return `***${value.slice(-4)}`;
}

/**
 * Parsea un texto de entrada e identifica si es un comando QA.
 *
 * @param {string} text
 * @returns {{ command: string, args: string } | null}
 */
function parseQaCommand(text) {
  const raw = normalizeQaInput(text);

  // Protección: rechaza si es muy largo (evita bypasses con texto largo)
  if (raw.length > 200) return null;

  const match = raw.match(QA_COMMAND_PATTERN);
  if (!match) return null;

  const command = match[1].toLowerCase();
  if (!VALID_COMMANDS.has(command)) return null;

  const args = (match[2] || '').trim().slice(0, CASE_NAME_MAX_LENGTH);

  return { command, args };
}

// ─── Allowlist ────────────────────────────────────────────────────────────────

/**
 * Normaliza un número de teléfono a dígitos puros.
 * Elimina +, espacios y guiones.
 */
function normalizePhoneForAllowlist(phone) {
  return String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Últimos 10 dígitos de números MX siempre autorizados para QA (!reset), además del env. */
const DEFAULT_QA_LOCAL_10 = ['8181877351', '8119086196'];

function expandMxComparableDigits(normalized) {
  const d = normalizePhoneForAllowlist(normalized);
  if (!d) return new Set();
  const out = new Set([d]);
  if (d.length === 13 && d.startsWith('521')) out.add(`52${d.slice(3)}`);
  if (d.length === 12 && d.startsWith('52') && !d.startsWith('521')) out.add(`521${d.slice(2)}`);
  if (d.length === 10) {
    out.add(`52${d}`);
    out.add(`521${d}`);
  }
  return out;
}

function isDefaultQaPhone(normalizedDigits) {
  const d = normalizePhoneForAllowlist(normalizedDigits);
  if (!d) return false;
  const last10 = d.slice(-10);
  return DEFAULT_QA_LOCAL_10.includes(last10);
}

/**
 * Verifica si un número de WhatsApp está autorizado para ejecutar comandos QA.
 *
 * Siempre autoriza los QA internos (8181877351, 8119086196 y variantes 52/521).
 * Además lee QA_ALLOWED_WHATSAPP_NUMBERS (separada por comas) para otros testers.
 *
 * @param {string} phone  Número normalizado (e.g. "5218111111111")
 * @returns {boolean}
 */
function isQaCommandAllowed(phone) {
  const normalized = normalizePhoneForAllowlist(phone);
  if (!normalized) return false;

  if (isDefaultQaPhone(normalized)) return true;

  const raw = process.env.QA_ALLOWED_WHATSAPP_NUMBERS || '';
  if (!raw.trim()) return false;

  const envList = raw
    .split(/[\n,;]+/)
    .map((n) => normalizePhoneForAllowlist(n))
    .filter(Boolean);

  for (const entry of envList) {
    if (!entry) continue;
    const entrySet = expandMxComparableDigits(entry);
    const phoneSet = expandMxComparableDigits(normalized);
    for (const p of phoneSet) {
      if (entrySet.has(p)) return true;
    }
    if (normalized.endsWith(entry.slice(-10)) && entry.slice(-10).length === 10) return true;
  }

  // Fallback explícito por últimos 10 dígitos para QA interno.
  const last10 = normalized.slice(-10);
  if (DEFAULT_QA_LOCAL_10.includes(last10)) return true;

  return false;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Ejecuta un comando QA autorizado.
 *
 * Params:
 *   command          — 'reset' | 'close' | 'case'
 *   args             — texto adicional (solo relevante para 'case')
 *   from             — número de WhatsApp del tester
 *   conversationId   — ID de la conversación activa
 *   conversationRow  — fila completa de la conversación
 *   supabase         — cliente Supabase
 *   conversations    — Map en memoria (contexto corto de OpenAI)
 *   sendReplyFn      — async (to, messages) => void
 *   saveEventFn      — async (conversationId, type, payload) => void
 *   saveStateFn      — async (conversationId, nextState) => void
 *   getDefaultState  — () => defaultAiState
 *   nowIso           — () => ISO timestamp
 *   metaMessageId    — ID del mensaje de WhatsApp entrante (para auditoría)
 *
 * @returns {Promise<{ handled: true, command: string, reply: string }>}
 */
async function handleQaCommand({
  command,
  args,
  from,
  conversationId,
  conversationRow,
  supabase,
  conversations,
  sendReplyFn,
  saveEventFn,
  saveStateFn,
  getDefaultState,
  nowIso,
  metaMessageId = null,
  normalizeAiState = normalizeAiStateFromModule,
  updateConversationFn = null,
}) {
  const sprintTextByCommand = {
    reset: '!reset',
    close: '!close',
    state: '!state',
    leadcheck: '!leadcheck',
  };

  if (sprintTextByCommand[command]) {
    const sprint = await processSprint1QaInbound({
      text: sprintTextByCommand[command],
      from,
      conversationId,
      conversationRow,
      metaMessageId,
      supabase,
      getDefaultAiState: getDefaultState,
      normalizeAiState,
      nowIso,
      saveEventFn,
      saveStateFn,
      updateConversationFn,
      conversations,
      isQaExecutionAllowed: isQaCommandAllowed,
    });

    if (sprint?.unauthorized) {
      return { handled: false, command, reason: 'qa_command_unauthorized' };
    }

    let reply = '';
    if (sprint?.handled && sprint.messages?.length) {
      reply = sprint.messages.length === 1 ? sprint.messages[0] : sprint.messages.join('\n\n');
    }
    if (reply && sendReplyFn) {
      try {
        await sendReplyFn(from, reply);
      } catch (sendErr) {
        console.error('[qa_command] Error enviando reply:', sendErr?.message || sendErr);
      }
    }

    console.log('[qa_command] executed', { command, from, conversation_id: conversationId });

    return { handled: !!sprint?.handled, command, reply };
  }

  // Sanitizar args: solo alfanumérico, guiones, underscores y espacios
  const safeArgs = (args || '').replace(/[^a-zA-Z0-9 _\-áéíóúüñÁÉÍÓÚÜÑ]/g, '').trim();
  const testSessionId = `qa_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
  let reply = '';

  // Audit base payload (no contiene datos de conversaciones reales)
  const auditBase = {
    qa_phone: from,
    conversation_id: conversationId,
    meta_message_id: metaMessageId,
    test_session_id: testSessionId,
    timestamp: nowIso(),
  };

  if (command !== 'case') {
    return { handled: false, command, reply: null };
  }

  if (!safeArgs) {
    reply = '⚠️ Usa: !case <nombre_del_caso>';
  } else {
    const currentState = conversationRow?.ai_state || getDefaultState();
    const casedState = {
      ...currentState,
      qa_test_active: true,
      qa_test_session_id: testSessionId,
      qa_test_case_name: safeArgs,
      qa_test_case_started_at: nowIso(),
      qa_lead_creation_blocked: true,
    };

    await saveStateFn(conversationId, casedState);

    await saveEventFn(conversationId, 'qa_command_case', {
      ...auditBase,
      action: 'qa_test_case_labeled',
      qa_test_case_name: safeArgs,
      qa_test_session_id: testSessionId,
    });

    reply = `Caso de prueba registrado: ${safeArgs}.`;
  }

  // Envía la respuesta corta de confirmación al tester
  if (reply && sendReplyFn) {
    try {
      await sendReplyFn(from, reply);
    } catch (sendErr) {
      console.error('[qa_command] Error enviando reply:', sendErr?.message || sendErr);
    }
  }

  console.log('[qa_command] executed', {
    command,
    from,
    conversation_id: conversationId,
    test_session_id: testSessionId,
    case_name: safeArgs || null,
  });

  return { handled: true, command, reply };
}

async function interceptQaCommand({
  text,
  from,
  conversationId,
  conversationRow,
  supabase,
  conversations,
  sendReplyFn,
  saveEventFn,
  saveStateFn,
  getDefaultState,
  nowIso,
  metaMessageId = null,
  logger = console,
  normalizeAiState = normalizeAiStateFromModule,
  updateConversationFn = null,
}) {
  const sprint = await processSprint1QaInbound({
    text,
    from,
    conversationId,
    conversationRow,
    metaMessageId,
    supabase,
    getDefaultAiState: getDefaultState,
    normalizeAiState,
    nowIso,
    saveEventFn,
    saveStateFn,
    updateConversationFn,
    conversations,
    isQaExecutionAllowed: isQaCommandAllowed,
  });

  if (sprint?.unauthorized) {
    logger.log('qa_command_unauthorized', sprint.payload);
    if (saveEventFn && conversationId) {
      await saveEventFn(conversationId, 'qa_command_unauthorized', sprint.payload);
    }
    return { handled: false, isQaCommand: true, reason: 'qa_command_unauthorized' };
  }

  if (sprint?.handled) {
    const cmd = parseSprint1StrictCommand(text);
    if (sendReplyFn && sprint.messages?.length) {
      const out = sprint.messages.length === 1 ? sprint.messages[0] : sprint.messages.join('\n\n');
      try {
        await sendReplyFn(from, out);
      } catch (sendErr) {
        console.error('[qa_command] Error enviando reply:', sendErr?.message || sendErr);
      }
    }
    logger.log('qa_sprint1_command_completed', { command: cmd, conversation_id: conversationId });
    return {
      handled: true,
      isQaCommand: true,
      command: cmd,
      reply: sprint.messages?.[0] || null,
    };
  }

  const parsed = parseQaCommand(text);
  if (!parsed) return { handled: false, isQaCommand: false, reason: 'not_qa_command' };

  if (parsed.command === 'reset' || parsed.command === 'close') {
    return { handled: false, isQaCommand: false, reason: 'qa_non_strict_reset_close_ignored' };
  }

  if (parsed.command !== 'case') return { handled: false, isQaCommand: false, reason: 'not_qa_case' };

  const logBase = {
    conversation_id: conversationId || null,
    from: maskPhoneForLog(from),
    command: parsed.command,
    meta_message_id: metaMessageId || null,
  };

  logger.log('qa_command_detected', logBase);

  const allowed = isQaCommandAllowed(from);
  if (!allowed) {
    logger.log('qa_command_unauthorized', logBase);
    if (saveEventFn && conversationId) {
      await saveEventFn(conversationId, 'qa_command_unauthorized', {
        ...logBase,
        reason: 'phone_not_authorized',
      });
    }
    return { handled: false, isQaCommand: true, reason: 'qa_command_unauthorized' };
  }

  logger.log('qa_command_authorized', logBase);
  if (saveEventFn && conversationId) {
    await saveEventFn(conversationId, 'qa_command_authorized', {
      ...logBase,
      reason: 'phone_authorized',
    });
  }

  const result = await handleQaCommand({
    command: parsed.command,
    args: parsed.args,
    from,
    conversationId,
    conversationRow,
    supabase,
    conversations,
    sendReplyFn,
    saveEventFn,
    saveStateFn,
    getDefaultState,
    nowIso,
    metaMessageId,
    normalizeAiState,
    updateConversationFn,
  });

  logger.log('qa_command_completed', {
    ...logBase,
    handled: !!result?.handled,
  });

  if (saveEventFn && conversationId) {
    await saveEventFn(conversationId, 'qa_command_completed', {
      ...logBase,
      handled: !!result?.handled,
    });
  }

  return {
    handled: true,
    isQaCommand: true,
    command: parsed.command,
    reply: result?.reply || null,
  };
}

// ─── Utilidades de verificación de estado QA ─────────────────────────────────

/**
 * Devuelve true si el estado actual indica que estamos en una sesión de prueba activa.
 * Se usa para bloquear creación de leads y seguimiento automático.
 */
function isActiveQaSession(aiState = {}) {
  return !!aiState?.qa_test_active && !!aiState?.qa_lead_creation_blocked;
}

/**
 * Devuelve true si hay una sesión QA cerrada (para bloqueo de leads).
 */
function isClosedQaSession(aiState = {}) {
  return !!aiState?.qa_test_closed && !!aiState?.qa_lead_creation_blocked;
}

/**
 * Devuelve true si el estado bloquea creación de leads por QA.
 */
function isQaLeadBlocked(aiState = {}) {
  return !!(aiState?.qa_lead_creation_blocked);
}

module.exports = {
  parseQaCommand,
  isQaCommandAllowed,
  handleQaCommand,
  interceptQaCommand,
  isActiveQaSession,
  isClosedQaSession,
  isQaLeadBlocked,
};
