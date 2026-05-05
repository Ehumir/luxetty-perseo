'use strict';

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
 * No eliminan: histórico real, contactos, leads.
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
  return String(phone || '').replace(/[\s\-+()\u00a0]/g, '').replace(/^0+/, '');
}

/**
 * Verifica si un número de WhatsApp está autorizado para ejecutar comandos QA.
 *
 * Lee la variable de entorno QA_ALLOWED_WHATSAPP_NUMBERS (separada por comas).
 * Si la variable está vacía o no existe, nadie está autorizado.
 *
 * @param {string} phone  Número normalizado (e.g. "5218111111111")
 * @returns {boolean}
 */
function isQaCommandAllowed(phone) {
  const raw = process.env.QA_ALLOWED_WHATSAPP_NUMBERS || '';
  if (!raw.trim()) return false;

  const normalized = normalizePhoneForAllowlist(phone);
  if (!normalized) return false;

  const allowlist = raw
    .split(/[\n,;]+/)
    .map((n) => normalizePhoneForAllowlist(n))
    .filter(Boolean);

  return allowlist.includes(normalized);
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
}) {
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

  if (command === 'reset') {
    // Limpia el contexto en memoria (short-memory de OpenAI)
    if (conversations && typeof conversations.set === 'function') {
      conversations.set(from, []);
    }

    // Genera nuevo estado limpio con bandera de sesión de prueba
    const freshState = {
      ...getDefaultState(),
      qa_test_active: true,
      qa_test_session_id: testSessionId,
      qa_test_started_at: nowIso(),
      qa_test_phone: from,
      // Bloquea creación de lead durante sesión de prueba
      qa_lead_creation_blocked: true,
    };

    // Persiste el estado limpio (no toca histórico ni contactos)
    await saveStateFn(conversationId, freshState);

    // Evento de auditoría técnica
    await saveEventFn(conversationId, 'qa_command_reset', {
      ...auditBase,
      action: 'conversation_context_cleared',
      previous_lead_flow: conversationRow?.ai_state?.lead_flow || null,
      previous_intent_type: conversationRow?.ai_state?.intent_type || null,
    });

    reply = 'Contexto reiniciado para prueba.';

  } else if (command === 'close') {
    // Marca la sesión de prueba como cerrada en el estado
    const currentState = conversationRow?.ai_state || getDefaultState();
    const closedState = {
      ...currentState,
      qa_test_active: false,
      qa_test_closed: true,
      qa_test_session_id: currentState.qa_test_session_id || testSessionId,
      qa_test_closed_at: nowIso(),
      // Bloquea lead creation para este caso cerrado
      qa_lead_creation_blocked: true,
      // Evita seguimiento automático
      handoff_ready: false,
      handoff_sent: false,
      closing_message_sent: true,
    };

    await saveStateFn(conversationId, closedState);

    // Actualizar la conversación con status qa_closed (no afecta leads reales)
    try {
      await supabase
        .from('conversations')
        .update({ qa_closed_at: nowIso() })
        .eq('id', conversationId);
    } catch (_err) {
      // qa_closed_at puede no existir en el schema — no es bloqueante
    }

    await saveEventFn(conversationId, 'qa_command_close', {
      ...auditBase,
      action: 'qa_test_session_closed',
      qa_test_session_id: closedState.qa_test_session_id,
    });

    reply = 'Caso cerrado para prueba.';

  } else if (command === 'case') {
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
}) {
  const parsed = parseQaCommand(text);
  if (!parsed) return { handled: false, isQaCommand: false, reason: 'not_qa_command' };

  const logBase = {
    conversation_id: conversationId || null,
    from: maskPhoneForLog(from),
    command: parsed.command,
    meta_message_id: metaMessageId || null,
  };

  logger.log('qa_command_detected', logBase);

  const allowed = isQaCommandAllowed(from);
  if (!allowed) {
    logger.log('qa_command_denied', logBase);
    if (saveEventFn && conversationId) {
      await saveEventFn(conversationId, 'qa_command_denied', {
        ...logBase,
        reason: 'phone_not_authorized',
      });
    }
    return { handled: false, isQaCommand: true, reason: 'qa_command_denied' };
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
