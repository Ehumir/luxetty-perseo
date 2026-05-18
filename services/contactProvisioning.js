const {
  normalizePhoneNumber,
  buildPhoneLookupValues,
  isUsefulContactName,
  isInvalidContactName,
  splitContactName,
} = require('../utils/helpers');
const { normalizeText } = require('../utils/text');

function resolvePropertyAgentId(property) {
  if (!property || typeof property !== 'object') return null;
  return property.agent_profile_id || property.assigned_agent_profile_id || null;
}

function logContactProvisioning(logger, label, payload = {}) {
  const writer = logger && typeof logger.info === 'function' ? logger.info.bind(logger) : console.log;
  writer(label, payload);
}

function normalizeCandidateNames(waName, state = {}) {
  const names = [waName, state?.full_name]
    .filter((name) => typeof name === 'string')
    .map((name) => name.trim())
    .filter(Boolean);

  const usefulName = names.find((name) => isUsefulContactName(name) && !isInvalidContactName(name)) || null;
  const rejectedNames = usefulName ? [] : names;
  return { usefulName, rejectedNames };
}

async function lookupExistingContact(supabase, conversationRow, normalizedPhone) {
  let existingContact = null;

  if (conversationRow?.contact_id) {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', conversationRow.contact_id)
      .maybeSingle();
    existingContact = data || null;
  }

  if (!existingContact) {
    const { data: byWhatsapp } = await supabase
      .from('contacts')
      .select('*')
      .eq('whatsapp', normalizedPhone)
      .limit(1);
    existingContact = byWhatsapp?.[0] || null;
  }

  if (!existingContact) {
    const { data: byPhone } = await supabase
      .from('contacts')
      .select('*')
      .eq('phone', normalizedPhone)
      .limit(1);
    existingContact = byPhone?.[0] || null;
  }

  if (!existingContact) {
    const lookupValues = buildPhoneLookupValues(normalizedPhone);
    const orFilter = lookupValues
      .flatMap((value) => [`phone.eq.${value}`, `whatsapp.eq.${value}`])
      .join(',');
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .or(orFilter)
      .limit(1);
    existingContact = data?.[0] || null;
  }

  return existingContact;
}

/**
 * Plan contacto sin writes (compartido con preview ARGOS y execute).
 */
async function _planContact({
  supabase,
  conversationRow,
  state,
  phone,
  waName = null,
  property = null,
}) {
  if (!conversationRow?.id || !phone) {
    return {
      action: 'would_skip',
      would_create_contact: false,
      would_reuse_contact: false,
      contact_id: null,
      wasCreated: false,
      assigned_agent_profile_id: null,
      normalized_whatsapp: null,
    };
  }

  const normalizedPhone = normalizePhoneNumber(phone) || phone;
  const { usefulName } = normalizeCandidateNames(waName, state);
  const existingContact = await lookupExistingContact(supabase, conversationRow, normalizedPhone);
  const propertyAgentId = resolvePropertyAgentId(property);

  if (existingContact) {
    return {
      action: 'would_reuse',
      would_create_contact: false,
      would_reuse_contact: true,
      contact_id: existingContact.id,
      wasCreated: false,
      assigned_agent_profile_id:
        existingContact.assigned_agent_profile_id || null,
      normalized_whatsapp: normalizedPhone,
      useful_name: usefulName || null,
    };
  }

  return {
    action: 'would_create',
    would_create_contact: true,
    would_reuse_contact: false,
    contact_id: null,
    wasCreated: true,
    assigned_agent_profile_id: propertyAgentId || null,
    normalized_whatsapp: normalizedPhone,
    useful_name: usefulName || null,
  };
}

async function previewContactForConversation(params) {
  return _planContact(params);
}

async function ensureContactForConversationCore({
  supabase,
  conversationRow,
  state,
  phone,
  waName = null,
  source = 'whatsapp',
  rawPayload = null,
  property = null,
  logger = console,
  saveConversationEvent,
  updateConversationMeta,
}) {
  try {
    if (!conversationRow?.id || !phone) {
      return { contactId: null, wasCreated: false };
    }

    const normalizedPhone = normalizePhoneNumber(phone) || phone;
    const { usefulName, rejectedNames } = normalizeCandidateNames(waName, state);

    if (rejectedNames.length > 0) {
      await saveConversationEvent(conversationRow.id, 'contact_name_rejected', {
        source,
        normalized_phone: normalizedPhone,
        rejected_names: rejectedNames.slice(0, 3),
      });
    }

    const plan = await _planContact({
      supabase,
      conversationRow,
      state,
      phone,
      waName,
      property,
    });

    if (plan.action === 'would_skip') {
      return { contactId: null, wasCreated: false };
    }

    let existingContact =
      plan.action === 'would_reuse'
        ? await lookupExistingContact(supabase, conversationRow, normalizedPhone)
        : null;

    if (existingContact) {
      const payload = {};
      const existingDisplay =
        [existingContact.first_name, existingContact.last_name].filter(Boolean).join(' ').trim() ||
        existingContact.full_name ||
        '';
      const placeholderFirst = /^cliente$/i.test(String(existingContact.first_name || '').trim());
      const shouldApplyName =
        usefulName &&
        (!isUsefulContactName(existingDisplay) || placeholderFirst);

      if (shouldApplyName) {
        const nameParts = splitContactName(usefulName);
        payload.first_name = nameParts.firstName;
        payload.last_name = nameParts.lastName;
        payload.name_source = 'whatsapp_meta';
      } else if (
        usefulName &&
        isUsefulContactName(existingDisplay) &&
        normalizeText(existingDisplay) !== normalizeText(usefulName)
      ) {
        logContactProvisioning(logger, 'contact_name_mismatch_proposal', {
          conversation_id: conversationRow.id,
          contact_id: existingContact.id,
          existing_contact_name: existingDisplay,
          proposed_full_name: usefulName,
          action: 'manual_review_no_auto_rename',
        });
        await saveConversationEvent(conversationRow.id, 'contact_name_mismatch_proposal', {
          contact_id: existingContact.id,
          existing_contact_name: existingDisplay,
          proposed_full_name: usefulName,
          source,
        });
      }
      if (!existingContact.phone) payload.phone = normalizedPhone;
      if (!existingContact.whatsapp) payload.whatsapp = normalizedPhone;
      if (!existingContact.phone_normalized) payload.phone_normalized = normalizedPhone;
      if (!existingContact.whatsapp_normalized) payload.whatsapp_normalized = normalizedPhone;

      if (Object.keys(payload).length > 0) {
        await supabase.from('contacts').update(payload).eq('id', existingContact.id);
      }

      if (shouldApplyName) {
        await saveConversationEvent(conversationRow.id, 'contact_provisional_enriched', {
          contact_id: existingContact.id,
          source,
          normalized_phone: normalizedPhone,
          applied_name: usefulName,
        });
      }

      if (!conversationRow.contact_id || conversationRow.contact_id !== existingContact.id) {
        await updateConversationMeta(conversationRow.id, {
          contact_id: existingContact.id,
        });
      }

      await saveConversationEvent(conversationRow.id, 'contact_reused', {
        contact_id: existingContact.id,
        source,
        normalized_phone: normalizedPhone,
      });

      return { contactId: existingContact.id, wasCreated: false };
    }

    const { firstName: newContactFirstName, lastName: newContactLastName } =
      splitContactName(usefulName || 'Cliente');
    const propertyAgentId = resolvePropertyAgentId(property);
    const createPayload = {
      first_name: newContactFirstName,
      last_name: newContactLastName,
      phone: normalizedPhone,
      whatsapp: normalizedPhone,
      phone_normalized: normalizedPhone,
      whatsapp_normalized: normalizedPhone,
      name_source: usefulName ? 'whatsapp_meta' : 'auto_placeholder',
      created_source: 'ai_agent',
      created_channel: 'whatsapp',
    };
    if (propertyAgentId) {
      createPayload.assigned_agent_profile_id = propertyAgentId;
      logContactProvisioning(logger, 'assignment_property_owner_for_new_contact', {
        conversation_id: conversationRow.id,
        property_assigned_agent_profile_id: propertyAgentId,
        property_id: property?.id || null,
        property_code: property?.listing_id || property?.property_code || null,
      });
      await saveConversationEvent(conversationRow.id, 'contact_assigned_from_property', {
        assigned_agent_profile_id: propertyAgentId,
        property_id: property?.id || null,
        source,
      });
    }

    const { data: created, error } = await supabase
      .from('contacts')
      .insert(createPayload)
      .select()
      .single();

    if (error) {
      console.error('Error creating contact:', error);
      return { contactId: null, wasCreated: false };
    }

    await updateConversationMeta(conversationRow.id, {
      contact_id: created.id,
    });

    await saveConversationEvent(conversationRow.id, 'contact_created', {
      contact_id: created.id,
      source,
      normalized_phone: normalizedPhone,
      has_useful_name: !!usefulName,
      raw_payload_meta_message_id: rawPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id || null,
    });

    return { contactId: created.id, wasCreated: true };
  } catch (err) {
    console.error('FATAL ensureContactForConversation:', err);
    return { contactId: null, wasCreated: false };
  }
}

module.exports = {
  ensureContactForConversationCore,
  _planContact,
  previewContactForConversation,
  lookupExistingContact,
  resolvePropertyAgentId,
};

