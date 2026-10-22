#!/usr/bin/env bash
# 把新庫在 CUTOVER_TS 之後新增／更新的列，以 upsert 方式補回舊庫。
# 只處理 public 裡有 created_at 或 updated_at 的表。沒有時間欄的表會列出來，要人工判斷。
# 用法：NEW_DATABASE_URL=... OLD_DATABASE_URL=... CUTOVER_TS='2026-10-22T16:00:00+08:00' ./06-replay-delta.sh
# 預設乾跑。APPLY_DELTA=yes 才寫入舊庫。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh

need_cmd psql
need_cmd python3
require_pg18

NEW_DATABASE_URL="$(read_url NEW_DATABASE_URL)"
OLD_DATABASE_URL="$(read_url OLD_DATABASE_URL)"
require_sslmode "$NEW_DATABASE_URL" NEW_DATABASE_URL
require_sslmode "$OLD_DATABASE_URL" OLD_DATABASE_URL
CUTOVER_TS="${CUTOVER_TS:?請設 CUTOVER_TS（ISO-8601）}"
APPLY_DELTA="${APPLY_DELTA:-no}"
WORKDIR="${WORKDIR:?請設 WORKDIR}"
mkdir_private "$WORKDIR"

printf '新庫 host：%s\n舊庫 host：%s\nCUTOVER_TS=%s\n' \
  "$(redacted_host "$NEW_DATABASE_URL")" \
  "$(redacted_host "$OLD_DATABASE_URL")" \
  "$CUTOVER_TS"

python3 - "$NEW_DATABASE_URL" "$OLD_DATABASE_URL" "$CUTOVER_TS" "$WORKDIR" "$APPLY_DELTA" <<'PY'
import os, subprocess, json, sys
from datetime import datetime

new_url, old_url, cutover, workdir, apply = sys.argv[1:]

def psql(url, sql, tuples=False):
    cmd = ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1"]
    if tuples:
        cmd += ["-At", "-F", "\t"]
    cmd += ["-c", sql]
    env = {**os.environ, "PSQL_HISTORY": "/dev/null"}
    result = subprocess.run(cmd, check=True, capture_output=True, text=True, env=env)
    return result.stdout

cols_sql = r"""
SELECT c.relname, array_agg(a.attname::text ORDER BY a.attnum)
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE n.nspname='public' AND c.relkind='r'
GROUP BY c.relname
ORDER BY 1;
"""
pk_sql = r"""
SELECT c.relname, array_agg(a.attname::text ORDER BY x.ordinality)
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_index i ON i.indrelid=c.oid AND i.indisprimary
JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS x(attnum, ordinality) ON true
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.attnum
WHERE n.nspname='public' AND c.relkind='r'
GROUP BY c.relname;
"""

def parse_array(text):
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        inner = text[1:-1]
        if not inner:
            return []
        return inner.split(",")
    return []

def load_map(url, sql):
    rows = {}
    for line in psql(url, sql, tuples=True).splitlines():
        if not line:
            continue
        name, arr = line.split("\t", 1)
        rows[name] = parse_array(arr)
    return rows

new_cols = load_map(new_url, cols_sql)
old_cols = load_map(old_url, cols_sql)
pks = load_map(new_url, pk_sql)

timestamp_tables = []
no_ts = []
for table, cols in sorted(new_cols.items()):
    if table not in old_cols:
        continue
    ts = [c for c in ("updated_at", "created_at", "applied_at", "occurred_at", "submitted_at") if c in cols]
    if ts:
        timestamp_tables.append((table, cols, pks.get(table, []), ts[0]))
    else:
        no_ts.append(table)

report = {"cutover": cutover, "tables": [], "no_timestamp": no_ts, "applied": apply == "yes"}
failures = []
for table, cols, pk, ts_col in timestamp_tables:
    ident_cols = ", ".join(f'"{c}"' for c in cols)
    count_sql = f'SELECT count(*) FROM public."{table}" WHERE "{ts_col}" >= TIMESTAMP WITH TIME ZONE %s'
    # psql -c 不能綁參數，改用 dollar quote 時間字串（已由呼叫端提供 ISO-8601）。
    safe_ts = cutover.replace("'", "''")
    count = int(psql(new_url, f"SELECT count(*) FROM public.\"{table}\" WHERE \"{ts_col}\" >= TIMESTAMPTZ '{safe_ts}'", tuples=True).strip() or "0")
    entry = {"table": table, "timestamp_column": ts_col, "new_rows": count, "primary_key": pk}
    report["tables"].append(entry)
    if count == 0 or apply != "yes":
        continue
    if not pk:
        failures.append(f"{table} 有 {count} 列但沒有主鍵，略過自動寫入")
        continue
    conflict = ", ".join(f'"{c}"' for c in pk)
    updates = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in cols if c not in pk)
    copy_sql = f"""
COPY (
  SELECT {ident_cols} FROM public."{table}" WHERE "{ts_col}" >= TIMESTAMPTZ '{safe_ts}'
) TO STDOUT WITH (FORMAT csv, HEADER false);
"""
    env = {**os.environ, "PSQL_HISTORY": "/dev/null"}
    copied = subprocess.run(
        ["psql", "--no-psqlrc", "--dbname", new_url, "-v", "ON_ERROR_STOP=1", "-c", copy_sql],
        check=True, capture_output=True, env=env,
    )
    csv_path = os.path.join(workdir, f"{table}.csv")
    open(csv_path, "wb").write(copied.stdout)
    set_clause = updates if updates else None
    insert = f"""
CREATE TEMP TABLE delta_src (LIKE public."{table}");
COPY delta_src ({ident_cols}) FROM STDIN WITH (FORMAT csv, HEADER false);
INSERT INTO public."{table}" ({ident_cols})
SELECT {ident_cols} FROM delta_src
ON CONFLICT ({conflict}) DO UPDATE SET {set_clause if set_clause else pk[0] + ' = EXCLUDED.' + pk[0]};
"""
    subprocess.run(
        ["psql", "--no-psqlrc", "--dbname", old_url, "-v", "ON_ERROR_STOP=1", "-c", insert],
        input=copied.stdout,
        check=True,
        env=env,
    )
    entry["applied_bytes"] = len(copied.stdout)

open(os.path.join(workdir, "delta-report.json"), "w", encoding="utf-8").write(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n"
)
print(f"有時間欄的表 {len(timestamp_tables)}，CUTOVER 之後有列的：{sum(1 for t in report['tables'] if t['new_rows'])}")
print(f"沒有時間欄、需人工看的表：{len(no_ts)}")
if failures:
    print("\n".join(failures))
    sys.exit(1)
if apply != "yes":
    print("乾跑結束。確認 delta-report.json 後設 APPLY_DELTA=yes 再跑一次。")
PY
