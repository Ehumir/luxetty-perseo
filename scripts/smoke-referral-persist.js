'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { persistConversationReferral } = require('../services/referralService');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log('SKIP smoke-referral-persist: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return null;
  }

  return createClient(url, key);
}

async function createTestConversation(supabase, phoneSuffix) {
  const now = new Date().toISOString();
  const phone = `+521999${phoneSuffix}`;
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      channel: 'whatsapp',
      phone,
      status: 'open',
      priority: 'medium',
      last_message_at: now,
      ai_state: {},
    })
    .select('id')
    .single();

  if (error) throw new Error(`createTestConversation failed: ${error.message}`);
  return data.id;
}

async function createTestInboundMessage(supabase, conversationId, metaMessageId, text) {
  const { data, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'inbound',
      sender_type: 'lead',
      message_type: 'text',
      message_text: text,
      meta_message_id: metaMessageId,
      raw_payload: {},
    })
    .select('id')
    .single();

  if (error) throw new Error(`createTestInboundMessage failed: ${error.message}`);
  return data.id;
}

async function countReferralRows(supabase, conversationId, metaMessageId) {
  let query = supabase
    .from('conversation_referrals')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if (metaMessageId) {
    query = query.eq('meta_message_id', metaMessageId);
  } else {
    query = query.is('meta_message_id', null);
  }

  const { count, error } = await query;
  if (error) throw new Error(`countReferralRows failed: ${error.message}`);
  return count || 0;
}

async function deleteConversationCascadeSafe(supabase, conversationId) {
  await supabase.from('conversations').delete().eq('id', conversationId);
}

async function canUseConversationReferralsTable(supabase) {
  const { error } = await supabase
    .from('conversation_referrals')
    .select('id')
    .limit(1);

  if (!error) return { ok: true };

  const message = error.message || '';
  const missingTable =
    message.includes("Could not find the table 'public.conversation_referrals'") ||
    message.includes('relation "conversation_referrals" does not exist');

  if (missingTable) {
    return { ok: false, reason: 'missing_table' };
  }

  return { ok: false, reason: message || 'table_check_failed' };
}

async function run() {
  const supabase = buildClient();
  if (!supabase) return;

  const tableCheck = await canUseConversationReferralsTable(supabase);
  if (!tableCheck.ok) {
    if (tableCheck.reason === 'missing_table') {
      console.log('SKIP smoke-referral-persist: apply migration for public.conversation_referrals first');
      return;
    }
    throw new Error(`conversation_referrals table check failed: ${tableCheck.reason}`);
  }

  const baseReferral = {
    source_type: 'ad',
    source_id: 'src-001',
    source_url: 'https://facebook.com/ad/1',
    headline: 'Casa en preventa',
    body: 'Agenda visita',
    media_type: 'image',
    image_url: 'https://cdn.example.com/image.jpg',
    video_url: 'https://cdn.example.com/video.mp4',
    thumbnail_url: 'https://cdn.example.com/thumb.jpg',
    ctwa_clid: 'clid-001',
    ad_id: 'ad-001',
    adgroup_id: 'adgroup-001',
    campaign_id: 'campaign-001',
  };

  const partialReferral = {
    source_url: 'https://example.com/partial',
  };

  const convA = await createTestConversation(supabase, '0000001');
  const convB = await createTestConversation(supabase, '0000002');
  const convC = await createTestConversation(supabase, '0000003');
  const convD = await createTestConversation(supabase, '0000004');

  try {
    const msgA = await createTestInboundMessage(supabase, convA, `wamid-smoke-a-${Date.now()}`, 'hola A');
    const msgB = await createTestInboundMessage(supabase, convB, `wamid-smoke-b-${Date.now()}`, 'hola B');
    const msgC = await createTestInboundMessage(supabase, convC, null, 'hola C');
    const msgD = await createTestInboundMessage(supabase, convD, `wamid-smoke-d-${Date.now()}`, 'hola D');

    const metaA = `wamid-referral-a-${Date.now()}`;
    const metaB = `wamid-referral-b-${Date.now()}`;
    const metaD = `wamid-referral-d-${Date.now()}`;

    const caseComplete = await persistConversationReferral({
      supabase,
      conversationId: convA,
      conversationMessageId: msgA,
      metaMessageId: metaA,
      referral: baseReferral,
    });
    assert(caseComplete.ok === true, 'Case complete referral should persist');

    const caseNoReferral = await persistConversationReferral({
      supabase,
      conversationId: convB,
      conversationMessageId: msgB,
      metaMessageId: metaB,
      referral: null,
    });
    assert(caseNoReferral.skipped === true, 'Case without referral should be skipped');
    assert(caseNoReferral.reason === 'missing_referral', 'Expected missing_referral reason');

    const duplicateFirst = await persistConversationReferral({
      supabase,
      conversationId: convA,
      conversationMessageId: msgA,
      metaMessageId: metaA,
      referral: baseReferral,
    });
    assert(duplicateFirst.ok === true, 'Duplicate insert should still return ok');
    const dupCount = await countReferralRows(supabase, convA, metaA);
    assert(dupCount === 1, `Expected exactly one row for duplicate case, got ${dupCount}`);

    const casePartial = await persistConversationReferral({
      supabase,
      conversationId: convD,
      conversationMessageId: msgD,
      metaMessageId: metaD,
      referral: partialReferral,
    });
    assert(casePartial.ok === true, 'Case partial referral should persist');

    const partialRowResult = await supabase
      .from('conversation_referrals')
      .select('raw_referral, source_url')
      .eq('conversation_id', convD)
      .eq('meta_message_id', metaD)
      .limit(1)
      .maybeSingle();
    if (partialRowResult.error) {
      throw new Error(`Read partial row failed: ${partialRowResult.error.message}`);
    }
    assert(!!partialRowResult.data, 'Expected partial row to exist');
    assert(
      partialRowResult.data.raw_referral?.source_url === partialReferral.source_url,
      'Expected raw_referral to preserve partial payload'
    );

    const caseNoMeta = await persistConversationReferral({
      supabase,
      conversationId: convC,
      conversationMessageId: msgC,
      metaMessageId: null,
      referral: baseReferral,
    });
    assert(caseNoMeta.ok === true, 'Case without meta_message_id should insert');
    const noMetaCount = await countReferralRows(supabase, convC, null);
    assert(noMetaCount >= 1, 'Expected at least one row when meta_message_id is null');

    console.log('PASS smoke referral persist');
  } finally {
    await deleteConversationCascadeSafe(supabase, convA);
    await deleteConversationCascadeSafe(supabase, convB);
    await deleteConversationCascadeSafe(supabase, convC);
    await deleteConversationCascadeSafe(supabase, convD);
  }
}

run().catch((err) => {
  console.error('FAIL smoke referral persist', err.message || err);
  process.exitCode = 1;
});