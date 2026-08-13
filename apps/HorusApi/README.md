# Horus API

Cloudflare Worker used as a small, cacheable proxy for TMDB search. The TMDB
read token stays in a Worker secret and is never bundled in HorusRemote.

## Local development

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Add the TMDB API Read Access Token to `.dev.vars`.
3. Run `pnpm --filter horus-api dev`.

## Deployment

```sh
pnpm --filter horus-api exec wrangler login
pnpm --filter horus-api exec wrangler secret put TMDB_READ_TOKEN
pnpm --filter horus-api deploy
```

The mobile app expects the Worker base URL in `EXPO_PUBLIC_HORUS_API_URL`.
