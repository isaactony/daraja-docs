"""Tests every Python example in the docs. Run: pytest -q

Unit tests use the official sample payloads from the Daraja 3.0 docs.
End-to-end tests start the local mock in ../mock-daraja (needs Node.js 18+), not Safaricom's sandbox.
"""
import json
import os
import queue
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
import requests

import daraja

PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919"
OFFICIAL_PASSWORD = (
    "MTc0Mzc5YmZiMjc5ZjlhYTliZGJjZjE1OGU5N2RkNzFhNDY3Y2QyZTBjODkzMDU5YjEwZjc4ZTZiNzJhZGEx"
    "ZWQyYzkxOTIwMjEwNjI4MDkyNDA4"
)


def test_stk_password_reproduces_the_official_sample():
    assert daraja.stk_password("174379", PASSKEY, "20210628092408") == OFFICIAL_PASSWORD


def test_timestamp_is_kenya_time():
    assert daraja.timestamp(datetime(2026, 11, 13, 21, 30, 5, tzinfo=timezone.utc)) == "20261114003005"


@pytest.mark.parametrize("value", ["0712345678", "+254712345678", "254712345678", "712345678"])
def test_normalize_phone(value):
    assert daraja.normalize_phone(value) == "254712345678"


def test_normalize_phone_rejects_bad_numbers():
    with pytest.raises(ValueError):
        daraja.normalize_phone("0812345678")


def test_parse_official_success_callback():
    payment = daraja.parse_stk_callback({"Body": {"stkCallback": {
        "MerchantRequestID": "29115-34620561-1",
        "CheckoutRequestID": "ws_CO_191220191020363925",
        "ResultCode": 0,
        "ResultDesc": "The service request is processed successfully.",
        "CallbackMetadata": {"Item": [
            {"Name": "Amount", "Value": 1.0},
            {"Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV"},
            {"Name": "TransactionDate", "Value": 20191219102115},
            {"Name": "PhoneNumber", "Value": 254708374149},
        ]},
    }}})
    assert payment["paid"] is True
    assert payment["receipt"] == "NLJ7RT61SV"
    assert payment["transaction_date"] == "20191219102115"


def test_parse_official_cancelled_callback():
    payment = daraja.parse_stk_callback({"Body": {"stkCallback": {
        "MerchantRequestID": "f1e2-4b95-a71d-b30d3cdbb7a7942864",
        "CheckoutRequestID": "ws_CO_21072024125243250722943992",
        "ResultCode": 1032,
        "ResultDesc": "Request cancelled by user",
    }}})
    assert payment["paid"] is False
    assert payment["result_code"] == 1032
    assert payment["receipt"] is None


def test_security_credential_round_trip():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    import base64

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    credential = daraja.security_credential("Safaricom999!*!", pem)
    assert key.decrypt(base64.b64decode(credential), padding.PKCS1v15()) == b"Safaricom999!*!"


# ---- End-to-end against the mock ----

def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def env():
    port = _free_port()
    mock = subprocess.Popen(
        ["node", str(Path(__file__).parent.parent / "mock-daraja" / "server.js")],
        env={**os.environ, "PORT": str(port)}, stdout=subprocess.PIPE, text=True)
    mock.stdout.readline()  # Wait for "listening".

    received = queue.Queue()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ResultCode": 0, "ResultDesc": "Accepted"}).encode())
            if self.path == "/payments/stk-callback":
                received.put(daraja.parse_stk_callback(body))
            elif self.path == "/payments/b2c/result":
                received.put(daraja.parse_result(body))

        def log_message(self, *args):
            pass

    callbacks = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=callbacks.serve_forever, daemon=True).start()
    cb = f"http://localhost:{callbacks.server_address[1]}"

    os.environ.update(
        DARAJA_BASE_URL=f"http://localhost:{port}",
        DARAJA_CONSUMER_KEY="mock-consumer-key",
        DARAJA_CONSUMER_SECRET="mock-consumer-secret",
        DARAJA_SHORTCODE="174379",
        DARAJA_PASSKEY=PASSKEY,
        DARAJA_CALLBACK_URL=f"{cb}/payments/stk-callback",
        DARAJA_RESULT_URL=f"{cb}/payments/b2c/result",
        DARAJA_TIMEOUT_URL=f"{cb}/payments/b2c/timeout",
    )
    daraja.clear_token_cache()
    yield received
    callbacks.shutdown()
    mock.terminate()


def test_stk_push_callback_and_query(env):
    ack = daraja.stk_push(1, "0712345678", "INV-2001")
    assert ack["ResponseCode"] == "0"
    payment = env.get(timeout=5)
    assert payment["paid"] and payment["checkout_request_id"] == ack["CheckoutRequestID"]
    assert daraja.stk_query(ack["CheckoutRequestID"])["ResultCode"] == "0"


def test_cancelled_push(env):
    daraja.stk_push(1032, "0722000011", "INV-2002")
    assert env.get(timeout=5)["result_code"] == 1032


def test_wrong_passkey(env):
    with pytest.raises(daraja.DarajaError) as err:
        daraja.stk_push(1, "0722000012", "X", passkey="wrong")
    assert err.value.error_code == "500.001.1001"
    assert err.value.body["errorMessage"] == "Wrong credentials"


def test_b2c_with_security_credential(env):
    pem = requests.get(f"{os.environ['DARAJA_BASE_URL']}/mock/certificate", timeout=5).text
    ack = daraja.b2c_payment(
        10, "0712345678", f"py-{time.time()}", shortcode="600999", initiator_name="testapi",
        credential=daraja.security_credential("Safaricom999!*!", pem), occasion="Refund")
    assert ack["ResponseCode"] == "0"
    result = env.get(timeout=5)
    assert result["ok"] and result["parameters"]["TransactionAmount"] == 10
