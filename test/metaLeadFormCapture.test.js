'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  META_LEAD_FORM_ACK_REPLY,
  tryMetaLeadFormCaptureTurn,
  isMetaLeadFormStructuredInbound,
  parseLabeledFormFields,
} = require('../conversation/metaLeadFormCapture');
const { cleanSpaces } = require('../utils/text');
const { extractCampaignReferralContext } = require('../services/leadAutomation');

const C1_CAMPAIGN = {
  campaign_type: 'seller_capture',
  campaign_name: 'Captacion propietarios C1',
  ad_name: 'Meta Lead Form Cumbres',
};

const STRUCTURED_TEXT = `Quiero vender mi propiedad
Nombre: Jorge Ramirez
Colonia: Apodaca
Tipo de propiedad: Casa
Operación: Venta`;

const META_FORM_STRUCTURED_TEXT = `Completé el formulario y me gustaría más información.
Nombre: Jorge Ramirez
Colonia: Apodaca
Tipo de propiedad: Casa
Operación: Venta`;

const META_FORM_EDGAR = `¡Hola! Completé el formulario y me gustaría obtener más información sobre tu negocio.
• nombre_completo: Edgar R.
• número_de_teléfono: +525545331442
• ¿la_propiedad_está_en_cumbres,_garcía_o_zona_poniente?: No
• ¿tienes_decisión_sobre_la_venta_o_renta_de_la_propiedad?: Solo estoy explorando
• ¿qué_tipo_de_propiedad_es?: Casa
• ¿qué_te_gustaría_hacer?: Vender
• ¿en_cuánto_tiempo_te_gustaría_avanzar?: 3-6 meses
• ¿en_qué_colonia_se_encuentra?: Vistancias segundo sector`;

const META_FORM_JAVIER = `¡Hola! Completé el formulario y me gustaría obtener más información sobre tu negocio.
• nombre_completo: Javier Velázquez | Broker Inmobiliario
• número_de_teléfono: +528110225732
• ¿la_propiedad_está_en_cumbres,_garcía_o_zona_poniente?: Sí
• ¿tienes_decisión_sobre_la_venta_o_renta_de_la_propiedad?: Sí
• ¿qué_tipo_de_propiedad_es?: Casa
• ¿qué_te_gustaría_hacer?: Vender
• ¿en_cuánto_tiempo_te_gustaría_avanzar?: 0-3 meses
• ¿en_qué_colonia_se_encuentra?: Cumbres`;

describe('Meta Lead Form / C1 captación propietarios', () => {
  it('detecta payload estructurado solo con frase de formulario completado', () => {
    assert.equal(
      isMetaLeadFormStructuredInbound({
        text: META_FORM_STRUCTURED_TEXT,
        message: { type: 'text' },
        campaignContext: C1_CAMPAIGN,
        previousAiState: {},
        parsedSignals: { lead_flow: 'offer', operation_type: 'sale' },
      }),
      true,
    );
  });

  it('no detecta campos estructurados sin frase de formulario completado', () => {
    assert.equal(
      isMetaLeadFormStructuredInbound({
        text: STRUCTURED_TEXT,
        message: { type: 'text' },
        campaignContext: C1_CAMPAIGN,
        previousAiState: {},
        parsedSignals: { lead_flow: 'offer', operation_type: 'sale' },
      }),
      false,
    );
  });

  it('parsea campos etiquetados del formulario', () => {
    const fields = parseLabeledFormFields(STRUCTURED_TEXT);
    assert.equal(fields.full_name, 'Jorge Ramirez');
    assert.equal(fields.location_text, 'Apodaca');
    assert.equal(fields.property_type_raw, 'Casa');
  });

  it('responde mensaje oficial único y persiste estado sin filtro de zona', () => {
    const turn = tryMetaLeadFormCaptureTurn({
      text: META_FORM_STRUCTURED_TEXT,
      message: { type: 'text' },
      campaignContext: C1_CAMPAIGN,
      previousAiState: {},
      parsedSignals: {
        lead_flow: 'offer',
        operation_type: 'sale',
        location_text: 'Apodaca',
      },
    });

    assert.equal(turn.handled, true);
    assert.equal(turn.reply, META_LEAD_FORM_ACK_REPLY);
    assert.match(String(turn.reply), /Gracias por compartir tu información/);
    assert.match(String(turn.reply), /En breve te estaremos contactando/);
    assert.doesNotMatch(String(turn.reply), /Claro, te puedo orientar con la venta/i);
    assert.equal(turn.statePatch.meta_lead_form_flow, true);
    assert.equal(turn.statePatch.full_name, 'Jorge Ramirez');
    assert.equal(turn.statePatch.location_text, 'Apodaca');
    assert.equal(turn.statePatch.property_type, 'house');
    assert.equal(turn.statePatch.geo_qualified, true);
    assert.equal(turn.statePatch.advisor_contact_consent, 'ACCEPTED');
    assert.equal(turn.statePatch.awaiting_field, null);
    assert.equal(turn.statePatch.handoff_sent, true);
  });

  it('no repite ack en turnos posteriores', () => {
    const first = tryMetaLeadFormCaptureTurn({
      text: META_FORM_STRUCTURED_TEXT,
      message: { type: 'text' },
      campaignContext: C1_CAMPAIGN,
      previousAiState: {},
      parsedSignals: { lead_flow: 'offer' },
    });
    const second = tryMetaLeadFormCaptureTurn({
      text: 'Gracias',
      message: { type: 'text' },
      campaignContext: C1_CAMPAIGN,
      previousAiState: { ...(first.statePatch || {}) },
      parsedSignals: { lead_flow: 'offer' },
    });
    assert.equal(second.handled, false);
  });

  it('integra con extractCampaignReferralContext para pauta captación', () => {
    const extracted = extractCampaignReferralContext({
      referral: {
        source_url: 'https://facebook.com/ad?utm_campaign=captacion_propietarios_c1',
        ad_name: 'Captacion propietarios Meta Lead Form',
      },
      messageText: META_FORM_STRUCTURED_TEXT,
    });
    assert.equal(extracted.campaignContext.campaign_type, 'seller_capture');
    const turn = tryMetaLeadFormCaptureTurn({
      text: META_FORM_STRUCTURED_TEXT,
      message: { type: 'text' },
      campaignContext: extracted.campaignContext,
      previousAiState: {},
      parsedSignals: { lead_flow: 'offer', full_name: 'Jorge Ramirez', location_text: 'Apodaca' },
    });
    assert.equal(turn.handled, true);
    assert.equal(turn.responseSource, 'meta_lead_form_c1');
  });

  it('QA real: Meta Lead Form Edgar — zona fuera de Cumbres, respuesta oficial única', () => {
    const turn = tryMetaLeadFormCaptureTurn({
      text: META_FORM_EDGAR,
      message: { type: 'text' },
      campaignContext: null,
      previousAiState: {},
      parsedSignals: {},
    });
    assert.equal(turn.handled, true);
    assert.equal(turn.reply, META_LEAD_FORM_ACK_REPLY);
    assert.equal(turn.statePatch.full_name, 'Edgar R');
    assert.equal(turn.statePatch.location_text, 'Vistancias segundo sector');
    assert.equal(turn.statePatch.property_type, 'house');
    assert.equal(turn.statePatch.geo_qualified, true);
    assert.equal(turn.statePatch.is_exploring_sale, true);
    assert.doesNotMatch(String(turn.reply), /Claro, te puedo orientar/i);
  });

  it('QA real: Meta Lead Form Javier — Cumbres, respuesta oficial única', () => {
    const turn = tryMetaLeadFormCaptureTurn({
      text: META_FORM_JAVIER,
      message: { type: 'text' },
      campaignContext: null,
      previousAiState: {},
      parsedSignals: {},
    });
    assert.equal(turn.handled, true);
    assert.equal(turn.statePatch.full_name, 'Javier Velázquez');
    assert.equal(turn.statePatch.location_text, 'Cumbres');
    assert.match(String(turn.reply), /canalizar tu caso con un asesor/i);
  });

  it('Railway path: Edgar colapsado en una línea (cleanSpaces) detecta y responde oficial', () => {
    const collapsed = cleanSpaces(META_FORM_EDGAR);
    assert.ok(!/\n/.test(collapsed));
    assert.equal(
      isMetaLeadFormStructuredInbound({
        text: collapsed,
        message: { type: 'text' },
        campaignContext: null,
        previousAiState: {},
        parsedSignals: {},
      }),
      true,
    );
    const fields = parseLabeledFormFields(collapsed);
    assert.ok(Object.keys(fields).length >= 2);
    const turn = tryMetaLeadFormCaptureTurn({
      text: collapsed,
      message: { type: 'text' },
      campaignContext: null,
      previousAiState: {},
      parsedSignals: {},
    });
    assert.equal(turn.handled, true);
    assert.equal(turn.reply, META_LEAD_FORM_ACK_REPLY);
    assert.equal(turn.statePatch.full_name, 'Edgar R');
    assert.equal(turn.statePatch.location_text, 'Vistancias segundo sector');
  });

  it('Railway path: Javier colapsado en una línea (cleanSpaces) detecta y responde oficial', () => {
    const collapsed = cleanSpaces(META_FORM_JAVIER);
    const turn = tryMetaLeadFormCaptureTurn({
      text: collapsed,
      message: { type: 'text' },
      campaignContext: null,
      previousAiState: {},
      parsedSignals: {},
    });
    assert.equal(turn.handled, true);
    assert.equal(turn.statePatch.full_name, 'Javier Velázquez');
    assert.equal(turn.statePatch.location_text, 'Cumbres');
  });

  it('Railway path: orgánico colapsado NO entra al parser Meta', () => {
    const text = cleanSpaces('Hola, quiero vender mi casa');
    assert.equal(
      isMetaLeadFormStructuredInbound({
        text,
        message: { type: 'text' },
        campaignContext: null,
        previousAiState: {},
        parsedSignals: {},
      }),
      false,
    );
  });

  it('Railway path: "Vi su anuncio" colapsado NO entra al parser Meta', () => {
    const text = cleanSpaces('Vi su anuncio');
    assert.equal(
      isMetaLeadFormStructuredInbound({
        text,
        message: { type: 'text' },
        campaignContext: { campaign_type: 'seller_capture' },
        previousAiState: {},
        parsedSignals: {},
      }),
      false,
    );
  });

  it('Railway path: payload parcial colapsado — fallback seguro sin crash', () => {
    const partial = cleanSpaces('Completé el formulario y me gustaría más información. Nombre: Jorge');
    assert.equal(
      isMetaLeadFormStructuredInbound({
        text: partial,
        message: { type: 'text' },
        campaignContext: null,
        previousAiState: {},
        parsedSignals: {},
      }),
      false,
    );
    const turn = tryMetaLeadFormCaptureTurn({
      text: partial,
      message: { type: 'text' },
      campaignContext: null,
      previousAiState: {},
      parsedSignals: {},
    });
    assert.equal(turn.handled, false);
  });
});
