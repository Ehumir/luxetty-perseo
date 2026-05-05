# PERSEO — Política de No Regresión y Documentación QA

## Política

> **Toda mejora futura debe pasar la suite completa sin degradar ningún escenario.**
> Si un PR rompe un test de regresión, se rechaza hasta corregir la causa raíz.

---

## Comandos

| Comando | Descripción |
|---|---|
| `npm test` | Ejecuta **todos** los test files bajo `test/` con el runner nativo de Node |
| `npm run test:regression` | Solo la suite maestra de regresión (`perseoRegression.test.js`) |
| `npm run test:perseo` | Suite maestra + regresión de conversación + CRM + inbound + playbooks |

---

## Archivos de la suite

| Archivo | Propósito |
|---|---|
| `test/perseoRegression.test.js` | Suite maestra — 31 escenarios cubriendo intent, tono, CRM, media, cambio de intención |
| `test/fixtures/perseoRegressionFixtures.js` | Fixtures controlados y factory de Supabase mock |
| `test/conversationRegression.test.js` | Regresión de flujo conversacional |
| `test/crmFlowRegression.test.js` | Flujos de conversión CRM end-to-end |
| `test/inboundReliability.test.js` | Confiabilidad de burst inbound y memoria de intención |
| `test/sprint3Playbooks.test.js` | Cobertura de playbooks definidos en sprint 3 |

---

## Escenarios de la suite maestra (`perseoRegression.test.js`)

### Escenarios de intención y tono

| ID | Nombre | Señales verificadas | Invariantes de respuesta |
|---|---|---|---|
| R01 | Saludo simple | `lead_flow=null`, `direct_property_reference=false` | No crea intención, no inventa propiedad |
| R02 | Comprador genérico | `lead_flow=demand` | Pide zona/presupuesto; no inventa propiedad inexistente |
| R03 | Comprador con presupuesto | `lead_flow=demand`, `budget_max≥4M`, `location_text=Cumbres` | Extrae ambos campos correctamente |
| R04 | Interés en propiedad específica | `direct_property_reference=true`, `property_code=LUX-A0453` | Captura código exacto |
| R05 | Pregunta por precio | Reply usa precio real del fixture | Sin precio → escala a asesor; nunca inventa |
| R06 | Pregunta por disponibilidad | Reply canaliza a asesor | Nunca afirma disponibilidad sin confirmar |
| R07 | Pregunta por ubicación | `location_text≈San Pedro` | No inventa calles ni precios |
| R08 | Solicitud de visita | `wants_visit=true` | Reply confirma coordinación con asesor |
| R09 | Vendedor genérico | `lead_flow=offer`, `operation_type=sale` | Tono consultivo; pide datos clave |
| R10 | Valuación | `asks_valuation=true`, `lead_flow=offer` | No inventa precio de tasación |
| R11 | Pregunta de comisión | `asks_commission=true` | No evasivo; aborda el tema directamente |
| R12 | Terreno en venta | `property_type≈land`, `lead_flow=offer` | No confunde con demanda |
| R13 | Propiedad ya publicada | `already_listed=true` | Está en `seller_scenarios` o como `primary_seller_scenario` |
| R14 | Sucesión/intestado | `legal_sensitive=true`, `needs_specialized_review=true` | No minimiza; escala a asesor |
| R15 | Propiedad ocupada | `occupancy_status≠null` o escenario de inquilinos | Registra la condición |
| R16 | Crédito vigente | `has_mortgage=true` | No trivializa; reconoce hipoteca |
| R17 | Urgencia de venta | `urgent_sale_signal=true` | No promete precio garantizado ni compra inmediata |
| R18 | No exclusiva | `objection_no_exclusivity=true` | No confrontacional; no fuerza exclusividad |

### Escenarios de campaña y seguimiento

| ID | Nombre | Señales verificadas | Invariantes de respuesta |
|---|---|---|---|
| R19 | Pauta con mensaje genérico | `hasCampaignContext=true`, `campaign_type=seller_capture` | Reply referencia la campaña |
| R20 | Reclamo de seguimiento | `complaint_followup=true`, `isComplaintCorrection=true` | Mantiene `lead_flow=offer`; no lanza preguntas masivas |

### Escenarios de media

| ID | Nombre | Señales verificadas | Invariantes de respuesta |
|---|---|---|---|
| R21 | Imagen sin visión real | — | No afirma análisis visual; reconocimiento honesto |
| R22 | Audio sin transcripción (1er) | `audio_without_transcription=true` | Pide texto o asesor |
| R22b | Audio sin transcripción (2do) | `audio_without_transcription_repeat=true` | Escala a asesor directamente |

### Escenarios de flujo y CRM

| ID | Nombre | Señales verificadas | Invariantes de CRM |
|---|---|---|---|
| R23 | Cambio de intención | `intent_changed=true`, `lead_flow=offer` | Reply de venta no mezcla demanda |
| R24 | Deduplicación de contacto | Múltiples formatos → ≤2 variantes normalizadas | Mismo input → mismo output siempre |
| R25 | No crea lead en saludo | `shouldCreate=false` | Saludo ambiguo no crea lead |
| R26 | CRM: lead creado con propiedad | `success=true`, asignado al agente de la propiedad | Agente correcto desde el fixture |
| R27 | CRM: idempotencia | No duplica leads en misma conversación | DB tiene ≤1 lead para la conversación |
| R28 | CRM: imagen sola no crea lead | `shouldCreate=false` | Sin señal de intención → no create |
| R29 | Cierre comercial: "Quiero verla" | `shouldClose=true`, `shouldClarify=false` | Con contexto de propiedad activa el cierre |
| R30 | Proveedor no crea lead | `provider=true`, `shouldCreate=false` | Categoría no-inmobiliaria bloqueada |
| R31 | Burst inbound: deduplicación | 3 mensajes → 2 únicos | Elimina duplicado por `meta_message_id` |

---

## Contrato de fixtures

Los fixtures en `test/fixtures/perseoRegressionFixtures.js` son **inmutables de referencia**:

- **No modificar** sus IDs, precios ni slugs sin actualizar todos los tests que los usan.
- `PROPERTY_LUX_C0310` tiene `slug: null` intencionalmente para probar el path de atención humana.
- `CONTACT_ANA_ALT_PHONE` es un formato alternativo del teléfono de Ana para probar normalización.

### Propiedades

| Constante | listing_id | Tipo | Precio | Agente asignado |
|---|---|---|---|---|
| `PROPERTY_LUX_A0453` | LUX-A0453 | casa | $4,500,000 | agent-owner-a0453 |
| `PROPERTY_LUX_B0201` | LUX-B0201 | terreno | $1,800,000 | agent-owner-b0201 |
| `PROPERTY_LUX_C0310` | LUX-C0310 | casa | $3,200,000 | null (sin agente) |

### Contactos

| Constante | WhatsApp | Agente asignado |
|---|---|---|
| `CONTACT_ANA` | 5218111111111 | null |
| `CONTACT_CARLOS` | 5218119999999 | agent-owner-a0453 |

---

## Mock Supabase

El factory `buildMockSupabase(db)` simula:

- `from(table)` → cadena fluida con `.select()`, `.insert()`, `.update()`, `.eq()`, `.is()`, `.or()`, `.order()`, `.limit()`, `.maybeSingle()`, `.single()`, `.then()`
- `rpc('assign_lead_via_engine', args)` → siempre retorna `fallback_agent` en el mock
- **Estado mutable**: el objeto `db` pasado se modifica in-place para simular persistencia dentro del test
- Cada test debe pasar su propia instancia de `buildBaseDb()` para aislar el estado

```js
const db = buildBaseDb({ leads: [existingLead] });
const supabase = buildMockSupabase(db);
// ... usar supabase en llamadas a servicios
```

---

## Ejecución en CI

Para integrar en un pipeline:

```sh
npm run test:perseo
```

La salida de `node --test` es compatible con TAP. Para formato JUnit:

```sh
node --test --test-reporter=junit test/perseoRegression.test.js
```

> **Umbral requerido: 0 failures.** Cualquier fallo bloquea el merge.
