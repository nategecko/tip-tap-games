/* Tip Tap Games — leaderboard + sign-in sheet.
 *
 * One sheet for the whole app, drawn over the feed. It is never a route: the
 * card underneath stays mounted and the player returns to exactly where they
 * were. Sign-in is offered here and only here, and only once a score is worth
 * keeping — the feed must never open on a login wall.
 */

window.Sheet = (function () {
  'use strict';

  var el, scrim, body, titleEl, subEl, boardEl, authEl, whoEl;
  var openSlug = null;
  var promptedThisSession = false;
  var onSignInStash = null;      // set by app.js so OAuth can return to the card

  function init() {
    if (el) return;
    el = document.getElementById('sheet');
    scrim = el.querySelector('.sheet-scrim');
    body = el.querySelector('.sheet-body');
    titleEl = el.querySelector('.sheet-title');
    subEl = el.querySelector('.sheet-sub');
    boardEl = el.querySelector('.board');
    authEl = el.querySelector('.sheet-auth');
    whoEl = el.querySelector('.sheet-who');

    scrim.addEventListener('click', close);

    el.querySelectorAll('.auth-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var provider = b.dataset.provider;
        if (onSignInStash) onSignInStash();
        b.disabled = true;
        Promise.resolve(Backend.signIn(provider)).then(function () {
          // mock mode signs in instantly; live mode has already navigated away
          if (!Backend.live) { b.disabled = false; render(openSlug); }
        }).catch(function (e) {
          b.disabled = false;
          console.warn('sign-in', e);
          subEl.textContent = "Couldn't reach the sign-in provider. Try again.";
        });
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.hidden) close();
    });

    // drag the sheet down to dismiss
    var startY = null;
    body.addEventListener('pointerdown', function (e) {
      if (body.scrollTop > 0) return;
      startY = e.clientY;
    });
    body.addEventListener('pointermove', function (e) {
      if (startY === null) return;
      var dy = e.clientY - startY;
      if (dy > 0) body.style.transform = 'translateY(' + dy + 'px)';
    });
    function end(e) {
      if (startY === null) return;
      var dy = e.clientY - startY;
      startY = null;
      body.style.transform = '';
      if (dy > 90) close();
    }
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);

    Backend.onChange(function () { if (!el.hidden) render(openSlug); });
  }

  function pct(standing) {
    if (!standing || standing.percentile === null || standing.percentile === undefined) return null;
    return 'You beat ' + standing.percentile + '% of players';
  }

  function renderWho() {
    var s = Backend.session();
    if (!s) { whoEl.hidden = true; authEl.hidden = false; return; }
    authEl.hidden = true;
    whoEl.hidden = false;
    whoEl.innerHTML = '';
    var av = document.createElement(s.avatar_url ? 'img' : 'div');
    av.className = 'av';
    if (s.avatar_url) av.src = s.avatar_url;
    var nm = document.createElement('span');
    nm.textContent = 'signed in as ' + s.handle;
    var out = document.createElement('button');
    out.className = 'out';
    out.textContent = 'sign out';
    out.addEventListener('click', function () { Backend.signOut(); });
    whoEl.appendChild(av); whoEl.appendChild(nm); whoEl.appendChild(out);
  }

  function row(rnk, handle, avatarUrl, best, isMe) {
    var li = document.createElement('li');
    if (isMe) li.className = 'me';

    var rk = document.createElement('span');
    rk.className = 'rk';
    rk.textContent = rnk;

    var av = document.createElement(avatarUrl ? 'img' : 'div');
    av.className = 'av';
    if (avatarUrl) { av.src = avatarUrl; av.alt = ''; }

    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = handle + (isMe ? ' (you)' : '');

    var sc = document.createElement('span');
    sc.className = 'sc';
    sc.textContent = best;

    li.appendChild(rk); li.appendChild(av); li.appendChild(nm); li.appendChild(sc);
    return li;
  }

  function renderBoard(rows, standing) {
    boardEl.innerHTML = '';
    if (!rows.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No runs yet. Yours would be first.';
      boardEl.appendChild(li);
      return;
    }
    var hasMe = false;
    rows.forEach(function (r) {
      if (r.is_me) hasMe = true;
      boardEl.appendChild(row(r.rnk, r.handle, r.avatar_url, r.best, r.is_me));
    });

    // ranked below the cut — show them anyway, otherwise "you're #12" points at
    // a board they don't appear on
    if (!hasMe && standing && standing.rank) {
      var gap = document.createElement('li');
      gap.className = 'empty';
      gap.textContent = '⋯';
      boardEl.appendChild(gap);
      var s = Backend.session();
      boardEl.appendChild(
        row(standing.rank, s ? s.handle : 'guest', s ? s.avatar_url : null, standing.best, true)
      );
    }
  }

  function render(slug, headline) {
    var def = (window.__TIPTAP_GAMES__ || []).filter(function (g) { return g.slug === slug; })[0];
    titleEl.textContent = def ? def.title : 'Leaderboard';
    subEl.textContent = headline || 'Loading…';
    renderWho();

    // when we're asking someone to sign in, keep the board short so the buttons
    // stay above the fold — the CTA is the whole point of that variant
    var limit = (headline && !Backend.session()) ? 5 : 10;

    return Backend.board(slug, limit).then(function (res) {
      renderBoard(res.rows || [], res.standing);
      if (!headline) {
        var st = res.standing;
        subEl.textContent =
          (st && st.rank ? 'You’re #' + st.rank + ' of ' + st.total + '. ' : '') +
          (pct(st) || 'Play a run to get on the board.');
      }
      return res;
    });
  }

  function open(slug, headline) {
    init();
    openSlug = slug;
    el.hidden = false;
    // next frame so the transition actually runs
    requestAnimationFrame(function () { el.classList.add('in'); });
    render(slug, headline);
  }

  function close() {
    if (!el || el.hidden) return;
    el.classList.remove('in');
    var done = function () { el.hidden = true; };
    setTimeout(done, 260);
  }

  return {
    open: open,
    close: close,
    isOpen: function () { return el && !el.hidden; },
    setStashHook: function (fn) { onSignInStash = fn; },

    /* Called after every run. Only interrupts when there is genuinely something
       to claim, and only once per session — a prompt on every game over would
       be the login wall the brief warns about, just delayed. */
    maybePrompt: function (slug, standing) {
      init();
      if (Backend.session()) return false;          // already signed in
      if (promptedThisSession) return false;
      if (!standing || !standing.rank) return false;
      if (standing.rank > 10) return false;
      promptedThisSession = true;
      open(slug, 'You’re #' + standing.rank + ' — sign in to claim it.');
      return true;
    }
  };
})();
