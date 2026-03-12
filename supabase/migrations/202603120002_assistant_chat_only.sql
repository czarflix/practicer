BEGIN;

UPDATE public.assistant_threads
SET chat_mode = 'chat'
WHERE chat_mode IS DISTINCT FROM 'chat';

ALTER TABLE public.assistant_threads
  ALTER COLUMN chat_mode SET DEFAULT 'chat';

ALTER TABLE public.assistant_threads
  DROP CONSTRAINT IF EXISTS assistant_threads_chat_mode_check;

ALTER TABLE public.assistant_threads
  ADD CONSTRAINT assistant_threads_chat_mode_check
  CHECK (chat_mode = 'chat');

DELETE FROM public.assistant_threads AS threads
WHERE NOT EXISTS (
  SELECT 1
  FROM public.assistant_messages AS messages
  WHERE messages.thread_id = threads.id
);

UPDATE public.assistant_messages
SET content = jsonb_build_object(
  'title', 'Assistant unavailable',
  'summary', 'The assistant could not complete this turn.',
  'blocks', jsonb_build_array(
    jsonb_build_object(
      'id', 'block-0',
      'kind', 'warning',
      'text', 'The model turn failed. Try again.'
    )
  ),
  'suggested_prompts', jsonb_build_array('Try again', 'Ask a shorter follow-up')
)
WHERE role = 'assistant'
  AND status = 'error'
  AND (
    content::text ILIKE '%Request kept in context%'
    OR content::text ILIKE '%Attached context%'
  );

COMMIT;
