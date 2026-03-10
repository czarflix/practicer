BEGIN;

WITH ordered AS (
  SELECT
    sm.id,
    ROW_NUMBER() OVER (ORDER BY sm.sort_order, sm.module_number, sm.id) AS new_number
  FROM public.study_modules sm
  WHERE sm.track_key = 'dsa'
), temp_update AS (
  UPDATE public.study_modules sm
  SET module_key = format('tmp-phase-%s', ordered.new_number),
      module_number = ordered.new_number,
      sort_order = ordered.new_number,
      updated_at = now()
  FROM ordered
  WHERE sm.id = ordered.id
  RETURNING sm.id, sm.module_number
)
UPDATE public.study_modules sm
SET module_key = format('phase-%s', sm.module_number),
    updated_at = now()
WHERE sm.track_key = 'dsa'
  AND sm.module_key LIKE 'tmp-phase-%';

COMMIT;
