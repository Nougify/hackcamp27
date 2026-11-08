# Gemini issues

## Prod: 404 "Publisher model ... locations/us-central1/... gemini-3.8-flash was not found"

**Symptom:** Gemini calls fail in production with a 404 naming `locations/us-central1`. The same code works on localhost.

**Cause:** `gemini-3.8-flash` is only served on Vertex AI's `global` endpoint, not in `us-central1`. Localhost has `GOOGLE_CLOUD_LOCATION=global` in `.env.local`. In prod, at least one container does not see that value, so `src/lib/env.ts` falls back to its default, `us-central1`.

The service-account key is not the problem: the error names the right project, so auth worked.

`src/lib/gemini/client.ts` is the only place that creates the Gemini client, and `@google/genai` uses exactly the location we pass. So `us-central1` can only come from the container's environment or the default in `src/lib/env.ts`.

### Fix 1: code default (needs a `contract:` commit; `src/lib/**` is frozen)

In `src/lib/env.ts`:

```diff
-  GOOGLE_CLOUD_LOCATION: z.string().min(1).catch('us-central1'), // blank line in .env also falls back
+  GOOGLE_CLOUD_LOCATION: z.string().min(1).catch('global'), // blank line in .env also falls back
```

Commit it on its own, titled e.g. `contract: default GOOGLE_CLOUD_LOCATION to global`, then merge and deploy (`./deploy.sh` on the server).

Optional, to see what each container actually uses: in `getClient()` in `src/lib/gemini/client.ts`, right after the client is created, add:

```ts
console.info(`[gemini] vertex project=${env.GOOGLE_CLOUD_PROJECT} location=${env.GOOGLE_CLOUD_LOCATION}`);
```

Then check `docker compose logs web | grep gemini`.

The docs, `.env.example` and `scripts/gemini-smoke.mjs` already default to `global` (branch `jerry/vertex-global`).

### Fix 2: check the server (works without a deploy)

On the VPS:

```sh
cd ~/hackcamp27
# Must print exactly GOOGLE_CLOUD_LOCATION=global$ once. ^M$ = Windows line endings, a second line = duplicate (last one wins).
grep -n "GOOGLE_CLOUD" .env.production | cat -A
# Fix Windows line endings if needed:
sed -i 's/\r$//' .env.production
# Every replica (there are 4) must print global:
for i in 1 2 3 4; do docker compose exec --index $i web printenv GOOGLE_CLOUD_LOCATION; done
# env_file is only read when a container is created, so recreate after any change:
docker compose up -d --force-recreate web
```

Also check for other places that could set it: `.env` next to `docker-compose.yml`, or exported shell variables (`env | grep GOOGLE`).

## Local dev reminders

- Sign in: `gcloud auth application-default login` and `gcloud auth application-default set-quota-project <PROJECT_ID>`.
- `.env.local` needs `GOOGLE_CLOUD_PROJECT=<PROJECT_ID>` and `GOOGLE_CLOUD_LOCATION=global` (or leave the location out once Fix 1 is merged). If you copied an older `.env.example`, it may still say `us-central1`: change it.
- Smoke test: `node --env-file=.env.local scripts/gemini-smoke.mjs`.
