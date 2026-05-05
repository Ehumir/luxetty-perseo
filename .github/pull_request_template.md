## Resumen del cambio

Describe claramente que problema resuelve este PR y que comportamiento cambia.

## Checklist obligatorio (No-Regression)

Marca todas las casillas antes de solicitar revision:

- [ ] Corri pruebas unitarias (npm test)
- [ ] Corri pruebas de regresion (npm run test:regression)
- [ ] Valide escenarios existentes (sin regresiones funcionales)
- [ ] Valide que no se duplican contactos
- [ ] Valide que se crean leads cuando aplica
- [ ] Valide asignacion de leads
- [ ] Valide logs/eventos de trazabilidad CRM
- [ ] Confirme que no cambie esquema sin avisar

## Evidencia requerida

Incluye evidencia concreta:
- Salida resumida de pruebas
- Casos cubiertos/agregados
- Eventos CRM verificados (contact_created/contact_reused, lead_created/lead_reused, lead_assigned, assignment_fallback_used, crm_creation_failed)

## Riesgos y rollback

- Riesgo principal:
- Plan de rollback:
