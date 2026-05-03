'use strict';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function mapReferralColumns(referral) {
  const safeReferral = isPlainObject(referral) ? referral : {};
  return {
    source_type: firstNonEmptyString([safeReferral.source_type, safeReferral.sourceType]),
    source_id: firstNonEmptyString([safeReferral.source_id, safeReferral.sourceId]),
    source_url: firstNonEmptyString([safeReferral.source_url, safeReferral.sourceUrl]),
    headline: firstNonEmptyString([safeReferral.headline, safeReferral.title]),
    body: firstNonEmptyString([safeReferral.body, safeReferral.text]),
    media_type: firstNonEmptyString([safeReferral.media_type, safeReferral.mediaType]),
    image_url: firstNonEmptyString([safeReferral.image_url, safeReferral.imageUrl]),
    video_url: firstNonEmptyString([safeReferral.video_url, safeReferral.videoUrl]),
    thumbnail_url: firstNonEmptyString([safeReferral.thumbnail_url, safeReferral.thumbnailUrl]),
    ctwa_clid: firstNonEmptyString([safeReferral.ctwa_clid, safeReferral.ctwaClid]),
    ad_id: firstNonEmptyString([safeReferral.ad_id, safeReferral.adId]),
    adgroup_id: firstNonEmptyString([
      safeReferral.adgroup_id,
      safeReferral.adgroupId,
      safeReferral.ad_group_id,
      safeReferral.ad_set_id,
      safeReferral.adset_id,
    ]),
    campaign_id: firstNonEmptyString([safeReferral.campaign_id, safeReferral.campaignId]),
  };
}

async function persistConversationReferral({
  supabase,
  conversationId,
  conversationMessageId = null,
  metaMessageId = null,
  referral,
}) {
  try {
    if (!conversationId) {
      return { skipped: true, reason: 'missing_conversation_id' };
    }

    if (!isPlainObject(referral) || Object.keys(referral).length === 0) {
      return { skipped: true, reason: 'missing_referral' };
    }

    const payload = {
      conversation_id: conversationId,
      conversation_message_id: conversationMessageId,
      meta_message_id: metaMessageId || null,
      ...mapReferralColumns(referral),
      raw_referral: referral,
    };

    if (metaMessageId) {
      const { data: existing, error: findError } = await supabase
        .from('conversation_referrals')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('meta_message_id', metaMessageId)
        .limit(1)
        .maybeSingle();

      if (findError) {
        return { ok: false, error: findError.message };
      }

      if (existing?.id) {
        return { ok: true, id: existing.id, duplicate: true };
      }
    }

    const { data, error } = await supabase
      .from('conversation_referrals')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      const duplicateByConstraint = error.code === '23505';
      if (duplicateByConstraint && metaMessageId) {
        const { data: existing, error: fetchExistingError } = await supabase
          .from('conversation_referrals')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('meta_message_id', metaMessageId)
          .limit(1)
          .maybeSingle();

        if (!fetchExistingError && existing?.id) {
          return { ok: true, id: existing.id, duplicate: true };
        }
      }

      return { ok: false, error: error.message };
    }

    return { ok: true, id: data?.id || null, created: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

module.exports = {
  persistConversationReferral,
};