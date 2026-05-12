const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERSEO_CONSULTANT_SYSTEM_PROMPT,
  buildPerseoConsultantContext,
} = require('../conversation/perseoConsultantPrompt');

test('system prompt incluye reglas rectoras consultivas y comerciales oficiales', () => {
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /filtrar, calificar/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /comprar, rentar, vender o poner en renta/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /Zona/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /Precio/);
  assert.match(
    PERSEO_CONSULTANT_SYSTEM_PROMPT,
    /¿La propiedad es tuya o estás apoyando a alguien\?/
  );
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /\$3,000,000/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /\$10,000/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /https:\/\/luxetty\.com/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /Nunca inventar propiedades/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /Podemos agendar una visita rápida \(20 min\)/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /Podemos agendar una llamada breve \(20 min\)/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /Nunca enviar resumen al prospecto/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /3\.5% y 5%/);
  assert.match(PERSEO_CONSULTANT_SYSTEM_PROMPT, /exclusividad/i);
});

test('lead ofertante con terreno genera guia de oferta consultiva', () => {
  const context = buildPerseoConsultantContext(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      property_type: 'land',
      location_text: 'Monterrey',
      budget_max: 4500000,
    },
    [{ role: 'user', content: 'Quiero vender mi terreno en Monterrey' }],
    { userMessage: 'Quiero vender mi terreno en Monterrey' }
  );

  assert.match(context, /lead_flow=offer/);
  assert.match(context, /zone_accepted=yes/);
  assert.match(context, /Oferta en calificacion/i);
});

test('lead pregunta comision activa instruccion exacta de comision', () => {
  const context = buildPerseoConsultantContext(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'San Pedro Garza Garcia',
      budget_max: 8000000,
    },
    [{ role: 'user', content: 'Que comision manejan?' }],
    { userMessage: 'Que comision manejan?' }
  );

  assert.match(context, /pregunta de comision/i);
  assert.match(context, /exclusividad/i);
});

test('lead comprador con presupuesto mantiene flujo de demanda', () => {
  const context = buildPerseoConsultantContext(
    {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Cumbres',
      budget_max: 5500000,
      property_type: 'house',
      contact_preference: 'whatsapp',
    },
    [{ role: 'user', content: 'Busco casa en Cumbres con 5.5 millones' }],
    { userMessage: 'Busco casa en Cumbres con 5.5 millones' }
  );

  assert.match(context, /lead_flow=demand/);
  assert.match(context, /minimum_required_mxn=3000000/);
  assert.match(context, /Demanda en calificacion/i);
});

test('lead fuera de zona queda marcado para orientacion', () => {
  const context = buildPerseoConsultantContext(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'Saltillo',
      budget_max: 5000000,
    },
    [{ role: 'user', content: 'Quiero vender en Saltillo' }],
    { userMessage: 'Quiero vender en Saltillo' }
  );

  assert.match(context, /zone_accepted=no/);
  assert.match(context, /fuera de cobertura/i);
});

test('lead por debajo del rango minimo se marca como below minimum', () => {
  const context = buildPerseoConsultantContext(
    {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Monterrey',
      budget_max: 1800000,
    },
    [{ role: 'user', content: 'Busco casa en Monterrey de 1.8 millones' }],
    { userMessage: 'Busco casa en Monterrey de 1.8 millones' }
  );

  assert.match(context, /below_minimum=yes/);
  assert.match(context, /por debajo del minimo/i);
});
