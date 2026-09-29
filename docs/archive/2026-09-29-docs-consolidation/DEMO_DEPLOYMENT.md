# Demo deployment

## Current live branch

The Hetzner demo deploys from `main`.

## Edge / DNS

DNS is proxied (orange-cloud) through **Cloudflare**. CF SSL/TLS mode is
**Full (Strict)** (CF validates the origin Let's Encrypt cert). The deploy
pipeline automatically firewalls `:80/:443` to Cloudflare IP ranges
(`apps/taptrade-platform/scripts/security/cf-firewall.sh`, plus the
`cf-firewall.service` unit beside it) on every push.

`EDGE_SHARED_SECRET` (repo secret) is injected into both Caddy and the gateway
at deploy time. Caddy stamps it as `X-Edge-Auth`; the gateway validates it so
direct-to-origin requests are denied.

## Required repo secrets

| Secret | Purpose |
|---|---|
| `DEPLOY_SSH_KEY` | SSH private key for root on the Hetzner box |
| `BACKOFFICE_BASIC_AUTH_HASH` | bcrypt hash for `office.99rtp.io` basic_auth |
| `EDGE_SHARED_SECRET` | Anti-spoof token shared by Caddy + gateway (`openssl rand -hex 32`) |
| `OPENROUTER_API_KEY` | *(optional)* AI drafting + market translation |

## Smoke checks

```sh
curl -sS -D - -o /tmp/demo-api.txt --max-time 20 \
  'https://demo.99rtp.io/api/v1/markets?limit=1'

curl -sS -D - -o /tmp/demo-root.html --max-time 20 \
  'https://demo.99rtp.io/'

curl -sS -D - -o /tmp/office-root.html --max-time 20 \
  'https://office.99rtp.io/'
```

Expected results:

- `demo.99rtp.io/api/v1/markets?limit=1` returns `200`.
- `demo.99rtp.io/` returns `200`.
- `office.99rtp.io/` returns `401 Basic` unless operator credentials are
  supplied.
