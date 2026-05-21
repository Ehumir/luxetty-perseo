# PERSEO V1 — WhatsApp smoke (producción)

**Allowlist obligatoria.** Flex OFF. Worker async OFF.

---

## Preflight

```bash
node scripts/perseo-v1-preflight.js --phase f1 --phone <tel_allowlist>
node scripts/perseo-v1-production-readiness.js --phase f1
```

Sin `BLOCKER` antes de WA.

---

## Fase 1 — Variables Railway

```env
PERSEO_V3_ENABLED=true
PERSEO_V3_HANDOFF_ENABLED=true
PERSEO_V3_SHADOW_MODE=false
PERSEO_V3_CRM_DRY_RUN=true
PERSEO_V3_CRM_EXECUTE=false
PERSEO_CONVERSATIONAL_FLEX_ENABLED=false
PERSEO_CRM_WORKER_ASYNC_ENABLED=false
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=false
PERSEO_POLICY_V2_ENABLED=true
PERSEO_V3_QA_ALLOWLIST=<tel1>,<tel2>,<tel3>
```

Reiniciar webhook tras cambios.

---

## A. 5 pruebas WA internas (Fase 1)

| ID | Pasos | PASS | FAIL |
|----|-------|------|------|
| **WI-01** | `!reset` → `Hola` | Respuesta V3; log `v3_primary_reply` | 500, silencio, legacy sin explicación |
| **WI-02** | Flujo compra: Cumbres → 5M → nombre → consent | `CRM_READY` en DB preview / stage | loop, sin consent |
| **WI-03** | Flujo venta: zona → precio/no sé → ocupación → nombre → consent | `lead_flow=offer` | invento precio mercado |
| **WI-04** | Post-handoff: `Sería todo` | Cierre terminal; no wizard compra | “seguimos con tu búsqueda” |
| **WI-05** | Tel **fuera** allowlist: `Hola` | `v3_primary_fallback_legacy` + legacy OK | crash o V3 en no-lista |

---

## B. 10 pruebas WA pauta (Fase 3 — CRM_EXECUTE ON)

Añadir solo teléfono(s) pauta a allowlist. Activar:

```env
PERSEO_V3_CRM_DRY_RUN=false
PERSEO_V3_CRM_EXECUTE=true
```

| ID | Flujo | PASS | FAIL |
|----|-------|------|------|
| **WP-01** | Pauta compra secuencial completa | 1 contact + 1 lead, asesor notificado | duplicado, sin lead |
| **WP-02** | Pauta venta + ocupación habitada | occupancy habitada; no “libre” falso | slot mal |
| **WP-03** | Consent corto `Sí jalo` / `Sale y vale` | ACCEPTED | UNKNOWN loop |
| **WP-04** | Usuario solo zona en 1 msg tras menú | Captura zona sin repregunta 3× | loop formulario |
| **WP-05** | Usuario pregunta precio sin listing | No inventa; pide contexto o asesor | precio inventado |
| **WP-06** | Código LUX en mensaje (si aplica pauta) | property context | pierde listing |
| **WP-07** | Mensaje confuso / typo leve zona | Responde sin crash | 500 / menú infinito |
| **WP-08** | Cierre `seria todo` tras handoff | terminal ack | reabre comercial |
| **WP-09** | Segundo lead misma conv (mismo intent) | reuse lead, no duplicar | 2 leads |
| **WP-10** | Audio corto (si pauta usa audio) | fallback honesto o transcript | “escuché que…” falso |

---

## C. Scripts Supabase

```bash
# Última conversación por teléfono (ajustar schema si aplica)
node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const phone = process.argv[1] || '5218181877351';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: c } = await sb.from('contacts').select('id,phone_normalized,full_name').ilike('phone_normalized', '%' + phone.slice(-10) + '%').limit(3);
  console.log('contacts', c);
  if (c?.[0]) {
    const { data: l } = await sb.from('leads').select('id,contact_id,created_at,lead_flow').eq('contact_id', c[0].id).order('created_at', { ascending: false }).limit(5);
    console.log('leads', l);
  }
})();
" 5218181877351
```

Duplicados 48h:

```sql
SELECT phone_normalized, count(*) FROM contacts
WHERE created_at > now() - interval '48 hours'
GROUP BY phone_normalized HAVING count(*) > 1;

SELECT conversation_id, count(*) FROM leads
WHERE created_at > now() - interval '48 hours'
GROUP BY conversation_id HAVING count(*) > 2;
```

---

## D. Rollback

```env
PERSEO_V3_ENABLED=false
PERSEO_V3_CRM_EXECUTE=false
```

Reiniciar servicio.

---

## E. Registro

Usar tabla en `docs/argos/PERSEO_V1_PRODUCTION_READINESS_REPORT.md` o hoja compartida: fecha, ID prueba, tel, `response_source`, PASS/FAIL, notas.
