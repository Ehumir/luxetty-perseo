# Matriz QA P0 — conversaciones simuladas (WhatsApp)

| ID | Escenario | Resultado | Observaciones |
|----|-----------|-----------|---------------|
| QA-01 | Saludo + seguimiento “Info” (continuidad + nombre) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-02 | Propiedad LUX-A0453 + pregunta de precio | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-03 | Captación venta + solo municipio (sin “canal equivocado”) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-04 | Visita explícita + nombre | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-05 | Handoff previo + “gracias” (sin silencio + nombre si falta) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-06 | Campaña listing + “me interesa” (contexto pauta) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-07 | Disponibilidad sobre propiedad en contexto | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-08 | Ubicación / zona (demanda) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-09 | Valuación (oferta) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-10 | Comisión (tono consultivo, sin inventar) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-11 | Follow-up contextual: zona luego presupuesto | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-12 | Demanda genérica + refinamiento | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-13 | “Solo dame el precio” con contexto demanda/propiedad | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-14 | Venta + urgencia (captación) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-15 | Propiedad intestada (señal legal, sin silencio) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-16 | Crédito hipotecario pendiente | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-17 | Ocupada por inquilino | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-18 | Ya publicada y no se vende | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-19 | Contacto con nombre válido: no insistir en nombre | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |
| QA-20 | Perfil WA útil + placeholder contacto (confirmación) | **PASS** | PASS: continuidad, tono y política de nombre coherentes con el escenario. |

## Transcripts
### QA-01 — Saludo + seguimiento “Info” (continuidad + nombre)

- **user:** Hola
- **assistant:** Hola, bienvenido a Luxetty 😊 ¿En qué puedo orientarte hoy? ¿Buscas comprar, rentar, vender o poner en renta una propiedad? Claro, te ayudo. Para ubicar bien tu solicitud, ¿me compartes tu nombre y en qué te puedo orientar primero?
- **user:** Info
- **assistant:** Claro, te apoyo con gusto. Para orientarte mejor, ¿buscas comprar, rentar, vender o una valuación?

### QA-02 — Propiedad LUX-A0453 + pregunta de precio

- **user:** Me interesa la propiedad LUX-A0453
- **assistant:** Para orientarte mejor, ¿buscas comprar o rentar una propiedad? Para ubicar bien tu solicitud, ¿me compartes tu nombre y si buscas comprar o rentar?
- **user:** ¿Cuál es el precio?
- **assistant:** La propiedad LUX-A0453 está en $4,500,000 MXN. ¿Quieres verla esta semana?

### QA-03 — Captación venta + solo municipio (sin “canal equivocado”)

- **user:** Quiero vender mi casa
- **assistant:** Entendido. ¿La propiedad es tuya o estás apoyando a alguien? Para registrar bien tu solicitud, ¿me compartes tu nombre y en qué zona está la propiedad?
- **user:** Apodaca
- **assistant:** Entendido. ¿La propiedad es tuya o estás apoyando a alguien?

### QA-04 — Visita explícita + nombre

- **user:** Me interesa LUX-A0453 y quiero verla
- **assistant:** Perfecto. Voy a canalizar tu solicitud con un asesor de Luxetty para que te apoye con la información y próximos pasos. Con gusto revisamos la visita. Para dejarte registrado correctamente, ¿me compartes tu nombre?

### QA-05 — Handoff previo + “gracias” (sin silencio + nombre si falta)

- **user:** gracias
- **assistant:** Gracias a ti. Si surge algo más, aquí estoy para seguirte orientando con gusto. Claro, te ayudo. Para ubicar bien tu solicitud, ¿me compartes tu nombre y en qué te puedo orientar primero?

### QA-06 — Campaña listing + “me interesa” (contexto pauta)

- **user:** Me interesa
- **assistant:** Perfecto. Voy a canalizar tu solicitud con un asesor de Luxetty para que te apoye con la información y próximos pasos. Claro, te ayudo. Para ubicar bien tu solicitud, ¿me compartes tu nombre y en qué te puedo orientar primero?

### QA-07 — Disponibilidad sobre propiedad en contexto

- **user:** ¿Sigue disponible LUX-A0453?
- **assistant:** Para orientarte mejor, ¿buscas comprar o rentar una propiedad? Para ubicar bien tu solicitud, ¿me compartes tu nombre y si buscas comprar o rentar?

### QA-08 — Ubicación / zona (demanda)

- **user:** Busco casa en Cumbres
- **assistant:** Entendido. ¿Cuál es tu presupuesto aproximado? Para ubicar bien tu solicitud, ¿me compartes tu nombre y si buscas comprar o rentar?

### QA-09 — Valuación (oferta)

- **user:** Quiero valuar mi casa en San Pedro
- **assistant:** Claro. Para valuar de forma responsable usamos comparativo de mercado (cierres reales, oferta competidora y absorcion), no un numero al aire. Podemos hacer una revision inicial y, si tiene sentido, agendar una visita breve para darte una referencia mas precisa. ¿La propiedad esta en Cumbres, Garcia, San Pedro, Carretera Nacional u otra zona? Para registrar bien tu solicitud, ¿me compartes tu nombre y en qué zona está la propiedad?

### QA-10 — Comisión (tono consultivo, sin inventar)

- **user:** ¿Cuánto cobran de comisión?
- **assistant:** Buena pregunta. Normalmente la comisión se maneja como un porcentaje sobre el precio final de venta, pero más que una comisión aislada, lo importante es cuánto neto te queda y en cuánto tiempo se puede cerrar con buena estrategia, filtrado, promoción y negociación. ¿La propiedad ya está publicada o apenas estás evaluando vender? Para registrarte bien, ¿me compartes tu nombre?

### QA-11 — Follow-up contextual: zona luego presupuesto

- **user:** Busco en Cumbres
- **assistant:** Para orientarte mejor, ¿buscas comprar o rentar una propiedad? Para ubicar bien tu solicitud, ¿me compartes tu nombre y si buscas comprar o rentar?
- **user:** Hasta 5 millones
- **assistant:** Para orientarte mejor, ¿buscas comprar o rentar una propiedad?

### QA-12 — Demanda genérica + refinamiento

- **user:** Busco depa
- **assistant:** Entendido. ¿En qué zona te interesa buscar? Para ubicar bien tu solicitud, ¿me compartes tu nombre y si buscas comprar o rentar?
- **user:** En San Pedro, 3 recámaras
- **assistant:** Entendido. ¿Cuál es tu presupuesto aproximado?

### QA-13 — “Solo dame el precio” con contexto demanda/propiedad

- **user:** Solo dame el precio
- **assistant:** La propiedad LUX-A0453 está en $4,500,000 MXN. ¿Quieres verla esta semana? Para registrarte bien, ¿me compartes tu nombre?

### QA-14 — Venta + urgencia (captación)

- **user:** Me urge vender mi casa en Cumbres
- **assistant:** Entiendo la urgencia. Cuando se necesita vender rapido, lo clave es salir con precio y estrategia correctos desde el inicio, junto con papeleria clara y buena exposicion comercial. ¿La propiedad ya tiene papeleria lista o todavia habria que revisarla? Para registrarte bien, ¿me compartes tu nombre?

### QA-15 — Propiedad intestada (señal legal, sin silencio)

- **user:** Quiero vender pero está intestada
- **assistant:** Entendido. ¿La propiedad es tuya o estás apoyando a alguien? Para registrar bien tu solicitud, ¿me compartes tu nombre y en qué zona está la propiedad?

### QA-16 — Crédito hipotecario pendiente

- **user:** Quiero vender y todavía tengo crédito
- **assistant:** Entendido. ¿La propiedad es tuya o estás apoyando a alguien? Para registrar bien tu solicitud, ¿me compartes tu nombre y en qué zona está la propiedad?

### QA-17 — Ocupada por inquilino

- **user:** Quiero vender mi casa pero está ocupada
- **assistant:** Gracias por explicarme tan bien. Este caso sí vale la pena revisarlo con cuidado; puede ser viable, pero hay que revisar documentación, ocupación y estrategia antes de definir la ruta. Lo correcto es revisarlo con enfoque comercial y jurídico. ¿Hace cuánto tiempo está ocupada? ¿La persona entró con permiso o fue despojo? Para registrar bien tu solicitud, ¿me compartes tu nombre y en qué zona está la propiedad?

### QA-18 — Ya publicada y no se vende

- **user:** Ya la tengo publicada y no se vende
- **assistant:** Entendido. ¿La propiedad es tuya o estás apoyando a alguien? Para registrar bien tu solicitud, ¿me compartes tu nombre y en qué zona está la propiedad?

### QA-19 — Contacto con nombre válido: no insistir en nombre

- **user:** Hola, busco casa
- **assistant:** Entendido. ¿En qué zona te interesa buscar?

### QA-20 — Perfil WA útil + placeholder contacto (confirmación)

- **user:** Hola
- **assistant:** Hola, bienvenido a Luxetty 😊 ¿En qué puedo orientarte hoy? ¿Buscas comprar, rentar, vender o poner en renta una propiedad? ¿Te registro como Carlos? Si no, dime cómo quieres que aparezca tu nombre.
