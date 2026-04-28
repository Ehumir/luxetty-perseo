/*
 * LEGACY BLOCKED MODULE.
 *
 * ATENA V1 defines Solicitud = public.leads.
 * The IA agent must not create or assign public.requests as an operational flow.
 * This file intentionally keeps the old public API as no-op stubs so older
 * imports fail closed instead of writing legacy rows.
 */

function disabledResult(extra = {}) {
  return {
    success: false,
    created: false,
    mode: null,
    request: null,
    assigned_agent_profile_id: null,
    assigned_user_id: null,
    strategy: null,
    reason: 'requests_flow_disabled_for_ai_agent',
    outcome: 'disabled',
    ...extra,
  };
}

function determineRequestCreationMode() {
  return null;
}

function hasMinimumDataForRequest() {
  return false;
}

async function findExistingEquivalentRequest() {
  return null;
}

async function getInitialRequestStageId() {
  return null;
}

async function buildRequestPayload() {
  return disabledResult();
}

async function createRequestIfNeeded(params = {}) {
  const conversationId = params?.conversationId || null;
  const saveConversationEvent = params?.saveConversationEvent;

  console.warn('REQUEST_AUTOMATION_BLOCKED_LEGACY_CREATE', {
    conversation_id: conversationId,
    reason: 'ATENA_V1_uses_public_leads_as_solicitudes',
  });

  if (conversationId && saveConversationEvent) {
    await saveConversationEvent(conversationId, 'request_flow_blocked_legacy', {
      reason: 'ATENA_V1_uses_public_leads_as_solicitudes',
      replacement: 'public.leads',
    });
  }

  return disabledResult();
}

async function assignRequestViaEngine(params = {}) {
  console.warn('REQUEST_AUTOMATION_BLOCKED_LEGACY_ASSIGNMENT', {
    legacy_id: params?.request?.id || null,
    conversation_id: params?.conversationId || null,
    reason: 'ATENA_V1_uses_public_leads_as_solicitudes',
  });

  return disabledResult();
}

module.exports = {
  determineRequestCreationMode,
  hasMinimumDataForRequest,
  findExistingEquivalentRequest,
  getInitialRequestStageId,
  buildRequestPayload,
  createRequestIfNeeded,
  assignRequestViaEngine,
};
