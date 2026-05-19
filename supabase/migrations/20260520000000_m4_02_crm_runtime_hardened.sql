-- M4-02 PROPOSED — hardened CRM outbox (revisión sobre M4-01)
-- ⚠️ DO NOT APPLY without explicit team approval
-- Replaces/extends: 20260519120000_m4_crm_runtime_outbox.sql
-- Rollback: see docs/sprints/M4-02-production-activation-design.md §1.3

BEGIN;

-- If M4-01 already applied, use ALTER-only path in staging (separate migration note).
-- This file assumes greenfield or first apply of CRM runtime tables.

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
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  lock_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_outbox_status_scheduled
  ON crm_outbox (status, scheduled_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_crm_outbox_worker_poll
  ON crm_outbox (next_attempt_at)
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

CREATE INDEX IF NOT EXISTS idx_crm_idempotency_completed
  ON crm_idempotency_keys (completed_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_crm_dead_letters_created
  ON crm_dead_letters (created_at DESC);

ALTER TABLE crm_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_dead_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_outbox_service ON crm_outbox;
DROP POLICY IF EXISTS crm_idempotency_service ON crm_idempotency_keys;
DROP POLICY IF EXISTS crm_execution_logs_service ON crm_execution_logs;
DROP POLICY IF EXISTS crm_dead_letters_service ON crm_dead_letters;

CREATE POLICY crm_outbox_service ON crm_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crm_idempotency_service ON crm_idempotency_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crm_execution_logs_service ON crm_execution_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crm_dead_letters_service ON crm_dead_letters FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
