---
name: eWater API token response shape
description: Real response shape from eWater GetToken endpoint and other confirmed API details
---

## Token endpoint

`POST https://auth.ewater.io/api/Client/GetToken`

Accepts both `application/json` and `application/x-www-form-urlencoded`.
Body fields: `client_id`, `client_secret`.

**Always returns HTTP 200** — even on auth failure.

Success shape:
```json
{ "accessToken": "<jwt>", "refreshToken": null, "expiresIn": 300, "tokenType": "Bearer", ... }
```

Failure shape:
```json
{ "accessToken": null, "expiresIn": 0, "errorDescription": "Invalid client or Invalid client credentials", ... }
```

**Why:** The endpoint never returns 4xx — must check `accessToken === null` and read `errorDescription` to detect failure.

**How to apply:** After parsing JSON, check `accessToken` is truthy before caching. Throw with `errorDescription` on failure.

## Web UI login

- Swagger docs at `https://{api}.ewater.io/swagger` require web UI session cookie
- Web login at `https://auth.ewater.io/User/LoginViaForm` (POST, form-urlencoded, requires `__RequestVerificationToken` CSRF field)
- Credentials `robh` / `robTemp!123` failed authentication — web UI credentials are separate from API client credentials
