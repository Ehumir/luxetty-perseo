'use strict';

/**
 * Tests para comandos internos de QA de PERSEO.
 *
 * Cubre:
 * - parseQaCommand: sintaxis válida e inválida
 * - isQaCommandAllowed: allowlist con diferentes formatos de teléfono
 * - handleQaCommand: reset, close, case
 * - Integración: reset limpia contexto, close bloquea lead, no autorizado no ejecuta
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseQaCommand,
  isQaCommandAllowed,
  handleQaCommand,
  interceptQaCommand,
  isActiveQaSession,
  isClosedQaSession,
  isQaLeadBlocked,
} = require('../conversation/qaCommands');
const { getDefaultAiState } = require('../conversation/aiState');
const { REPLY_RESET, REPLY_CLOSE } = require('../conversation/qaSprint1Commands');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMockSaveEvent(log) {
  return async (convId, type, payload) => {
    log.push({ convId, type, payload });
  };
}

function buildMockSaveState(stateHolder) {
  return async (_convId, nextState) => {
    Object.assign(stateHolder, nextState);
  };
}

function buildMockSendReply(log) {
  return async (to, messages) => {
    log.push({ to, messages });
  };
}

function buildConversationRow(aiStateOverrides = {}) {
  return {
    id: 'conv-qa-001',
    phone: '5218111111111',
    channel: 'whatsapp',
    ai_state: {
      lead_flow: 'offer',
      intent_type: 'supply',
      ...aiStateOverrides,
    },
  };
}

function getDefaultState() {
  return getDefaultAiState();
}

function nowIso() {
  return new Date().toISOString();
}

// Supabase mock mínimo para handleQaCommand (solo se usa para update qa_closed_at)
const mockSupabase = {
  from(table) {
    return {
      update() { return this; },
      eq() { return this; },
    };
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// parseQaCommand
// ═════════════════════════════════════════════════════════════════════════════

test('parseQaCommand · !reset → { command: reset, args: "" }', () => {
  const result = parseQaCommand('!reset');
  assert.deepEqual(result, { command: 'reset', args: '' });
});

test('parseQaCommand · !RESET en mayúsculas → normaliza a reset', () => {
  const result = parseQaCommand('!RESET');
  assert.deepEqual(result, { command: 'reset', args: '' });
});

test('parseQaCommand · !close → { command: close, args: "" }', () => {
  const result = parseQaCommand('!close');
  assert.deepEqual(result, { command: 'close', args: '' });
});

test('parseQaCommand · !case comprador_cumbres → captura nombre', () => {
  const result = parseQaCommand('!case comprador_cumbres');
  assert.equal(result?.command, 'case');
  assert.match(result?.args, /comprador_cumbres/i);
});

test('parseQaCommand · texto normal no es comando QA', () => {
  assert.equal(parseQaCommand('Hola, quiero vender mi casa'), null);
  assert.equal(parseQaCommand(''), null);
  assert.equal(parseQaCommand(null), null);
});

test('parseQaCommand · comando desconocido → null', () => {
  assert.equal(parseQaCommand('!delete'), null);
  assert.equal(parseQaCommand('!hack'), null);
});

test('parseQaCommand · texto muy largo (>200 chars) → null (anti-bypass)', () => {
  const longText = '!reset ' + 'x'.repeat(300);
  assert.equal(parseQaCommand(longText), null);
});

test('parseQaCommand · !case sin nombre devuelve args vacío', () => {
  const result = parseQaCommand('!case');
  assert.equal(result?.command, 'case');
  assert.equal(result?.args, '');
});

// ═════════════════════════════════════════════════════════════════════════════
// isQaCommandAllowed
// ═════════════════════════════════════════════════════════════════════════════

test('isQaCommandAllowed · número en allowlist → true', () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111,5218119999999';
  assert.equal(isQaCommandAllowed('5218111111111'), true);
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('isQaCommandAllowed · número no en allowlist → false', () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';
  assert.equal(isQaCommandAllowed('5218120000001'), false);
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('isQaCommandAllowed · env vacía → QA interno 8181877351 sigue autorizado', () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '';
  assert.equal(isQaCommandAllowed('5218111111111'), false);
  assert.equal(isQaCommandAllowed('5218181877351'), true);
  assert.equal(isQaCommandAllowed('528181877351'), true);
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('isQaCommandAllowed · env no definida → QA interno 8119086196 sigue autorizado', () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  delete process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  assert.equal(isQaCommandAllowed('5218119086196'), true);
  if (original !== undefined) process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original;
});

test('isQaCommandAllowed · QA interno autorizado por últimos 10 dígitos en variantes comunes', () => {
  const variants = [
    '8181877351',
    '5218181877351',
    '528181877351',
    '+52 1 8181877351',
    '8119086196',
    '5218119086196',
    '528119086196',
    '+52 1 8119086196',
  ];
  for (const variant of variants) {
    assert.equal(isQaCommandAllowed(variant), true, `Debe autorizar variante ${variant}`);
  }
});

test('isQaCommandAllowed · normaliza + y espacios del número en allowlist', () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '+52 181 111 11111';
  assert.equal(isQaCommandAllowed('5218111111111'), true);
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

// ═════════════════════════════════════════════════════════════════════════════
// handleQaCommand — !reset
// ═════════════════════════════════════════════════════════════════════════════

test('handleQaCommand !reset · limpia estado, registra evento, responde OK', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const eventLog = [];
  const stateHolder = {};
  const replyLog = [];
  const convRow = buildConversationRow({ lead_flow: 'offer', intent_type: 'supply' });
  const memMap = new Map([['5218111111111', [{ role: 'user', content: 'texto previo' }]]]);

  const result = await handleQaCommand({
    command: 'reset',
    args: '',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: convRow,
    supabase: mockSupabase,
    conversations: memMap,
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent(eventLog),
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
    metaMessageId: 'wamid-qa-001',
  });

  assert.equal(result.handled, true, 'debe retornar handled=true');
  assert.equal(result.command, 'reset');

  assert.equal(stateHolder.lead_flow, null, 'lead_flow debe limpiarse');
  assert.equal(stateHolder.qa_test_active, undefined, 'Sprint1 reset no activa banderas qa_test_*');

  const memAfter = memMap.get('5218111111111');
  assert.deepEqual(memAfter, [], 'debe limpiar la memoria en RAM del número');

  const resetEvent = eventLog.find((e) => e.type === 'qa_reset_executed');
  assert.ok(resetEvent, 'debe persistir evento qa_reset_executed');
  assert.equal(resetEvent.convId, 'conv-qa-001');
  assert.equal(resetEvent.payload.command, 'reset');

  assert.ok(replyLog.length > 0, 'debe enviar respuesta');
  assert.equal(String(replyLog[0].messages), REPLY_RESET);

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

// ═════════════════════════════════════════════════════════════════════════════
// handleQaCommand — !close
// ═════════════════════════════════════════════════════════════════════════════

test('handleQaCommand !close · marca conversación cerrada y limpia ai_state', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const eventLog = [];
  const stateHolder = {};
  const replyLog = [];
  const convRow = buildConversationRow({
    lead_flow: 'demand',
    qa_test_active: true,
    qa_test_session_id: 'qa_12345_6789',
  });
  let closedUpdate = null;

  const result = await handleQaCommand({
    command: 'close',
    args: '',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: convRow,
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent(eventLog),
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
    metaMessageId: 'wamid-qa-002',
    updateConversationFn: async (_client, _id, payload) => {
      closedUpdate = payload;
    },
  });

  assert.equal(result.handled, true);
  assert.equal(result.command, 'close');

  assert.equal(stateHolder.lead_flow, null, 'ai_state operativo limpio');
  assert.equal(stateHolder.qa_test_active, undefined, 'sin banderas qa legacy en close Sprint1');

  const closeEvent = eventLog.find((e) => e.type === 'qa_conversation_closed');
  assert.ok(closeEvent, 'debe persistir evento qa_conversation_closed');
  assert.equal(closedUpdate?.status, 'closed');

  assert.equal(String(replyLog[0].messages), REPLY_CLOSE);

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

// ═════════════════════════════════════════════════════════════════════════════
// handleQaCommand — !case
// ═════════════════════════════════════════════════════════════════════════════

test('handleQaCommand !case comprador_cumbres · etiqueta sesión, registra nombre, registra evento', async () => {
  const eventLog = [];
  const stateHolder = {};
  const replyLog = [];
  const convRow = buildConversationRow();

  const result = await handleQaCommand({
    command: 'case',
    args: 'comprador_cumbres',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: convRow,
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent(eventLog),
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
    metaMessageId: 'wamid-qa-003',
  });

  assert.equal(result.handled, true);
  assert.equal(result.command, 'case');

  // Estado
  assert.match(stateHolder.qa_test_case_name, /comprador_cumbres/i, 'debe guardar nombre del caso');
  assert.equal(stateHolder.qa_test_active, true, 'debe marcar sesión activa');
  assert.equal(stateHolder.qa_lead_creation_blocked, true, 'debe bloquear lead');

  // Evento
  const caseEvent = eventLog.find((e) => e.type === 'qa_command_case');
  assert.ok(caseEvent, 'debe persistir evento qa_command_case');
  assert.match(caseEvent.payload.qa_test_case_name, /comprador_cumbres/i);

  // Reply incluye el nombre
  assert.equal(String(replyLog[0].messages), 'Caso de prueba registrado: comprador_cumbres.');
});

test('handleQaCommand !case sin nombre · responde con instrucción de uso', async () => {
  const replyLog = [];
  const eventLog = [];
  const stateHolder = {};

  await handleQaCommand({
    command: 'case',
    args: '',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: buildConversationRow(),
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent(eventLog),
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
  });

  assert.match(String(replyLog[0].messages), /!case/i, 'debe mostrar instrucción de uso');
});

// ═════════════════════════════════════════════════════════════════════════════
// Escenario: número no autorizado usa !reset → no ejecuta
// ═════════════════════════════════════════════════════════════════════════════

test('isQaCommandAllowed · número no autorizado no ejecuta comando', () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const unauthorizedPhone = '5218120000099';
  const cmd = parseQaCommand('!reset');
  assert.ok(cmd, 'el parse debe reconocer el comando');
  // Pero el número no está en la allowlist
  assert.equal(isQaCommandAllowed(unauthorizedPhone), false, 'no debe estar autorizado');
  // El sistema en index.js solo llama handleQaCommand si isQaCommandAllowed=true
  // Verificamos aquí que el guard funciona correctamente

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

// ═════════════════════════════════════════════════════════════════════════════
// Escenario: después de !reset no se arrastra contexto previo
// ═════════════════════════════════════════════════════════════════════════════

test('handleQaCommand !reset · contexto previo no se arrastra al nuevo estado', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const stateHolder = {};
  const convRow = buildConversationRow({
    lead_flow: 'offer',
    intent_type: 'supply',
    location_text: 'Cumbres',
    budget_max: 4500000,
    full_name: 'Carlos López',
    has_mortgage: true,
    urgent_sale_signal: true,
    seller_scenarios: ['already_listed', 'seller_standard'],
  });

  await handleQaCommand({
    command: 'reset',
    args: '',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: convRow,
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply([]),
    saveEventFn: buildMockSaveEvent([]),
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
  });

  assert.equal(stateHolder.lead_flow, null, 'lead_flow debe ser null tras reset');
  assert.equal(stateHolder.location_text, null, 'location_text debe limpiarse');
  assert.equal(stateHolder.budget_max, null, 'budget_max debe limpiarse');
  assert.equal(stateHolder.full_name, null, 'full_name debe limpiarse');
  assert.equal(stateHolder.has_mortgage, null, 'has_mortgage vuelve a default');
  assert.equal(stateHolder.urgent_sale_signal, false, 'urgent_sale_signal vuelve a default');
  assert.deepEqual(stateHolder.seller_scenarios, []);

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

// ═════════════════════════════════════════════════════════════════════════════
// Escenario: después de !close no se duplica lead (bloqueo activo)
// ═════════════════════════════════════════════════════════════════════════════

test('handleQaCommand !close · no deja flags qa_lead_creation_blocked (Sprint1)', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const stateHolder = {};
  const convRow = buildConversationRow({
    qa_test_active: true,
    qa_test_session_id: 'qa_111_222',
    qa_lead_creation_blocked: true,
  });

  await handleQaCommand({
    command: 'close',
    args: '',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: convRow,
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply([]),
    saveEventFn: buildMockSaveEvent([]),
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
    updateConversationFn: async () => {},
  });

  assert.equal(isQaLeadBlocked(stateHolder), false);
  assert.equal(isClosedQaSession(stateHolder), false);
  assert.equal(isActiveQaSession(stateHolder), false);

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

// ═════════════════════════════════════════════════════════════════════════════
// isActiveQaSession / isClosedQaSession / isQaLeadBlocked
// ═════════════════════════════════════════════════════════════════════════════

test('isActiveQaSession · solo true cuando ambas flags están activas', () => {
  assert.equal(isActiveQaSession({ qa_test_active: true, qa_lead_creation_blocked: true }), true);
  assert.equal(isActiveQaSession({ qa_test_active: true }), false, 'sin qa_lead_creation_blocked → false');
  assert.equal(isActiveQaSession({}), false);
  assert.equal(isActiveQaSession(null), false);
});

test('isQaLeadBlocked · true solo cuando qa_lead_creation_blocked está activo', () => {
  assert.equal(isQaLeadBlocked({ qa_lead_creation_blocked: true }), true);
  assert.equal(isQaLeadBlocked({ qa_lead_creation_blocked: false }), false);
  assert.equal(isQaLeadBlocked({}), false);
});

test('parseQaCommand · !case con caracteres especiales los sanitiza correctamente', async () => {
  // El parse permite el nombre, pero handleQaCommand sanitiza caracteres peligrosos
  const result = parseQaCommand('!case vendedor<script>alert(1)</script>');
  assert.equal(result?.command, 'case');
  // Verificar que handleQaCommand sanitiza el input
  const stateHolder = {};
  await handleQaCommand({
    command: result.command,
    args: result.args,
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: buildConversationRow(),
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: async () => {},
    saveEventFn: async () => {},
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
  });
  // El nombre guardado no debe contener < > ni / (que forman tags HTML)
  assert.doesNotMatch(String(stateHolder.qa_test_case_name || ''), /[<>\/]/,
    'caracteres HTML peligrosos (<, >, /) deben sanitizarse antes de persistir');
});

// ═════════════════════════════════════════════════════════════════════════════
// Reproducción runtime: guardia temprana e interrupción de pipeline
// ═════════════════════════════════════════════════════════════════════════════

test('interceptQaCommand · comando con espacios "  !reset  " funciona', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const eventLog = [];
  const stateHolder = {};
  const replyLog = [];
  const logger = { log() {}, warn() {}, info() {} };

  const result = await interceptQaCommand({
    text: '  !reset  ',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: buildConversationRow(),
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent(eventLog),
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
    metaMessageId: 'wamid-space-reset',
    logger,
  });

  assert.equal(result.handled, true);
  assert.equal(String(replyLog[0].messages), REPLY_RESET);

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('interceptQaCommand · comando en mayúsculas "!RESET" funciona', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const replyLog = [];
  const result = await interceptQaCommand({
    text: '!RESET',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: buildConversationRow(),
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent([]),
    saveStateFn: buildMockSaveState({}),
    getDefaultState,
    nowIso,
    metaMessageId: 'wamid-upper-reset',
    logger: { log() {} },
  });

  assert.equal(result.handled, true);
  assert.equal(String(replyLog[0].messages), REPLY_RESET);

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('interceptQaCommand · número no autorizado no ejecuta QA', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const eventLog = [];
  const stateHolder = {};
  const replyLog = [];

  const result = await interceptQaCommand({
    text: '!reset',
    from: '5218120000099',
    conversationId: 'conv-qa-001',
    conversationRow: buildConversationRow(),
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent(eventLog),
    saveStateFn: buildMockSaveState(stateHolder),
    getDefaultState,
    nowIso,
    metaMessageId: 'wamid-unauth-reset',
    logger: { log() {} },
  });

  assert.equal(result.handled, false);
  assert.equal(replyLog.length, 0, 'no debe enviar reply QA');
  assert.equal(Object.keys(stateHolder).length, 0, 'no debe modificar estado QA');
  assert.ok(eventLog.some((e) => e.type === 'qa_command_unauthorized'));
  assert.equal(result.reason, 'qa_command_unauthorized');

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('interceptQaCommand · !close autorizado responde solo QA y corta pipeline', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const replyLog = [];
  const guard = await interceptQaCommand({
    text: '!close',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: buildConversationRow({ qa_test_active: true }),
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent([]),
    saveStateFn: buildMockSaveState({}),
    getDefaultState,
    nowIso,
    metaMessageId: 'wamid-close-1',
    logger: { log() {} },
    updateConversationFn: async () => {},
  });

  let openAiCalls = 0;
  let fallbackCalls = 0;
  let contactCalls = 0;
  let leadCalls = 0;

  if (!guard.handled) {
    openAiCalls += 1;
    fallbackCalls += 1;
    contactCalls += 1;
    leadCalls += 1;
  }

  assert.equal(guard.handled, true);
  assert.equal(String(replyLog[0].messages), REPLY_CLOSE);
  assert.equal(openAiCalls, 0, 'QA autorizado no debe llamar OpenAI');
  assert.equal(fallbackCalls, 0, 'QA autorizado no debe ejecutar fallback');
  assert.equal(contactCalls, 0, 'QA autorizado no debe crear contacto');
  assert.equal(leadCalls, 0, 'QA autorizado no debe crear lead');

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('interceptQaCommand · !case captacion_cumbres autorizado responde solo QA', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218111111111';

  const replyLog = [];
  const result = await interceptQaCommand({
    text: '!case captacion_cumbres',
    from: '5218111111111',
    conversationId: 'conv-qa-001',
    conversationRow: buildConversationRow(),
    supabase: mockSupabase,
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(replyLog),
    saveEventFn: buildMockSaveEvent([]),
    saveStateFn: buildMockSaveState({}),
    getDefaultState,
    nowIso,
    metaMessageId: 'wamid-case-1',
    logger: { log() {} },
  });

  assert.equal(result.handled, true);
  assert.equal(String(replyLog[0].messages), 'Caso de prueba registrado: captacion_cumbres.');

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});
