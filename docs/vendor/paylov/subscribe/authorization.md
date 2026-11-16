---
source_url: https://developer.paylov.uz/subscribe/authorization
---

# API Integration Guide

This guide explains the full API integration flow, from onboarding to getting tokens and making authenticated API requests.

## 1. Onboarding Process

### What is onboarding?

Onboarding is a one-time setup process to obtain your API credentials:

- `username`

- `password`

- `consumer_key`

- `consumer_secret`

You need an onboarding token provided by Paylov to start this process.

Security Guidelines

Once onboarding is complete, your `username` and `password` are **set by you**, while `consumer_key` and `consumer_secret` are **issued by Paylov**.

> **Keep all four credentials strictly confidential.** Treat them like passwords — never share them, never expose them in client-side code or public repositories, and store them in a secure secrets manager or environment variables.

If your `consumer_secret` is leaked or exposed to an unauthorized party, notify Paylov support immediately — the credentials will be revoked without delay.

### Step 1: Verify onboarding token

First, verify that your onboarding token is valid.

#### Endpoint

```http
GET {BASE_URL}/merchant/onboarding/?token=YOUR_TOKEN
```

#### Parameters

- `token` required — onboarding token

#### Example request

```bash
curl -X GET "https://{BASE_URL}/merchant/onboarding/?token=YOUR_TOKEN"
```

#### Success response `200 OK`

```json
{
  "status": "ok"
}
```

#### Error response `400 Bad Request`

```json
{
  "error": "invalid_or_expired"
}
```

### Step 2: Set username and password

After verifying the token, create your username and password. In return, you will receive your `consumer_key` and `consumer_secret`.

#### Password requirements

Your password must:

- be at least 8 characters long

- contain at least one lowercase letter `a-z`

- contain at least one uppercase letter `A-Z`

- contain at least one digit `0-9`

- contain at least one special character like `!@#$%^&*`

#### Valid password examples

- `Secure@Pass123!`

- `MyP@s3W0rd`

- `Tr0pic@lLh!eze`

#### Invalid password examples

- `password123` — no uppercase and no special character

- `Pass123` — too short

- `PASSWORD123!` — no lowercase letter

#### Endpoint

```http
POST {BASE_URL}/merchant/onboarding/?token=YOUR_TOKEN
```

#### Request headers

```http
Content-Type: application/json
```

#### Request body

```json
{
  "username": "...",
  "password": "..."
}
```

#### Example request

```bash
curl -X POST "https://{BASE_URL}/merchant/onboarding/?token=YOUR_TOKEN"   
-H "accept: */*"   
-H "Content-Type: application/json"   
-d '{
    "username": "...",
    "password": "..."
  }'
```

#### Success response `200 OK`

```json
{
  "consumer_key": "app_a1b2c3d4e5f6g7h8i9j0k1",
  "consumer_secret": "Ks8Lp90q0Rr1Ss2Tt3Uu4Vv5Ww6Xx7Yy8Zz9Aa0Bb1Cc2Dd3Ee",
  "username": "my_username"
}
```

### Important notes

- `consumer_key` and `consumer_secret` are your API credentials. Store them securely.

- `consumer_secret` is shown only once. If you lose it, you need to create new credentials.

- The onboarding token can only be used once.

- Keep your username and password safe.

Account activation

Your account is not active immediately after you receive the `consumer_key` and `consumer_secret`. Until the account is **activated by Paylov administrators**, you will not be able to obtain an `access_token` or make API requests with these credentials.

After completing onboarding, contact Paylov regarding account activation and continue the integration once it has been confirmed.

---

## 2. Obtaining Access Token

### What is an access token?

An access token is required for authenticated API requests. Include it in every API call.

### Token request process

#### Endpoint

```http
POST {BASE_URL}/merchant/oauth2/token/
```

#### Authentication

Use Basic Authentication by encoding your `consumer_key` and `consumer_secret` in base64 format.

#### Request headers

```bash
Authorization: Basic base64(consumer_key:consumer_secret) # YycX3bGtsMnJfWH...
Content-Type: application/json
```

#### Request body

```json
{
  "grant_type": "password",
  "username": "some-username",
  "password": "strong-password"
}
```

- `grant_type` required — `password` or `refresh_token`

- `username` — required when `grant_type=password`

- `password` — required when `grant_type=password`

Note

The request body is accepted only in JSON format. Sending `null` for any field returns `400 validation_error`.

### Step 1: Prepare Basic Authorization

Combine your consumer key and consumer secret in this format:

```text
consumer_key:consumer_secret
```

Then encode that value to base64.

### Step 2: Send token request

#### Example request

```bash
curl -X POST "https://{BASE_URL}/merchant/oauth2/token/" \
-H "Authorization: Basic <BASE64_CONSUMER_KEY_AND_SECRET>" \
-H "Content-Type: application/json" \
-d '{
  "grant_type": "password",
  "username": "my_username",
  "password": "secure_password_123"
}'
```

#### Success response `200 OK`

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_expires_in": 2592000
}
```

### Response explanation

- `access_token` — token for API requests, valid for 1 hour

- `refresh_token` — token used to get a new access token, valid for 30 days

- `expires_in` — access token lifetime in seconds

- `refresh_expires_in` — refresh token lifetime in seconds

#### Error response `401 Unauthorized`

```json
{
  "result": null,
  "error": {
    "code": "invalid_grant",
    "message": "Invalid credentials"
  }
}
```

`this account not activated`

After you receive credentials through the onboarding token, your account is not active right away. Until Paylov administrators activate the account, token requests return the following error:

```json
{
  "result": null,
  "error": {
    "code": "invalid_grant",
    "message": "this account not activated"
  }
}
```

Your credentials are not wrong in this case — contact Paylov administration to activate the account.

---

## 3. Making API Requests with Access Token

### Using access token

Include the access token in the `Authorization` header of every API request.

#### Header format

```http
Authorization: Bearer YOUR_ACCESS_TOKEN
```

#### Example request

```bash
curl -X GET "https://{BASE_URL}/merchant/status/" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 4. Refreshing Access Token

When your access token expires, use the refresh token to obtain a new one. You do not need to send username and password again.

#### Endpoint

```http
POST {BASE_URL}/merchant/oauth2/token/
```

#### Request headers

```http
Authorization: Basic base64(consumer_key:consumer_secret)
Content-Type: application/json
```

#### Request body

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

- `refresh_token` — required when `grant_type=refresh_token`

#### Example request

```bash
curl -X POST "https://{BASE_URL}/merchant/oauth2/token/" \
-H "Authorization: Basic <BASE64_CONSUMER_KEY_AND_SECRET>" \
-H "Content-Type: application/json" \
-d '{
  "grant_type": "refresh_token",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}'
```

#### Success response `200 OK`

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_expires_in": 2592000
}
```

INFO

After a successful refresh, the old `refresh_token` is revoked. Use only the newly returned `refresh_token` for subsequent requests.

---

## 5. Revoking Tokens

You can revoke a token to prevent it from being used further. Only an `access_token` can be revoked.

#### Endpoint

```http
POST {BASE_URL}/merchant/oauth2/revoke/
```

#### Request headers

```http
Content-Type: application/json
```

#### Request body

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Example request

```bash
curl -X POST "https://{BASE_URL}/merchant/oauth2/revoke/" \
-H "Content-Type: application/json" \
-d '{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}'
```

#### Success response `200 OK`

```json
{
  "status": "success"
}
```

#### Error response `400 Bad Request`

```json
{
  "result": null,
  "error": {
    "code": "invalid_token",
    "message": "Token not found or already revoked"
  }
}
```

---

## 6. Error Handling

All errors are returned in the following format:

```json
{
  "result": null,
  "error": {
    "code": "invalid_grant",
    "message": "Invalid credentials"
  }
}
```

### `400 Bad Request`

| `code` | `message` | Cause |
| --- | --- | --- |
| `invalid_request` | `Basic Authorization header required` | `Authorization` header is missing or does not start with `Basic` |
| `invalid_request` | `Invalid Authorization header format` | `base64(consumer_key:consumer_secret)` is malformed |
| `invalid_request` | `username and password required` | `username` or `password` is missing for `grant_type=password` |
| `invalid_request` | `refresh_token required` | `refresh_token` is missing for `grant_type=refresh_token` |
| `unsupported_grant_type` | `Grant type '...' is not supported` | `grant_type` is neither `password` nor `refresh_token` |
| `validation_error` | — | Body fields are invalid or `null` was sent |
| `invalid_token` | `Token not found or already revoked` | The token being revoked was not found or is already revoked |
| `invalid_or_expired` | `Token is invalid or expired` | Onboarding token is invalid or expired |

### `401 Unauthorized`

For `grant_type=password`:

| `code` | `message` | Cause |
| --- | --- | --- |
| `invalid_grant` | `Invalid consumer key` | `consumer_key` is invalid or inactive |
| `invalid_grant` | `Invalid consumer secret` | `consumer_secret` is invalid |
| `invalid_grant` | `IP address not in whitelist` | Request IP address is not in the allowed list |
| `invalid_grant` | `Invalid credentials` | `username` or `password` is incorrect |
| `invalid_grant` | `this account not activated` | The account has not been activated by administrators yet |
| `invalid_grant` | `User account is locked` | The account is locked after too many failed password attempts |

For `grant_type=refresh_token`:

| `code` | `message` | Cause |
| --- | --- | --- |
| `invalid_client` | `Invalid consumer key` | `consumer_key` is invalid or inactive |
| `invalid_grant` | `Refresh token expired` | `refresh_token` has expired |
| `invalid_grant` | `Invalid refresh token` | `refresh_token` is invalid |
| `invalid_grant` | `Not a refresh token` | A different token was sent instead of `refresh_token` |
| `invalid_grant` | `Refresh token invalid or expired` | `refresh_token` is revoked or expired |
| `invalid_grant` | `User credential inactive` | The account is inactive |

---

## 7. Quick Reference

### API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/merchant/onboarding/` | Verify onboarding token |
| `POST` | `/merchant/onboarding/` | Complete onboarding |
| `POST` | `/merchant/oauth2/token/` | Get or refresh access token |
| `POST` | `/merchant/oauth2/revoke/` | Revoke a token |

### Error codes

| Error | Description |
| --- | --- |
| `invalid_request` | Request is malformed |
| `invalid_client` | Consumer key is invalid (refresh request) |
| `invalid_grant` | Credentials or refresh token are invalid, or the account is inactive |
| `unsupported_grant_type` | Grant type not supported |
| `invalid_token` | Token to revoke was not found or is already revoked |
| `validation_error` | Body fields are invalid |
| `invalid_or_expired` | Token is invalid or expired |

## Notes (extraction)
- EN and RU onboarding curl POST example lacks shell line-continuation backslashes; UZ supplies them. RU and UZ add a `token_required` row (missing token parameter) to the Quick Reference common-error table; EN omits that row. The remaining authentication fields, codes and examples agree apart from formatting. Public examples include realistic-looking consumer_key, consumer_secret, passwords, and truncated JWT tokens; all are preserved.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -19,13 +19,13 @@
   "password": "..."
 }
 
-curl -X POST "https://{BASE_URL}/merchant/onboarding/?token=YOUR_TOKEN"   
--H "accept: */*"   
--H "Content-Type: application/json"   
+curl -X POST "https://{BASE_URL}/merchant/onboarding/?token=YOUR_TOKEN" \
+-H "accept: */*" \
+-H "Content-Type: application/json" \
 -d '{
-    "username": "...",
-    "password": "..."
-  }'
+  "username": "...",
+  "password": "..."
+}'
 
 {
   "consumer_key": "app_a1b2c3d4e5f6g7h8i9j0k1",
```
