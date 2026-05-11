# Sprint: WhatsApp Context Preservation & Reset Command
## Luxetty PERSEO - Context Preservation Fix

**Rama:** `fix/perseo-context-reset-intent`  
**Commit:** `645cd21`  
**Fecha:** 2026-05-08  
**Estado:** Pruebas pasadas (235/235), listo para PR  

---

## Resumen Ejecutivo

Se implementó mejora de clasificación de intención y preservación de contexto conversacional en PERSEO para resolver cuatro problemas críticos en testing:

1. ✅ Comando `!reset` ya existía en infraestructura QA
2. ✅ Intención (venta vs compra vs renta) ahora más clara
3. ✅ Contexto se preserva entre mensajes consecutivos
4. ✅ Conversación continúa en mismo flujo cuando usuario agrega detalles

---

## Cambios Técnicos

### 1. **conversation/intent.js** — Clasificación de Intención Mejorada

**Problema:** Keywords ambiguos como `"vender"` solo y `"comprar"` solo generaban falsos positivos.

**Cambios:**
- Eliminé `text.includes('vender')` y `text.includes('comprar')` solos
- Agregué requerimiento de contexto: `"vender mi [casa/propiedad/depa]"`
- Mejoré `wantsBuy` para detectar explícitamente `"quiero informacion de una casa"`
- Resultado: Demanda (compra) ahora no confunde con oferta (venta)

**Ejemplo:** 
- Antes: "Información sobre propiedad" → posible detección como venta
- Ahora: "Información sobre propiedad" → claramente demanda

### 2. **conversation/contextPreservation.js** — Nuevo Archivo

**Propósito:** Helpers para detectar continuación vs cambio de intención, y preservar estado.

**Funciones:**
- `isDetailContinuation(newText, previousAiState)` — Detecta si usuario agrega detalles
- `mergeIntentWithPreviousState(newIntent, previousState)` — Fusiona intención con estado previo
- `extractCapturedDataFromState(previousAiState)` — Extrae datos ya capturados para evitar repetir
- `decideNextConversationStep(intent, previousState)` — Decide qué pregunta hacer

**Lógica:**
- Si mensaje contiene keywords de detalle (recámara, zona, precio, etc), preservar `lead_flow`
- Si no contradice flow anterior, mantener intención
- Ejemplo: Usuario dice "cerca de Leones, 3 recámaras" → preservar "venta" detectado antes

### 3. **index.js** — Integración de Preservación

**Cambios:**
- Importación de `contextPreservation` helpers
- Inserción de lógica de preservación después de `buildUnifiedConversationContext`
- Si `isDetailContinuation` es true, llamar `mergeIntentWithPreviousState`
- Resultado: La intención detectada en msg anterior NO se pierde

**Código insertado (~línea 2113):**
```javascript
const isContinuation = isDetailContinuation(text, previousAiState);
if (isContinuation && previousAiState?.lead_flow && unifiedContext.normalizedIntent) {
  unifiedContext.normalizedIntent = mergeIntentWithPreviousState(
    unifiedContext.normalizedIntent,
    previousAiState,
    {}
  );
}
```

### 4. **utils/helpers.js** — Mejoras Sprint 4

(Cambios previos de Sprint 4 reutilización de conversación):
- `buildPhoneLookupValues()` — Normaliza variantes de teléfono mexicano
- `selectConversationReuseStrategy()` — Elige entre reutilizar abierta o crear nueva

---

## Escenarios de Aceptación — Status

### Escenario A — Reset
**Objetivo:** Comando `!reset` limpia contexto sin crear lead.

**Status:** ✅ Ya existe en `conversation/qaCommands.js`
- `interceptQaCommand()` detecta `!reset` antes del pipeline
- `handleQaCommand()` limpia contexto y responde "Contexto reiniciado para prueba."
- No crea lead si `qa_lead_creation_blocked: true`
- Requiere número en `QA_ALLOWED_WHATSAPP_NUMBERS` o `NODE_ENV !== 'production'`

**Nota:** Para testing, configure:
```bash
export QA_ALLOWED_WHATSAPP_NUMBERS=521xxxxxxxxxx
```
O use en desarrollo donde `NODE_ENV` no es 'production'.

### Escenario B — Venta
**Objetivo:** Clasificar y mantener intención de venta, no reiniciar con mensaje genérico.

**Status:** ✅ Resuelto

**Flujo:**
1. Usuario: "Hola, quiero vender mi casa en Cumbres"
   - Detecta: `lead_flow: 'offer'`, `operation_type: 'sale'`
   - Persiste en `ai_state`

2. Usuario: "Está cerca de Leones y tiene 3 recámaras"
   - `isDetailContinuation` detecta keywords: "cerca de", "recámaras"
   - Preserva: `lead_flow: 'offer'` del mensaje anterior
   - NO reinicia con "¿En qué puedo ayudarte?"

### Escenario C — Compra (Demanda)
**Objetivo:** No confundir con venta; reconocer claramente como búsqueda/demanda.

**Status:** ✅ Resuelto

**Cambios en `intent.js`:**
```javascript
const wantsBuy =
  text.includes('quiero comprar') ||
  text.includes('busco comprar') ||
  text.includes('busco casa') ||
  text.includes('busco depa') ||
  // ... AGREGADO:
  text.includes('quiero informacion');  // ← Clave para "Quiero información de..."
```

**Flujo:**
1. Usuario: "Hola, quiero información de una casa en Cumbres"
   - Detecta: `lead_flow: 'demand'`, `operation_type: 'sale'`
   - NO pregunta: "¿En cuánto quieres venderla?" (error anterior)

2. Usuario: "Mi presupuesto es 4 a 5 millones, también 3 recámaras"
   - Preserva demanda, agrega presupuesto y recámaras

### Escenario D — Reutilización de Conversación
**Objetivo:** Reutilizar conversación abierta del mismo teléfono.

**Status:** ✅ Ya implementado en Sprint 4

**Cambios en `utils/helpers.js`:**
- `selectConversationReuseStrategy()` — Reutiliza solo si `status !== 'closed'`
- Si solo hay cerradas, crea nueva pero hereda `contact_id`, `lead_id`, `assigned_agent_profile_id`

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|-----------|
| Falsos negativos en intent | Medio | Medio | Tests cobertura intent (235 pasados) |
| Lead duplicado por misma conversación | Bajo | Alto | Sprint 4: `meta_message_id` deduplicación |
| State corruption en BD | Bajo | Alto | Guardar con `ai_state` completo, no parcial |
| Performance con últimos mensajes | Bajo | Bajo | Solo análisis actual + estado previo, no N mensajes |
| QA commands ejecutándose erróneamente | Bajo | Medio | Requiere autorización o NODE_ENV control |

---

## Archivos Modificados

```
✏️  conversation/intent.js
    - Línea 25-28: wantsSell mejorado, eliminar "vender" solo
    - Línea 76-86: wantsBuy mejorado, agregar "quiero información"

✏️  index.js
    - Línea 45-51: Importar contextPreservation helpers
    - Línea 2113-2123: Integrar preservación de intención

✨  conversation/contextPreservation.js (NUEVO)
    - 180+ líneas de helpers para preservación de contexto

✏️  utils/helpers.js (Sprint 4)
    - buildPhoneLookupValues, selectConversationReuseStrategy

✨  test/conversationReusePolicy.test.js (NUEVO)
    - Tests de política de reutilización de conversación

```

---

## Validación

### Pruebas Ejecutadas
```bash
$ npm test
✔ 235 tests passed
✖ 0 tests failed
```

### Cobertura Incluida
- `test/qaCommands.test.js` (19 tests) — Comando !reset
- `test/leadAutomation.test.js` (17 tests) — Clasificación de intención
- `test/conversationReusePolicy.test.js` (3 tests nuevo) — Reutilización
- `test/sprint3Playbooks.test.js` (20+ tests) — Flujos conversacionales

---

## Pasos para Testing en WhatsApp

### 1. Configurar QA_ALLOWED_WHATSAPP_NUMBERS
```bash
# .env o en producción
export QA_ALLOWED_WHATSAPP_NUMBERS=521234567890
```

### 2. Test Escenario A (Reset)
```
Usuario: !reset
PERSEO: Contexto reiniciado para prueba.
```
Verificar: No crea lead, no hace pregunta comercial.

### 3. Test Escenario B (Venta)
```
Usuario: Hola, quiero vender mi casa en Cumbres
Usuario: Está cerca de Leones y tiene 3 recámaras
```
Verificar: Mantiene intención "venta", no pregunta "¿Cuánto quieres comprar?"

### 4. Test Escenario C (Compra)
```
Usuario: Quiero información de una casa en Cumbres
Usuario: Mi presupuesto es 4 millones y quiero 3 recámaras
```
Verificar: Detecta demanda, NO pregunta precio de venta.

### 5. Test Escenario D (Reutilización)
```
Usuario 1: Primer mensaje (crea conversación)
Usuario 1: (mismo teléfono, < 24h) Segundo mensaje
```
Verificar: Usa misma conversation_id, preserva contact/lead.

---

## Comandos para Merge

```bash
cd luxetty-perseo

# Verificar rama correcta
git branch -v
# fix/perseo-context-reset-intent  645cd21 fix(perseo): preserve whatsapp context...

# Ver cambios
git diff main..fix/perseo-context-reset-intent --stat

# Push a origin
git push origin fix/perseo-context-reset-intent

# Crear PR en GitHub
# Título: fix(perseo): preserve whatsapp context and handle reset command
# Descripción: Ver arriba o SPRINT_CONTEXT_RESET_SUMMARY.md

# Después de aprobación:
git checkout main
git pull origin main
git merge --no-ff fix/perseo-context-reset-intent -m "Merge fix/perseo-context-reset-intent"
git push origin main
```

---

## Notas para Seguimiento

1. **QA Command !reset** — Funciona si número autorizado. En desarrollo funciona sin lista.
2. **Intent Preservation** — Activado automáticamente, no requiere cambios de usuario.
3. **Conversation Reuse** — Sprint 4 ya maneja esto; este fix asegura contexto correcto.
4. **State Persistence** — Se persiste con `ai_state` completo; vea `saveConversationState()`.
5. **Next Steps** — Considerar índice único parcial en `conversations(channel, phone, status)` si se detectan duplicados en producción.

---

**Status Final:** ✅ Listo para PR y merge
