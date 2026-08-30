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

This is two separate things that both have to be running, plus a reverse proxy in front of
them -- there's no single command that starts "the app."

1. **The Express API** (`server/index.ts`) -- serves everything under `/api/*`. Nothing else
   serves this; there's no fallback.
2. **The built static frontend** (`dist/`, from `npm run build`) -- plain static files. Nginx
   (or whatever's fronting the site) should serve these directly. **Do not run `vite preview`
   or `vite` itself as the production frontend** -- that's a dev-convenience server, not meant
   to sit behind a public domain, and critically it does not know about `/api/*` at all, so
   proxying to it instead of nginx serving `dist/` directly silently breaks every API call
   while the page itself still loads fine (this exact mistake is what took the site down during
   testing -- nothing was listening on the API's port at all, only a stray Vite process was
   up).

Deploy from the **`deploy-clean`** branch, not `main` -- it's the one with the `start` script
and without dev-only tooling (tests, eslint, etc.) that has no reason to ship.

```bash
git checkout deploy-clean
git pull
npm ci
npm run build      # produces dist/
npm run start      # runs the API on $PORT (default 3001) -- only exists on this branch
```

`npm run start` runs in the foreground and dies the moment its terminal/session closes. Run it
under whatever process supervisor is normally used on the box (`pm2`, a `systemd` service,
etc.) so it survives a disconnect and restarts if it crashes. In a pinch, `screen -S
campus-trade-api` before `npm run start`, then `Ctrl+A` `D` to detach, works as a stopgap.

**Nginx** (or equivalent) needs to do two things:

- Serve `dist/` as static files for everything else, with a fallback to `dist/index.html` for
  unknown paths (this is a client-side-routed React app -- a hard refresh on e.g. `/cards/123`
  has to still resolve to the app, not a 404).
- Reverse-proxy `/api/` to `http://localhost:$PORT` (the Express process from above).

Also: the camera-based QR scanner requires a secure context -- HTTPS (or `localhost`). Over
plain HTTP, browsers don't expose camera access at all, and the scanner fails with "Could not
access the camera" regardless of permissions. TLS has to be set up before that feature works;
the manual ID-entry fallback in the scanner covers this in the meantime.

**After the first deploy (or after adding/changing physical card copies):** run
`npx tsx scripts/import-card-copies.ts` to populate `card_instances` from
`data/card_copies_master.csv`. This is **destructive** -- it wipes `verified_trades`,
`exchange_events`, `card_instances`, and `seen_supercards` first -- so only run it when that's
actually intended (a fresh environment, or a deliberate reset), never casually against a
database with real trading history.

**Quick health check after any of the above:**

```bash
curl -s http://localhost:$PORT/api/auth/me
```

Should print `{"error":"Not authenticated"}` -- real JSON, not an HTML page or a connection
error. If it doesn't, the API isn't actually running/reachable and nothing account-related will
work, no matter how correct the code deployed is.
