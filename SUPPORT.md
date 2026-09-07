# Support

Use this file to route local development issues quickly.

## Local Stack

Check container health:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform
docker compose ps
docker compose logs --tail=100 postgres redis
```

Compose defines `postgres`, `redis`, `gateway` and `auth`. The usual local loop runs only
the two datastores in Docker and the Go services from source (see README step 3), so
`docker compose logs gateway auth` is empty unless you started those containers too.

## Player App

Start the app:

```bash
cd /Users/john/Sandbox/taptrade-workspace/taptrade/apps/taptrade-platform/frontend/packages/app
NEXT_PUBLIC_API_URL=http://localhost:18080 \
NEXT_PUBLIC_AUTH_URL=http://localhost:18081 \
NEXT_PUBLIC_WS_URL=ws://localhost:18080/ws \
yarn dev -p 3010
```

Open `http://localhost:3010/predict`. If markets are missing, the database has not been
migrated and seeded — see README steps 2 and 3.

## Demo Accounts

- Player: `demo@taptrade.local` / `demo123`
- Admin: `admin@taptrade.local` / `admin123`

## Bug Reports

Include:

- Page or API endpoint
- Expected behavior
- Actual behavior
- Screenshot or curl output
- Browser console errors
- Relevant container logs
- Commit hash
