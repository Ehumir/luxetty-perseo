const axios = require('axios');
const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = require('../config/env');

module.exports = {
  axios,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
};