-- Replay application ACLs, including explicit PUBLIC revokes and grant options.
-- Extension-owned objects retain their managed ACLs. System-role grants are omitted.
WITH objects AS (
  SELECT format('SCHEMA %I', nspname) AS object, nspowner AS owner,
         coalesce(nspacl, acldefault('n', nspowner)) AS acl
    FROM pg_namespace WHERE nspname = 'public'
  UNION ALL
  SELECT format('%s %I.%I', CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, n.nspname, c.relname),
         c.relowner, coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  UNION ALL
  SELECT format('%s %I.%I(%s)', CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
                n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
         p.proowner, coalesce(p.proacl, acldefault('f', p.proowner))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
), defaults AS (
  SELECT d.*, CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
                   WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' END AS kind,
         format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s', r.rolname,
                CASE WHEN n.oid IS NULL THEN '' ELSE format(' IN SCHEMA %I', n.nspname) END) AS prefix
    FROM pg_default_acl d
    JOIN pg_roles r ON r.oid = d.defaclrole
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE (d.defaclnamespace = 0 OR n.nspname = 'public')
     AND r.rolname !~ '^pg_'
     AND r.rolname NOT IN ('postgres','cloud_admin','neon_superuser','neon_admin','neon_auth','neon_authenticator','neon_service')
     AND d.defaclobjtype IN ('r','S','f','T','n')
), statements AS (
  SELECT 0 AS phase, format('REVOKE ALL ON %s FROM PUBLIC;', object) AS sql FROM objects
  UNION ALL
  SELECT 1, format('GRANT %s ON %s TO %s%s;', string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type),
                   o.object, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END,
                   CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
    FROM objects o CROSS JOIN LATERAL aclexplode(o.acl) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE a.grantee <> o.owner AND (a.grantee = 0 OR
         (r.rolname !~ '^pg_' AND r.rolname NOT IN ('postgres','cloud_admin','neon_superuser','neon_admin','neon_auth','neon_authenticator','neon_service')))
   GROUP BY o.object, a.grantee, r.rolname, a.is_grantable
  UNION ALL
  SELECT 2, format('%s REVOKE ALL ON %s FROM PUBLIC;', prefix, kind) FROM defaults
  UNION ALL
  SELECT 3, format('%s GRANT %s ON %s TO %s%s;', d.prefix, a.privilege_type, d.kind,
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END,
                   CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
    FROM defaults d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE a.grantee <> d.defaclrole AND (a.grantee = 0 OR
         (r.rolname !~ '^pg_' AND r.rolname NOT IN ('postgres','cloud_admin','neon_superuser','neon_admin','neon_auth','neon_authenticator','neon_service')))
)
SELECT sql FROM statements ORDER BY phase, sql;
