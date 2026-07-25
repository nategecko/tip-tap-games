/* Tip Tap Games — backend.
 *
 * One module between the feed and the network. Two implementations behind the
 * same surface: a seeded local mock (used while config.js is blank) and the
 * live Supabase client. Nothing above this file knows which is running.
 *
 * The rule that shapes everything here: the feed must never wait on the network.
 * submit() writes to a localStorage outbox and returns immediately; the flush
 * happens behind it and retries. A dead network costs you a rank line, never a
 * dropped run and never a stalled game loop.
 */

window.Backend = (function () {
  'use strict';

  var K_DEVICE = 'tt_device';
  var K_OUTBOX = 'tt_outbox';
  var K_RETURN = 'tt_return';
  var K_MOCK   = 'tt_mock';

  var cfg = window.TIPTAP_CONFIG || {};
  var LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  var supa = null;
  var session = null;              // { id, handle, avatar_url, provider } | null
  var listeners = [];

  /* ------------------------------------------------------------ utils */

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* full/private */ }
  }

  var deviceId = (function () {
    var d = null;
    try { d = localStorage.getItem(K_DEVICE); } catch (e) { /* private mode */ }
    // long random, never derived — a guessable device id would let anyone
    // claim someone else's guest runs on sign-in
    if (!d || d.length < 30) {
      d = uuid();
      try { localStorage.setItem(K_DEVICE, d); } catch (e) { /* ignore */ }
    }
    return d;
  })();

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(session); } catch (e) { console.warn(e); }
    });
  }

  /* ------------------------------------------------------------ mock */
  /* Seeded rivals so the board is populated from the first run and the
     "you're #7" moment is demonstrable before Supabase exists. */

  var MOCK_NAMES = [
    'peregrine', 'sootfox', 'nine_volt', 'harbour', 'quietriot', 'mossline',
    'delta_wren', 'kestrel', 'lowtide', 'brambled', 'nocturne', 'saltflat'
  ];

  function mockDb() {
    var db = read(K_MOCK, null);
    if (db) return db;
    db = { scores: [], seeded: {} };
    write(K_MOCK, db);
    return db;
  }

  function mockSeed(slug) {
    var db = mockDb();
    if (db.seeded[slug]) return db;
    var ceiling = slug === 'hardwater' ? 90 : 40;
    for (var i = 0; i < 11; i++) {
      db.scores.push({
        identity: 'mock:' + slug + ':' + i,
        handle: MOCK_NAMES[(i * 5 + slug.length) % MOCK_NAMES.length],
        slug: slug,
        score: Math.max(1, Math.round(ceiling * Math.pow(0.82, i) + (i % 3)))
      });
    }
    db.seeded[slug] = true;
    write(K_MOCK, db);
    return db;
  }

  function mockIdentity() {
    return session ? session.id : 'device:' + deviceId;
  }

  function mockBests(slug) {
    var db = mockSeed(slug);
    var best = {};
    db.scores.forEach(function (s) {
      if (s.slug !== slug) return;
      if (!best[s.identity] || s.score > best[s.identity].score) {
        best[s.identity] = { identity: s.identity, handle: s.handle, score: s.score };
      }
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  function mockStanding(slug) {
    var rows = mockBests(slug);
    var me = mockIdentity();
    var mine = null;
    rows.forEach(function (r) { if (r.identity === me) mine = r; });
    if (!mine) return { best: null, rank: null, total: rows.length, percentile: null };
    var rank = 1;
    rows.forEach(function (r) { if (r.score > mine.score) rank++; });
    var below = rows.filter(function (r) { return r.score < mine.score; }).length;
    return {
      best: mine.score,
      rank: rank,
      total: rows.length,
      percentile: rows.length > 1 ? Math.round((below / (rows.length - 1)) * 100) : null
    };
  }

  var MOCK = {
    submit: function (slug, score) {
      var db = mockSeed(slug);
      db.scores.push({
        identity: mockIdentity(),
        handle: session ? session.handle : 'guest',
        slug: slug,
        score: score
      });
      write(K_MOCK, db);
      return Promise.resolve(mockStanding(slug));
    },
    board: function (slug, limit) {
      var rows = mockBests(slug).slice(0, limit || 10);
      var me = mockIdentity();
      return Promise.resolve({
        rows: rows.map(function (r, i) {
          return {
            rnk: i + 1, handle: r.handle, avatar_url: null,
            best: r.score, is_me: r.identity === me
          };
        }),
        standing: mockStanding(slug)
      });
    },
    standing: function (slug) { return Promise.resolve(mockStanding(slug)); },
    signIn: function (provider) {
      // no redirect in mock mode; sign in instantly so the sheet is testable
      var db = mockDb();
      db.scores.forEach(function (s) {
        if (s.identity === 'device:' + deviceId) {
          s.identity = 'mock-me';
          s.handle = provider === 'discord' ? 'you_on_discord' : 'you_on_google';
        }
      });
      write(K_MOCK, db);
      session = {
        id: 'mock-me',
        handle: provider === 'discord' ? 'you_on_discord' : 'you_on_google',
        avatar_url: null,
        provider: provider
      };
      emit();
      return Promise.resolve(session);
    },
    signOut: function () { session = null; emit(); return Promise.resolve(); }
  };

  /* ------------------------------------------------------------ live */

  var SUPA_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function initLive() {
    if (!window.supabase) await loadScript(SUPA_CDN);
    supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    var got = await supa.auth.getSession();
    if (got.data && got.data.session) await adoptUser();

    supa.auth.onAuthStateChange(function (evt, s) {
      if (s && !session) adoptUser();
      else if (!s && session) { session = null; emit(); }
    });

    // strip ?code= / #access_token so a refresh doesn't retry the exchange
    if (/[?#].*(code=|access_token=)/.test(location.href)) {
      history.replaceState({}, '', location.pathname);
    }
  }

  // register the player row, then pull every guest run onto the account
  async function adoptUser() {
    try {
      var p = await supa.rpc('ensure_player', { p_device_id: deviceId });
      if (p.error) throw p.error;
      session = p.data;
      var c = await supa.rpc('claim_device_scores', { p_device_id: deviceId });
      if (c.error) console.warn('claim failed', c.error);
      else if (c.data) console.log('claimed ' + c.data + ' guest run(s)');
      emit();
    } catch (e) {
      console.warn('adoptUser', e);
    }
  }

  var LIVEAPI = {
    submit: async function (slug, score, durationMs) {
      var r = await supa.rpc('submit_score', {
        p_device_id: deviceId, p_game_slug: slug,
        p_score: score, p_duration_ms: durationMs || null
      });
      if (r.error) throw r.error;
      return r.data;
    },
    board: async function (slug, limit) {
      var b = await supa.rpc('leaderboard', {
        p_game_slug: slug, p_device_id: deviceId, p_limit: limit || 10
      });
      if (b.error) throw b.error;
      var st = await supa.rpc('my_standing', { p_game_slug: slug, p_device_id: deviceId });
      return { rows: b.data || [], standing: st.error ? null : st.data };
    },
    standing: async function (slug) {
      var r = await supa.rpc('my_standing', { p_game_slug: slug, p_device_id: deviceId });
      if (r.error) throw r.error;
      return r.data;
    },
    signIn: async function (provider) {
      // OAuth is a full-page bounce; app.js stashes the card to come back to
      var r = await supa.auth.signInWithOAuth({
        provider: provider,
        options: { redirectTo: location.origin + location.pathname }
      });
      if (r.error) throw r.error;
    },
    signOut: async function () {
      await supa.auth.signOut();
      session = null;
      emit();
    }
  };

  /* ------------------------------------------------------------ outbox */

  // Validation failures are permanent — retrying a rejected score forever is
  // just noise. Anything else is treated as transport and retried.
  function isPermanent(err) {
    var m = (err && (err.message || err.msg) || '').toLowerCase();
    return m.indexOf('out of range') >= 0 ||
           m.indexOf('implausible') >= 0 ||
           m.indexOf('unknown game') >= 0;
  }

  var flushing = false;
  // flush() re-reads the queue from storage, so it never holds the same object
  // the caller does — results come back by id instead of by mutation
  var results = {};

  async function flush() {
    if (flushing) return;
    var q = read(K_OUTBOX, []);
    if (!q.length) return;
    flushing = true;
    try {
      while (q.length) {
        var item = q[0];
        try {
          results[item.id] = await impl().submit(item.slug, item.score, item.durationMs);
          q.shift();
        } catch (e) {
          item.tries = (item.tries || 0) + 1;
          if (isPermanent(e) || item.tries >= 5) {
            console.warn('dropping score', item, e);
            q.shift();
          } else {
            break;                       // transport problem — stop, retry later
          }
        }
        write(K_OUTBOX, q);
      }
    } finally {
      write(K_OUTBOX, q);
      flushing = false;
    }
  }

  window.addEventListener('online', function () { flush(); });

  /* ------------------------------------------------------------ surface */

  function impl() { return LIVE ? LIVEAPI : MOCK; }

  var ready = (LIVE ? initLive().catch(function (e) {
    console.warn('supabase init failed, staying offline', e);
  }) : Promise.resolve()).then(function () { return flush(); });

  return {
    live: LIVE,
    ready: ready,
    deviceId: function () { return deviceId; },
    session: function () { return session; },
    onChange: function (fn) { listeners.push(fn); return function () {
      listeners = listeners.filter(function (f) { return f !== fn; });
    }; },

    /* Queue a run and try to send it. Resolves with the server standing when
       the send lands in time, or null when it doesn't — never rejects, and
       never blocks the caller's game loop. */
    submit: function (slug, score, durationMs) {
      var id = uuid();
      var q = read(K_OUTBOX, []);
      q.push({ id: id, slug: slug, score: score, durationMs: durationMs || null, tries: 0 });
      write(K_OUTBOX, q);
      return flush().then(function () {
        var st = results[id] || null;
        delete results[id];
        return st;
      }).catch(function () { return null; });
    },

    board: function (slug, limit) {
      return impl().board(slug, limit).catch(function (e) {
        console.warn('board', e);
        return { rows: [], standing: null };
      });
    },

    standing: function (slug) {
      return impl().standing(slug).catch(function () { return null; });
    },

    signIn: function (provider) {
      return impl().signIn(provider);
    },

    signOut: function () { return impl().signOut(); },

    /* redirect-and-restore: OAuth leaves the page, so remember where we were */
    stashReturn: function (state) { write(K_RETURN, state); },
    takeReturn: function () {
      var r = read(K_RETURN, null);
      try { localStorage.removeItem(K_RETURN); } catch (e) { /* ignore */ }
      return r;
    }
  };
})();
