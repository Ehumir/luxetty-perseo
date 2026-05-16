# `conversation/v3/crm/` — CRM execution (V3)

| Módulo | Rol |
|--------|-----|
| `payloadBuilder.js` | Payload dry-run (`CRM_READY`) |
| `executionGate.js` | Gate F6: flags + stage + consent |
| `executionPayload.js` | Payload enriquecido + map a `ai_state` legacy |
| `crmExecutor.js` | Orquesta `ensureContactForConversationCore` + `createOrReuseLeadFromConversation` |

**F6:** writes reales solo con `PERSEO_V3_CRM_EXECUTE=true` + allowlist + `CRM_READY` + consent `ACCEPTED`. Cableado desde `index.js` cuando V3 primary (`skipLegacyCrm`).
