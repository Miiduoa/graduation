"""Two-phase QA cleanup with a target-bound receipt and exact Storage paths."""

import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from safety import SafetyError, database_identity, postgres

BUCKET = "assignment-submissions"
PREFIX = "cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2/cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1/"
SQL_PATH = Path(__file__).with_name("qa-cleanup.sql")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_write(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Storage:
    def __init__(self, base, key, requester=None):
        try:
            parsed = urlsplit(base)
            port = parsed.port
        except ValueError:
            raise SafetyError("SUPABASE_URL 格式無效") from None
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in {"", "/"} or not key or port == 0
                or (parsed.scheme != "https" and not (parsed.scheme == "http" and local))):
            raise SafetyError("SUPABASE_URL 必須是 HTTPS origin；只有本機測試可用 HTTP")
        self.base, self.key = base.rstrip("/"), key
        self.requester = requester

    def target(self):
        return {"origin": self.base, "bucket": BUCKET, "prefix": PREFIX}

    def request(self, method, action, payload):
        if self.requester:
            return self.requester(method, action, payload)
        req = urllib.request.Request(
            self.base + "/storage/v1/object/" + action,
            data=json.dumps(payload).encode(), method=method,
            headers={"Authorization": "Bearer " + self.key, "apikey": self.key,
                     "Content-Type": "application/json"},
        )
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
                return json.load(response)
        except (urllib.error.URLError, OSError, ValueError):
            # Never print a request, headers, response body, or service key.
            raise SafetyError("Storage 請求失敗；保留 receipt，檢查服務後重試") from None

    def list(self):
        files, visited = {}, set()

        def walk(prefix, depth=0):
            if depth > 20 or prefix in visited:
                raise SafetyError("Storage 目錄層次或重複目錄不合理，停止清理")
            visited.add(prefix)
            offset, names = 0, set()
            while True:
                page = self.request("POST", "list/" + BUCKET, {
                    "prefix": prefix.rstrip("/"), "limit": 100, "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                })
                if not isinstance(page, list) or len(page) > 100:
                    raise SafetyError("Storage list 回應格式無效")
                for item in page:
                    name = item.get("name") if isinstance(item, dict) else None
                    if (not isinstance(name, str) or not name or name in {".", ".."}
                            or "/" in name or "\\" in name or re.search(r"[\x00-\x1f\x7f]", name)
                            or name in names):
                        raise SafetyError("Storage list 含不安全或重複的檔名")
                    names.add(name)
                    path = prefix + name
                    if item.get("id") is None and item.get("metadata") is None:
                        walk(path + "/", depth + 1)
                    elif isinstance(item.get("id"), str) and item["id"]:
                        files[path] = {"path": path, "id": item["id"],
                                       "updated_at": item.get("updated_at"),
                                       "metadata": item.get("metadata")}
                    else:
                        raise SafetyError("Storage 物件缺少可核對的 id")
                offset += len(page)
                if len(files) > 10000 or offset > 10000:
                    raise SafetyError("Storage 清理超過 10000 個項目，請人工核對範圍")
                if len(page) < 100:
                    break

        walk(PREFIX)
        return [files[path] for path in sorted(files)]

    def remove(self, paths):
        if any(not path.startswith(PREFIX) or path == PREFIX or path.endswith("/") for path in paths):
            raise SafetyError("拒絕刪除 QA 範圍外或資料夾前綴")
        # Supabase remove() expects full object paths, not a folder prefix.
        for start in range(0, len(paths), 100):
            result = self.request("DELETE", BUCKET, {"prefixes": paths[start:start + 100]})
            if not isinstance(result, list):
                raise SafetyError("Storage delete 回應格式無效；保留 receipt 供重試")


def validate_objects(current, reviewed, *, allow_missing=False):
    expected = {item["path"]: item for item in reviewed}
    actual = {item["path"]: item for item in current}
    if (not allow_missing and actual != expected) or any(expected.get(path) != item for path, item in actual.items()):
        raise SafetyError("Storage 檔案自 list 後已改變，停止；重新盤點並核對 receipt")


def run_sql(url, sql, apply, expected=""):
    if apply and not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise SafetyError("receipt 缺少有效 SQL 盤點指紋")
    transaction = "BEGIN ISOLATION LEVEL REPEATABLE READ;\n" + sql + ("\nCOMMIT;\n" if apply else "\nROLLBACK;\n")
    result = postgres(url, ["--set", "apply=" + ("1" if apply else "0"),
                            "--set", "expected_preview_digest=" + expected], input=transaction)
    matches = re.findall(r"^QA_PREVIEW_DIGEST ([0-9a-f]{64})$", result.stdout, re.M)
    if len(matches) != 1:
        raise SafetyError("SQL 盤點缺少唯一指紋，拒絕產生清理 receipt")
    return matches[0], result.stdout


def execute(mode, url, directory, receipt_path, storage=None, *, confirmed=False, writes_stopped=False):
    directory, receipt_path = Path(directory), Path(receipt_path)
    sql = SQL_PATH.read_text(encoding="utf-8")
    binding = {"version": 1, "database": database_identity(url), "sql_sha256": digest(sql.encode()),
               "storage": storage.target() if storage else None}
    if mode == "list":
        sql_digest, output = run_sql(url, sql, False)
        objects = storage.list() if storage else []
        receipt = {**binding, "stage": "reviewed", "preview_digest": sql_digest, "storage_objects": objects}
        private_write(directory / "qa-list.txt", output)
        private_write(receipt_path, json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
        print(f"list 完成：{len(objects)} 個 Storage 檔案；請核對 qa-list.txt 與 receipt。")
        if not storage:
            print("未設定 Storage：此 receipt 只處理 SQL，不代表附件已清除。")
        return receipt
    if mode != "apply" or not confirmed or not writes_stopped:
        raise SafetyError("apply 需要 CONFIRM=yes 與 CONFIRM_WRITES_STOPPED=yes，先暫停資料與附件寫入")
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise SafetyError("找不到有效 list receipt，請先 MODE=list") from None
    if not isinstance(receipt, dict) or any(receipt.get(key) != value for key, value in binding.items()):
        raise SafetyError("receipt 的資料庫、Storage 目標或 SQL 版本不符，拒絕套用")
    if receipt.get("stage") not in {"reviewed", "sql_applied", "completed"}:
        raise SafetyError("receipt 階段無效")
    if not isinstance(receipt.get("storage_objects"), list):
        raise SafetyError("receipt 缺少 Storage 盤點")
    if storage:
        current = storage.list()
        validate_objects(current, receipt["storage_objects"], allow_missing=receipt["stage"] != "reviewed")
    if receipt["stage"] == "completed":
        if storage and current:
            raise SafetyError("已完成的 receipt 之後又出現檔案，請重新盤點")
        print("此 receipt 已完成；未重複刪除。")
        return receipt
    if receipt["stage"] == "reviewed":
        _, output = run_sql(url, sql, True, receipt.get("preview_digest", ""))
        private_write(directory / "qa-apply.txt", output)
        receipt["stage"] = "sql_applied"
        private_write(receipt_path, json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    if storage:
        current = storage.list()
        validate_objects(current, receipt["storage_objects"], allow_missing=True)
        storage.remove([item["path"] for item in current])
        if storage.list():
            raise SafetyError("Storage 仍有檔案；SQL 已完成，保留 receipt 以重試剩餘檔案")
    receipt["stage"] = "completed"
    private_write(receipt_path, json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print("SQL 與已盤點的 Storage 檔案已清理並核對。" if storage else "SQL 清理完成；Storage 未設定，附件未處理。")
    return receipt


def main():
    try:
        directory = Path(os.environ["RECEIPT_DIR"])
        url, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if bool(url) != bool(key):
            raise SafetyError("SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 必須一起設定")
        storage = Storage(url, key) if url else None
        execute(os.environ["MODE"], os.environ["NEON_MIGRATION_DATABASE_URL"], directory,
                os.environ.get("RECEIPT", str(directory / "qa-list.receipt.json")), storage,
                confirmed=os.environ.get("CONFIRM") == "yes", writes_stopped=os.environ.get("CONFIRM_WRITES_STOPPED") == "yes")
    except (SafetyError, OSError, KeyError, TypeError, ValueError) as exc:
        message = str(exc) if isinstance(exc, SafetyError) else type(exc).__name__
        print("錯誤：" + message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
