-- Account-scoped AI action preferences; this does not grant school membership or enable services.
CREATE TABLE platform_assistant_permissions (
  platform_account_id text PRIMARY KEY REFERENCES platform_accounts(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  create_personal_event boolean NOT NULL DEFAULT false,
  prepare_food_order boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE platform_assistant_permissions FROM PUBLIC;

-- Account closure owns the account row before deleting preferences. Preference
-- writes take FOR SHARE on that same row, so a closed account cannot be recreated
-- by an in-flight settings save. Suspension retains preferences but denies access.
CREATE FUNCTION dispose_closed_account_assistant_permissions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.state IN ('deleted', 'closed') AND NEW.state IS DISTINCT FROM OLD.state THEN
    EXECUTE format('DELETE FROM %I.platform_assistant_permissions WHERE platform_account_id = $1', TG_TABLE_SCHEMA)
      USING NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER closed_account_assistant_permissions AFTER UPDATE OF state ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION dispose_closed_account_assistant_permissions();
