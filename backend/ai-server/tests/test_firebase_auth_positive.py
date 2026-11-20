"""Positive Firebase ID-token acceptance via real firebase_admin.verify_id_token.

Cloud lock must include firebase-admin. Only the Google X.509 certificate HTTP
fetch boundary is mocked — no ADC/service-account files, no provider/LLM calls,
no production credentials. Ephemeral RSA + self-signed cert stay in memory.
"""

from __future__ import annotations

import datetime as dt
import importlib
import json
import os
import socket
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from google.auth import crypt, jwt, transport

AI_SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVER_ROOT))

TEST_PROJECT_ID = "campus-one-auth-test"
TEST_KID = "test-key-id-1"
TEST_UID = "uid-positive-auth-user"
CERT_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)

_CLOUD_ENV = {
    "ENABLE_RAG": "false",
    "ENABLE_WEB_SEARCH": "false",
    "ENABLE_SELF_TRAIN_LOOP": "false",
    "ENABLE_REFLEXION": "false",
    "LLM_PROVIDER": "groq",
    "REQUIRE_FIREBASE_AUTH": "true",
    "AI_SERVER_HOST": "127.0.0.1",
    "AI_ALLOWED_ORIGINS": "http://127.0.0.1:3000",
    "OPENAI_COMPAT_API_KEY": "",
    "GROQ_API_KEY": "",
    "TOGETHER_API_KEY": "",
    # Force Certificate path unused; tests pre-init the default app in-memory.
    "FIREBASE_CRED_PATH": "",
}


def _purge_app_modules() -> None:
    for name in list(sys.modules):
        if name == "config" or name == "server" or name.startswith(
            ("rag.", "self_training.", "tools.", "prompts.", "training.")
        ):
            sys.modules.pop(name, None)
        if name in {
            "rag",
            "self_training",
            "tools",
            "prompts",
            "training",
            "llm_client",
            "tool_planner",
            "reflexion",
            "web_search",
        }:
            sys.modules.pop(name, None)


class _MockResponse(transport.Response):
    def __init__(self, status: int, body: str) -> None:
        self._status = status
        self._body = body

    @property
    def status(self) -> int:
        return self._status

    @property
    def headers(self) -> dict:
        return {}

    @property
    def data(self) -> bytes:
        return self._body.encode()


class _MockCertFetchRequest(transport.Request):
    """Stand-in for CertificateFetchRequest — records URLs, never opens sockets."""

    def __init__(self, status: int, body: str) -> None:
        self._response = _MockResponse(status, body)
        self.log: list[str] = []

    def __call__(
        self,
        url,
        method="GET",
        body=None,
        headers=None,
        timeout=None,
        **kwargs,
    ):
        self.log.append(str(url))
        return self._response


def _ephemeral_rsa_and_cert() -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "TW"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "CampusOneAuthTest"),
            x509.NameAttribute(NameOID.COMMON_NAME, "firebase-auth-test"),
        ]
    )
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    return private_pem, cert_pem


def _service_account_dict(private_pem: str) -> dict:
    return {
        "type": "service_account",
        "project_id": TEST_PROJECT_ID,
        "private_key_id": TEST_KID,
        "private_key": private_pem,
        "client_email": (
            f"firebase-adminsdk-test@{TEST_PROJECT_ID}.iam.gserviceaccount.com"
        ),
        "client_id": "100000000000000000001",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }


def _encode_id_token(
    private_pem: str,
    *,
    aud: str = TEST_PROJECT_ID,
    uid: str = TEST_UID,
    iat: int | None = None,
    exp: int | None = None,
    kid: str = TEST_KID,
) -> str:
    now = int(time.time())
    iat = now - 10 if iat is None else iat
    exp = now + 3600 if exp is None else exp
    signer = crypt.RSASigner.from_string(private_pem.encode())
    payload = {
        "aud": aud,
        "iss": f"https://securetoken.google.com/{aud}",
        "iat": iat,
        "exp": exp,
        "sub": uid,
        "user_id": uid,
        "auth_time": iat,
    }
    token = jwt.encode(signer, payload, header={"kid": kid, "alg": "RS256"})
    return token.decode() if isinstance(token, bytes) else token


class FirebaseAuthPositiveTests(unittest.TestCase):
    """HTTP auth through require_firebase_user with the real Admin SDK verifier."""

    @classmethod
    def setUpClass(cls) -> None:
        _purge_app_modules()
        cls._env_patch = mock.patch.dict(os.environ, _CLOUD_ENV, clear=False)
        cls._env_patch.start()

        import firebase_admin
        from firebase_admin import auth, credentials

        for app in list(firebase_admin._apps.values()):
            firebase_admin.delete_app(app)

        cls._firebase_admin = firebase_admin
        cls._auth = auth
        cls._private_pem, cls._cert_pem = _ephemeral_rsa_and_cert()
        cls._wrong_private_pem, _ = _ephemeral_rsa_and_cert()
        cls._sa = _service_account_dict(cls._private_pem)
        cls._app = firebase_admin.initialize_app(credentials.Certificate(cls._sa))

        certs_body = json.dumps({TEST_KID: cls._cert_pem})
        cls._cert_fetch = _MockCertFetchRequest(200, certs_body)
        client = auth._get_client(cls._app)
        cls._original_cert_request = client._token_verifier.request
        client._token_verifier.request = cls._cert_fetch

        # Fail closed on any real TCP connect during these tests.
        cls._real_create_connection = socket.create_connection

        def _no_network(*args, **kwargs):
            raise AssertionError(f"unexpected network connect: args={args!r}")

        socket.create_connection = _no_network  # type: ignore[assignment]

        import config as config_mod

        importlib.reload(config_mod)
        import server as server_mod

        importlib.reload(server_mod)
        cls.config = config_mod
        cls.server = server_mod

        # Prove product handler wires the real SDK entry (not a test stub).
        assert server_mod.require_firebase_user is not None
        assert auth.verify_id_token is cls._auth.verify_id_token

        from fastapi import Depends
        from fastapi.testclient import TestClient

        @server_mod.app.get("/__test__/firebase-user")
        async def _firebase_user_echo(
            user: dict = Depends(server_mod.require_firebase_user),
        ):
            return {"uid": user.get("uid"), "sub": user.get("sub")}

        cls.client_cm = TestClient(server_mod.app)
        cls.client = cls.client_cm.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_cm.__exit__(None, None, None)
        socket.create_connection = cls._real_create_connection  # type: ignore[assignment]
        try:
            client = cls._auth._get_client(cls._app)
            client._token_verifier.request = cls._original_cert_request
        except Exception:
            pass
        for app in list(cls._firebase_admin._apps.values()):
            cls._firebase_admin.delete_app(app)
        # Drop ephemeral key material from class attrs.
        cls._private_pem = ""
        cls._wrong_private_pem = ""
        cls._cert_pem = ""
        cls._sa = {}
        cls._env_patch.stop()
        _purge_app_modules()

    def setUp(self) -> None:
        self._cert_fetch.log.clear()

    def _bearer(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def test_cloud_lock_exposes_firebase_admin(self) -> None:
        import firebase_admin

        self.assertTrue(hasattr(firebase_admin, "initialize_app"))
        self.assertEqual(firebase_admin.__name__, "firebase_admin")

    def test_public_auth_startup_allows_bind_when_sdk_present(self) -> None:
        # Same contract as Docker/Render: public bind + REQUIRE_FIREBASE_AUTH.
        self.config.assert_bind_allowed("0.0.0.0", require_firebase_auth=True)
        import firebase_admin

        self.assertTrue(bool(firebase_admin._apps))

    def test_valid_token_returns_uid_over_http(self) -> None:
        token = _encode_id_token(self._private_pem)
        response = self.client.get(
            "/__test__/firebase-user",
            headers=self._bearer(token),
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body.get("uid"), TEST_UID)
        self.assertEqual(body.get("sub"), TEST_UID)
        self.assertIn(CERT_URL, self._cert_fetch.log)
        self.assertGreaterEqual(len(self._cert_fetch.log), 1)

    def test_valid_token_existing_protected_route_continues(self) -> None:
        token = _encode_id_token(self._private_pem)

        async def _fake_chat(req):
            return {
                "content": "auth-ok",
                "suggestions": [],
                "provider": "groq",
            }

        with mock.patch.object(self.server, "_chat_response", side_effect=_fake_chat):
            response = self.client.post(
                "/api/chat/sync",
                headers=self._bearer(token),
                json={"message": "ping", "stream": False},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json().get("content"), "auth-ok")
        self.assertIn(CERT_URL, self._cert_fetch.log)

    def test_missing_bearer_still_401(self) -> None:
        response = self.client.get("/__test__/firebase-user")
        self.assertEqual(response.status_code, 401)

    def test_invalid_signature_401(self) -> None:
        token = _encode_id_token(self._wrong_private_pem)
        response = self.client.get(
            "/__test__/firebase-user",
            headers=self._bearer(token),
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("Invalid Firebase token", response.json().get("detail", ""))

    def test_wrong_audience_401(self) -> None:
        token = _encode_id_token(self._private_pem, aud="wrong-project-id")
        response = self.client.get(
            "/__test__/firebase-user",
            headers=self._bearer(token),
        )
        self.assertEqual(response.status_code, 401)

    def test_expired_token_401(self) -> None:
        now = int(time.time())
        token = _encode_id_token(
            self._private_pem,
            iat=now - 10_000,
            exp=now - 3_600,
        )
        response = self.client.get(
            "/__test__/firebase-user",
            headers=self._bearer(token),
        )
        self.assertEqual(response.status_code, 401)

    def test_cert_fetch_boundary_mocked_not_verify_id_token(self) -> None:
        """Guard: SDK verify_id_token stays real; only cert HTTP is stubbed."""
        from firebase_admin import auth as auth_mod

        self.assertIs(auth_mod.verify_id_token, self._auth.verify_id_token)
        self.assertIsInstance(self._cert_fetch, _MockCertFetchRequest)
        token = _encode_id_token(self._private_pem)
        # Direct SDK call (same path require_firebase_user uses).
        claims = auth_mod.verify_id_token(token)
        self.assertEqual(claims["uid"], TEST_UID)
        self.assertTrue(all(u.startswith("https://www.googleapis.com/") for u in self._cert_fetch.log))


if __name__ == "__main__":
    unittest.main()
