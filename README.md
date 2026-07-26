# Tip Tap Games

A vertical, swipe-through feed where every card is a playable 3D mini game instead of a video.
No menus, no tutorials, no loading. Land on a game that's already running, play as long as
you like, swipe when you're bored.

**Live:** _add your Vercel URL here_

## Stack

- Plain HTML, CSS and JavaScript — no build step
- Three.js (r128) from CDN
- Supabase for auth, scores and leaderboards
- Deployed on Vercel as a static site

## Run it

Open `index.html` in a browser. That's it.

With `config.js` blank the app runs on a **seeded local mock backend** — the
leaderboard, ranks, the sign-in prompt and the guest merge all work offline. Fill
in the two Supabase values to go live; nothing else changes.

## Backend

### One-time setup

1. **Supabase project** → copy the Project URL and anon key from Settings → API
   into `config.js`. Both are public; RLS is what protects the data. The
   `service_role` key must never go in this repo.
2. **Run `supabase/schema.sql`** in the SQL editor. Creates the three tables,
   the RLS policies, and the functions. Safe to re-run.
3. **Discord** → [developer portal](https://discord.com/developers/applications)
   → OAuth2 → add redirect `https://<project-ref>.supabase.co/auth/v1/callback`.
   Paste client id/secret into Supabase → Auth → Providers → Discord.
4. **Google** → Cloud Console → OAuth client (Web) → same callback URL. Paste
   into Supabase → Auth → Providers → Google.
5. **Supabase → Auth → URL Configuration** → Site URL is your production domain;
   add `http://localhost:8123` so local dev works. Set the production domain on
   Vercel *before* this step or you'll be chasing preview URLs.

### How it fits together

`backend.js` is the only file that talks to the network, and it presents the same
surface whether it's running the mock or Supabase. Two rules shape it:

**The feed never waits on the network.** `submit()` appends to a localStorage
outbox and returns; the flush runs behind it and retries, with permanent
validation failures dropped rather than retried forever. Personal best is written
to localStorage *before* the submit, so a dead network costs you a rank line and
nothing else.

**The client never writes scores.** RLS denies inserts on `scores` outright. The
only way in is `submit_score()`, a security-definer function that checks the
score against a per-game ceiling, rejects implausible points-per-second, rate
limits per device, and takes `player_id` from `auth.uid()` — never from the
caller. `app.js` accumulates real play time in the frame loop rather than wall
time, so the rate check means something.

**Guest merge.** Every run carries a `device_id` from the first swipe. Sign-in
calls `claim_device_scores()`, which reattaches those rows to the account. The
device id is a random UUID on purpose: a guessable one would let anyone claim
someone else's runs.

**OAuth leaves the page.** That's unavoidable with any hosted provider. The sheet
stashes the current card before redirecting and `app.js` puts that game back on
card 0 on return, so you land where you left.

## Architecture

The one decision everything else hangs off: **there are exactly two WebGL renderers, forever.**

Mobile Safari caps WebGL contexts and silently drops the oldest when you exceed the limit, so
giving each feed card its own canvas breaks the app after a dozen swipes. Instead, two fixed
canvases sit behind the scrolling feed. Card `i` is always drawn by renderer `i % 2`, which means
the swap needs no bookkeeping — as you scroll, the renderer holding the card you just left is
torn down and remounted with the card ahead of you.

The scrolling DOM is transparent chrome: score, rail, title, rule. The canvases are moved with
`translateY` to track scroll position, so the swipe looks like the games themselves are scrolling.

## The games

Five: **Hardwater**, **Keeper**, **Downhill**, **Snow Fight** and **Drift**.

### Drift — a mountain pass, throttle pinned

Hold to break traction. The corner throws the car toward the outside and the
slip you build fights it, so too little understeers off the edge and too much
rotates you into the inside — a balance rather than a timing window. Coasting
through a corner without drifting resets the combo, which costs you without
ending the run. Touching either edge does end it.

The road is a single geometry rewritten every frame from a curvature function
of distance, with guardrails and pines driven by the same per-segment offsets so
everything bends together. Segments are also drawn *behind* the car so the
ribbon reaches past the chase camera instead of stopping in a hard edge, and the
offsets are normalised so the car's own segment is the origin — otherwise x = 0
isn't the middle of the road and the car sits visibly off-line.

The scoring is built to reward commitment. A bot that micro-corrects to stay
centred survived 8036m for 1060 points at x2; one that committed to real slides
went 8397m for 3644 at x8. Same survival, 3.4x the score for actually drifting.

The two starter games from the original scaffold (Fit and Lock) have been
removed. They're recoverable from git history if ever wanted, and their rows in
the `games` table are set inactive rather than deleted so existing score history
survives.

### Snow Fight — forts across the yard

Heads pop up from behind snow forts for about a second. Tap a red jacket to
throw. Blue jackets are your own team, so mashing every target is exactly how
you lose — hitting one costs a life and resets your multiplier. Let a red one
finish winding up and you wear the snowball instead. Three mistakes ends it.

The enemy's throwing arm rises over the whole window, so the throw is
telegraphed rather than sprung on you. Hits are decided on tap and the thrown
snowball is purely cosmetic, which keeps it feeling honest at distance.

Targets are hit-tested in screen space with a radius that scales with depth,
not by raycast — the far forts are small on a phone and a generous radius is
much kinder than pixel-accurate picking. Forts are arranged in receding rows
rather than a wide line for the same portrait-FOV reason as Keeper.

### Downhill — three lanes down a piste

Tap a side to carve into that lane and hold it. Rocks and trees end the run on
contact; slalom gates pay a bonus for skiing through them, and a gate sitting
beside a rock is a real decision rather than free points. Speed climbs the whole
way and the camera FOV widens with it, which is where most of the sensation
comes from.

It shares its input with Keeper, so it deliberately differs on feel: you hold a
lane instead of snapping back to centre, one hit ends the run rather than
costing a life, and the score is distance rather than discrete events.

Rows never block all three lanes and gaps never fall below reaction time, so
every row has a legal answer. A path-finding bot cleared 2176m, which is the
check that the difficulty curve is fair rather than merely steep.

### Keeper — you're in goal

Tap a side to dive that way. Shots down the middle you block by standing still,
which makes a dive a commitment rather than a reflex — three outcomes out of two
buttons plus the option of doing nothing. Later shots curl late: go early and
you're beaten, hold and you can read it. Concede three and the run ends.

Portrait forces the whole layout. A regulation 7.32m goal cannot fit a 9:16
frame without pushing the camera so far back the keeper is a speck, so the goal
is arcade-scaled to 3.9 and the camera sits at exactly 7.2 units — the closest
distance that still fits both posts. That also means the camera is behind the
net looking through it, like a TV camera behind the goal, so the net is
deliberately sparse and faint rather than a full grid.

### Hardwater — ice fishing

Walk a frozen lake at dusk with a thumbstick. Glowing holes mean fish are under them; a shoal
roams beneath the ice and warms holes as it passes, so the glow is the thing you read. Stop on
a hole and your line drops on its own. When one bites, the rod loads, a strike bead flares red,
and the reel lights up — crank it in circles with your thumb to bring the fish up.

The whole game is the tension arc on that reel. The fish alternates between running and tiring.
Crank while it runs and tension spikes and the line snaps; crank while it's tired and it comes
up clean. You watch the fish, not the meter. Every landed fish buys back clock; the run ends
when the clock does.

## Adding a game

Drop a file in `games/`, add a `<script>` tag to `index.html`, and register:

```js
window.__TIPTAP_GAMES__.push({
  slug: 'my-game',
  title: 'My game',
  rule: 'One sentence, understandable in two seconds.',
  create: function (ctx) {
    // ctx: { THREE, width, height, setScore, addScore, gameOver, overlay, card }
    return {
      scene, camera,
      update: function (dt) {},
      pointer: function (type, x, y) {},   // 'down' | 'move' | 'up'
      resize: function (w, h) {},
      dispose: function () {}              // must free geometries and materials
    };
  }
});
```

Rules for a game to belong here: one mechanic, understandable in two seconds, endless.

### On-screen controls

`ctx.pointer` is a single stream and the card is `touch-action:pan-y`, so it can't do
multi-touch and vertical drags on it belong to the feed. A game that needs a stick, a knob or
two thumbs at once builds real DOM instead:

- `ctx.overlay` — an empty per-card div above the canvas. It's `pointer-events:none`; set
  `pointer-events:auto` **and `touch-action:none`** on each control so the feed doesn't steal
  the gesture. The harness wipes it on unmount, which takes your listeners with it.
- `ctx.card` — the card element, for contextual chrome. Hardwater adds a `fighting` class that
  fades the rail out while a fish is on. The harness resets `className` on unmount.

Ship the control CSS from inside the game file (inject a `<style>` once, guarded by id) so the
game stays a single drop-in file.

## Performance rules

- `devicePixelRatio` capped at 1.5
- Geometry built from primitives in code, zero loaded assets
- No shadow maps, no post-processing, no antialiasing
- Fog for depth, flat shading for the look
- `dispose()` must free everything or memory leaks across swipes

## Status

Against the build spec's Definition of Done:

- [x] Vertical snap feed with momentum
- [x] 3+ playable games — Hardwater, Keeper, Downhill, Snow Fight, Drift
- [x] Auto start / auto stop
- [x] Endless feed
- [x] Guest play, then login — device ID from the first swipe, OAuth offered
      only at a rank worth claiming
- [x] Persisted scores — server-validated writes
- [x] Live leaderboard — top 10 plus your own rank, on the card
- [x] Community hooks — per-game board, "you beat N% of players", challenge link
- [ ] **Deployed public URL** — the one row still failing
- [ ] Supabase credentials in `config.js` (running on the mock until then)
- [ ] Sound — reel clicks and the strike, muted by default
- [ ] Ghost rival and daily board
