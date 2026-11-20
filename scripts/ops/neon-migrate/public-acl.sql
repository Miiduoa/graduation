-- Explicitly compare PUBLIC exposure; --no-acl must not reopen private routines.
WITH objects AS (
  SELECT format('SCHEMA %I', nspname) AS object, coalesce(nspacl, acldefault('n', nspowner)) AS acl
    FROM pg_namespace WHERE nspname = 'public'
  UNION ALL
  SELECT format('%s %I.%I', CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, n.nspname, c.relname),
         coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  UNION ALL
  SELECT format('%s %I.%I(%s)', CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
         coalesce(p.proacl, acldefault('f', p.proowner))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
)
SELECT object, a.privilege_type, a.is_grantable
  FROM objects o CROSS JOIN LATERAL aclexplode(o.acl) a
 WHERE a.grantee = 0 ORDER BY 1,2,3;
