"""Shared validation and redacted PostgreSQL execution for the migration tools."""

import hashlib
import ipaddress
import json
import os
import re
import subprocess
import sys
from urllib.parse import parse_qsl, quote, unquote, urlsplit


class SafetyError(Exception):
    pass


def database_url(value, *, allow_local=True):
    if not value or value != value.strip() or re.search(r"\s|[\x00-\x1f\x7f]", value):
        raise SafetyError("資料庫 URL 不可為空或包含未編碼空白／控制字元")
    if re.search(r"%(?![0-9A-Fa-f]{2})", value):
        raise SafetyError("資料庫 URL 的百分比編碼無效")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        port = parsed.port if parsed.port is not None else 5432
        user = unquote(parsed.username or "")
        password = unquote(parsed.password or "")
        name = unquote(parsed.path.removeprefix("/"))
        query = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except (ValueError, UnicodeError):
        raise SafetyError("資料庫 URL 格式無效") from None
    if parsed.scheme not in {"postgres", "postgresql"} or not host or not user or not name:
        raise SafetyError("資料庫 URL 必須包含 PostgreSQL scheme、host、使用者與資料庫名稱")
    if port < 1 or parsed.fragment or "/" in name or any(ord(c) < 32 or ord(c) == 127 for c in user + password + name):
        raise SafetyError("資料庫 URL 的資料庫名稱或認證欄位無效")
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = host.lower() == "localhost"
        if len(host) > 253 or any(not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in host.rstrip(".").split(".")):
            raise SafetyError("資料庫 host 格式無效") from None
    if not allow_local and local:
        raise SafetyError("拒絕將本機資料庫寫入 Fly secrets")
    if re.search(r"-pooler(?:\.|$)|(?:^|\.)pooler\.", host, re.I):
        raise SafetyError("請使用直連資料庫 host，不可使用 pooler")
    options = {}
    allowed = {"sslmode", "channel_binding", "connect_timeout", "application_name"}
    for key, item in query:
        if key in options or key not in allowed or not item or re.search(r"[\x00-\x1f\x7f]", item):
            raise SafetyError("資料庫 URL 有重複、空白或不支援的連線參數")
        options[key] = item
    if not local and options.get("sslmode") not in {"require", "verify-full", "verify-ca"}:
        raise SafetyError("遠端資料庫 URL 必須帶 sslmode=require 或更嚴格的設定")
    if options.get("sslmode", "prefer") not in {"disable", "allow", "prefer", "require", "verify-full", "verify-ca"}:
        raise SafetyError("sslmode 設定無效")
    if not local and not password:
        raise SafetyError("遠端資料庫 URL 必須包含密碼")
    if options.get("channel_binding", "prefer") not in {"disable", "prefer", "require"}:
        raise SafetyError("channel_binding 設定無效")
    if "connect_timeout" in options and not re.fullmatch(r"[0-9]+", options["connect_timeout"]):
        raise SafetyError("connect_timeout 必須是非負整數")
    return {"host": host.lower(), "port": port, "user": user, "password": password,
            "database": name, "options": options}


def database_identity(value):
    parsed = database_url(value)
    return {key: parsed[key] for key in ("host", "port", "database", "user")}


def target_digest(value):
    return hashlib.sha256(json.dumps(database_identity(value), sort_keys=True).encode()).hexdigest()


def postgres_env(value):
    parsed = database_url(value)
    # Do not let a local PGSERVICE/PGHOSTADDR override the reviewed target.
    env = {key: val for key, val in os.environ.items() if not key.startswith("PG")}
    env.update({"PGHOST": parsed["host"], "PGPORT": str(parsed["port"]),
                "PGUSER": parsed["user"], "PGPASSWORD": parsed["password"],
                "PGDATABASE": parsed["database"], "PSQL_HISTORY": "/dev/null"})
    env.update({"PG" + key.upper(): val for key, val in parsed["options"].items()})
    return env


def redact(value, url, secrets=()):
    text = value.decode(errors="replace") if isinstance(value, bytes) else str(value or "")
    for secret in (url, database_url(url)["password"], *secrets):
        if secret:
            for variant in sorted({secret, secret.replace("'", "''"), quote(secret, safe="")}, key=len, reverse=True):
                text = text.replace(variant, "[redacted]")
    return re.sub(r"postgres(?:ql)?://[^\s'\"]+", "[database URL redacted]", text)


def postgres(url, args, *, input=None, check=True, text=True, secrets=()):
    """Capture output without putting the connection string in argv or exceptions."""
    result = subprocess.run(["psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", *args],
                            env=postgres_env(url), input=input, capture_output=True, text=text)
    if result.returncode and check:
        error = redact(result.stderr, url, secrets)
        raise SafetyError(f"psql 失敗（exit {result.returncode}）：{error}")
    return result


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def ensure_web_role(url, role, password):
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role) or not password or re.search(r"[\x00-\x1f\x7f]", password):
        raise SafetyError("WEB_ROLE_NAME 或 WEB_ROLE_PASSWORD 無效")
    exists = postgres(url, ["-At", "-c", "SELECT CASE WHEN count(*) = 0 THEN 0 WHEN bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN 1 ELSE 2 END FROM pg_roles WHERE rolname = " + literal(role)]).stdout.strip()
    if exists == "0":
        # SQL is sent on stdin; %I/%L belong to PostgreSQL format, not Python.
        # Avoid a DO dollar-quoted body: passwords may themselves contain '$$'.
        statement = (
            "SET standard_conforming_strings = on;\n"
            f"SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', {literal(role)}, {literal(password)})\\gexec\n"
        )
        postgres(url, [], input=statement, secrets=(password,))
        return True
    if exists != "1":
        raise SafetyError("既有 web role 必須可登入且沒有 superuser／角色管理／資料庫管理／複寫／BYPASSRLS 權限")
    return False


def validate_fly_secrets(contents, app, apply):
    expected = {"nuni-api": "DATABASE_URL", "nuni-web": "ASSIGNMENT_FILE_DATABASE_URL"}.get(app)
    if expected is None:
        raise SafetyError("APP 只能是 nuni-api 或 nuni-web")
    found = set()
    for raw in contents.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if "=" not in raw:
            raise SafetyError("stdin 必須是 KEY=VALUE；已省略內容")
        key, value = raw.split("=", 1)
        if key != expected or key in found:
            raise SafetyError("stdin 包含未預期或重複的 secret 鍵")
        found.add(key)
        parsed = database_url(value, allow_local=not apply)
        if parsed["password"].lower() in {"changeme", "password", "secret"}:
            raise SafetyError("拒絕使用預設資料庫密碼")
    if found != {expected}:
        raise SafetyError("stdin 缺少此 app 必須的資料庫 secret")
    return expected


def main():
    try:
        action = sys.argv[1]
        if action == "validate":
            database_url(os.environ["NEON_MIGRATION_DATABASE_URL"])
        elif action == "host":
            print(database_url(os.environ["NEON_MIGRATION_DATABASE_URL"])["host"])
        elif action == "role":
            created = ensure_web_role(os.environ["NEON_MIGRATION_DATABASE_URL"],
                                      os.environ["WEB_ROLE_NAME"], os.environ["WEB_ROLE_PASSWORD"])
            print("web role created" if created else "web role already exists", file=sys.stderr)
        elif action == "fly":
            with open(sys.argv[2], encoding="utf-8") as file:
                key = validate_fly_secrets(file.read(), sys.argv[3], sys.argv[4] == "yes")
            print("stdin 通過檢查；鍵名：" + key)
        elif action == "pg":
            url = os.environ["NEON_MIGRATION_DATABASE_URL"]
            binary, *args = sys.argv[2:]
            if binary not in {"psql", "pg_dump", "pg_restore"}:
                raise SafetyError("不支援的 PostgreSQL 工具")
            if binary == "pg_restore":
                # Select restore-to-database mode; libpq fills the empty value
                # from PGDATABASE. The URL/password never appears in argv.
                args = ["--dbname", "", *args]
            result = subprocess.run([binary, *args], env=postgres_env(url), stderr=subprocess.PIPE)
            if result.stderr:
                sys.stderr.write(redact(result.stderr, url))
            return result.returncode
        else:
            raise SafetyError("不支援的操作")
    except (SafetyError, KeyError, IndexError, OSError) as exc:
        message = str(exc) if isinstance(exc, SafetyError) else type(exc).__name__
        print("錯誤：" + message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
