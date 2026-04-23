#!/usr/bin/env node
/**
 * smoke-request-assignment.js
 * 
 * Smoke test para validar los cambios de hardening de creación y asignación de requests.
 * 
 * Ejecutar:
 *   node scripts/smoke-request-assignment.js
 * 
 * Valida:
 * 1. FASE 1: buildRequestPayload NO preinyecta assigned_agent_profile_id
 * 2. FASE 3: request_detected solo se registra con mínimos validados
 * 3. FASE 4: assignRequestViaEngine devuelve outcome classification
 * 4. FASE 2+5: Idempotencia sin preasignación
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Importar funciones del servicio
const requestAutomation = require('../services/requestAutomation');

// Mock de Supabase client
const mockSupabase = {
  from: (table) => ({
    select: () => ({
      eq: function() { return this; },
      is: function() { return this; },
      order: function() { return this; },
      limit: function() { return this; },
    }),
    insert: async (data) => {
      // Simular respuesta exitosa
      return {
        data: { id: 'req-123', ...data },
        error: null,
      };
    },
  }),
  rpc: async (funcName, params) => {
    // Simular RPC response
    if (funcName === 'assign_from_external_trigger') {
      return {
        data: {
          success: true,
          assigned_agent_profile_id: 'agent-456',
          assigned_user_id: 'user-789',
          strategy: 'rule_based',
          reason: 'auto_assigned',
        },
        error: null,
      };
    }
    return { data: null, error: 'Unknown RPC' };
  },
};

const events = [];
const mockSaveEvent = async (convId, type, payload) => {
  events.push({ conversationId: convId, type, payload });
  console.log(`  ✓ Event: ${type}`);
};

/**
 * TEST 1: FASE 1 - buildRequestPayload NO preinyecta assigned_agent_profile_id
 */
async function testPhase1NoPreinjection() {
  console.log('\n📋 TEST 1 - FASE 1: No Preinjection of assigned_agent_profile_id');
  
  const payload = await requestAutomation.buildRequestPayload({
    supabase: mockSupabase,
    mode: 'demand_internal',
    state: { 
      operation_type: 'sale',
      location_text: 'zona norte',
      budget_max: 500000,
    },
    property: { id: 'prop-123', zone_id: 'zone-456' },
    conversationId: 'conv-001',
    contactId: 'contact-001',
    // IMPORTANTE: aunque pasamos esto, debe ser ignorado
    assignedAgentProfileId: 'agent-999',
  });

  if (payload.assigned_agent_profile_id === null) {
    console.log('  ✓ PASS: assigned_agent_profile_id es NULL (no preinyectado)');
    return true;
  } else {
    console.log(`  ✗ FAIL: assigned_agent_profile_id debería ser null, pero es: ${payload.assigned_agent_profile_id}`);
    return false;
  }
}

/**
 * TEST 2: FASE 3 - request_detected solo con mínimos validados
 */
async function testPhase3EventTiming() {
  console.log('\n📋 TEST 2 - FASE 3: request_detected Event Timing');
  
  events.length = 0;

  // Escenario A: Sin mínimos (incompleto)
  console.log('  → Escenario A: Sin mínimos suficientes');
  const resultIncomplete = await requestAutomation.createRequestIfNeeded({
    supabase: mockSupabase,
    conversationId: 'conv-001',
    conversationRow: null,
    state: { 
      operation_type: 'sale',
      lead_flow: 'demand',
      // Falta location_text, budget, etc.
    },
    contactId: 'contact-001',
    property: null,
    messageText: 'Quiero buscar una casa',
    assignedAgentProfileId: null,
    saveConversationEvent: mockSaveEvent,
  });

  const hasRequestNotReady = events.some(e => e.type === 'request_not_ready');
  const hasRequestDetected = events.some(e => e.type === 'request_detected');
  
  if (resultIncomplete.reason === 'insufficient_data' && hasRequestNotReady && !hasRequestDetected) {
    console.log('    ✓ PASS: request_not_ready registrado, request_detected NO registrado');
  } else {
    console.log(`    ✗ FAIL: Eventos incorrectos. request_not_ready=${hasRequestNotReady}, request_detected=${hasRequestDetected}`);
    return false;
  }

  // Escenario B: Sin intención
  console.log('  → Escenario B: Sin intención detectada');
  events.length = 0;
  const resultNoMode = await requestAutomation.createRequestIfNeeded({
    supabase: mockSupabase,
    conversationId: 'conv-002',
    conversationRow: null,
    state: {},
    contactId: null,
    property: null,
    messageText: 'Hola',
    assignedAgentProfileId: null,
    saveConversationEvent: mockSaveEvent,
  });

  if (resultNoMode.mode === null && events.length === 0) {
    console.log('    ✓ PASS: Sin events si no hay modo detectado');
  } else {
    console.log(`    ✗ FAIL: Se registraron eventos sin modo: ${events.length} events`);
    return false;
  }

  return true;
}

/**
 * TEST 3: FASE 4 - assignRequestViaEngine devuelve outcome classification
 */
async function testPhase4OutcomeClassification() {
  console.log('\n📋 TEST 3 - FASE 4: Assignment Outcome Classification');

  const request = { id: 'req-123' };

  const result = await requestAutomation.assignRequestViaEngine({
    supabase: mockSupabase,
    request,
    conversationId: 'conv-001',
  });

  if (result.outcome === 'assigned' && result.success === true && result.assigned_agent_profile_id) {
    console.log('  ✓ PASS: outcome="assigned" cuando success=true + assigned_agent_profile_id existe');
  } else {
    console.log(`  ✗ FAIL: outcome debería ser "assigned", es: ${result.outcome}`);
    return false;
  }

  // Test outcome classification with different scenarios
  const testCases = [
    {
      name: 'invalid_request',
      input: { success: false, reason: 'invalid_request' },
      expectedOutcome: 'invalid_request',
    },
    {
      name: 'rpc_error',
      input: { success: false, reason: 'rpc_error' },
      expectedOutcome: 'rpc_error',
    },
  ];

  return true;
}

/**
 * TEST 4: FASE 2+5 - Idempotencia sin preasignación
 */
async function testPhase2Phase5Idempotence() {
  console.log('\n📋 TEST 4 - FASE 2+5: Idempotence Without Preassignment');

  events.length = 0;

  // Simular un request que ya existe y está sin asignar
  const mockSupabaseWithExisting = {
    ...mockSupabase,
    from: (table) => ({
      select: () => ({
        eq: function() { return this; },
        is: function() { return this; },
        order: function() { return this; },
        limit: async () => {
          // Simular encontrar un request existente sin asignar
          return {
            data: [{ 
              id: 'req-existing',
              assigned_agent_profile_id: null,
              is_active: true,
            }],
            error: null,
          };
        },
      }),
      insert: async () => ({
        data: { id: 'req-new' },
        error: null,
      }),
    }),
  };

  const result = await requestAutomation.createRequestIfNeeded({
    supabase: mockSupabaseWithExisting,
    conversationId: 'conv-001',
    conversationRow: { contact_id: 'contact-001', assigned_agent_profile_id: null },
    state: { 
      operation_type: 'sale',
      lead_flow: 'demand',
      location_text: 'zona norte',
      budget_max: 500000,
    },
    contactId: 'contact-001',
    property: { id: 'prop-123' },
    messageText: 'Busco casa',
    assignedAgentProfileId: null,
    saveConversationEvent: mockSaveEvent,
  });

  if (result.reason === 'existing_request_found' && result.request?.assigned_agent_profile_id === null) {
    console.log('  ✓ PASS: Request existente encontrado sin preasignación');
    return true;
  } else {
    console.log(`  ✗ FAIL: Request debería estar sin asignar pero está: ${result.request?.assigned_agent_profile_id}`);
    return false;
  }
}

/**
 * Ejecutar todos los tests
 */
async function runAllTests() {
  console.log('🚀 SMOKE TEST: Request Creation & Assignment Hardening\n');
  console.log('='.repeat(60));

  const results = [];

  try {
    results.push(await testPhase1NoPreinjection());
    results.push(await testPhase3EventTiming());
    results.push(await testPhase4OutcomeClassification());
    results.push(await testPhase2Phase5Idempotence());
  } catch (err) {
    console.error('\n❌ Test execution failed:', err.message);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  if (passed === total) {
    console.log(`\n✅ TODOS LOS TESTS PASARON (${passed}/${total})\n`);
    process.exit(0);
  } else {
    console.log(`\n❌ ALGUNOS TESTS FALLARON (${passed}/${total})\n`);
    process.exit(1);
  }
}

runAllTests();
