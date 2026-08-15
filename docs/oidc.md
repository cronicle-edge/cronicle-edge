# OpenID Connect configuration and logout

Cronicle Edge supports OAuth 2.0 login with optional OpenID Connect (OIDC) token validation, RP-Initiated Logout, and Back-Channel Logout. Both logout modes are disabled by default, so existing OAuth configurations continue to perform local logout only.

OIDC does not provision users or assign privileges. The username selected from UserInfo must already exist as an active Cronicle Edge user.

## Example configuration

```json
{
  "oauth": {
    "enabled": true,
    "button_label": "Sign in with the identity provider",
    "only": false,
    "auto_login": false,
    "insecure": false,
    "client_id": "cronicle-edge",
    "client_secret": "replace-me",
    "redirect_uri": "https://cronicle.example/api/user/callback",
    "authorize_url": "https://idp.example/application/o/authorize/",
    "token_url": "https://idp.example/application/o/token/",
    "user_url": "https://idp.example/application/o/userinfo/",
    "user_attribute": "preferred_username",
    "avatar_attribute": "picture",
    "scope": "openid profile email",
    "issuer": "https://idp.example/application/o/cronicle/",
    "jwks_url": "https://idp.example/application/o/cronicle/jwks/",
    "allowed_algs": ["RS256"],
    "clock_tolerance_seconds": 5,
    "jwks_cooldown_seconds": 30,
    "allow_http_localhost": false,
    "logout": {
      "enabled": true,
      "end_session_url": "https://idp.example/application/o/cronicle/end-session/",
      "post_logout_redirect_uri": "https://cronicle.example/",
      "allow_http_localhost": false,
      "params": {}
    },
    "backchannel_logout": {
      "enabled": true,
      "max_token_age_seconds": 300,
      "max_token_size": 16384
    }
  }
}
```

Use the exact URLs published by the provider. In particular, `issuer` is compared as an exact string with the signed `iss` claim, including a trailing slash when the provider includes one.

## Configuration reference

### Login and OAuth

| Property | Meaning |
| --- | --- |
| `enabled` | Enables OAuth login. Defaults to `false`. |
| `profile` | Starts with a built-in `google`, `github`, or `authentik` profile; explicitly configured properties override profile values. |
| `base_url` | Prefixes relative profile values in `authorize_url`, `token_url`, `redirect_uri`, `user_url`, `issuer`, and `jwks_url`. |
| `button_label` | Text displayed on the login button. |
| `only` | Hides local account controls and rejects password login. Verify OAuth first to avoid locking out local access. |
| `auto_login` | Sends unauthenticated visitors directly to the provider. Verify OAuth first. |
| `insecure` | When `true`, disables TLS certificate verification only for token and UserInfo requests. Keep `false` in production. It does not enable localhost HTTP and does not change JWT signature validation. |
| `client_id` | OAuth/OIDC client identifier registered at the provider. |
| `client_secret` | Client credential sent only to the token endpoint. Keep it outside source control. |
| `redirect_uri` | Authorization Code callback registered at the provider. With the default base path, use `https://cronicle.example/api/user/callback`. |
| `authorize_url` | Provider Authorization Endpoint used for the browser redirect. |
| `token_url` | Provider Token Endpoint used to exchange the authorization code. |
| `user_url` | Provider UserInfo endpoint used to obtain the Cronicle username and optional avatar. |
| `user_attribute` | UserInfo property used as the Cronicle username. Defaults to `login`; Authentik commonly uses `preferred_username`. |
| `avatar_attribute` | UserInfo property used as the avatar URL. Defaults to `avatar_url`. |
| `scope` | Space-separated scopes. Include `openid` to request an ID Token; when OIDC validation is configured, Cronicle binds it to a per-request nonce. |
| `params` | Additional fields merged into the token request body. A duplicate key overrides Cronicle's default request value. |
| `headers` | Additional token endpoint request headers. Cronicle always requests a JSON response. |

### OIDC token validation

| Property | Meaning |
| --- | --- |
| `issuer` | Exact expected `iss` value for ID Tokens and Logout Tokens. Query and fragment components are rejected. |
| `jwks_url` | Provider JWKS endpoint used to verify token signatures and signing-key rotation. |
| `allowed_algs` | Allowlist of asymmetric JWT signing algorithms. Defaults to `RS256`; symmetric `HS*` algorithms are rejected. |
| `clock_tolerance_seconds` | Allowed clock skew while validating time claims. Defaults to `5`. |
| `jwks_cooldown_seconds` | Minimum interval between JWKS refresh attempts. Defaults to `30`. |
| `allow_http_localhost` | Allows HTTP for `issuer` and `jwks_url` only when the host is `localhost`, `127.0.0.1`, or `::1`. This is independent of `insecure` and is intended only for local development. |

When either logout mode is enabled, both `issuer` and `jwks_url` are required. RP-Initiated Logout also requires the token endpoint to return a signed ID Token. Access and refresh tokens are not stored in the Cronicle session.

Tokens are accepted only when every `aud` value matches `client_id`; no additional trusted audiences are configurable.

For an HTTP Authentik instance used only on the same development host, keep TLS verification semantics unchanged and opt in to localhost HTTP explicitly:

```json
{
  "insecure": false,
  "allow_http_localhost": true,
  "issuer": "http://localhost:9000/application/o/cronicle/",
  "jwks_url": "http://localhost:9000/application/o/cronicle/jwks/",
  "user_attribute": "preferred_username",
  "logout": {
    "enabled": true,
    "end_session_url": "http://localhost:9000/application/o/cronicle/end-session/",
    "post_logout_redirect_uri": "http://localhost:3034",
    "allow_http_localhost": true
  }
}
```

This exception never permits a remote HTTP host. Production provider and Cronicle URLs should use HTTPS.

### RP-Initiated Logout

| Property | Meaning |
| --- | --- |
| `logout.enabled` | Enables provider logout after the local Cronicle session has been deleted. Defaults to `false`. |
| `logout.end_session_url` | Provider Logout Endpoint. It is never accepted from a browser request. |
| `logout.post_logout_redirect_uri` | Optional return URL registered exactly at the provider. |
| `logout.allow_http_localhost` | Allows HTTP logout and post-logout URLs only on localhost for local development. It does not affect provider/JWKS URLs. |
| `logout.params` | Additional scalar query parameters. Reserved `id_token_hint`, `post_logout_redirect_uri`, and `client_id` values cannot be overridden. |

Cronicle deletes the local session and its OIDC indexes before returning a same-origin, short-lived logout ticket. The backend consumes the ticket once and redirects to the configured Logout Endpoint. The verified ID Token is encrypted in session storage using `secret_key` and supplied as `id_token_hint`; it is deleted with the session. Its stored issuer and client ID must still match the active configuration, otherwise Cronicle performs local logout only. A provider outage therefore cannot restore the local session.

OIDC defines the provider Logout Endpoint as HTTPS. `logout.allow_http_localhost` is a narrow development exception for locally hosted providers such as Authentik; it never permits HTTP on a remote host and must remain disabled in production.

### Back-Channel Logout

| Property | Meaning |
| --- | --- |
| `backchannel_logout.enabled` | Enables `POST /api/user/oidc_backchannel_logout`. Defaults to `false`. |
| `backchannel_logout.max_token_age_seconds` | Maximum accepted age of a Logout Token based on `iat`. Defaults to `300`. |
| `backchannel_logout.max_token_size` | Maximum Logout Token size in bytes. Defaults to `16384`, with a minimum of `1024`. |

The endpoint accepts `application/x-www-form-urlencoded` with one `logout_token`. Cronicle verifies the signature, asymmetric algorithm allowlist, `iss`, `aud`, `iat`, `jti`, the back-channel logout event, absence of `nonce`, and a `sid` or `sub` identifier. When `exp` is present it is validated, but the final Back-Channel Logout specification does not require it; replay and revocation records still receive a finite lifetime derived from `iat` and `max_token_age_seconds`. A `sid` token removes the matching provider session; a `sub` token removes all indexed sessions for that provider subject. Repeated valid requests and valid tokens for an already absent session return success as required for provider retries. Invalid requests and failed logout actions return HTTP 400 with a standard `invalid_request` error body.

Session indexes, processed `jti` values, and short-lived revocation markers are persisted. The callback checks the matching marker under the same storage lock used for revocation, preventing an in-flight callback from recreating a session after logout completed.

## Provider and proxy setup

Register these exact URLs, adjusted for `base_path` when configured:

- Authorization Code callback: `https://cronicle.example/api/user/callback`
- Back-channel logout URI: `https://cronicle.example/api/user/oidc_backchannel_logout`
- Post-logout redirect URI: the exact value of `oauth.logout.post_logout_redirect_uri`

The back-channel URI must be reachable by the provider without an interactive browser challenge. A reverse proxy must preserve the POST method, `Content-Type`, and form body. Do not log request bodies or logout `Location` headers on the OIDC paths.

OIDC validation uses `jose` 6.x and requires Node.js 20 or newer. The implemented claim checks follow [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html), [OpenID Connect RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html), and [OpenID Connect Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html).
