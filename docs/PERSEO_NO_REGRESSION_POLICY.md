# PERSEO No-Regression Policy (Obligatoria)

## Objetivo
Blindar los escenarios conversacionales y de CRM de PERSEO para que ningun PR pueda introducir regresiones funcionales sin deteccion.

## Alcance
Esta politica aplica a todo cambio en:
- Logica conversacional
- Clasificacion de intencion
- Generacion de respuestas
- Integraciones CRM (contactos, leads, asignacion)
- Ingestion de media (audio, imagen, documentos, ubicacion, interactive)

## Reglas Obligatorias

### 1) Ningun escenario funcional puede modificarse sin prueba
- Todo ajuste de comportamiento debe venir acompanado de prueba automatizada.
- Si cambia una salida esperada de un flujo existente, el PR debe incluir:
  - ajuste de prueba existente, y
  - evidencia de validacion de no-regresion en escenarios relacionados.

### 2) Toda nueva intencion debe agregar test
- Cada nueva intencion/categoria/playbook debe incluir al menos:
  - prueba positiva (detecta correctamente),
  - prueba negativa (no dispara en contexto incorrecto),
  - prueba de borde si aplica (ambiguedad o conflicto de senales).

### 3) Toda correccion de bug debe agregar test de reproduccion
- Todo bugfix debe incluir una prueba que falle antes del fix y pase despues del fix.
- No se acepta cierre de bug sin reproduccion automatizada.

### 4) Prohibido borrar o relajar tests para pasar el build
- No se permite:
  - eliminar asserts para evitar fallo,
  - cambiar expected de forma injustificada,
  - marcar tests como skip/todo sin aprobacion explicita del Tech Lead.
- Cualquier reduccion de cobertura debe justificarse por escrito en el PR.

### 5) Prohibido fingir capacidades no implementadas
- Las respuestas no deben afirmar capacidades inexistentes.
- Especialmente en media:
  - vision de imagen,
  - transcripcion de audio,
  - lectura de documentos.
- Si una capacidad no esta disponible en ese mensaje, la respuesta debe ser honesta y trazable.

### 6) Contacto/Lead/Asignacion requieren evidencia verificable
Todo flujo comercial valido debe dejar evidencia auditable:
- Contacto: contact_created o contact_reused
- Lead: lead_created o lead_reused
- Asignacion: lead_assigned (y assignment_fallback_used cuando aplique)
- Error de creacion CRM: crm_creation_failed

Ademas:
- No se deben duplicar contactos por telefono/whatsapp normalizado.
- No se debe duplicar lead abierto para misma combinacion compatible.
- Toda solicitud comercial valida debe quedar asignada o dejar evento explicito de fallo.

## Gate Tecnico Obligatorio Antes de PR
Se debe ejecutar localmente, en este orden:
1. npm ci
2. npm run lint
3. npm test
4. npm run test:regression

Comando unificado:
- npm run gate:no-regression

## Criterio de Bloqueo de PR
Un PR se considera bloqueado si ocurre cualquiera de estos puntos:
- Falla cualquier paso del gate tecnico.
- Falta prueba para nueva intencion o bugfix.
- Se detecta relajacion/eliminacion injustificada de tests.
- Se detecta respuesta que finge capacidades no implementadas.
- No existe evidencia verificable de contacto/lead/asignacion en flujos comerciales.

## Nota de Esquema
No se permiten cambios de esquema (migraciones/columnas/constraints) sin aviso explicito en el PR y aprobacion previa.
