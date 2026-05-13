require('dotenv').config();

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'luxetty_token';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v19.0';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || GRAPH_API_VERSION;
const MEDIA_DOWNLOAD_MAX_BYTES = Number(process.env.MEDIA_DOWNLOAD_MAX_BYTES || 15728640);
const IMAGE_VISION_ENABLED = process.env.IMAGE_VISION_ENABLED !== 'false';
const IMAGE_VISION_MODEL = process.env.IMAGE_VISION_MODEL || 'gpt-4o-mini';
const IMAGE_VISION_TIMEOUT_MS = Number(process.env.IMAGE_VISION_TIMEOUT_MS || 30000);
const IMAGE_VISION_MAX_BYTES = Number(process.env.IMAGE_VISION_MAX_BYTES || MEDIA_DOWNLOAD_MAX_BYTES);

// QA: números de WhatsApp autorizados para comandos internos de prueba
// Formato: lista separada por comas. Dejar vacío en producción si no hay testers.
// Ejemplo: QA_ALLOWED_WHATSAPP_NUMBERS=5218111111111,5218119999999
const QA_ALLOWED_WHATSAPP_NUMBERS = process.env.QA_ALLOWED_WHATSAPP_NUMBERS || '';

/** Sprint 2 — gatekeeper + fail-closed lectura `ai_conversation_channel_settings`. Default false = comportamiento previo (solo control por conversación). */
const PERSEO_POLICY_V2_ENABLED = process.env.PERSEO_POLICY_V2_ENABLED === 'true';

module.exports = {
  PORT,
  VERIFY_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  WHATSAPP_TOKEN,
  META_ACCESS_TOKEN,
  PHONE_NUMBER_ID,
  GRAPH_API_VERSION,
  WHATSAPP_API_VERSION,
  MEDIA_DOWNLOAD_MAX_BYTES,
  IMAGE_VISION_ENABLED,
  IMAGE_VISION_MODEL,
  IMAGE_VISION_TIMEOUT_MS,
  IMAGE_VISION_MAX_BYTES,
  QA_ALLOWED_WHATSAPP_NUMBERS,
  PERSEO_POLICY_V2_ENABLED,
};