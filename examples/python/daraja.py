"""Minimal M-Pesa Daraja client used throughout the docs. Python 3.9+.

Needs `requests`, plus `cryptography` only for security_credential().
"""
import base64
import os
import re
import time
from datetime import datetime, timedelta, timezone

import requests

HOSTS = {
    "sandbox": "https://sandbox.safaricom.co.ke",
    "production": "https://api.safaricom.co.ke",
}
EAT = timezone(timedelta(hours=3))


def base_url():
    return os.environ.get("DARAJA_BASE_URL") or HOSTS[os.environ.get("DARAJA_ENV", "sandbox")]


def timestamp(now=None):
    """YYYYMMDDHHmmss in Kenya time (EAT, UTC+3), whatever the server's time zone."""
    now = now or datetime.now(timezone.utc)
    return now.astimezone(EAT).strftime("%Y%m%d%H%M%S")


def stk_password(shortcode, passkey, ts):
    """Password = base64(BusinessShortCode + Passkey + Timestamp)."""
    return base64.b64encode(f"{shortcode}{passkey}{ts}".encode()).decode()


def normalize_phone(value):
    """Accepts 0712345678, +254712345678, 254712345678, or 712345678. Returns 254712345678."""
    digits = re.sub(r"\D", "", str(value))
    local = re.sub(r"^(254|0)", "", digits)
    if not re.fullmatch(r"[17]\d{8}", local):
        raise ValueError(f"Not a Kenyan mobile number: {value}")
    return f"254{local}"


class DarajaError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        self.error_code = body.get("errorCode")
        super().__init__(f"{self.error_code or status}: {body.get('errorMessage', body)}")


# Tokens last 3600 seconds. Keep one cached token per app and refresh it shortly before it expires;
# requesting a token per call wastes requests and can hit Daraja's rate limits.
_token = {"value": None, "expires_at": 0.0}


def get_token():
    if _token["value"] and time.time() < _token["expires_at"] - 60:
        return _token["value"]
    res = requests.get(
        f"{base_url()}/oauth/v1/generate",
        params={"grant_type": "client_credentials"},
        auth=(os.environ["DARAJA_CONSUMER_KEY"], os.environ["DARAJA_CONSUMER_SECRET"]),
        timeout=30,
    )
    body = _json(res)
    if not res.ok or "access_token" not in body:
        raise DarajaError(res.status_code, body)
    _token.update(value=body["access_token"], expires_at=time.time() + int(body["expires_in"]))
    return _token["value"]


def clear_token_cache():
    _token.update(value=None, expires_at=0.0)


def _json(res):
    try:
        return res.json()
    except ValueError:
        return {}


def _post(path, payload):
    res = requests.post(
        f"{base_url()}{path}",
        json=payload,
        headers={"Authorization": f"Bearer {get_token()}"},
        timeout=30,
    )
    body = _json(res)
    if not res.ok or "errorCode" in body:
        raise DarajaError(res.status_code, body)
    return body


def stk_push(amount, phone, account_reference, description="Payment",
             transaction_type="CustomerPayBillOnline", party_b=None,
             shortcode=None, passkey=None, callback_url=None):
    """Sends an M-Pesa Express (STK Push) prompt to the customer's phone.

    For a till, use transaction_type="CustomerBuyGoodsOnline" and pass the till number as party_b.
    """
    shortcode = shortcode or os.environ["DARAJA_SHORTCODE"]
    passkey = passkey or os.environ["DARAJA_PASSKEY"]
    ts = timestamp()
    msisdn = normalize_phone(phone)
    return _post("/mpesa/stkpush/v1/processrequest", {
        "BusinessShortCode": shortcode,
        "Password": stk_password(shortcode, passkey, ts),
        "Timestamp": ts,
        "TransactionType": transaction_type,
        "Amount": round(amount),
        "PartyA": msisdn,
        "PartyB": party_b or shortcode,
        "PhoneNumber": msisdn,
        "CallBackURL": callback_url or os.environ["DARAJA_CALLBACK_URL"],
        "AccountReference": str(account_reference)[:12],
        "TransactionDesc": description[:13],
    })


def stk_query(checkout_request_id, shortcode=None, passkey=None):
    """Asks M-Pesa for the result of an STK Push you started."""
    shortcode = shortcode or os.environ["DARAJA_SHORTCODE"]
    passkey = passkey or os.environ["DARAJA_PASSKEY"]
    ts = timestamp()
    return _post("/mpesa/stkpushquery/v1/query", {
        "BusinessShortCode": shortcode,
        "Password": stk_password(shortcode, passkey, ts),
        "Timestamp": ts,
        "CheckoutRequestID": checkout_request_id,
    })


def parse_stk_callback(body):
    """Turns the STK callback body into a flat dict. CallbackMetadata exists only when ResultCode is 0."""
    cb = (body or {}).get("Body", {}).get("stkCallback")
    if cb is None:
        raise ValueError("Not an STK callback: missing Body.stkCallback")
    items = {i["Name"]: i.get("Value") for i in cb.get("CallbackMetadata", {}).get("Item", [])}
    return {
        "paid": int(cb["ResultCode"]) == 0,
        "result_code": int(cb["ResultCode"]),
        "result_desc": cb.get("ResultDesc"),
        "merchant_request_id": cb.get("MerchantRequestID"),
        "checkout_request_id": cb.get("CheckoutRequestID"),
        "amount": items.get("Amount"),
        "receipt": items.get("MpesaReceiptNumber"),
        "transaction_date": str(items["TransactionDate"]) if "TransactionDate" in items else None,
        "phone": str(items["PhoneNumber"]) if "PhoneNumber" in items else None,
    }


def security_credential(initiator_password, certificate_pem):
    """RSA-encrypts the initiator password with M-Pesa's public key certificate.

    Uses PKCS #1 v1.5 padding (not OAEP), then base64-encodes the result.
    Accepts the portal's X.509 certificate or a bare public key, in PEM format.
    """
    from cryptography import x509
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    pem = certificate_pem.encode() if isinstance(certificate_pem, str) else certificate_pem
    if b"BEGIN CERTIFICATE" in pem:
        public_key = x509.load_pem_x509_certificate(pem).public_key()
    else:
        public_key = serialization.load_pem_public_key(pem)
    encrypted = public_key.encrypt(initiator_password.encode(), padding.PKCS1v15())
    return base64.b64encode(encrypted).decode()


def b2c_payment(amount, phone, originator_conversation_id, command_id="BusinessPayment",
                remarks="Payout", occasion=None, shortcode=None, initiator_name=None,
                credential=None, result_url=None, timeout_url=None):
    """Sends money from a B2C shortcode to a customer."""
    payload = {
        "OriginatorConversationID": originator_conversation_id,
        "InitiatorName": initiator_name or os.environ["DARAJA_INITIATOR_NAME"],
        "SecurityCredential": credential or os.environ["DARAJA_SECURITY_CREDENTIAL"],
        "CommandID": command_id,
        "Amount": round(amount),
        "PartyA": shortcode or os.environ["DARAJA_B2C_SHORTCODE"],
        "PartyB": normalize_phone(phone),
        "Remarks": remarks,
        "QueueTimeOutURL": timeout_url or os.environ["DARAJA_TIMEOUT_URL"],
        "ResultURL": result_url or os.environ["DARAJA_RESULT_URL"],
    }
    if occasion:
        payload["Occassion"] = occasion  # The B2C API spells it "Occassion".
    return _post("/mpesa/b2c/v3/paymentrequest", payload)


def parse_result(body):
    """Turns a B2C, Transaction Status, or other "Result" callback into a flat dict."""
    r = (body or {}).get("Result")
    if r is None:
        raise ValueError("Not a result callback: missing Result")
    params = r.get("ResultParameters", {}).get("ResultParameter", [])
    if isinstance(params, dict):
        params = [params]
    return {
        "ok": int(r["ResultCode"]) == 0,
        "result_code": int(r["ResultCode"]),
        "result_desc": r.get("ResultDesc"),
        "originator_conversation_id": r.get("OriginatorConversationID"),
        "conversation_id": r.get("ConversationID"),
        "transaction_id": r.get("TransactionID"),
        "parameters": {p["Key"]: p.get("Value") for p in params},
    }
