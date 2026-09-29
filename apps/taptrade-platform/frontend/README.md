# Tap Trade front ends (yarn workspace)

This directory is the yarn-workspaces root for the player app
(`packages/app`), the back office (`packages/office`) and the shared API client
(`packages/api-client`). Install once from here:

```bash
yarn install --frozen-lockfile
```

Requirements, commands, environment variables and tests are documented in
[`docs/ENVIRONMENT.md`](../../../docs/ENVIRONMENT.md). The package-level rules
are in [`packages/app/CLAUDE.md`](./packages/app/CLAUDE.md) and
[`packages/office/README.md`](./packages/office/README.md).

(Until 2026-09-29 this file carried sportsbook-era instructions — Node 14, Yarn
1.17 and a private npm registry. None of them apply; see git history if needed.)
