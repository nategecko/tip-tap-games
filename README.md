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

## Adding a game

Drop a file in `games/`, add a `<script>` tag to `index.html`, and register:

```js
window.__TIPTAP_GAMES__.push({
  slug: 'my-game',
  title: 'My game',
  rule: 'One sentence, understandable in two seconds.',
  create: function (ctx) {
    // ctx: { THREE, width, height, setScore, addScore, gameOver }
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

Rules for a game to belong here: one mechanic, understandable in two seconds, one thumb,
endless. Horizontal drags only — vertical belongs to the feed.

## Performance rules

- `devicePixelRatio` capped at 1.5
- Geometry built from primitives in code, zero loaded assets
- No shadow maps, no post-processing, no antialiasing
- Fog for depth, flat shading for the look
- `dispose()` must free everything or memory leaks across swipes

## Status

- [x] Vertical snap feed with momentum
- [x] A/B renderer harness, auto start / auto stop
- [x] Two playable games
- [ ] Third game
- [ ] Scores persisted to Supabase
- [ ] Live leaderboard
- [ ] Guest play with device ID
