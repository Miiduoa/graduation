#!/usr/bin/env bash
# 把新庫在 CUTOVER_TS 之後新增／更新的列，以 upsert 方式補回舊庫。
# 只處理 public 裡有時間欄且有主鍵的表。沒有時間欄的表會列出來，要人工判斷。
# 預設略過 schema_migrations（避免把 checksum 寫回舊庫害舊映像起不來）。
# 用法：NEW_DATABASE_URL=... OLD_DATABASE_URL=... CUTOVER_TS='2026-10-22T16:00:00+08:00' ./06-replay-delta.sh
# 預設乾跑。APPLY_DELTA=yes 才寫入舊庫，且必須先有同一 CUTOVER_TS 的乾跑報告。
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
require_direct_host "$NEW_DATABASE_URL" NEW_DATABASE_URL
require_direct_host "$OLD_DATABASE_URL" OLD_DATABASE_URL
CUTOVER_TS="${CUTOVER_TS:?請設 CUTOVER_TS（ISO-8601）}"
APPLY_DELTA="${APPLY_DELTA:-no}"
WORKDIR="${WORKDIR:?請設 WORKDIR}"
mkdir_private "$WORKDIR"

printf '新庫 host：%s\n舊庫 host：%s\nCUTOVER_TS=%s\n' \
  "$(redacted_host "$NEW_DATABASE_URL")" \
  "$(redacted_host "$OLD_DATABASE_URL")" \
  "$CUTOVER_TS"

python3 - "$NEW_DATABASE_URL" "$OLD_DATABASE_URL" "$CUTOVER_TS" "$WORKDIR" "$APPLY_DELTA" <<'PY'
import os, subprocess, json, sys, re

new_url, old_url, cutover, workdir, apply = sys.argv[1:]
skip_tables = {t.strip() for t in os.environ.get("SKIP_TABLES", "schema_migrations").split(",") if t.strip()}

def psql(url, sql, tuples=False, quiet=False):
    cmd = ["psql", "--no-psqlrc", "--dbname", url, "-v", "ON_ERROR_STOP=1"]
    if tuples:
        cmd += ["-At", "-F", "\t"]
    if quiet:
        cmd += ["-q"]
    cmd += ["-c", sql]
    env = {**os.environ, "PSQL_HISTORY": "/dev/null"}
    result = subprocess.run(cmd, check=True, capture_output=True, env=env)
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
    for line in psql(url, sql, tuples=True).decode().splitlines():
        if not line:
            continue
        name, arr = line.split("\t", 1)
        rows[name] = parse_array(arr)
    return rows

if not re.fullmatch(r"[0-9T:+\- ]{10,40}", cutover):
    raise SystemExit("CUTOVER_TS 格式不像 ISO-8601，已拒絕")

new_cols = load_map(new_url, cols_sql)
old_cols = load_map(old_url, cols_sql)
pks = load_map(new_url, pk_sql)

timestamp_tables = []
no_ts = []
skipped = []
for table, cols in sorted(new_cols.items()):
    if table in skip_tables:
        skipped.append(table)
        continue
    if table not in old_cols:
        continue
    ts = [c for c in ("updated_at", "created_at", "applied_at", "occurred_at", "submitted_at") if c in cols]
    if ts:
        timestamp_tables.append((table, cols, pks.get(table, []), ts[0]))
    else:
        no_ts.append(table)

report_path = os.path.join(workdir, "delta-report.json")
if apply == "yes":
    if not os.path.isfile(report_path):
        raise SystemExit("找不到乾跑 delta-report.json。請先不要設 APPLY_DELTA，確認報告後再套用。")
    previous = json.loads(open(report_path, encoding="utf-8").read())
    if previous.get("cutover") != cutover:
        raise SystemExit("乾跑報告的 CUTOVER_TS 與這次不同，拒絕套用。")
    if previous.get("applied"):
        raise SystemExit("這份報告已經套用過。若要再跑，先刪除 delta-report.json 並重新乾跑。")

report = {
    "cutover": cutover,
    "tables": [],
    "no_timestamp": no_ts,
    "skipped": sorted(skipped),
    "applied": False,
}
failures = []
safe_ts = cutover.replace("'", "''")
env = {**os.environ, "PSQL_HISTORY": "/dev/null"}

for table, cols, pk, ts_col in timestamp_tables:
    ident_cols = ", ".join(f'"{c}"' for c in cols)
    count = int(
        psql(
            new_url,
            f'SELECT count(*) FROM public."{table}" WHERE "{ts_col}" >= TIMESTAMPTZ \'{safe_ts}\'',
            tuples=True,
        ).decode().strip()
        or "0"
    )
    entry = {"table": table, "timestamp_column": ts_col, "new_rows": count, "primary_key": pk}
    report["tables"].append(entry)
    if count == 0:
        continue
    if not pk:
        failures.append(f"{table} 有 {count} 列但沒有主鍵，拒絕自動寫入")
        continue
    if apply != "yes":
        continue

    conflict = ", ".join(f'"{c}"' for c in pk)
    updates = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in cols if c not in pk)
    copy_sql = (
        f'COPY (SELECT {ident_cols} FROM public."{table}" '
        f'WHERE "{ts_col}" >= TIMESTAMPTZ \'{safe_ts}\') '
        f"TO STDOUT WITH (FORMAT csv, HEADER false, FORCE_QUOTE *)"
    )
    copied = subprocess.run(
        ["psql", "--no-psqlrc", "--dbname", new_url, "-v", "ON_ERROR_STOP=1", "-At", "-q", "-c", copy_sql],
        check=True, capture_output=True, env=env,
    )
    payload = copied.stdout
    if payload.endswith(b"COPY ") or b"\nCOPY " in payload:
        raise SystemExit(f"{table} 的 COPY 輸出含命令標籤，拒絕寫入以免污染資料")
    csv_path = os.path.join(workdir, f"{table}.csv")
    open(csv_path, "wb").write(payload)
    set_clause = updates if updates else f'"{pk[0]}" = EXCLUDED."{pk[0]}"'
    insert = f"""
BEGIN;
CREATE TEMP TABLE delta_src (LIKE public."{table}");
COPY delta_src ({ident_cols}) FROM STDIN WITH (FORMAT csv, HEADER false);
INSERT INTO public."{table}" ({ident_cols})
SELECT {ident_cols} FROM delta_src
ON CONFLICT ({conflict}) DO UPDATE SET {set_clause};
COMMIT;
"""
    result = subprocess.run(
        ["psql", "--no-psqlrc", "--dbname", old_url, "-v", "ON_ERROR_STOP=1", "-c", insert],
        input=payload,
        env=env,
        capture_output=True,
    )
    if result.returncode != 0:
        failures.append(f"{table} 寫入失敗：{(result.stderr or b'').decode(errors='replace').strip()}")
        # 這張表的 BEGIN 會因 ON_ERROR_STOP 中止而 rollback；不要繼續後面的表。
        break
    entry["applied_bytes"] = len(payload)

if apply == "yes" and not failures:
    report["applied"] = True
open(report_path, "w", encoding="utf-8").write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(f"有時間欄的表 {len(timestamp_tables)}，CUTOVER 之後有列的：{sum(1 for t in report['tables'] if t['new_rows'])}")
print(f"沒有時間欄、需人工看的表：{len(no_ts)}")
print(f"略過的表：{', '.join(sorted(skipped)) or '（無）'}")
if no_ts:
    print("no_timestamp：", ", ".join(no_ts[:30]))
if failures:
    print("\n".join(failures))
    sys.exit(1)
if apply != "yes":
    print("乾跑結束。確認 delta-report.json 後設 APPLY_DELTA=yes 再跑一次。")
    print("注意：這不會重放 DELETE，也不保證 FK 順序。補完後請再核對列數。")
PY
