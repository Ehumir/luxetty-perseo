# PERSEO V3-F1 — Núcleo conversacional paralelo (arquitectura y estrategia)

**Estado:** F1 completado en código aislado. **Producción:** sigue 100 % legacy (`index.js` sin imports V3).

---

## 1. Arquitectura V3 (capas)

```
Usuario (futuro) → Interpreter (OpenAI en F3+) → Decision schema
                 → Rule Guard (invariantes) → State Manager
                 → Stage Engine + Identity resolver
                 → Composer (humano) → (futuro) CRM layer aparte
```

| Capa | Carpeta F1 | Responsabilidad |
|------|-------------|-----------------|
| Tipos / contratos | `conversation/v3/types/`, `contracts/` | `ConversationState`, `ConversationDecision`, enums |
| Estado | `conversation/v3/state/` | Merge puro + transición con guard |
| Reglas | `conversation/v3/rules/` | Bloqueos offer↔demand, humano, CRM mínimo, inventario |
| Etapas | `conversation/v3/stages/` | `resolveNextStage()` determinista |
| Identidad | `conversation/v3/identity/` | `resolveIdentityState()` |
| Intérprete | `conversation/v3/interpreter/` | **Mock** sin OpenAI |
| Composer | `conversation/v3/composer/` | Stub de contrato (sin copy legacy) |
| CRM | `conversation/v3/crm/` | README hasta F6 |
| Observabilidad | `conversation/v3/core/` | `v3Log`, `shadowHarness` |

---

## 2. Flujo conversacional (lógica de negocio desacoplada)

1. Estado inicial `NEW` + modo `ai`.  
2. Saludo → `UNDERSTANDING`.  
3. Intención venta → `leadFlow=offer`, `operationType=sale`, etapa hacia `IDENTITY_PENDING` si falta nombre.  
4. Nombre → `collectedFields.fullName`, identidad `PARTIAL`/`CONFIRMED`.  
5. Ubicación / precio esperado (venta) → `expectedPrice`, **no** `budget`.  
6. Cuando ubicación + precio → etapa `READY_FOR_CRM` (sin ejecutar CRM en F1).

---

## 3. Stage engine

Constantes en `types/constants.js` (`CONVERSATION_STAGES`).  
Transiciones en `stages/stageEngine.js` — **sin** aleatoriedad ni llamadas de red.

---

## 4. Rule guard

`rules/ruleGuard.js` evalúa `evaluateRuleGuard(state, decision)`:

- Cambio offer → demand (o inverso) sin `explicitFlowSwitch`.  
- Respuesta IA si `mode === human`.  
- `shouldCreateLead` sin `hasContact`.  
- `inventedPropertyClaim`.  
- `nextSuggestedStage` inválido.

---

## 5. Composer (contrato)

Entrada: `{ state, decision, context }`.  
Salida: `{ responseText, followUpQuestion, toneFlags }`.  
F1: `composerStub.js` no reutiliza plantillas legacy.

---

## 6. Shadow strategy

`core/shadowHarness.js` expone `runShadowCompare({ legacyText, v3State, v3Decision })` para contrastar strings/estructuras **fuera** del webhook.  
En F3 se alimentará con decisión real + logs `PERSEO_V3_SHADOW_MODE`.

---

## 7. Rollout strategy

| Fase | Motor productivo | V3 |
|------|------------------|-----|
| F1 | Legacy | Solo tests + módulos |
| F3 | Legacy | Shadow (diff log) |
| F5 | Legacy + allowlist | Ejecución acotada |
| F9 | Deprecación legacy | Default |

Variables:

- `PERSEO_ENGINE` — `legacy` (default efectivo F1) o `v3` (solicitud reservada; productivo sigue legacy).  
- `PERSEO_V3_ENABLED` — maestro futuro de enrutamiento (F1: no cableado).  
- `PERSEO_V3_SHADOW_MODE` — habilita logging V3 en sombra.  
- `PERSEO_V3_QA_ALLOWLIST` — lista preparada para F5.  
- `PERSEO_V3_LOG` — logs estructurados `[V3]` sin ruido por defecto.

`shouldRouteInboundToV3Core()` en `config/perseoV3Flags.js` hoy exige `enabled` + `PERSEO_ENGINE=v3`; **no** se llama desde `index.js` en F1.

---

## 8. Riesgos F1

| Riesgo | Mitigación |
|--------|------------|
| Alguien importa V3 desde legacy por error | README + lint futuro; F1 no toca `index.js` |
| Mock interpreter diverge del mundo real | Reemplazo por OpenAI JSON en F3 + tests de contrato |
| Drift de enums | Tests en `test/v3ConversationCore.test.js` |

---

## 9. Rollback

Revert del commit F1 o no desplegar. Sin migraciones ni flags obligatorios en Railway.

---

## 10. Criterio PASS/F1

- Núcleo bajo `conversation/v3/` con exports en `index.js`.  
- Tests V3 PASS; suite legacy PASS.  
- Sin CRM, sin OpenAI real, sin cambio de respuestas WhatsApp.
