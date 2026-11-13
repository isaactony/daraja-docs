"""Builds api-reference/openapi.json, the unofficial OpenAPI description of the Daraja APIs in these docs.

Written from Safaricom's official API pages (13 November 2026). Run: python3 scripts/build-openapi.py api-reference/openapi.json
"""
import json, sys

def s(desc, ex=None, **kw):
    d = {"type": "string", "description": desc}
    if ex is not None: d["example"] = ex
    d.update(kw); return d

def n(desc, ex=None, **kw):
    d = {"type": "integer", "description": desc}
    if ex is not None: d["example"] = ex
    d.update(kw); return d

err = {"$ref": "#/components/schemas/Error"}
def errors(*codes):
    out = {}
    for status, desc in codes:
        out[status] = {"description": desc, "content": {"application/json": {"schema": err}}}
    return out

ack_b2c = {
    "type": "object",
    "properties": {
        "ConversationID": s("Unique ID from M-Pesa for this request.", "AG_20240706_20106e9209f64bebd05b"),
        "OriginatorConversationID": s("Your ID for this request, echoed back.", "600997_Test_32et3241ed8yu"),
        "ResponseCode": s("`0` means the request was accepted. The result arrives at `ResultURL`.", "0"),
        "ResponseDescription": s("Description of `ResponseCode`.", "Accept the service request successfully."),
    },
}

spec = {
  "openapi": "3.1.0",
  "info": {
    "title": "M-Pesa Daraja 3.0 API (unofficial description)",
    "version": "3.0",
    "description": "An unofficial OpenAPI description of the Daraja APIs covered in the Daraja for Developers docs, written from Safaricom's official API pages as published on 13 November 2026. Safaricom doesn't publish an OpenAPI file. Not affiliated with or endorsed by Safaricom.",
    "contact": {"name": "Isaac Tony", "url": "https://github.com/isaactony/daraja-docs"},
    "license": {"name": "MIT", "identifier": "MIT"},
  },
  "servers": [
    {"url": "https://sandbox.safaricom.co.ke", "description": "Sandbox"},
    {"url": "https://api.safaricom.co.ke", "description": "Production"},
  ],
  "security": [{"bearerAuth": []}],
  "paths": {
    "/oauth/v1/generate": {"get": {
      "operationId": "generateAccessToken",
      "summary": "Get an access token",
      "description": "Returns an OAuth access token for all other Daraja calls. Use HTTP Basic authentication with your consumer key as the username and consumer secret as the password. Tokens last 3600 seconds. Cache one token per app and share it across servers. A wrong key or secret returns HTTP 400 with an empty body. See [Get an access token](/guides/get-an-access-token).",
      "security": [{"basicAuth": []}],
      "parameters": [{"name": "grant_type", "in": "query", "required": True,
                      "schema": {"type": "string", "enum": ["client_credentials"]},
                      "description": "Always `client_credentials`."}],
      "responses": {
        "200": {"description": "Token issued.", "content": {"application/json": {"schema": {
          "type": "object", "required": ["access_token", "expires_in"],
          "properties": {
            "access_token": s("The token. Send it as `Authorization: Bearer <token>`.", "c9SQxWWhmdVRlyh0zh8gZDTkubVF"),
            "expires_in": {"description": "Lifetime in seconds. Returned as a string (observed in the sandbox), though the official sample shows a number. Convert it.", "oneOf": [{"type": "string"}, {"type": "integer"}], "example": "3599"},
          }}}}},
        **errors(("400", "`400.008.01` Invalid authentication passed, or `400.008.02` Invalid grant type passed. A wrong key or secret returns 400 with an empty body.")),
      },
    }},
    "/mpesa/stkpush/v1/processrequest": {"post": {
      "operationId": "stkPush",
      "summary": "Send an STK Push (M-Pesa Express)",
      "description": "Sends a payment prompt to the customer's phone. The immediate response only means the request was accepted; the result is posted to `CallBackURL`. In the sandbox, this sends a real prompt and moves real money, reversed at 6 AM the next day. See [Take a payment with STK Push](/guides/take-a-payment-with-stk-push).",
      "requestBody": {"required": True, "content": {"application/json": {"schema": {
        "type": "object",
        "required": ["BusinessShortCode", "Password", "Timestamp", "TransactionType", "Amount", "PartyA", "PartyB", "PhoneNumber", "CallBackURL", "AccountReference"],
        "properties": {
          "BusinessShortCode": s("Your paybill number, or the store number for a till. `174379` in the sandbox.", "174379"),
          "Password": s("`base64(BusinessShortCode + Passkey + Timestamp)`. See [Fix \"Wrong credentials\"](/troubleshooting/wrong-credentials).", "MTc0Mzc5YmZiMjc5ZjlhYTliZGJjZjE1OGU5N2RkNzFhNDY3Y2QyZTBjODkzMDU5YjEwZjc4ZTZiNzJhZGExZWQyYzkxOTIwMjEwNjI4MDkyNDA4"),
          "Timestamp": s("`YYYYMMDDHHmmss`. Must match the timestamp used in `Password`.", "20210628092408", pattern="^[0-9]{14}$"),
          "TransactionType": s("`CustomerPayBillOnline` for a paybill, `CustomerBuyGoodsOnline` for a till.", "CustomerPayBillOnline", enum=["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]),
          "Amount": n("Whole shillings, at least 1.", 1, minimum=1),
          "PartyA": s("The customer's phone, `2547XXXXXXXX` or `2541XXXXXXXX`.", "254712345678", pattern="^254[17][0-9]{8}$"),
          "PartyB": s("Your paybill number, or the till number.", "174379"),
          "PhoneNumber": s("The phone that receives the prompt. Usually the same as `PartyA`.", "254712345678", pattern="^254[17][0-9]{8}$"),
          "CallBackURL": s("Public URL for the result. HTTPS in production. Must not contain `mpesa`, `safaricom`, `query`, and similar words.", "https://your-domain.example/payments/stk-callback", format="uri"),
          "AccountReference": s("Shown to the customer. The account number for a paybill. Up to 12 characters.", "INV-1001", maxLength=12),
          "TransactionDesc": s("Optional comment, up to 13 characters.", "Payment", maxLength=13),
        }}}}},
      "responses": {
        "200": {"description": "Accepted. The prompt was sent; the result goes to `CallBackURL`.", "content": {"application/json": {"schema": {
          "type": "object", "properties": {
            "MerchantRequestID": s("ID from the API proxy.", "2654-4b64-97ff-b827b542881d3130"),
            "CheckoutRequestID": s("ID of this push. Store it: it links the callback and STK Query.", "ws_CO_1007202409152617172396192"),
            "ResponseCode": s("`0` means accepted.", "0"),
            "ResponseDescription": s("Description of `ResponseCode`.", "Success. Request accepted for processing"),
            "CustomerMessage": s("Message for the customer.", "Success. Request accepted for processing"),
          }}}}},
        **errors(("400", "`400.002.02` Bad Request - Invalid *Field*, or `400.002.05` Invalid Request Payload."),
                 ("404", "`404.001.03` Invalid Access Token, or `404.001.01` Resource not found."),
                 ("500", "`500.001.1001` Wrong credentials, Merchant does not exist, or Unable to lock subscriber. `500.003.02` System busy or Spike Arrest Violation. `500.003.03` Quota Violation.")),
      },
      "callbacks": {"stkResult": {"{$request.body#/CallBackURL}": {"post": {
        "summary": "STK Push result",
        "description": "Posted by M-Pesa when the customer pays, cancels, or the prompt fails. `CallbackMetadata` exists only when `ResultCode` is 0.",
        "requestBody": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/StkCallback"}}}},
        "responses": {"200": {"description": "Reply quickly with HTTP 200."}},
      }}}},
    }},
    "/mpesa/stkpushquery/v1/query": {"post": {
      "operationId": "stkQuery",
      "summary": "Query an STK Push result",
      "description": "Returns the result of an STK Push you sent. Use it when the callback is late or missing. Build `Password` and `Timestamp` as for the push. See [Confirm a payment without a callback](/guides/confirm-a-payment-without-a-callback).",
      "requestBody": {"required": True, "content": {"application/json": {"schema": {
        "type": "object", "required": ["BusinessShortCode", "Password", "Timestamp", "CheckoutRequestID"],
        "properties": {
          "BusinessShortCode": s("The shortcode you used for the push.", "174379"),
          "Password": s("`base64(BusinessShortCode + Passkey + Timestamp)`, with a fresh timestamp."),
          "Timestamp": s("`YYYYMMDDHHmmss`.", "20261113143005", pattern="^[0-9]{14}$"),
          "CheckoutRequestID": s("From the STK Push response.", "ws_CO_1007202409152617172396192"),
        }}}}},
      "responses": {
        "200": {"description": "The payment's result.", "content": {"application/json": {"schema": {
          "type": "object", "properties": {
            "ResponseCode": s("`0` means the query was accepted.", "0"),
            "ResponseDescription": s("Description of `ResponseCode`.", "The service request has been accepted successfully"),
            "MerchantRequestID": s("From the push.", "22205-34066-1"),
            "CheckoutRequestID": s("From the push.", "ws_CO_13012021093521236557"),
            "ResultCode": s("The payment's result as a string: `0` paid, `1032` cancelled. See [Result codes](/reference/result-codes).", "0"),
            "ResultDesc": s("Description of `ResultCode`.", "The service request is processed successfully."),
          }}}}},
        **errors(("500", "`500.001.1001` Wrong credentials, or The transaction does not Exist (observed for an unknown CheckoutRequestID). Developers also report `500.001.1001` The transaction is being processed, while the customer hasn't answered."), ("429", "Spike arrest violation. The sandbox allowed 30 requests per minute with a burst of 3 (observed). The body is a `fault` object, not an `errorCode`.")),
      },
    }},
    "/mpesa/c2b/v2/registerurl": {"post": {
      "operationId": "c2bRegisterUrl",
      "summary": "Register C2B URLs",
      "description": "Registers the confirmation and validation URLs for a shortcode. In production this is one-time; see [Fix \"Urls are already registered\"](/troubleshooting/urls-already-registered).",
      "requestBody": {"required": True, "content": {"application/json": {"schema": {
        "type": "object", "required": ["ShortCode", "ResponseType", "ConfirmationURL", "ValidationURL"],
        "properties": {
          "ShortCode": s("Your paybill or till shortcode.", "600984"),
          "ResponseType": s("What M-Pesa does if your validation URL doesn't answer in time. Exactly `Completed` or `Cancelled`.", "Completed", enum=["Completed", "Cancelled"]),
          "ConfirmationURL": s("Receives every completed payment.", "https://your-domain.example/payments/c2b/confirm", format="uri"),
          "ValidationURL": s("Asked to accept or reject payments, if external validation is enabled.", "https://your-domain.example/payments/c2b/validate", format="uri"),
        }}}}},
      "responses": {
        "200": {"description": "Registered.", "content": {"application/json": {"schema": {
          "type": "object", "properties": {
            "OriginatorCoversationID": s("Request ID. Spelled without the \"n\" in the official C2B docs.", "6e86-45dd-91ac-fd5d4178ab523408729"),
            "ResponseCode": s("`0` means success.", "0"),
            "ResponseDescription": s("Description.", "Success"),
          }}}}},
        **errors(("400", "`400.003.01` Invalid Access Token, `400.003.02` Bad Request, or `400.002.05` Invalid Request Payload."),
                 ("500", "`500.003.1001` Urls are already registered, Duplicate notification info, or Internal Server Error.")),
      },
    }},
    "/mpesa/c2b/v2/simulate": {"post": {
      "operationId": "c2bSimulate",
      "summary": "Simulate a C2B payment (sandbox only)",
      "description": "Creates a test customer payment in the sandbox, which M-Pesa sends to your registered URLs. The request body is from the current official C2B page; the path is from an earlier version of the official docs.",
      "servers": [{"url": "https://sandbox.safaricom.co.ke", "description": "Sandbox only"}],
      "requestBody": {"required": True, "content": {"application/json": {"schema": {
        "type": "object", "required": ["ShortCode", "CommandID", "Amount", "Msisdn"],
        "properties": {
          "ShortCode": n("Your test shortcode.", 600984),
          "CommandID": s("`CustomerPayBillOnline` or `CustomerBuyGoodsOnline`.", "CustomerPayBillOnline", enum=["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]),
          "Amount": n("Whole shillings.", 10),
          "Msisdn": n("The test phone number.", 254708374149),
          "BillRefNumber": s("Account number for a paybill. Empty for a till.", "ACC-42"),
        }}}}},
      "responses": {"200": {"description": "Accepted. Watch your URLs.", "content": {"application/json": {"schema": {
        "type": "object", "properties": {
          "OriginatorCoversationID": s("Request ID.", "53e3-4aa8-9fe0-8fb5e4092cdd3405976"),
          "ResponseCode": s("`0` means accepted.", "0"),
          "ResponseDescription": s("Description.", "Accept the service request successfully."),
        }}}}}},
    }},
    "/mpesa/b2c/v3/paymentrequest": {"post": {
      "operationId": "b2cPayment",
      "summary": "Send a B2C payment",
      "description": "Sends money from your B2C shortcode to a customer. The result is posted to `ResultURL`, or `QueueTimeOutURL` on timeout. See [Send money with B2C](/guides/send-money-with-b2c).",
      "requestBody": {"required": True, "content": {"application/json": {"schema": {
        "type": "object",
        "required": ["OriginatorConversationID", "InitiatorName", "SecurityCredential", "CommandID", "Amount", "PartyA", "PartyB", "Remarks", "QueueTimeOutURL", "ResultURL"],
        "properties": {
          "OriginatorConversationID": s("Your unique ID for this payout. Prevents double payment.", "refund-ord-1042-1"),
          "InitiatorName": s("The API operator's username.", "testapi"),
          "SecurityCredential": s("The initiator password, RSA-encrypted with PKCS #1 v1.5 and base64-encoded. See [Encrypt the security credential](/guides/encrypt-the-security-credential)."),
          "CommandID": s("The payment type.", "BusinessPayment", enum=["BusinessPayment", "SalaryPayment", "PromotionPayment"]),
          "Amount": n("Whole shillings.", 10),
          "PartyA": s("Your B2C shortcode.", "600992"),
          "PartyB": s("The customer's phone, 12 digits.", "254712345678", pattern="^254[17][0-9]{8}$"),
          "Remarks": s("2 to 100 characters.", "Refund for order 1042", minLength=2, maxLength=100),
          "QueueTimeOutURL": s("Receives a notice if the request times out.", "https://your-domain.example/payments/b2c/timeout", format="uri"),
          "ResultURL": s("Receives the result.", "https://your-domain.example/payments/b2c/result", format="uri"),
          "Occassion": s("Optional, 1 to 100 characters. Spelled with a double \"s\" in this API.", "Refund", maxLength=100),
        }}}}},
      "responses": {
        "200": {"description": "Accepted. The result goes to `ResultURL`.", "content": {"application/json": {"schema": ack_b2c}}},
        **errors(("400", "`400.002.02` Bad Request - Invalid *Field*."), ("404", "`404.001.03` Invalid Access Token.")),
      },
      "callbacks": {"b2cResult": {"{$request.body#/ResultURL}": {"post": {
        "summary": "B2C result",
        "requestBody": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Result"}}}},
        "responses": {"200": {"description": "Reply with HTTP 200."}},
      }}}},
    }},
    "/mpesa/transactionstatus/v1/query": {"post": {
      "operationId": "transactionStatus",
      "summary": "Check a transaction status",
      "description": "Looks up a recent transaction. The result is posted to `ResultURL`. See [Check a transaction status](/guides/check-a-transaction-status).",
      "requestBody": {"required": True, "content": {"application/json": {"schema": {
        "type": "object",
        "required": ["Initiator", "SecurityCredential", "CommandID", "PartyA", "IdentifierType", "ResultURL", "QueueTimeOutURL", "Remarks"],
        "properties": {
          "Initiator": s("The API operator's username. Called `InitiatorName` in B2C.", "testapi"),
          "SecurityCredential": s("The encrypted initiator password."),
          "CommandID": s("Always `TransactionStatusQuery`.", "TransactionStatusQuery", enum=["TransactionStatusQuery"]),
          "TransactionID": s("The M-Pesa receipt number.", "NEF61H8J60"),
          "OriginalConversationID": s("The `OriginatorConversationID` of the transaction to check.", "7071-4170-a0e5-8345632bad442144258"),
          "PartyA": s("Your shortcode.", "600782"),
          "IdentifierType": s("`4` for an organization shortcode.", "4"),
          "ResultURL": s("Receives the result.", "https://your-domain.example/payments/status/result", format="uri"),
          "QueueTimeOutURL": s("Receives a notice on timeout. The official field table spells it `QueueTimeoutURL`; the sample uses this spelling.", "https://your-domain.example/payments/status/timeout", format="uri"),
          "Remarks": s("Up to 100 characters.", "Check payout", maxLength=100),
          "Occasion": s("Optional, up to 100 characters. One \"s\" here.", "Payout check", maxLength=100),
        }}}}},
      "responses": {
        "200": {"description": "Accepted. The result goes to `ResultURL`.", "content": {"application/json": {"schema": ack_b2c}}},
        **errors(("400", "`400.002.02` Bad Request - Invalid *Field*.")),
      },
    }},
  },
  "components": {
    "securitySchemes": {
      "basicAuth": {"type": "http", "scheme": "basic", "description": "Consumer key as the username, consumer secret as the password."},
      "bearerAuth": {"type": "http", "scheme": "bearer", "description": "The `access_token` from `GET /oauth/v1/generate`."},
    },
    "schemas": {
      "Error": {"type": "object", "properties": {
        "requestId": s("Keep this for support requests.", "1c5b-4ba8-815c-ac45c57a3db01495926"),
        "errorCode": s("See [Error codes](/reference/error-codes).", "400.002.02"),
        "errorMessage": s("Read this as well as `errorCode`; one code can have several messages.", "Bad Request - Invalid BusinessShortCode"),
      }},
      "StkCallback": {"type": "object", "properties": {"Body": {"type": "object", "properties": {"stkCallback": {
        "type": "object", "required": ["MerchantRequestID", "CheckoutRequestID", "ResultCode", "ResultDesc"],
        "properties": {
          "MerchantRequestID": s("From the push response.", "29115-34620561-1"),
          "CheckoutRequestID": s("From the push response. Match your order with it.", "ws_CO_191220191020363925"),
          "ResultCode": n("`0` paid; anything else failed. A number here.", 0),
          "ResultDesc": s("Description.", "The service request is processed successfully."),
          "CallbackMetadata": {"type": "object", "description": "Only when `ResultCode` is 0.", "properties": {"Item": {"type": "array", "items": {
            "type": "object", "properties": {"Name": s("`Amount`, `MpesaReceiptNumber`, `TransactionDate`, `PhoneNumber`, or `Balance`."), "Value": {"description": "The value; numbers for Amount, TransactionDate, and PhoneNumber."}}}}}},
        }}}}}},
      "Result": {"type": "object", "properties": {"Result": {"type": "object", "properties": {
        "ResultType": n("Usually 0.", 0),
        "ResultCode": n("`0` success. See [Result codes](/reference/result-codes).", 0),
        "ResultDesc": s("Description.", "The service request is processed successfully."),
        "OriginatorConversationID": s("Your ID from the request."),
        "ConversationID": s("M-Pesa's ID from the response."),
        "TransactionID": s("The M-Pesa receipt number.", "SG632NMUAB"),
        "ResultParameters": {"type": "object", "description": "Only on success.", "properties": {"ResultParameter": {"type": "array", "items": {
          "type": "object", "properties": {"Key": s("For example `TransactionAmount` or `ReceiverPartyPublicName`."), "Value": {"description": "The value."}}}}}},
      }}}},
    },
  },
}
json.dump(spec, open(sys.argv[1], "w"), indent=2, ensure_ascii=False)
print("paths", len(spec["paths"]))
