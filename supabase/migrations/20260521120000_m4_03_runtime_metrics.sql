-- M4-03 PROPOSED — runtime metrics rollup (operational observability)
-- DO NOT APPLY without explicit approval

BEGIN;

CREATE TABLE IF NOT EXISTS runtime_metrics_rollup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_at timestamptz NOT NULL,
  metric_key text NOT NULL,
  metric_value numeric NOT NULL DEFAULT 0,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runtime_metrics_bucket_key
  ON runtime_metrics_rollup (bucket_at DESC, metric_key);

CREATE TABLE IF NOT EXISTS crm_worker_heartbeats (
  worker_id text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE runtime_metrics_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_worker_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY runtime_metrics_service ON runtime_metrics_rollup
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crm_worker_heartbeats_service ON crm_worker_heartbeats
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
