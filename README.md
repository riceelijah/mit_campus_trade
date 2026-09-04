### MIT Campus Trade

# First off, how does the game work?:

- On the first day of orientation, we will distribute packs of Campus Trade cards to all of the freshmen. Each student will receive a pack that matches the color of their team, so a red team kid gets a red pack, with all red cards inside. Blue has blue, and so on. Each pack has 6-8 cards in it, with 3 unique cards per pack. So in total, 36 Unique cards on day one.
- The Goal of campus trade is to make friends. The second goal major goal is to collect a card in every one of the 12 flag colors. You may notice: This is impossible on day 1. We discourage speedrunning and would rather people just have fun trading with their friends.
- Each card has artwork on the front made by an MIT student, depicting a person, place, event, dorm, club, etc. on campus. On the back is an excerpt from an interview with a student on that topic, and an exchange cost. This exchange cost is a ritual that must be done by both people to trade that card. It could be an icebreaker question, taking a selfie together, making plans to go get food, etc.
- On the second day of orientation, we will distribute "Day 2" Packs to all students who attend the events on day 2. These packs have new cards not available on the first day, as well as an objective card [something like "Collect all 5 Cultural Group cards for a prize" or "collect the music cards" or something like that. More goals to be had. This adds more new cards into the system and encourages more trading.
- There will be a physical booth set up somewhere on campus where students can go with their cards once they've reached a goal to get a prize! Like a tote bag or a hat or something like that.
- From there, students go out into the campus in search of people to trade with. Some upperclassmen will also have special "Upperclassmen" packs with cards not available to any freshmen. These cards are Holos, probably.
- From there the game goes on and on, as long as they wish to play. Trading and making friends!!

# What is this?:

- This is the website on which campus trade will be hosted, matching with the physical trading card game happening at the same time

## Development setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in a `SESSION_SECRET` (see the comment in
   `.env.example` for how to generate one). Not required for local dev -- an insecure
   default is used if unset -- but required before any production deploy.
3. `npm run dev` runs the Vite dev server and the Express API concurrently.
4. `npm run build` type-checks and produces a production frontend build in `dist/`.
5. `npm run lint` / `npm run format` / `npm run test` run the linter, formatter, and test suite.

### Environment variables

| Variable         | Required      | Default              | Purpose                                                                                  |
| ---------------- | ------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `PORT`           | no            | `3001`               | Port the Express API listens on                                                          |
| `SESSION_SECRET` | in production | dev-only placeholder | Signs the session cookie; server refuses to start in production without it               |
| `ADMIN_EMAIL`    | no            | `ejrice@mit.edu`     | Email address auto-granted admin on registration                                         |
| `NODE_ENV`       | in production | unset                | Set to `production` for real deploys (enables secure cookies, enforces `SESSION_SECRET`) |

**`SESSION_SECRET` and `ADMIN_EMAIL` must actually have a value, not just exist as a blank
line.** Copying `.env.example` and leaving `SESSION_SECRET=`/`ADMIN_EMAIL=` empty is _not_ the
same as leaving them unset -- an empty string still counts as "set" and skips the normal
default, leaving sessions signed with an empty secret (forgeable) and nobody ever auto-granted
admin. Put a real value after the `=`, or delete the line entirely.

## Production deployment

This is two separate systems, deployed independently -- there's no single command that starts
"the app."

1. **The frontend** -- a static build (`dist/`, from `npm run build`) served from **Amazon S3**
   (bucket `mitcampustrade.ccc-mit.org`) behind **Amazon CloudFront**
   (distribution `E2FAAV4FWGKI2K`). Nothing in this repo serves it -- there's no nginx in front
   of it, no `vite preview` in production, and no static-file-serving code in
   `server/index.ts` (it's API-only, always has been).

2. **The Express API** (`server/index.ts`) -- serves everything under `/api/*`, running on its
   own EC2 instance. Nothing else serves this; there's no fallback.

### Deploying the frontend

```bash
git checkout deploy-clean
git pull
npm ci
npm run deploy:frontend   # builds dist/, syncs it to S3, invalidates CloudFront
```

`npm run deploy:frontend` (`scripts/deploy-frontend.ts`) always rebuilds from source first -- it
never assumes an on-disk `dist/` is current -- then runs `aws s3 sync` against the bucket above
with `--delete` (so stale build artifacts don't accumulate) and a CloudFront invalidation for
`/*` (so viewers stop getting cached files immediately instead of whenever their cache happens
to expire). Requires the AWS CLI installed and configured locally with credentials that can
write to that bucket and create invalidations on that distribution -- see the script's own doc
comment for details.

**Open item, not yet verified:** this is a client-side-routed React app, so a hard refresh on
e.g. `/cards/123` needs to resolve to `index.html`, not a 404/403 straight from S3. That
requires either an S3 error-document pointing at `index.html`, or a CloudFront custom error
response (403 and 404 → `/index.html`, HTTP 200) configured on the distribution. Confirm this is
actually set up before relying on deep links or hard refreshes working in production.

### Deploying the API

Deploy from **`main`** -- unlike the frontend below, the live host does *not* use
`deploy-clean` for this (an earlier version of this doc said otherwise; `deploy-clean` still
exists and does have its own `start` script, but it's not what the running host is actually
tracking, so don't check it out here). `main` has its own `start` script now too, added
specifically so this works from either branch:

```bash
cd /opt/campus-trade
git pull
npm ci
npm run start      # runs the API on $PORT -- see the systemd unit below for the real value
```

(No `npm run build` needed here -- that only matters for the frontend deploy above. This host
never serves `dist/`.)

`npm run start` runs in the foreground and dies the moment its terminal/session closes. Run it
under a process supervisor so it survives a disconnect and restarts on its own if it crashes --
don't run it raw in a terminal for anything other than a quick local check. The live host is
Ubuntu on EC2, under systemd, as **`campus-trade.service`** (not `campus-trade-api` -- another
place an earlier version of this doc drifted from reality). Its real unit file, verified via
`systemctl cat campus-trade.service`:

```ini
# /etc/systemd/system/campus-trade.service
[Unit]
Description=Campus Trade API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/campus-trade
EnvironmentFile=/etc/campus-trade.env
ExecStart=/opt/campus-trade/node_modules/.bin/tsx server/index.ts
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Note it calls `tsx` directly rather than `npm run start` (both do the same thing), and keeps
`SESSION_SECRET`/`ADMIN_EMAIL`/`DB_PATH`/`NODE_ENV`/`PORT` in **`/etc/campus-trade.env`**
(`KEY=value` per line, no `Environment=` prefix) rather than inline in the unit -- lock that
file down (`sudo chmod 600 /etc/campus-trade.env`) instead of the unit file. **This host's env
file sets `PORT=5000`**, not the table's documented default of 3001 -- check
`/etc/campus-trade.env` (or just the "listening on" line in the logs) before assuming which
port to hit.

Setting up a fresh host from scratch:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now campus-trade
sudo systemctl status campus-trade   # should show active (running)
sudo journalctl -u campus-trade -f   # logs
```

From then on, a redeploy is `git pull && npm ci && sudo systemctl restart campus-trade` -- no
more terminal sessions that die and take the API down with them (this is what actually happened
once already -- see the git history around the "Re-apply ADMIN_EMAIL/SESSION_SECRET" commits
for the full story).

There's also an hourly cron job (`crontab -l` as the `ubuntu` user) running `backup-db.ts`
against the real `DB_PATH`/`BACKUP_DIR`, independent of the manual `npm run backup:db` calls
below -- both write to the same `/var/lib/campus-trade/backups`, so a manual backup right before
something risky is extra insurance, not the only backup that exists.

Also: the camera-based QR scanner requires a secure context -- HTTPS (or `localhost`). Over
plain HTTP, browsers don't expose camera access at all, and the scanner fails with "Could not
access the camera" regardless of permissions. The public CloudFront domain is already HTTPS, so
this is covered for the deployed site; the manual ID-entry fallback in the scanner exists for
any other context where it isn't.

**After the first deploy:** run `npx tsx scripts/import-card-copies.ts` to populate
`card_instances` from `data/card_copies_master.csv`. This is **destructive** -- it wipes
`verified_trades`, `exchange_events`, `card_instances`, and `seen_supercards` first -- so only
run it when that's actually intended (a fresh environment, or a deliberate reset), never
casually against a database with real trading history.

**After adding/changing physical card copies once trading has actually started:** use
`npx tsx scripts/add-card-copies.ts` instead -- same source sheet, but purely additive. It
inserts only the unique_ids in `data/card_copies_master.csv` that don't already exist in
`card_instances`; every existing instance, and all ownership/trade history, is left completely
untouched. Safe to re-run (a unique_id already added is just skipped the second time).

Running either by hand like this doesn't go through `EnvironmentFile`, so `DB_PATH` isn't set
unless you export it yourself first -- without it, both scripts default to a `campus_trade.db`
next to the code instead of the real one at `/var/lib/campus-trade/campus_trade.db`, which is
very much not what you want:

```bash
DB_PATH=/var/lib/campus-trade/campus_trade.db npx tsx scripts/add-card-copies.ts
```

**Quick health check after any of the above** (port from `/etc/campus-trade.env`, not
necessarily the table's documented default -- see above):

```bash
curl -s http://localhost:$PORT/api/auth/me
```

Should print `{"error":"Not logged in"}` -- real JSON, not an HTML page or a connection error.
If it doesn't, the API isn't actually running/reachable and nothing account-related will work,
no matter how correct the code deployed is.
