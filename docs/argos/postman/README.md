# ARGOS-1 — Colección Postman

**Archivo:** `ARGOS-1-Internal-API.postman_collection.json`  
**Contrato:** v1.2 (2026-05-15)  
**Uso:** Importar en Postman **antes** de implementar ARGOS-1 en PERSEO.

## Variables de colección

| Variable | Ejemplo | Descripción |
|----------|---------|-------------|
| `perseo_base_url` | `http://localhost:3000` | URL base PERSEO QA |
| `argos_service_secret` | *(secret Railway)* | Header `X-Argos-Service-Secret` |
| `argos_admin_user_id` | UUID admin | Header opcional audit |
| `phone_sim` | `5218100000001` | Teléfono simulado |
| `session_id` | *(auto)* | Se setea tras primer `simulate-turn` |

## Env servidor requerido

```env
PERSEO_ARGOS_ENABLED=true
ARGOS_SERVICE_SECRET=<mismo que Postman>
PERSEO_V3_ENABLED=true
PERSEO_V3_CRM_EXECUTE=false
PERSEO_V3_CRM_DRY_RUN=true
```

## Requests incluidas

1. **GET** `/internal/argos/health`
2. **POST** `/internal/argos/simulate-turn` (4 ejemplos en cadena)
3. **POST** `/internal/argos/crm-dry-run`
4. **POST** `/internal/argos/reset-session` (`crm` / `full`)
5. **POST** `/internal/argos/run-scenario` (pass, fail, loop, must_not, ownership)

Cada request incluye **ejemplos de response** documentados (valores ilustrativos hasta que exista implementación).

## Orden de prueba manual

1. Health → verificar `argos_enabled` y `crm_execute: false`
2. simulate-turn "Hola" → copiar `session_id`
3. simulate-turn flujo compra
4. crm-dry-run
5. reset-session `crm`
6. run-scenario `DEMAND_002`

## Notas

- Los bodies con `deterministic_mode: true` congelan variabilidad (contrato v1.2).
- Responses incluyen `events[]`, `debug_trace[]`, `conversation_snapshot`.
- `run-scenario` soporta `must_not` para asserts negativos.
