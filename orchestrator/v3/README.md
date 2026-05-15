# `orchestrator/v3/` — PERSEO V3

**Fase:** V3-F0 — placeholder de arquitectura.

La orquestación **productiva** sigue en:

- `index.js` (webhook WhatsApp, persistencia, CRM phase, outbound)
- `conversation/conversationOrchestrator.js` (decisión OpenAI + validación)

Aquí vivirá el **strangler** que en fases futuras delegará turnos al núcleo V3 cuando `PERSEO_ENGINE` / flags lo permitan.

**No añadir** aquí lógica que duplique el webhook legacy en F0.
