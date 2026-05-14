# Sprint 5A — PR2: PERSEO inbound media ingest

**Repo:** `luxetty-perseo`  
**Dependencia:** PR1 bucket `whatsapp-inbound-media` (Supabase) ya aplicado.

**Post-merge:** rama **`hotfix/sprint-5a-ingest-flag-off-silent`** (`8440b9e`) — con flag `false`, mensajes **texto** no generan log `perseo_inbound_media_*`; solo tipos media registran `ingest_skipped` (`flag_disabled`). Corrige `pendingRecord` (`errorCode`) para cuando el flag sea `true`.

## Resumen técnico

- Variable **`PERSEO_INBOUND_MEDIA_STORAGE_ENABLED`**: solo con valor exacto **`true`** activa el pipeline (lectura en **runtime** vía `process.env` en cada ingest).
- Tras **persist inbound** y **`resolveAutomatedReplyPolicy`**, `index.js` programa **`scheduleInboundMediaIngest`** con `setImmediate` (sin `await`): no bloquea el webhook por descarga/upload.
- Servicio **`services/inboundMediaStorageIngest.js`**: Graph download con `resolveInboundMedia`, upload a Storage con path **`{conversation_id}/{message_id}.{ext}`**, `upsert: true`, y `UPDATE` de `metadata` con **merge** que conserva claves existentes (`delivery_status`, etc.).
- **Tipos:** `image`, `audio`, `voice`, `document` → descarga si MIME MVP; **`sticker`** y **`video`** → `skipped_unsupported` sin descarga.
- **`extractTextFromInbound`** mejora captions/filename para preview de texto sin cambiar gatekeeper ni wrapper.

## Archivos tocados

| Archivo | Cambio |
|---------|--------|
| `config/env.js` | Export documentado de `PERSEO_INBOUND_MEDIA_STORAGE_ENABLED` (default false en config export; runtime ingest usa `process.env`). |
| `services/inboundMediaStorageIngest.js` | **Nuevo** — ingest completo. |
| `index.js` | Captions; `scheduleInboundMediaIngest` tras policy; require del servicio. |
| `test/inboundMediaStorageIngest.test.js` | **Nuevo** — merge metadata, flag off, MIME. |

## Variables Railway / runtime

| Variable | Obligatoria para ingest ON |
|----------|------------------------------|
| `SUPABASE_URL` | Sí (ya existente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí (Storage + DB) |
| `WHATSAPP_TOKEN` o `META_ACCESS_TOKEN` | Sí para descarga Graph; si faltan → `skipped_token_missing` |
| `PERSEO_INBOUND_MEDIA_STORAGE_ENABLED` | `true` para activar; **`false`** = comportamiento previo (solo schedule + early return en defer) |

## Activar pruebas multimedia (controlado)

1. Deploy PERSEO con código PR2 y **`PERSEO_INBOUND_MEDIA_STORAGE_ENABLED=false`**.
2. QA texto / gatekeeper / envío humano (sin cambios esperados).
3. En staging (o ventana acotada prod): poner **`PERSEO_INBOUND_MEDIA_STORAGE_ENABLED=true`** y reiniciar servicio.
4. Enviar desde WhatsApp: imagen JPEG, audio OGG/OPUS, PDF; sticker y video deben quedar `skipped_unsupported` en `metadata.whatsapp_media`.
5. Verificar Storage objeto bajo `{conversation_id}/{message_id}.ext` y fila `conversation_messages.metadata`.
6. Apagar: **`PERSEO_INBOUND_MEDIA_STORAGE_ENABLED=false`** + reinicio → sin nuevos uploads ni updates (el defer retorna al inicio).

## Rollback instantáneo

- **`PERSEO_INBOUND_MEDIA_STORAGE_ENABLED=false`** + redeploy/restart → pipeline desactivado sin revertir código.
- Revertir deploy del PR2 si hace falta código antiguo.

## Checklist QA

- [ ] Flag `false`: mensaje texto → sin `whatsapp_media`; sin regresión respuesta IA/humano.
- [ ] Flag `false`: grep / prueba manual — cero uploads nuevos al bucket en ventana de prueba.
- [ ] Flag `true`: imagen → `download_status: stored` + objeto en bucket.
- [ ] Flag `true`: audio/voice → `stored` o `failed` honesto.
- [ ] Flag `true`: PDF → `stored`; `filename` en metadata si aplica.
- [ ] Flag `true`: sticker/video → `skipped_unsupported`, sin objeto.
- [ ] MIME no MVP → `skipped_unsupported_mime` o `failed` según `whatsappMediaService`.
- [ ] Mensaje outbound humano con `metadata.delivery_status` no se pierde al actualizar otra fila inbound (regresión manual: filas distintas; merge solo afecta la fila del `message_id` inbound).

## Riesgos residuales

- **Carrera:** dos ingests concurrentes para el mismo mensaje (raro): `upsert` en Storage + último `UPDATE` de metadata gana; `already_stored` evita re-trabajo habitual.
- **Webhook:** el `200` a Meta sigue al final del handler actual; el ingest **no** se espera, pero el proceso total del handler no se acorta.
- **Logs:** no incluyen URLs con token ni secretos; errores truncados a 200 caracteres en un caso de Storage.

## Validación automatizada

- `npm test` (incluye `test/inboundMediaStorageIngest.test.js`).
- `npm run validate:graph-outbound` — sin nuevos `axios.post` hacia Graph fuera del wrapper.
