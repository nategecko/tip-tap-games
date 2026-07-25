-- Wipe run data without touching the schema, accounts, or provider config.
-- Run this right before judging so the boards start clean.

-- everything
delete from public.scores;

-- ...or just the synthetic rows from backend testing, keeping real play:
-- delete from public.scores
--  where device_id in (
--    '00000000-0000-4000-8000-000000000001',
--    '00000000-0000-4000-8000-000000000002',
--    '00000000-0000-4000-8000-000000000003'
--  );

-- to also drop signed-in players (they'll be recreated on next sign-in):
-- delete from public.players;

select
  (select count(*) from public.scores)  as scores_left,
  (select count(*) from public.players) as players_left;
