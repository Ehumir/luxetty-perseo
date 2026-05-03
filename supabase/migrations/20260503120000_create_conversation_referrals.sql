CREATE TABLE IF NOT EXISTS public.conversation_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  conversation_message_id uuid REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  meta_message_id text,
  source_type text,
  source_id text,
  source_url text,
  headline text,
  body text,
  media_type text,
  image_url text,
  video_url text,
  thumbnail_url text,
  ctwa_clid text,
  ad_id text,
  adgroup_id text,
  campaign_id text,
  raw_referral jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_referrals_conversation_id
  ON public.conversation_referrals (conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_referrals_message_id
  ON public.conversation_referrals (conversation_message_id);

CREATE INDEX IF NOT EXISTS idx_conversation_referrals_meta_message_id
  ON public.conversation_referrals (meta_message_id);

CREATE INDEX IF NOT EXISTS idx_conversation_referrals_created_at
  ON public.conversation_referrals (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_referrals_conversation_meta_not_null
  ON public.conversation_referrals (conversation_id, meta_message_id)
  WHERE meta_message_id IS NOT NULL;