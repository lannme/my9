# Share Storage V2 Ops

## New env vars

- `R2_ENDPOINT`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- Optional: `R2_REGION` (default: `auto`)
- Optional: `MY9_ENABLE_V1_FALLBACK=0` (default keeps `my9_shares_v1` read fallback)
- Optional: `CRON_SECRET` (recommended in production, used by Vercel Cron Authorization header)
- Optional: `MY9_ARCHIVE_OLDER_THAN_DAYS` (default `30`)
- Optional: `MY9_ARCHIVE_BATCH_SIZE` (default `500`)
- Optional: `MY9_ARCHIVE_CLEANUP_TREND_DAYS` (default `190`)

## Migration

Run idempotent migration with checkpoint:

```bash
npm run migrate:shares:v1-to-v2
```

Useful flags:

- `--batch-size=300`
- `--max-rows=5000`

Checkpoint file: `scripts/.migrate-shares-v1.checkpoint.json`

## Migration verify

Run migration consistency checks (`old`, `v2`, `alias`, `missing`):

```bash
npm run verify:shares:v2-migration
```

## Cold archive + day-count cleanup

```bash
npm run archive:shares:cold
```

Useful flags:

- `--older-than-days=30`
- `--batch-size=500`
- `--cleanup-trend-days=190`

## Vercel Cron (daily, Hobby-safe)

- Cron route: `/api/cron/archive`
- Config file: `vercel.json`
- Current schedule: `0 3 * * *` (UTC, once per day)
- Route default behavior: archive shares older than `30` days

Notes from Vercel docs for Hobby:

- Minimum cron interval on Hobby is once per day.
- Failed runs are not retried automatically. Check logs and re-run manually when needed.

Recommended setup:

1. Set `CRON_SECRET` in Vercel project env.
2. Redeploy so `vercel.json` cron is applied.
3. Verify route manually once:
   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-domain>/api/cron/archive
   ```
