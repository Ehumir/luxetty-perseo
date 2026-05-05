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
  isActiveQaSession,
  isClosedQaSession,
  isQaLeadBlocked,
} = require('../conversation/qaCommands');

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
  return {
    lead_flow: null,
    intent_type: null,
    operation_type: null,
    property_type: null,
    location_text: null,
    budget_max: null,
    full_name: null,
  };
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

test('isQaCommandAllowed · env vacía → nadie autorizado', () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '';
  assert.equal(isQaCommandAllowed('5218111111111'), false);
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('isQaCommandAllowed · env no definida → nadie autorizado', () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  delete process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  assert.equal(isQaCommandAllowed('5218111111111'), false);
  if (original !== undefined) process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original;
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

  // Estado limpio
  assert.equal(stateHolder.lead_flow, null, 'lead_flow debe limpiarse');
  assert.equal(stateHolder.qa_test_active, true, 'qa_test_active debe activarse');
  assert.equal(stateHolder.qa_lead_creation_blocked, true, 'debe bloquear creación de lead');
  assert.ok(stateHolder.qa_test_session_id, 'debe generar qa_test_session_id');

  // Memoria en RAM limpia
  const memAfter = memMap.get('5218111111111');
  assert.deepEqual(memAfter, [], 'debe limpiar la memoria en RAM del número');

  // Evento de auditoría
  const resetEvent = eventLog.find((e) => e.type === 'qa_command_reset');
  assert.ok(resetEvent, 'debe persistir evento qa_command_reset');
  assert.equal(resetEvent.convId, 'conv-qa-001');
  assert.equal(resetEvent.payload.qa_phone, '5218111111111');
  assert.equal(resetEvent.payload.previous_lead_flow, 'offer');

  // Reply enviado
  assert.ok(replyLog.length > 0, 'debe enviar respuesta');
  assert.match(String(replyLog[0].messages), /reiniciado|reset/i, 'reply debe confirmar reset');
});

// ═════════════════════════════════════════════════════════════════════════════
// handleQaCommand — !close
// ═════════════════════════════════════════════════════════════════════════════

test('handleQaCommand !close · marca sesión cerrada, bloquea lead, registra evento', async () => {
  const eventLog = [];
  const stateHolder = {};
  const replyLog = [];
  const convRow = buildConversationRow({
    lead_flow: 'demand',
    qa_test_active: true,
    qa_test_session_id: 'qa_12345_6789',
  });

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
  });

  assert.equal(result.handled, true);
  assert.equal(result.command, 'close');

  // Estado de cierre
  assert.equal(stateHolder.qa_test_closed, true, 'debe marcar qa_test_closed');
  assert.equal(stateHolder.qa_test_active, false, 'debe desactivar qa_test_active');
  assert.equal(stateHolder.qa_lead_creation_blocked, true, 'debe mantener bloqueo de lead');
  assert.equal(stateHolder.handoff_ready, false, 'no debe triggear handoff');
  assert.equal(stateHolder.closing_message_sent, true, 'debe marcar closing_message_sent');

  // Evento de auditoría
  const closeEvent = eventLog.find((e) => e.type === 'qa_command_close');
  assert.ok(closeEvent, 'debe persistir evento qa_command_close');

  // Reply
  assert.match(String(replyLog[0].messages), /cerrado|close/i);
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
  assert.match(String(replyLog[0].messages), /comprador_cumbres/i, 'reply debe incluir nombre del caso');
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

  // Ningún campo del contexto previo debe estar presente
  assert.equal(stateHolder.lead_flow, null, 'lead_flow debe ser null tras reset');
  assert.equal(stateHolder.location_text, null, 'location_text debe limpiarse');
  assert.equal(stateHolder.budget_max, null, 'budget_max debe limpiarse');
  assert.equal(stateHolder.full_name, null, 'full_name debe limpiarse');
  assert.equal(stateHolder.has_mortgage, undefined, 'has_mortgage no debe arrastrarse');
  assert.equal(stateHolder.urgent_sale_signal, undefined, 'urgent_sale_signal no debe arrastrarse');

  // Solo deben existir las banderas QA
  assert.equal(stateHolder.qa_test_active, true);
  assert.equal(stateHolder.qa_lead_creation_blocked, true);
});

// ═════════════════════════════════════════════════════════════════════════════
// Escenario: después de !close no se duplica lead (bloqueo activo)
// ═════════════════════════════════════════════════════════════════════════════

test('isQaLeadBlocked · estado cerrado bloquea creación de lead', async () => {
  const stateHolder = {};
  const convRow = buildConversationRow({
    qa_test_active: true,
    qa_test_session_id: 'qa_111_222',
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
  });

  // isQaLeadBlocked debe retornar true para el estado guardado
  assert.equal(isQaLeadBlocked(stateHolder), true,
    'después de !close, isQaLeadBlocked debe ser true');
  assert.equal(isClosedQaSession(stateHolder), true,
    'debe ser sesión QA cerrada');
  assert.equal(isActiveQaSession(stateHolder), false,
    'no debe ser sesión activa después de close');
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
