-- The identity tables answer to their owner alone, and Supabase's Data API
-- gets nothing in `public` (ADR 0005, amending ADR 0002).
--
-- ENABLE, not FORCE, and no policy: the owner — Better Auth and the system
-- lane — is exempt by construction, and every other role reads and writes
-- nothing, whatever it has been granted. That is what holds if a grant comes
-- back.
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The roles Supabase serves `public` to over HTTP. Its default privileges gave
-- them everything on every table the owner created here; Planora never used
-- the Data API, so they keep nothing — now, and on the tables still to come.
-- They exist only on Supabase: elsewhere there is nothing to revoke.
DO $$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', data_api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', data_api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', data_api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', data_api_role);
    END IF;
  END LOOP;
END
$$;
