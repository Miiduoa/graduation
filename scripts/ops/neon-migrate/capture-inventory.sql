-- 唯讀盤點。輸出到 stdout，由 01-export.sh 分檔保存。
-- 不印連線字串。Neon 內建角色會一併列出，還原時不得 CREATE 它們。

\pset tuples_only off
\pset format aligned

\echo ===pg_version===
SELECT version();

\echo ===extensions===
SELECT e.extname, e.extversion, n.nspname AS schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
 ORDER BY 1;

\echo ===roles===
SELECT rolname,
       rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication,
       rolbypassrls
  FROM pg_roles
 ORDER BY rolname;

\echo ===role_memberships===
SELECT r.rolname AS member, g.rolname AS granted_role, m.admin_option
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.member
  JOIN pg_roles g ON g.oid = m.roleid
 ORDER BY 1, 2;

\echo ===table_counts===
SELECT n.nspname AS schema, c.relname AS name, c.relkind, c.reltuples::bigint AS reltuples_estimate,
       CASE WHEN c.relkind = 'r' THEN (
         SELECT reltuples::bigint FROM pg_class x WHERE x.oid = c.oid
       ) END AS unused
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
   AND c.relkind IN ('r', 'p')
 ORDER BY 1, 2;

\echo ===exact_table_counts===
SELECT n.nspname AS schema, c.relname AS table_name,
       (xpath('row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint AS row_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND c.relname NOT LIKE 'pg_%'
 ORDER BY 1, 2;

\echo ===sequences===
SELECT schemaname, sequencename, last_value, start_value, increment_by
  FROM pg_sequences
 ORDER BY 1, 2;

\echo ===schema_migrations===
SELECT id, checksum, applied_at
  FROM public.schema_migrations
 ORDER BY id;

\echo ===table_privileges===
SELECT grantor, grantee, table_schema, table_name, privilege_type, is_grantable
  FROM information_schema.role_table_grants
 WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
 ORDER BY table_schema, table_name, grantee, privilege_type;

\echo ===column_privileges===
SELECT grantor, grantee, table_schema, table_name, column_name, privilege_type, is_grantable
  FROM information_schema.column_privileges
 WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
   AND grantee NOT IN ('PUBLIC')
 ORDER BY 3, 4, 5, 2, 6;

\echo ===routine_privileges===
SELECT grantor, grantee, routine_schema, routine_name, privilege_type, is_grantable
  FROM information_schema.routine_privileges
 WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
 ORDER BY 3, 4, 2, 5;

\echo ===default_privileges===
SELECT pg_get_userbyid(d.defaclrole) AS owner,
       n.nspname AS schema,
       d.defaclobjtype,
       defaclacl::text AS acl
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
 ORDER BY 1, 2, 3;
