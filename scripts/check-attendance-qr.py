#!/usr/bin/env python3
"""Compare the actual TS QR encoder with python-qrcode and decode via OpenCV.
Optional development tools only: qrcode, numpy, opencv-python. No network or uploads.
Usage: python3 scripts/check-attendance-qr.py /absolute/path/attendanceQr.ts
"""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import cv2
import numpy as np
import qrcode

module = Path(sys.argv[1]).resolve()
tokens = ['A' * 32, 'z' * 32, '0123456789abcdef' * 2, '-_' * 16]
# These are reproducible synthetic test vectors, not secrets.
alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
for n in range(60):
    digest = hashlib.sha256(('attendance-vector-' + str(n)).encode()).digest()
    tokens.append(''.join(alphabet[b & 63] for b in digest))
script = "const fs=require('node:fs'); const {attendanceQr}=require(process.argv[1]); console.log(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(attendanceQr)));"
process = subprocess.run(['node', '--experimental-strip-types', '-e', script, str(module)], input=json.dumps(tokens), text=True, capture_output=True, check=True)
matrices = json.loads(process.stdout)
for token, matrix in zip(tokens, matrices, strict=True):
    qr = qrcode.QRCode(version=3, error_correction=qrcode.constants.ERROR_CORRECT_M, mask_pattern=0, border=0)
    qr.add_data(qrcode.util.QRData(token, mode=qrcode.util.MODE_8BIT_BYTE), optimize=0)
    qr.make(fit=False)
    if matrix != qr.get_matrix():
        raise AssertionError('Reference matrix mismatch')
    pixels = np.repeat(np.repeat((1 - np.pad(np.array(matrix, dtype=np.uint8), 4)) * 255, 6, axis=0), 6, axis=1)
    decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(pixels)
    if decoded != token:
        raise AssertionError('Decoder mismatch')
print(json.dumps({'cases':len(tokens), 'reference_matches':len(tokens), 'decoded_exactly':len(tokens),
  'qrcode_version':importlib.metadata.version('qrcode'), 'opencv_version':cv2.__version__,
  'scope':'Rendered matrices at six pixels/module with four-module quiet zone; not a phone-camera test'}, indent=2))
