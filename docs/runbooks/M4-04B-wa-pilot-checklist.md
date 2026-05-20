# M4-04B — Checklist ultra simple (3 pilotos WA)

**Tiempo estimado:** 30–45 min con 3 teléfonos. **Prod:** OFF.

---

## Antes (5 min)

```bash
# 1. Allowlist local (gitignored)
cp docs/argos/whatsapp-smoke/m4-02/allowlist-b1.local.yaml.example \
   docs/argos/whatsapp-smoke/m4-02/allowlist-b1.local.yaml
# → pegar 3 teléfonos QA reales

# 2. Validar
M4_WA_ALLOWLIST_MIN=3 npm run staging:wa-allowlist
```

En Railway **webhook staging**: el número debe estar en `PERSEO_V3_QA_ALLOWLIST` (formato `521XXXXXXXXXX`, sin `+`).

Opcional: `!reset` al inicio de cada piloto para conversación limpia.

---

## Durante cada piloto (≈10 min c/u)

Marca en la tabla al terminar. No hace falta transcript manual — al final corre `npm run staging:wa-collect`.

### Piloto 1 — B1_DEMAND_LONG (comprador)

| Paso | Acción |
|------|--------|
| 1 | Saludo corto |
| 2 | Mensaje **largo**: zona + presupuesto + intención compra |
| 3 | Nombre en **mensaje aparte** (ej. "Me llamo …") |
| 4 | Responder consentimiento si pregunta |

**PASS si:** responde coherente, no inventa propiedad/precio, no repite la misma pregunta 3×.

### Piloto 2 — B1_OFFER_POLICY (propietario)

| Paso | Acción |
|------|--------|
| 1 | "Quiero vender mi casa en [zona]" |
| 2 | Datos básicos (tamaño, precio deseado si aplica) |
| 3 | Pregunta algo de policy / valoración |

**PASS si:** no decline erróneo, tono útil, sin inventar avalúo oficial.

### Piloto 3 — B1_MEDIA_FALLBACK (media)

| Paso | Acción |
|------|--------|
| 1 | Enviar **nota de voz** corta O imagen con caption |
| 2 | Si falla media: debe **fallback en texto** (no silencio, no crash) |
| 3 | Escribir en texto qué necesitas |

**PASS si:** hay respuesta útil tras media; `fail_open` o transcript razonable.

---

## Cómo medir (rápido)

### Humanity (1–5 por piloto)

| Score | Significado |
|-------|-------------|
| 5 | Natural, empático, progresión clara |
| 4 | Bueno, detalle menor |
| 3 | Aceptable pero rígido o genérico |
| 2 | Robótico / confuso |
| 1 | Inaceptable |

**B1 GO:** ≥ **2 de 3** pilotos con **≥ 4/5**.

### Invento crítico (sí/no)

**SÍ = FAIL** si el bot afirma sin datos del usuario:

- precio, m², dirección exacta, nombre de desarrollo, disponibilidad inventada

**NO invento** = parafrasea, pregunta, o dice que no tiene el dato.

### Loop (sí/no)

**SÍ = FAIL** si la **misma pregunta** (misma intención) aparece **3+ veces** sin avance.

### Duplicado CRM (auto)

Lo valida `staging:wa-collect` / `staging:duplicates` — no revisar manual salvo duda.

---

## Después (5 min) — cierre 04B

```bash
# Recolecta evidencia Supabase → run log + JSON
npm run staging:wa-collect

# Cierre formal B1
npm run staging:close:wa-b1
```

Archivos generados:

- `docs/argos/whatsapp-smoke/m4-02/runs/M4-04-STAGING-20260520.md` (tabla auto)
- `docs/argos/whatsapp-smoke/m4-02/runs/M4-04-B1-evidence.json` (detalle)

Si `staging:close:wa-b1` → exit 0 → **M4-04B WA B1 GO**.

---

## Tabla manual opcional (mientras pruebas)

| ID | Humanity /5 | Invento crítico | Loop | Notas 1 línea |
|----|-------------|-----------------|------|---------------|
| B1_DEMAND_LONG | | ☐ sí ☐ no | ☐ sí ☐ no | |
| B1_OFFER_POLICY | | ☐ sí ☐ no | ☐ sí ☐ no | |
| B1_MEDIA_FALLBACK | | ☐ sí ☐ no | ☐ sí ☐ no | |

---

## Si algo falla

| Síntoma | Acción |
|---------|--------|
| No responde WA | Verificar allowlist V3 en Railway + número exacto |
| Respuesta legacy | `PERSEO_V3_ENABLED=true` en webhook staging |
| CRM raro | Worker logs `mode=db`; `PERSEO_V3_CRM_EXECUTE=false` en staging |
| Collect sin mensajes | Esperar 1 min; ampliar `M4_WA_COLLECT_HOURS=48` |
