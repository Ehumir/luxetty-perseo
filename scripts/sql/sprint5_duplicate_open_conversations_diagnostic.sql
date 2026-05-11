-- Sprint 5 — Diagnóstico manual: conversaciones WhatsApp abiertas duplicadas por key10 (últimos 10 dígitos MX).
-- Solo lectura. NO ejecutar UPDATE/DELETE desde este archivo.
-- Criterio canónico (alineado a PERSEO chooseCanonicalReusableConversation):
--   1) lead_id NOT NULL
--   2) contact_id NOT NULL
--   3) last_message_at DESC
--   4) updated_at DESC
--   5) created_at DESC
--   6) id DESC (lex)

WITH conv AS (
  SELECT
    c.id,
    c.channel,
    c.status,
    c.phone,
    c.contact_id,
    c.lead_id,
    c.last_message_at,
    c.updated_at,
    c.created_at,
    regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') AS digits
  FROM public.conversations c
  WHERE c.channel = 'whatsapp'
    AND lower(trim(coalesce(c.status, ''))) <> 'closed'
),
keyed AS (
  SELECT
    *,
    CASE
      WHEN length(digits) = 13 AND digits LIKE '521%' THEN right(digits, 10)
      WHEN length(digits) = 12 AND digits LIKE '52%' AND digits NOT LIKE '521%' THEN right(digits, 10)
      WHEN length(digits) = 10 THEN digits
      ELSE NULL
    END AS key10
  FROM conv
),
dup_groups AS (
  SELECT key10
  FROM keyed
  WHERE key10 IS NOT NULL
  GROUP BY key10
  HAVING count(*) > 1
),
ranked AS (
  SELECT
    k.*,
    row_number() OVER (
      PARTITION BY k.key10
      ORDER BY
        (k.lead_id IS NOT NULL) DESC,
        (k.contact_id IS NOT NULL) DESC,
        k.last_message_at DESC NULLS LAST,
        k.updated_at DESC NULLS LAST,
        k.created_at DESC NULLS LAST,
        k.id DESC
    ) AS rn
  FROM keyed k
  INNER JOIN dup_groups d ON d.key10 = k.key10
)
SELECT
  r.key10,
  r.id AS conversation_id,
  r.status,
  r.phone,
  r.lead_id,
  r.contact_id,
  r.last_message_at,
  r.updated_at,
  r.created_at,
  CASE WHEN r.rn = 1 THEN true ELSE false END AS is_canonical_suggestion,
  CASE WHEN r.rn = 1 THEN NULL ELSE (
    SELECT r2.id FROM ranked r2 WHERE r2.key10 = r.key10 AND r2.rn = 1 LIMIT 1
  ) END AS suggested_canonical_id
FROM ranked r
ORDER BY r.key10, r.rn;

-- Lista compacta: solo duplicadas (no canónicas sugeridas) por key10
-- SELECT key10, id AS duplicate_conversation_id, phone, lead_id, contact_id
-- FROM ranked WHERE rn > 1 ORDER BY key10, id;
