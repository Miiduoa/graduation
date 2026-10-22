-- 產出可重放的應用程式 ACL。排除 Neon／系統角色與物件擁有者自己。
-- 由 01-export.sh 以 -At 執行，寫入 inventory/grants.sql。
-- 只用實際存下來的 ACL，不用 acldefault，避免把「擁有者隱含權限」寫成 GRANT。

SELECT format(
  'GRANT %s ON TABLE %I.%I TO %I;',
  string_agg(x.priv, ', ' ORDER BY x.priv),
  x.nspname, x.relname, x.grantee
)
FROM (
  SELECT n.nspname, c.relname, r.rolname AS grantee, a.privilege_type AS priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL aclexplode(c.relacl) a ON true
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm')
     AND c.relacl IS NOT NULL
     AND r.rolname NOT IN (
       'postgres','cloud_admin','neon_superuser','neon_admin',
       'neon_auth','neon_authenticator','neon_service'
     )
     AND r.rolname !~ '^pg_'
     AND a.grantee <> c.relowner
) x
GROUP BY x.nspname, x.relname, x.grantee

UNION ALL

SELECT format(
  'GRANT %s ON SEQUENCE %I.%I TO %I;',
  string_agg(x.priv, ', ' ORDER BY x.priv),
  x.nspname, x.relname, x.grantee
)
FROM (
  SELECT n.nspname, c.relname, r.rolname AS grantee, a.privilege_type AS priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL aclexplode(c.relacl) a ON true
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND c.relkind = 'S'
     AND c.relacl IS NOT NULL
     AND r.rolname NOT IN (
       'postgres','cloud_admin','neon_superuser','neon_admin',
       'neon_auth','neon_authenticator','neon_service'
     )
     AND r.rolname !~ '^pg_'
     AND a.grantee <> c.relowner
) x
GROUP BY x.nspname, x.relname, x.grantee

UNION ALL

SELECT format(
  'GRANT %s ON FUNCTION %I.%I(%s) TO %I;',
  string_agg(x.priv, ', ' ORDER BY x.priv),
  x.nspname, x.proname, x.args, x.grantee
)
FROM (
  SELECT n.nspname,
         p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         r.rolname AS grantee,
         a.privilege_type AS priv
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN LATERAL aclexplode(p.proacl) a ON true
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND p.proacl IS NOT NULL
     AND r.rolname NOT IN (
       'postgres','cloud_admin','neon_superuser','neon_admin',
       'neon_auth','neon_authenticator','neon_service'
     )
     AND r.rolname !~ '^pg_'
     AND a.grantee <> p.proowner
) x
GROUP BY x.nspname, x.proname, x.args, x.grantee

UNION ALL

SELECT format('GRANT USAGE ON SCHEMA public TO %I;', r.rolname)
  FROM pg_namespace n
  JOIN LATERAL aclexplode(n.nspacl) a ON true
  JOIN pg_roles r ON r.oid = a.grantee
 WHERE n.nspname = 'public'
   AND n.nspacl IS NOT NULL
   AND a.privilege_type = 'USAGE'
   AND r.rolname NOT IN (
     'postgres','cloud_admin','neon_superuser','neon_admin',
     'neon_auth','neon_authenticator','neon_service'
   )
   AND r.rolname !~ '^pg_'
   AND a.grantee <> n.nspowner

UNION ALL

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT %s ON %s TO %I;',
  pg_get_userbyid(d.defaclrole),
  COALESCE(n.nspname, 'public'),
  a.privilege_type,
  CASE d.defaclobjtype
    WHEN 'r' THEN 'TABLES'
    WHEN 'S' THEN 'SEQUENCES'
    WHEN 'f' THEN 'FUNCTIONS'
    WHEN 'T' THEN 'TYPES'
    WHEN 'n' THEN 'SCHEMAS'
    ELSE NULL
  END,
  pg_get_userbyid(a.grantee)
)
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  JOIN LATERAL aclexplode(d.defaclacl) a ON true
 WHERE pg_get_userbyid(d.defaclrole) NOT IN (
         'cloud_admin','neon_superuser','neon_admin','neon_auth',
         'neon_authenticator','neon_service','postgres'
       )
   AND pg_get_userbyid(a.grantee) NOT IN (
         'cloud_admin','neon_superuser','neon_admin','neon_auth',
         'neon_authenticator','neon_service','postgres'
       )
   AND d.defaclobjtype IN ('r','S','f','T','n')

ORDER BY 1;
