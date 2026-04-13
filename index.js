require('dotenv').config();

const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'luxetty_token';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Memoria temporal corta por número para continuidad rápida
const conversations = new Map();

// Prompt maestro Luxetty
const systemPrompt = `Eres el Asesor Inmobiliario IA de Luxetty.

Tu función es atender conversaciones entrantes, filtrar, calificar y perfilar leads de Oferta y Demanda, orientar con profesionalismo y llevar cada caso al siguiente paso correcto dentro del proceso comercial de Luxetty.

Tu objetivo NO es cerrar operaciones por tu cuenta.
Tu objetivo es:

* entender el caso real del lead
* perfilarlo correctamente
* responder con claridad y naturalidad
* compartir únicamente información real del sistema
* lograr aceptación para que un asesor humano dé seguimiento
* dejar el caso listo para operación interna

# IDENTIDAD

Hablas como parte de Luxetty.
Nunca te presentas como un sistema técnico.
Nunca hablas como programador, bot, modelo, API o asistente virtual técnico.

# TONO

Tu estilo debe ser:

* profesional
* natural
* consultivo
* claro
* directo
* amable
* sobrio
* confiable

Debes sonar como una persona seria de una inmobiliaria premium, no como formulario, chatbot robótico ni call center agresivo.

# REGLA DE CONTINUIDAD

* Solo te presentas una vez al inicio real de una conversación nueva.
* Si ya existe contexto, no repitas saludo ni presentación.
* No repitas preguntas ya respondidas.
* Continúa exactamente desde el punto de la conversación donde se quedó.
* Si el cliente manda un mensaje corto, ambiguo o parcial, interpretas el contexto antes de preguntar de nuevo.

# PRESENTACIÓN INICIAL

Solo cuando la conversación realmente inicia y no existe contexto previo, abre con algo como:

Hola, soy el asistente de Luxetty 😊
Con gusto te ayudo.
Para ubicarte mejor, ¿estás buscando comprar, rentar, vender o poner en renta una propiedad?

No uses esta presentación en mensajes posteriores de la misma conversación.

# MISIÓN COMERCIAL

Tu trabajo es:

* filtrar
* calificar
* detectar prioridad
* perfilar el caso
* orientar
* generar confianza
* lograr aceptación para contacto humano
* dejar trazabilidad útil para el equipo comercial

# TIPOS DE CLIENTE

## OFERTA

Clientes que quieren:

* vender una propiedad
* poner en renta una propiedad

## DEMANDA

Clientes que quieren:

* comprar
* rentar

# ZONAS DE ATENCIÓN

Luxetty atiende principalmente:

* Monterrey
* Cumbres
* García
* San Pedro Garza García
* Carretera Nacional
* zonas residenciales de alto valor en Guadalupe, San Nicolás, Apodaca y Santa Catarina

Si el caso está claramente fuera de estas zonas:

* responde cordialmente
* explica brevemente que Luxetty se enfoca en determinadas zonas
* no sigas profundizando innecesariamente
* ofrece orientación breve solo si tiene sentido

# FILTROS DE CALIFICACIÓN

## OFERTA

Descartar comercialmente si:

* venta menor a $3,000,000 MXN
* renta menor a $10,000 MXN

## DEMANDA

Descartar comercialmente si:

* compra menor a $3,000,000 MXN
* renta menor a $10,000 MXN

Si el caso no califica, responde con cortesía, sin sonar despectivo, por ejemplo con una idea como:
Por el momento estamos enfocados en propiedades de mayor valor en ciertas zonas, pero con gusto puedo orientarte brevemente si lo necesitas.

# REGLAS CRÍTICAS ABSOLUTAS

## VERDAD Y TRAZABILIDAD

* Nunca inventes propiedades
* Nunca inventes precios
* Nunca inventes links
* Nunca inventes disponibilidad
* Nunca inventes ubicaciones específicas
* Nunca inventes amenidades, metrajes, características, vistas o condiciones
* Nunca digas que revisaste inventario si el sistema no te devolvió resultados reales
* Nunca hables de propiedades de otras inmobiliarias como si fueran de Luxetty
* Nunca presentes supuestos como hechos

## AGENDA Y SEGUIMIENTO

* No agendes reuniones como si ya hubieran quedado cerradas internamente
* No confirmes citas exactas como un hecho consumado
* No prometas que alguien llamará en un minuto exacto ni en una hora exacta si el sistema no lo controla
* Tu función es lograr aceptación para contacto humano y dejar el caso listo para seguimiento

## COMPORTAMIENTO

* Máximo 1 o 2 preguntas por mensaje, salvo que una sola respuesta breve pida una aclaración mínima adicional
* No hagas interrogatorios
* No mandes textos excesivamente largos
* No presiones
* No uses lenguaje demasiado vendedor
* No uses emojis en exceso
* Puedes usar validaciones naturales como: “Perfecto”, “Claro”, “Entiendo”

# QUÉ HACER SEGÚN EL TIPO DE MENSAJE

## SI RECIBES TEXTO

Interpretas intención, contexto y siguiente paso.

## SI RECIBES AUDIO

Debes comportarte como si ya se hubiera transcrito correctamente.

* toma la transcripción como entrada válida
* responde con naturalidad
* si el contenido no está claro, pide solo la aclaración mínima necesaria
* no menciones detalles técnicos de transcripción al usuario

## SI RECIBES IMAGEN

Debes comportarte como si el sistema ya hubiera procesado la imagen.
Puedes usar la imagen como apoyo contextual, pero:

* no inventes datos no visibles
* no valores una propiedad por foto
* no asegures metrajes, ubicación, precio o situación legal por una imagen
* si la imagen sirve como referencia, úsala para perfilar mejor

# REGLAS ESPECIALES PARA DEMANDA

## CUANDO SÍ HAY RESULTADOS REALES DEL SISTEMA

Si el sistema te entrega propiedades reales:

* solo puedes hablar de esas propiedades
* usa únicamente datos reales que vengan del sistema
* puedes compartir links reales de Luxetty
* puedes resumir coincidencias reales
* puedes comparar opciones solo con base en datos reales disponibles

## CUANDO NO HAY RESULTADOS REALES DEL SISTEMA

Si no hubo resultados reales:

* no inventes nada
* no prometas propiedades específicas
* perfila mejor la búsqueda
* o deja el caso listo para seguimiento humano

# REGLA FINAL ABSOLUTA

Si no está confirmado por el sistema o por el lead, no lo afirmes.
Si no existe como dato real, no lo inventes.
Si no hay integración o resultado real, no muestres propiedades específicas.
`;

function detectIntent(message) {
  const text = (message || '').toLowerCase();

  const wantsBuy =
    text.includes('comprar') ||
    text.includes('compra') ||
    text.includes('busco') ||
    text.includes('quiero una casa') ||
    text.includes('quiero una propiedad');

  const wantsRent =
    text.includes('rentar') ||
    text.includes('renta') ||
    text.includes('alquilar') ||
    text.includes('alquiler');

  const wantsSell =
    text.includes('vender') ||
    text.includes('quiero vender') ||
    text.includes('venta mi casa');

  const wantsOfferRent =
    text.includes('poner en renta') ||
    text.includes('quiero rentar mi propiedad');

  let leadType = null;
  let operationType = null;

  if (wantsBuy) {
    leadType = 'demand';
    operationType = 'sale';
  } else if (wantsRent) {
    leadType = 'demand';
    operationType = 'rent';
  } else if (wantsSell) {
    leadType = 'offer';
    operationType = 'sale';
  } else if (wantsOfferRent) {
    leadType = 'offer';
    operationType = 'rent';
  }

  let propertyType = null;
  if (text.includes('terreno')) propertyType = 'land';
  else if (text.includes('casa') || text.includes('residencia')) propertyType = 'house';
  else if (text.includes('depa') || text.includes('departamento')) propertyType = 'apartment';

  return {
    leadType,
    operationType,
    propertyType
  };
}

function extractLocation(message) {
  const text = (message || '').toLowerCase();
  const knownLocations = [
    'cumbres',
    'san pedro',
    'monterrey',
    'garcía',
    'garcia',
    'carretera nacional',
    'guadalupe',
    'san nicolás',
    'san nicolas',
    'apodaca',
    'santa catarina'
  ];

  const normalized = {
    cumbres: 'Cumbres',
    'san pedro': 'San Pedro',
    monterrey: 'Monterrey',
    'garcía': 'García',
    garcia: 'García',
    'carretera nacional': 'Carretera Nacional',
    guadalupe: 'Guadalupe',
    'san nicolás': 'San Nicolás',
    'san nicolas': 'San Nicolás',
    apodaca: 'Apodaca',
    'santa catarina': 'Santa Catarina'
  };

  for (const location of knownLocations) {
    if (text.includes(location)) {
      return normalized[location];
    }
  }

  return null;
}

function extractMaxPrice(message) {
  const text = (message || '').toLowerCase();

  if (text.includes('10 millones') || text.includes('10m')) return 10000000;
  if (text.includes('9 millones') || text.includes('9m')) return 9000000;
  if (text.includes('8 millones') || text.includes('8m')) return 8000000;
  if (text.includes('7 millones') || text.includes('7m')) return 7000000;
  if (text.includes('6 millones') || text.includes('6m')) return 6000000;
  if (text.includes('5 millones') || text.includes('5m')) return 5000000;
  if (text.includes('4 millones') || text.includes('4m')) return 4000000;
  if (text.includes('3 millones') || text.includes('3m')) return 3000000;

  const numberMatch = text.match(/\$?\s*([\d,]+)\s*(mxn|pesos)?/i);
  if (numberMatch) {
    return Number(numberMatch[1].replace(/,/g, ''));
  }

  return null;
}

function extractBedrooms(message) {
  const text = (message || '').toLowerCase();

  const match = text.match(/(\d+)\s*(rec[aá]maras?|habitaciones?)/i);
  if (match) {
    return Number(match[1]);
  }

  return null;
}

async function searchProperties({
  operationType,
  location,
  minPrice = null,
  maxPrice = null,
  bedrooms = null,
  propertyType = null,
  limit = 5
}) {
  const { data, error } = await supabase.rpc('ai_search_properties', {
    p_operation_type: operationType,
    p_location: location,
    p_min_price: minPrice,
    p_max_price: maxPrice,
    p_bedrooms: bedrooms,
    p_limit: limit,
    p_property_type: propertyType
  });

  if (error) {
    console.error('Supabase RPC error:', error);
    return [];
  }

  return data || [];
}

function formatPropertyPrice(price, currencyCode) {
  if (price == null) return 'Precio por confirmar';
  return `$${Number(price).toLocaleString('es-MX')} ${currencyCode || 'MXN'}`;
}

function formatProperties(properties) {
  if (!properties || properties.length === 0) return null;

  return properties.map((p, i) => {
    const locationText = p.neighborhood || p.zone || p.city || 'Ubicación por confirmar';
    const highlights = Array.isArray(p.public_highlights) && p.public_highlights.length > 0
      ? `✨ ${p.public_highlights.slice(0, 2).join(' · ')}\n`
      : '';

    return `${i + 1}. ${p.title}
💰 ${formatPropertyPrice(p.price, p.currency_code)}
📍 ${locationText}
${highlights}🔗 ${p.listing_url}`;
  }).join('\n\n');
}

function buildInventoryContext(properties) {
  if (!properties || properties.length === 0) {
    return 'RESULTADOS_REALES_DEL_SISTEMA: []';
  }

  return `RESULTADOS_REALES_DEL_SISTEMA:\n${JSON.stringify(properties, null, 2)}`;
}

async function getOrCreateConversation(phone) {
  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('*')
    .eq('channel', 'whatsapp')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1);

  if (findError) throw findError;

  if (existing && existing.length > 0) {
    return existing[0];
  }

  const { data: created, error: createError } = await supabase
    .from('conversations')
    .insert({
      channel: 'whatsapp',
      phone,
      status: 'open',
      priority: 'medium',
      last_message_at: new Date().toISOString()
    })
    .select()
    .single();

  if (createError) throw createError;

  return created;
}

async function saveConversationMessage({
  conversationId,
  direction,
  senderType,
  messageType,
  messageText,
  transcriptionText = null,
  metaMessageId = null,
  rawPayload = {}
}) {
  const { data, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: conversationId,
      direction,
      sender_type: senderType,
      message_type: messageType,
      message_text: messageText,
      transcription_text: transcriptionText,
      meta_message_id: metaMessageId,
      raw_payload: rawPayload
    })
    .select()
    .single();

  if (error) throw error;

  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString()
    })
    .eq('id', conversationId);

  return data;
}

async function savePropertySuggestions(conversationId, conversationMessageId, properties) {
  if (!properties || properties.length === 0) return;

  const rows = properties
    .filter((property) => property?.id)
    .map((property, index) => ({
      conversation_id: conversationId,
      conversation_message_id: conversationMessageId,
      property_id: property.id,
      position: index + 1
    }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('conversation_property_suggestions')
    .insert(rows);

  if (error) {
    console.error('Error saving property suggestions:', error);
  }
}

async function sendWhatsAppText(to, body) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const messageType = message.type;
    const metaMessageId = message.id || null;

    let text = '';

    if (messageType === 'text') {
      text = message.text?.body || '';
    } else if (messageType === 'audio') {
      text = 'El usuario envió un audio. Aún falta integrar la transcripción automática.';
    } else if (messageType === 'image') {
      text = 'El usuario envió una imagen. Aún falta integrar el análisis de imágenes.';
    } else {
      text = `El usuario envió un mensaje de tipo: ${messageType}.`;
    }

    console.log('Mensaje recibido:', text);

    const conversationRow = await getOrCreateConversation(from);

    await saveConversationMessage({
      conversationId: conversationRow.id,
      direction: 'inbound',
      senderType: 'lead',
      messageType: messageType === 'text' ? 'text' : (messageType === 'audio' ? 'audio' : (messageType === 'image' ? 'image' : 'system')),
      messageText: text,
      metaMessageId,
      rawPayload: req.body
    });

    const previousMessages = conversations.get(from) || [];

    const intent = detectIntent(text);
    const detectedLocation = extractLocation(text);
    const detectedMaxPrice = extractMaxPrice(text);
    const detectedBedrooms = extractBedrooms(text);

    let matchedProperties = [];

    if (intent.leadType === 'demand' && detectedLocation) {
      matchedProperties = await searchProperties({
        operationType: intent.operationType || 'sale',
        location: detectedLocation,
        maxPrice: detectedMaxPrice,
        bedrooms: detectedBedrooms,
        propertyType: intent.propertyType,
        limit: 3
      });

      console.log('Propiedades encontradas:', matchedProperties);
    }

    let reply = null;

    if (matchedProperties.length > 0) {
      const inventoryContext = buildInventoryContext(matchedProperties);

      const messages = [
        { role: 'system', content: systemPrompt },
        ...previousMessages,
        {
          role: 'system',
          content: `Usa únicamente estas propiedades reales si decides compartir opciones.\n${inventoryContext}`
        },
        { role: 'user', content: text }
      ];

      const response = await client.chat.completions.create({
        model: 'gpt-5-mini',
        messages
      });

      reply =
        response.choices[0].message.content?.trim() ||
        `Te comparto opciones reales que encontré para ti:\n\n${formatProperties(matchedProperties)}`;
    } else {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...previousMessages,
        { role: 'user', content: text }
      ];

      const response = await client.chat.completions.create({
        model: 'gpt-5-mini',
        messages
      });

      reply =
        response.choices[0].message.content?.trim() ||
        'Gracias por escribirnos. En un momento te apoyamos.';
    }

    const updatedMessages = [
      ...previousMessages,
      { role: 'user', content: text },
      { role: 'assistant', content: reply }
    ];

    conversations.set(from, updatedMessages.slice(-12));

    const outboundMessageRow = await saveConversationMessage({
      conversationId: conversationRow.id,
      direction: 'outbound',
      senderType: 'ai_agent',
      messageType: 'text',
      messageText: reply,
      rawPayload: {}
    });

    if (matchedProperties.length > 0) {
      await savePropertySuggestions(
        conversationRow.id,
        outboundMessageRow.id,
        matchedProperties
      );
    }

    await sendWhatsAppText(from, reply);

    return res.sendStatus(200);
  } catch (error) {
    console.error('Error webhook:', error.response?.data || error.message || error);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT} 🚀`);
});