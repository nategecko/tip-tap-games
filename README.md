# Tip Tap Games

A vertical, swipe-through feed where every card is a playable 3D mini game instead of a video.
No menus, no tutorials, no loading. Land on a game that's already running, play as long as
you like, swipe when you're bored.

**Live:** _add your Vercel URL here_

## Stack

- Plain HTML, CSS and JavaScript — no build step
- Three.js (r128) from CDN
- Supabase for scores and leaderboards _(not wired yet)_
- Deployed on Vercel as a static site

## Run it

Open `index.html` in a browser. That's it.

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

Only **Hardwater** is wired up right now. `games/fit.js` and `games/placeholder.js` are still
in the repo but not loaded — add their `<script>` tags back to `index.html` to bring them in.

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

- [x] Vertical snap feed with momentum
- [x] A/B renderer harness, auto start / auto stop
- [x] DOM control layer for games that need a stick or a knob
- [x] Hardwater — walk, hook, fight, land
- [ ] Second game back in the feed (swiping currently reshuffles the same one)
- [ ] Sound — reel clicks and the strike, muted by default
- [ ] Scores persisted to Supabase
- [ ] Live leaderboard
- [ ] Guest play with device ID
