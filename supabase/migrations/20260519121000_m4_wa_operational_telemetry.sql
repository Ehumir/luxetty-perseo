-- M4-01 PROPOSED — WhatsApp operational telemetry (PERSEO)
-- ⚠️ DO NOT APPLY without explicit team approval (see README-M4-01.md)

BEGIN;

CREATE TABLE IF NOT EXISTS wa_operational_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  channel text NOT NULL DEFAULT 'whatsapp',
  policy_hit text,
  handoff_quality numeric,
  humanity_score numeric,
  drop_reason text,
  media_processed jsonb,
  crm_execution_result jsonb,
  fallback_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_telemetry_conversation
  ON wa_operational_telemetry (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_telemetry_created
  ON wa_operational_telemetry (created_at DESC);

ALTER TABLE wa_operational_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY wa_telemetry_service ON wa_operational_telemetry
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
