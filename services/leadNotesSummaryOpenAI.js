const { OPENAI_API_KEY, OPENAI_MODEL } = require('../config/env');
const { openai } = require('./openaiService');

function buildLeadSummaryFallback({ aiState = {}, conversation = {}, property = null }) {
  const parts = [];
  const operation = aiState?.operation_type || aiState?.lead_intent || null;
  const locationText = aiState?.location_text || null;
  const propertyType = aiState?.property_type || null;
  const campaignSource =
    aiState?.campaign_context?.campaign_source ||
    aiState?.source ||
    null;

  parts.push(`Solicitud generada desde conversación ${conversation?.channel || 'whatsapp'}.`);
  if (campaignSource) parts.push(`Origen: ${campaignSource}.`);
  if (property?.title || property?.listing_id) {
    parts.push(`Propiedad: ${property?.listing_id || ''} ${property?.title || ''}`.trim());
  }
  if (propertyType) parts.push(`Tipo: ${propertyType}.`);
  if (locationText) parts.push(`Zona: ${locationText}.`);
  if (operation) parts.push(`Operación/intención: ${operation}.`);
  return parts.join(' ').slice(0, 1500);
}

async function fetchRecentConversationMessages(supabase, conversationId, limit = 30) {
  if (!supabase || !conversationId) return [];
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('sender_type, message_text, direction, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('LEAD_NOTES_SUMMARY_MESSAGES_ERROR', error.message);
    return [];
  }
  return [...(data || [])].reverse();
}

async function generateLeadNotesSummaryOpenAI({
  supabase,
  conversationId,
  aiState = {},
  conversation = {},
  property = null,
  referralContext = null,
  fallbackSummary = null,
}) {
  const fallback = fallbackSummary || buildLeadSummaryFallback({ aiState, conversation, property });
  if (!OPENAI_API_KEY) return fallback;

  const recentMessages = await fetchRecentConversationMessages(supabase, conversationId);
  const chatSnippet = recentMessages
    .filter((m) => m.message_text)
    .map((m) => {
      const stamp = m.created_at
        ? new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ')
        : '';
      return `[${stamp}] [${m.sender_type || 'unknown'}] ${m.message_text}`;
    })
    .join('\n');

  const campaignContext =
    aiState?.campaign_context && typeof aiState.campaign_context === 'object'
      ? aiState.campaign_context
      : null;

  const prompt = `Eres un asistente de CRM inmobiliario. Redacta un resumen operativo en español (4-8 líneas) para que un asesor humano entienda el caso al abrir la solicitud.

Incluye intención comercial, origen (campaña/propiedad/orgánico), zona, presupuesto si aparece, urgencia y siguiente paso sugerido según la plática reciente. No inventes datos.

Contexto IA:
${JSON.stringify(aiState)}

Campaña:
${campaignContext ? JSON.stringify(campaignContext) : 'Sin campaña explícita'}

Referral:
${referralContext ? JSON.stringify(referralContext) : 'Sin referral'}

Teléfono: ${conversation?.phone || 'n/d'}
Canal: ${conversation?.channel || 'n/d'}
Propiedad: ${property?.title || 'n/d'} (${property?.listing_id || 'sin código'})

Mensajes recientes:
${chatSnippet || 'Sin mensajes recientes'}

Responde SOLO con el resumen narrativo, sin markdown.`;

  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 450,
      temperature: 0.35,
    });
    const summary = response?.choices?.[0]?.message?.content?.trim() || '';
    return summary || fallback;
  } catch (error) {
    console.error('LEAD_NOTES_SUMMARY_OPENAI_ERROR', error?.message || error);
    return fallback;
  }
}

module.exports = {
  buildLeadSummaryFallback,
  generateLeadNotesSummaryOpenAI,
};
