# R1 — Contrato de estado (hold / preparación)

**Estado:** Hold — **no implementar en R0.**  
**Propósito:** fijar dónde vivirán los conceptos del plan oficial v2.0 cuando se abra la fase R1.

## Campos previstos (convivencia con `ai_state` JSON)

| Concepto | Ubicación tentativa | Notas |
|----------|---------------------|--------|
| `conversation_stage` | `ai_state.conversation_stage` (string enum) | NEW, UNDERSTANDING, IDENTITY_PENDING, QUALIFYING, … |
| `identity_state` | `ai_state.identity_state` | unknown \| inferred \| confirmed \| crm_linked |
| `protected_intent` / intent lock | `ai_state.protected_lead_flow` + reglas en código | R0: `operation_type === 'sale'` **no** identifica solo al vendedor (también es compra vs renta en `intent.js`). R1 debe separar `transaction_side` / `intent_lane` explícitos. |
| `last_user_confirmed_fields` | `ai_state.last_user_confirmed_fields` (objeto o array) | Huella de confirmación explícita |
| `last_assistant_question` | `ai_state.last_assistant_question` (string o hash) | Anti-repeat / continuidad |

## Módulos legacy que chocarán con R1

- `conversation/parsers.js` — hoy mezcla `lead_flow`, `budget_max`, `expected_price` en un solo retorno.
- `conversation/stateUpdater.js` — merge `signals.lead_flow || prev.lead_flow` sin máquina de etapas.
- `index.js` — `buildConsultiveFallbackReply` (sigue existiendo en R0; R1 moverá lógica a capa única).
- `conversation/contextualMemoryResolver.js` — sustitución contextual vs oferta.
- `conversation/leadEntryPointRouter.js` — reassert de `lead_flow`.
- `conversation/conversationEngineV2.js` — orquestador OpenAI vs estado.
- `conversation/namePrompt.js` / `nameFirstGuardrail.js` — identidad dispersa.

## R2 Shadow Mode (recordatorio)

Decision Core: comparar decisiones en shadow antes de aplicar patches; ver `perseo-ai-decision-core-rearchitecture.md`.

---

*Actualizar este documento al kickoff de R1.*
