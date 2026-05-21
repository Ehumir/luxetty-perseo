# M4-05a — FLEX1 opening gate audit (WA staging)

**Input:** `Hola busco casa en cumpres elite como de unos 6 melones`  
**Síntoma:** doble menú IVR; contexto zona/presupuesto perdido tras responder "Comprar".

---

## 1. `flex.canonicalText` / `normalizeInboundUtterance`

**No existen en M4-05a.** El flex actual es solo hooks en parsers:

| Capa | Qué hace con FLEX1 |
|------|-------------------|
| `typoTolerance.fuzzyResolveZone` | `cumpres elite` → `Cumbres Elite` (tras fix frases) |
| `slangLexicon.parseFlexMoneyAmount` | `unos 6` → 6_000_000 |
| `minimalInterpreter` | **Bug:** `hola ` → `GREETING` antes de `BUY_PROPERTY` |

No hay `flex.signals`, `confidence` ni `hints` globales — solo telemetría opcional `recordFlexApplied(kind)`.

---

## 2. Root cause (turno 1)

En `minimalInterpreter.js` (orden histórico):

```javascript
if (t.startsWith('hola ')) → GREETING  // ← se ejecutaba ANTES de buy
// ...
if (matchesBuyOpenSearchPattern) → BUY_PROPERTY
```

El texto **sí** matchea compra (`busco` + `casa`), pero la rama `GREETING` cortaba el pipeline.

**Composer:** `GREETING` → `composeAdvisorGreeting` → `GLOBAL_OPENING_VARIANTS` (menú IVR).

**Estado tras T1 (bug):**

- `detected_intent`: `GREETING` (no `BUY_PROPERTY`)
- `conversation_goal`: no locked
- `location_text` / `budget`: no persistidos
- `awaiting_field`: null

---

## 3. Root cause (turno 2 — "Comprar")

`matchesBuyOpenSearchPattern('comprar')` era **false** (no incluía respuesta corta al menú).

→ `UNKNOWN` o flujo sin sticky → segundo menú (`pickOpeningVariant` / anti-repetición).

---

## 4. Fix aplicado (rama `feat/m4-05a-conversational-flex`)

1. **`hasSubstantiveIntentAfterGreeting`** — `hola` + compra/venta/renta no es `GREETING` puro.
2. **`isBareBuyMenuReply`** — `comprar` | `compra` → `BUY_PROPERTY` si goal no locked.
3. **`typoTolerance`** — frases `cumpres elite`, `cumpres elit` → `Cumbres Elite`.

**NO tocado:** closure, reopen, CRM, gate, worker.

---

## 5. Verificación local esperada (post-fix)

Turno 1 con flex ON:

- `detected_intent`: `BUY_PROPERTY`
- `conversation_goal`: `BUY_PROPERTY` + locked
- `known_zone`: `Cumbres Elite`
- `known_budget`: `6000000`
- Reply: continuidad compra (nombre/zona), **no** menú global

```bash
PERSEO_CONVERSATIONAL_FLEX_ENABLED=true node -e "
process.env.PERSEO_ARGOS_ENABLED='true';
process.env.PERSEO_V3_ENABLED='true';
const { processInboundForArgos, resetArgosV3Session } = require('./argos/processInboundForArgos');
const { seedSession, deleteSession } = require('./argos/argosSessionStore');
(async () => {
  const sid = 'f0000000-0000-4000-8000-000000000099';
  deleteSession(sid); resetArgosV3Session(sid);
  seedSession({ session_id: sid, phone_sim: '521818180099', flags: { deterministic_mode: true, conversational_flex: true } });
  const r = await processInboundForArgos({
    phone_sim: '521818180099', session_id: sid,
    text: 'Hola busco casa en cumpres elite como de unos 6 melones',
    flags: { deterministic_mode: true, conversational_flex: true },
  });
  console.log(JSON.stringify(r.conversation_snapshot, null, 2));
  console.log('reply:', r.reply.slice(0, 120));
})();
"
```

---

## 6. Consent compuesto + terminal ack (bloqueante merge #2)

**Input:** `sale y vale, me late.`  
**Causa:** `isFlexConsentAccept` solo matcheaba frase exacta en Set; compuesto fallaba → `composeHandoffPendingContinuity` (“un sí me ayuda…”).

**Input:** `Sería todo`  
**Causa:** `isTerminalAckClose` no incluía `seria todo` / `eso seria todo`.

**Fix:** `shortReplyLexicon` compuestos; `isPositiveHandoffAck` delega a lexicon; patrones `seria todo` en `conversationReopenPolicy.js`.

---

## 7. Re-smoke WA staging (bloqueante merge)

Repetir FLEX1 tras deploy fix en Railway QA con flag ON. Completar `FLEX_STAGING_SMOKE_RESULTS.md`.
