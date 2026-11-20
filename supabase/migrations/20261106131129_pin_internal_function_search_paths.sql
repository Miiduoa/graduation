begin;

-- These helpers use built-ins and schema-qualified application references.
-- Keep temporary objects after both trusted schemas in the lookup order.
alter function public._quiz_normalize_answer(text, jsonb)
  set search_path = pg_catalog, public, pg_temp;
alter function public._quiz_answer_correct(text, jsonb, jsonb)
  set search_path = pg_catalog, public, pg_temp;
alter function public.quiz_attempts_before_insert_guard()
  set search_path = pg_catalog, public, pg_temp;
alter function public.set_updated_at()
  set search_path = pg_catalog, public, pg_temp;

commit;
