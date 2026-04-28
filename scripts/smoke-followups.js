/*
 * Smoke test for IA v1.5 inactivity follow-ups.
 *
 * Run:
 *   node scripts/smoke-followups.js
 */

const {
  getNextDueAction,
  resetAiStateForClosedConversation,
} = require('../services/followupAutomation');

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const now = new Date();

  const baseMessages = [
    {
      direction: 'inbound',
      sender_type: 'lead',
      created_at: hoursAgo(7),
    },
    {
      direction: 'outbound',
      sender_type: 'ai_agent',
      created_at: hoursAgo(6.95),
    },
  ];

  const firstDue = getNextDueAction({
    messages: baseMessages,
    sentEvents: new Set(),
    now,
  });
  assert(firstDue?.step?.key === '1h', 'Expected 1h follow-up first');

  const secondDue = getNextDueAction({
    messages: baseMessages,
    sentEvents: new Set(['followup_1h_sent']),
    now,
  });
  assert(secondDue?.step?.key === '6h', 'Expected 6h follow-up after 1h sent');

  const noDueAfterUserReply = getNextDueAction({
    messages: [
      ...baseMessages,
      {
        direction: 'inbound',
        sender_type: 'lead',
        created_at: hoursAgo(0.5),
      },
    ],
    sentEvents: new Set(['followup_1h_sent']),
    now,
  });
  assert(noDueAfterUserReply === null, 'Expected no follow-up after user replied');

  const noDueAfterHuman = getNextDueAction({
    messages: [
      ...baseMessages,
      {
        direction: 'outbound',
        sender_type: 'agent',
        created_at: hoursAgo(0.5),
      },
    ],
    sentEvents: new Set(['followup_1h_sent']),
    now,
  });
  assert(noDueAfterHuman === null, 'Expected no follow-up after human outbound');

  const closeDue = getNextDueAction({
    messages: [
      {
        direction: 'inbound',
        sender_type: 'lead',
        created_at: hoursAgo(24),
      },
      {
        direction: 'outbound',
        sender_type: 'ai_agent',
        created_at: hoursAgo(23.9),
      },
    ],
    sentEvents: new Set(['followup_1h_sent', 'followup_6h_sent', 'followup_20h_sent']),
    now,
  });
  assert(closeDue?.kind === 'close', 'Expected close at 23h+');

  const reset = resetAiStateForClosedConversation({
    lead_flow: 'demand',
    operation_type: 'sale',
    lead_id: 'lead-1',
    assigned_agent_profile_id: 'agent-1',
  });
  assert(reset.lead_flow === null, 'Expected reset lead_flow');
  assert(reset.lead_id === 'lead-1', 'Expected lead_id to be preserved');

  console.log('PASS IA v1.5 follow-up smoke');
}

main();
