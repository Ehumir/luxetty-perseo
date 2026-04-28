ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS lead_score integer,
ADD COLUMN IF NOT EXISTS lead_temperature text;
