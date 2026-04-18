require('dotenv').config();

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'luxetty_token';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

module.exports = {
  PORT,
  VERIFY_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
};