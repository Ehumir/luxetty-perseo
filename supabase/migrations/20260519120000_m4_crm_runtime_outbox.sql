-- M4-01 PROPOSED — CRM operational outbox (PERSEO)
-- ⚠️ DO NOT APPLY without explicit team approval (see README-M4-01.md)

BEGIN;

CREATE TABLE IF NOT EXISTS crm_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_outbox_status_scheduled
  ON crm_outbox (status, scheduled_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS crm_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  outbox_id uuid REFERENCES crm_outbox (id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (conversation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS crm_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid REFERENCES crm_outbox (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  phase text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_execution_logs_conversation
  ON crm_execution_logs (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES crm_outbox (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  reason text NOT NULL,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_dead_letters ENABLE ROW LEVEL SECURITY;

-- Service role only (adjust if using dedicated perseo role)
CREATE POLICY crm_outbox_service ON crm_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crm_idempotency_service ON crm_idempotency_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crm_execution_logs_service ON crm_execution_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crm_dead_letters_service ON crm_dead_letters FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
