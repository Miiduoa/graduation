#!/usr/bin/env bash
# Generate a temporary test CA + leaf cert for synthetic campus-api / Google token TLS.
# Writes only under the caller-provided directory (owned scratch). Not real keys.
set -euo pipefail
OUT="${1:?usage: gen-test-certs.sh <output-dir>}"
mkdir -p "$OUT"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$OUT/ca.key" -out "$OUT/ca.pem" -days 1 \
  -subj "/CN=nuni-legacy-test-ca" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes \
  -keyout "$OUT/server.key" -out "$OUT/server.csr" \
  -subj "/CN=campus-api.test" >/dev/null 2>&1
cat >"$OUT/server.ext" <<'EOF'
subjectAltName=DNS:campus-api.test,DNS:oauth2.googleapis.com,DNS:legacy.test
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca.pem" -CAkey "$OUT/ca.key" \
  -CAcreateserial -out "$OUT/server.pem" -days 1 -extfile "$OUT/server.ext" >/dev/null 2>&1
rm -f "$OUT/server.csr" "$OUT/server.ext" "$OUT/ca.srl"
# Readable by Docker bind-mount consumers (Colima may map host uid differently).
chmod 644 "$OUT"/*.key "$OUT"/*.pem
echo "$OUT"
