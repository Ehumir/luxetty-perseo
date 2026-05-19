# M4-02 — Media never authoritative alone

## Regla

Audio, imagen, PDF o documento **no pueden**, por sí solos:

- crear oportunidad / lead,
- cerrar ejecución CRM,
- asumir precio, disponibilidad o link,
- asumir propiedad o código de inventario,
- asumir nombre del propietario.

## Obligatorio en runtime

| Campo / comportamiento | Propósito |
|------------------------|-----------|
| `media_authoritative: false` | Siempre en objeto media V3 |
| `requires_confirmation: true` | Intake debe pedir confirmación si hay señal débil |
| `hints_are_non_authoritative: true` | Vision hints no son facts |
| `confidence` | Umbral bajo → `needs_confirmation` |
| Timeout | `media_timeout` + copy honesto (fail-open) |

## Fail-open (`PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED`)

- Timeout o error de proveedor **no** rompe el webhook.
- Se continúa con texto/caption o mensaje de fallback.
- `fallback_reason` en telemetry operacional.

## CRM

CRM execute sigue gated por `evaluateV3CrmExecutionGate` + consent + payload humano confirmado.
