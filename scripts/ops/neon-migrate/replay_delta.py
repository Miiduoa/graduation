import os, json, sys, re
from datetime import datetime
from pathlib import Path
from safety import SafetyError, postgres, database_identity, redact

def main():
    new_url, old_url, cutover, workdir, apply = (os.environ[name] for name in ("NEW_DATABASE_URL", "OLD_DATABASE_URL", "CUTOVER_TS", "WORKDIR", "APPLY_DELTA"))
    skip_tables = {"schema_migrations"} | {t.strip() for t in os.environ.get("SKIP_TABLES", "").split(",") if t.strip()}
    binding = {"new_target": database_identity(new_url), "old_target": database_identity(old_url), "skip_tables": sorted(skip_tables)}
    if all(binding["new_target"][key] == binding["old_target"][key] for key in ("host", "port", "database")):
        raise SafetyError("新庫與舊庫不可相同")

    def psql(url, sql, tuples=False, quiet=False):
        args = []
        if tuples:
            args += ["-At", "-F", "\t"]
        if quiet:
            args += ["-q"]
        return postgres(url, [*args, "-c", sql], text=False).stdout


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

    try:
        parsed_cutover = datetime.fromisoformat(cutover.replace("Z", "+00:00"))
    except ValueError:
        raise SafetyError("CUTOVER_TS 必須是有效 ISO-8601 時間") from None
    if parsed_cutover.tzinfo is None:
        raise SafetyError("CUTOVER_TS 必須包含時區")

    new_cols = load_map(new_url, cols_sql)
    old_cols = load_map(old_url, cols_sql)
    pks = load_map(new_url, pk_sql)

    timestamp_tables = []
    no_ts = []
    skipped = []
    for table, cols in sorted(new_cols.items()):
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", table) or any(not re.fullmatch(r"[a-z_][a-z0-9_]*", col) for col in cols):
            raise SafetyError("delta 只支援一般小寫識別字；特殊表／欄位名稱請人工處理")
        if table in skip_tables:
            skipped.append(table)
            continue
        if table not in old_cols or old_cols[table] != cols:
            raise SafetyError(f"{table} 在新舊庫的欄位不一致；禁止自動 delta")
        ts = [c for c in ("updated_at", "created_at", "applied_at", "occurred_at", "submitted_at") if c in cols]
        if ts:
            timestamp_tables.append((table, cols, pks.get(table, []), ts[0]))
        else:
            no_ts.append(table)

    report_path = os.path.join(workdir, "delta-report.json")
    if apply == "yes":
        if not os.path.isfile(report_path):
            raise SystemExit("找不到乾跑 delta-report.json。請先不要設 APPLY_DELTA，確認報告後再套用。")
        previous = json.loads(Path(report_path).read_text(encoding="utf-8"))
        if any(previous.get(key) != value for key, value in binding.items()):
            raise SafetyError("乾跑報告的新舊庫或跳過表設定與這次不同，拒絕套用")
        if previous.get("partially_applied"):
            raise SafetyError("先前 delta 部分成功，先人工核對再重新乾跑，不可直接重試")
        if previous.get("failures"):
            raise SafetyError("乾跑報告仍有失敗項，修正並重新乾跑後才能套用")
        if previous.get("cutover") != cutover:
            raise SystemExit("乾跑報告的 CUTOVER_TS 與這次不同，拒絕套用。")
        if previous.get("applied"):
            raise SystemExit("這份報告已經套用過。若要再跑，先刪除 delta-report.json 並重新乾跑。")

    report = {
        **binding,
        "cutover": cutover,
        "tables": [],
        "no_timestamp": no_ts,
        "skipped": sorted(skipped),
        "applied": False,
    }
    failures = []
    safe_ts = cutover.replace("'", "''")

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
        copied = postgres(new_url, ["-At", "-q", "-c", copy_sql], text=False)
        payload = copied.stdout
        if payload.endswith(b"COPY ") or b"\nCOPY " in payload:
            raise SystemExit(f"{table} 的 COPY 輸出含命令標籤，拒絕寫入以免污染資料")
        csv_path = os.path.join(workdir, f"{table}.csv")
        Path(csv_path).write_bytes(payload)
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
        result = postgres(old_url, ["-c", insert], input=payload, text=False, check=False)
        if result.returncode != 0:
            failures.append(f"{table} 寫入失敗：{redact(result.stderr, old_url).strip()}")
            # 這張表的 BEGIN 會因 ON_ERROR_STOP 中止而 rollback；不要繼續後面的表。
            break
        entry["applied_bytes"] = len(payload)

    if apply == "yes" and not failures:
        report["applied"] = True
    report["failures"] = failures
    report["partially_applied"] = bool(failures and any("applied_bytes" in entry for entry in report["tables"]))
    Path(report_path).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
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


if __name__ == "__main__":
    try:
        main()
    except (SafetyError, OSError, ValueError, KeyError) as exc:
        message = str(exc) if isinstance(exc, SafetyError) else type(exc).__name__
        print("錯誤：" + message, file=sys.stderr)
        sys.exit(1)
