/* Tip Tap Games — feed spine + A/B renderer harness */

(function () {
  'use strict';

  /* ---------- registry ---------- */
  var GAMES = window.__TIPTAP_GAMES__ || [];
  if (!GAMES.length) { console.error('No games registered'); return; }

  /* ---------- shuffled endless order ---------- */
  var order = [];
  function extendOrder(n) {
    while (order.length < n) {
      var batch = GAMES.map(function (g, i) { return i; });
      for (var i = batch.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = batch[i]; batch[i] = batch[j]; batch[j] = t;
      }
      if (order.length && batch[0] === order[order.length - 1] && batch.length > 1) {
        var s = batch.shift(); batch.push(s);
      }
      order = order.concat(batch);
    }
  }
  extendOrder(12);

  /* ---------- renderers: exactly two, forever ---------- */
  var DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  function makeRenderer(canvas) {
    var r = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(DPR);
    return { gl: r, canvas: canvas, slot: null };
  }

  var slots = [
    makeRenderer(document.getElementById('cvA')),
    makeRenderer(document.getElementById('cvB'))
  ];

  var feed = document.getElementById('feed');
  var tpl = document.getElementById('cardTpl');
  var hint = document.getElementById('hint');

  var W = 0, H = 0;
  function measure() {
    W = feed.clientWidth;
    H = feed.clientHeight;
    slots.forEach(function (s) {
      s.gl.setSize(W, H, false);
      s.canvas.style.width = W + 'px';
      s.canvas.style.height = H + 'px';
      if (s.slot && s.slot.game && s.slot.game.resize) s.slot.game.resize(W, H);
    });
  }

  /* ---------- cards ---------- */
  var cards = [];
  function addCard(index) {
    var node = tpl.content.firstElementChild.cloneNode(true);
    var def = GAMES[order[index]];
    node.querySelector('.title').textContent = def.title;
    node.querySelector('.rule').textContent = def.rule;
    node.dataset.index = String(index);
    feed.appendChild(node);
    var card = {
      index: index,
      def: def,
      el: node,
      scoreEl: node.querySelector('.score'),
      bestEl: node.querySelector('.best'),
      overEl: node.querySelector('.over'),
      overScoreEl: node.querySelector('.over-score'),
      ctrlEl: node.querySelector('.ctrl')
    };
    card.bestEl.textContent = 'best ' + bestFor(def.slug);
    bindPointer(card);
    cards[index] = card;
    return card;
  }

  function ensureCards(upTo) {
    extendOrder(upTo + 3);
    for (var i = cards.length; i <= upTo + 2; i++) addCard(i);
  }

  /* ---------- personal best (local for now; Supabase later) ---------- */
  function bestFor(slug) {
    return parseInt(localStorage.getItem('tt_best_' + slug) || '0', 10);
  }
  function saveBest(slug, score) {
    if (score > bestFor(slug)) {
      localStorage.setItem('tt_best_' + slug, String(score));
      return true;
    }
    return false;
  }

  /* ---------- mounting ---------- */
  function mount(index) {
    var slotIdx = index % 2;
    var s = slots[slotIdx];
    if (s.slot && s.slot.index === index) return s.slot;
    unmount(slotIdx);

    var card = cards[index];
    var live = {
      index: index,
      card: card,
      score: 0,
      dead: false,
      game: null
    };

    var ctx = {
      THREE: THREE,
      width: W,
      height: H,
      // games with on-screen controls own this layer; it is wiped on unmount.
      // it sits above the canvas and is pointer-events:none until a game opts in.
      overlay: card.ctrlEl,
      card: card.el,
      setScore: function (n) {
        live.score = n;
        card.scoreEl.textContent = String(n);
      },
      addScore: function (n) {
        live.score += (n || 1);
        card.scoreEl.textContent = String(live.score);
      },
      gameOver: function () {
        if (live.dead) return;
        live.dead = true;
        var isBest = saveBest(card.def.slug, live.score);
        card.bestEl.textContent = 'best ' + bestFor(card.def.slug);
        card.overScoreEl.textContent = String(live.score);
        card.overEl.querySelector('.over-sub').textContent =
          isBest ? 'new best — tap to play again' : 'tap to play again';
        card.overEl.hidden = false;
        if (navigator.vibrate) navigator.vibrate(35);

        // local best is already saved above, so the run is never lost if this
        // never lands. fire-and-forget: nothing here blocks the game loop.
        var slug = card.def.slug;
        Backend.submit(slug, live.score, Math.round(live.playMs)).then(function (standing) {
          if (!standing) return;
          if (standing.rank) {
            card.overEl.querySelector('.over-sub').textContent =
              '#' + standing.rank + ' — tap to play again';
          }
          // only offer sign-in when there's a rank worth claiming
          if (live.index === current) Sheet.maybePrompt(slug, standing);
        });
      }
    };

    live.game = card.def.create(ctx);
    // accumulated in frame(): real play time, not wall time. cards mount ahead
    // of being reached, and a card can be scrolled away from mid-run.
    live.playMs = 0;
    card.scoreEl.textContent = '0';
    card.overEl.hidden = true;
    s.slot = live;
    return live;
  }

  function unmount(slotIdx) {
    var s = slots[slotIdx];
    if (!s.slot) return;
    if (s.slot.game && s.slot.game.dispose) {
      try { s.slot.game.dispose(); } catch (e) { console.warn(e); }
    }
    if (s.slot.card) {
      s.slot.card.overEl.hidden = true;
      s.slot.card.ctrlEl.innerHTML = '';
      s.slot.card.el.className = 'card';   // drop any classes the game set
    }
    s.slot = null;
  }

  function restart(index) {
    var slotIdx = index % 2;
    unmount(slotIdx);
    mount(index);
  }

  /* ---------- input forwarding ---------- */
  function bindPointer(card) {
    var el = card.el;
    var down = false;

    function local(e) {
      var t = e.touches ? e.touches[0] : e;
      var r = el.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }

    function slotFor() {
      var s = slots[card.index % 2];
      return (s.slot && s.slot.index === card.index) ? s.slot : null;
    }

    el.addEventListener('pointerdown', function (e) {
      var live = slotFor(); if (!live) return;
      if (live.dead) { restart(card.index); return; }
      down = true;
      var p = local(e);
      if (live.game.pointer) live.game.pointer('down', p.x, p.y);
    });

    el.addEventListener('pointermove', function (e) {
      if (!down) return;
      var live = slotFor(); if (!live || live.dead) return;
      var p = local(e);
      if (live.game.pointer) live.game.pointer('move', p.x, p.y);
    });

    function up(e) {
      if (!down) return;
      down = false;
      var live = slotFor(); if (!live || live.dead) return;
      var p = local(e);
      if (live.game.pointer) live.game.pointer('up', p.x, p.y);
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    el.querySelectorAll('.rail-btn').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var act = b.dataset.act;
        if (act === 'board') {
          Sheet.open(card.def.slug);
        } else if (act === 'share') {
          shareCard(card);
        } else {
          console.log('rail action:', act, card.def.slug);   // TODO: like
        }
      });
    });
  }

  /* ---------- share ---------- */
  // challenge link: lands the recipient on this exact game card
  function shareCard(card) {
    var url = location.origin + location.pathname + '?g=' + encodeURIComponent(card.def.slug);
    var best = bestFor(card.def.slug);
    var text = best
      ? 'I scored ' + best + ' on ' + card.def.title + '. Beat it.'
      : 'Play ' + card.def.title + ' on Tip Tap Games.';
    if (navigator.share) {
      navigator.share({ title: 'Tip Tap Games', text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + ' ' + url).then(function () {
        if (hint) {
          hint.textContent = 'link copied';
          hint.classList.remove('gone');
          setTimeout(function () { hint.classList.add('gone'); }, 1600);
        }
      }).catch(function () {});
    }
  }

  /* ---------- scroll ---------- */
  var current = -1;

  function onScroll() {
    var top = feed.scrollTop;
    var idx = Math.round(top / H);
    var raw = top / H;
    var base = Math.floor(raw);
    var frac = raw - base;

    ensureCards(base + 1);

    // card i is always drawn by slot i % 2 — no swapping needed
    var a = slots[base % 2];
    var b = slots[(base + 1) % 2];
    a.canvas.style.transform = 'translateY(' + (-frac * H) + 'px)';
    b.canvas.style.transform = 'translateY(' + ((1 - frac) * H) + 'px)';
    a.canvas.style.visibility = 'visible';
    b.canvas.style.visibility = frac > 0.002 ? 'visible' : 'hidden';

    if (idx !== current) {
      current = idx;
      ensureCards(idx + 1);
      mount(idx);
      mount(idx + 1);
      if (idx > 0 && hint && !hint.classList.contains('gone')) hint.classList.add('gone');
    }
  }

  feed.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('resize', function () {
    measure();
    onScroll();
  });

  /* ---------- loop ---------- */
  var last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // one throwing frame must never kill the loop — that would black out the whole feed
    try {
      var base = Math.floor(feed.scrollTop / H);
      for (var i = 0; i < 2; i++) {
        var s = slots[i];
        if (!s.slot) continue;
        var isActive = (s.slot.index === current);
        if (isActive && !s.slot.dead && s.slot.game.update) {
          s.slot.game.update(dt);
          s.slot.playMs += dt * 1000;
        }
        // only draw what can actually be seen
        if (s.slot.index === base || s.slot.index === base + 1) {
          s.gl.render(s.slot.game.scene, s.slot.game.camera);
        }
      }
    } catch (e) {
      console.error('frame', e);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- boot ---------- */

  // put a specific game on the first card — used by challenge links (?g=slug)
  // and to land you back where you were after the OAuth round trip
  function preferFirst(slug) {
    for (var gi = 0; gi < GAMES.length; gi++) {
      if (GAMES[gi].slug === slug) { order[0] = gi; return true; }
    }
    return false;
  }

  // OAuth is a full-page redirect, so remember the card before leaving
  Sheet.setStashHook(function () {
    var c = cards[current];
    Backend.stashReturn({ slug: c ? c.def.slug : null });
  });

  var returning = Backend.takeReturn();
  var wanted = returning && returning.slug;
  if (!wanted) {
    try { wanted = new URLSearchParams(location.search).get('g'); } catch (e) { /* ignore */ }
  }
  if (wanted) preferFirst(wanted);

  ensureCards(1);
  measure();
  onScroll();
  current = 0;
  mount(0);
  mount(1);
  requestAnimationFrame(frame);

  // once auth settles, confirm the claim without pulling anyone off a game
  Backend.ready.then(function () {
    if (!returning) return;
    var s = Backend.session();
    if (s) Sheet.open(returning.slug, 'Signed in as ' + s.handle + '. Your runs are claimed.');
  });

  window.addEventListener('orientationchange', function () {
    setTimeout(function () { measure(); onScroll(); }, 250);
  });
})();
