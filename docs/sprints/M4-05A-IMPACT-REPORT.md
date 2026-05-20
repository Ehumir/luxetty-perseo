# M4-05a — Impacto perceptual (pre-merge)

**Base:** suite ARGOS 20/20 + verificación NO-OP + diseño quick wins.  
**Smoke WA staging:** pendiente ejecución manual (ver runbook).

---

## 1. Qué se sintió más humano (ARGOS + diseño)

- **Zonas con typo:** `cumpres`, `cunbres`, `cumbres elit`, `san pedro garza garca` resuelven a colonia canónica sin pedir “¿cuál Cumbres?”.
- **Dinero coloquial MX:** `melones`, `mdp`, `unos 10`, `como 6`, `hasta 8` se interpretan como millones en contexto compra/venta.
- **Consentimiento corto:** `sip`, `simon`, `jalo`, `me late`, `sí porfa` cierran handoff como ACCEPTED sin forzar frase larga.
- **Ocupación con negación:** `no está libre` ya no dispara falso `libre`; `vive mi familia` → habitada; `no vive nadie` → libre.

---

## 2. Qué todavía se siente rígido

- **Apertura global:** primer turno sigue siendo menú vender/comprar/rentar (variantes fijas, no flex).
- **Orden de slots:** si el usuario manda ocupación antes del nombre, aún puede capturar mal el nombre (hay que ordenar mensajes en WA).
- **Respuestas consultivas:** el composer sigue usando plantillas por `awaiting_field`; el tono varía pero la estructura es predecible.
- **Sin confirmación suave** para `como 6` sin contexto (correcto por diseño: no inventar).

---

## 3. Qué sigue siendo “formulario”

- Secuencia explícita: zona → presupuesto → nombre → consentimiento (demanda).
- Captación oferta: zona → precio → ocupación → nombre → consent.
- Preguntas cerradas: “¿casa, departamento o terreno?”, “¿libre, habitada, rentada?”.
- Handoff sigue siendo binario ACCEPTED/DECLINED sin matices (“más tarde”, “solo WhatsApp”).

---

## 4. Qué sigue frágil

- **Railway sin V3 primary** → cae a `fallback_consultive` (hallazgo B1 M4-04B; independiente de flex).
- **STT + audio:** M4-05a no incluye softener; typos en audio dependen del transcriptor.
- **Variantes de copy** dependen de `conversationId` (hash); mismo usuario en sesión nueva = frases distintas.
- **Fragments multi-intent** en un solo mensaje largo (zona + precio + ocupación) aún compiten por prioridad de parser.

---

## 5. Responsabilidad M4-05b (no en este PR)

| Tema | M4-05a | M4-05b |
|------|--------|--------|
| Engine PRE centralizado | Hooks en parsers | `conversationFlexibilityEngine` |
| Humanizer POST | No | `conversationHumanizer` |
| Fragmentos / intención implícita | Parcial (regex) | Fusión + contexto turno |
| STT softener | No | M4-05c |
| Suite 50 escenarios | 20 FLEX | Expansión + audio |
| Confirmación suave ambigüedad | No inventar | Composer dedicado |

---

## Evidencia técnica adjunta

- NO-OP: `docs/argos/evidence/M4-05A-NOOP-VERIFICATION.md`
- ARGOS: `conversation-flexibility-p0` 20/20
- Closure: 8/8 + 6/6
- Simulación local mensajes WA (flex ON): `docs/argos/evidence/m405a-wa-smoke-simulation.json`
  - FLEX1: `known_zone=Cumbres` (elite→Cumbres en intake compuesto; elite en frase larga), `budget=6M`, flex `money+zone`
  - FLEX2: requiere turno handoff previo en WA real; local terminó en `REQUESTED`
  - FLEX3: `occupancy_status=habitada`, `consent=ACCEPTED`, flex `occupancy+consent`

---

## Recomendación merge

**Aprobar PR** tras completar checklist WA staging (`FLEX_STAGING_SMOKE_RESULTS.md`).  
**No activar** `PERSEO_CONVERSATIONAL_FLEX_ENABLED` en producción hasta M4-05d.
