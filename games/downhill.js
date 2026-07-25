/* Downhill — three lanes down an alpine piste.
   Tap a side to carve into that lane and hold it. Rocks and trees end the run
   on contact; slalom gates pay a bonus for skiing through them. Sometimes the
   gate sits beside a rock and you have to decide whether the points are worth
   the line. Speed never stops climbing. */

(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b)); }

  var LANES = [-1.45, 0, 1.45];
  var SKIER_Z = 0;
  var SPAWN_Z = -95;
  var RECYCLE_Z = 9;
  var HIT_X = 0.68, HIT_Z = 0.85;

  /* ---------------- control-layer css ---------------- */
  var CSS_ID = 'downhill-ui-css';
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
.dh-ui{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;
  font-variant-numeric:tabular-nums}

.dh-vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(125% 78% at 50% 40%,rgba(0,0,0,0) 44%,rgba(10,26,48,.5) 100%)}

.dh-zone{position:absolute;top:0;bottom:0;width:50%;opacity:0}
.dh-zone.l{left:0;background:linear-gradient(90deg,rgba(255,255,255,.2),rgba(255,255,255,0))}
.dh-zone.r{right:0;background:linear-gradient(270deg,rgba(255,255,255,.2),rgba(255,255,255,0))}

.dh-speed{position:absolute;left:19px;top:calc(82px + var(--safe-t));
  font-size:12px;color:rgba(244,243,239,.8);letter-spacing:.04em;
  text-shadow:0 2px 8px rgba(0,0,0,.6)}
.dh-speed b{font-size:15px;font-weight:600}

.dh-toast{position:absolute;left:0;right:0;top:33%;text-align:center;
  font-size:30px;font-weight:700;letter-spacing:-.02em;opacity:0;
  text-shadow:0 3px 20px rgba(0,0,0,.65)}

.dh-hint{position:absolute;left:0;right:0;bottom:calc(104px + var(--safe-b));
  text-align:center;font-size:13px;color:rgba(244,243,239,.75);
  text-shadow:0 2px 10px rgba(0,0,0,.6);transition:opacity .3s ease}

.dh-flash{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0}
`;
    document.head.appendChild(s);
  }

  /* ---------------- procedural textures ---------------- */
  function softDot(T, inner, outer) {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, inner); rg.addColorStop(1, outer);
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  // groomed piste: corduroy plus three pairs of ski tracks, one per lane, so
  // the lanes are legible at a glance instead of implied
  function pisteTexture(T) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#eef6ff';
    g.fillRect(0, 0, 256, 256);

    g.strokeStyle = 'rgba(176,199,224,.35)';
    g.lineWidth = 1;
    for (var i = 0; i < 64; i++) {                // corduroy grooming
      var y = i * 4;
      g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
    }
    // Three lane centres at 1/6, 1/2, 5/6 of the strip. These carry the whole
    // read of "three columns", so they have to survive bright snow lighting —
    // subtle blue-grey washes out completely.
    // px positions must map to the actual lane x values: the strip is 5.4 wide,
    // so lane +/-1.45 lands at (1.45 + 2.7) / 5.4 * 256 = 59 and 197
    [59, 128, 197].forEach(function (cx) {
      g.strokeStyle = 'rgba(96,132,172,.75)';
      g.lineWidth = 5;
      [-10, 10].forEach(function (off) {
        g.beginPath(); g.moveTo(cx + off, 0); g.lineTo(cx + off, 256); g.stroke();
      });
      g.strokeStyle = 'rgba(120,155,192,.28)';
      g.lineWidth = 14;
      g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, 256); g.stroke();
    });
    g.fillStyle = 'rgba(255,255,255,.5)';
    for (var k = 0; k < 90; k++) {
      g.fillRect(rand(0, 256), rand(0, 256), rand(1, 3), rand(1, 3));
    }
    var tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return tex;
  }

  function snowTexture(T) {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#e9f2fc'; g.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 260; i++) {
      g.fillStyle = 'rgba(255,255,255,' + rand(0.15, 0.5).toFixed(2) + ')';
      g.beginPath(); g.arc(rand(0, 128), rand(0, 128), rand(1, 5), 0, TAU); g.fill();
    }
    for (var j = 0; j < 90; j++) {
      g.fillStyle = 'rgba(178,202,228,' + rand(0.1, 0.28).toFixed(2) + ')';
      g.beginPath(); g.arc(rand(0, 128), rand(0, 128), rand(2, 7), 0, TAU); g.fill();
    }
    var tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return tex;
  }

  /* ---------------- the game ---------------- */
  function create(ctx) {
    var T = ctx.THREE;
    injectCSS();

    var killed = false;
    var trash = [];
    function keep(o) { trash.push(o); return o; }

    var vw = ctx.width, vh = ctx.height;

    /* ===== scene, alpine daylight ===== */
    var scene = new T.Scene();
    scene.fog = new T.Fog(0xcfe4f8, 45, 135);

    var BASE_FOV = 62;
    var camera = new T.PerspectiveCamera(BASE_FOV, vw / vh, 0.1, 500);

    var skyGeo = keep(new T.SphereGeometry(260, 24, 16));
    var skyMat = keep(new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new T.Color(0x1f63c8) },
        mid: { value: new T.Color(0xa9d6f7) },
        bot: { value: new T.Color(0xe4f1ff) }
      },
      vertexShader:
        'varying float vH;' +
        'void main(){ vH = normalize(position).y;' +
        'gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float vH;' +
        'void main(){ vec3 c = vH > 0.0 ? mix(mid, top, pow(vH, 0.62))' +
        ' : mix(mid, bot, pow(-vH, 0.5));' +
        'gl_FragColor = vec4(c, 1.0); }'
    }));
    scene.add(new T.Mesh(skyGeo, skyMat));

    // snow bounces a lot of light, so the ambient is unusually strong here
    scene.add(new T.HemisphereLight(0xbfe0ff, 0xdfeaf5, 0.85));
    var sun = new T.DirectionalLight(0xfff6e6, 1.05);
    sun.position.set(-22, 26, -10);
    scene.add(sun);
    var bounce = new T.DirectionalLight(0x9fc4ee, 0.3);
    bounce.position.set(14, 5, 16);
    scene.add(bounce);

    /* ===== snowfield + groomed piste ===== */
    var snowTex = keep(snowTexture(T));
    snowTex.repeat.set(26, 90);
    var fieldGeo = keep(new T.PlaneGeometry(220, 420, 1, 1));
    fieldGeo.rotateX(-Math.PI / 2);
    var fieldMat = keep(new T.MeshPhongMaterial({ map: snowTex, color: 0xffffff, shininess: 14 }));
    var field = new T.Mesh(fieldGeo, fieldMat);
    field.position.set(0, -0.02, -150);
    scene.add(field);

    var pisteTex = keep(pisteTexture(T));
    pisteTex.repeat.set(1, 46);
    var pisteGeo = keep(new T.PlaneGeometry(5.4, 420, 1, 1));
    pisteGeo.rotateX(-Math.PI / 2);
    var pisteMat = keep(new T.MeshPhongMaterial({ map: pisteTex, color: 0xffffff, shininess: 26 }));
    var piste = new T.Mesh(pisteGeo, pisteMat);
    piste.position.set(0, 0, -150);
    scene.add(piste);

    /* ===== distant peaks ===== */
    var peakGeo = keep(new T.ConeGeometry(1, 1, 5));
    var peakMat = keep(new T.MeshPhongMaterial({ color: 0x8fa8c6, flatShading: true, shininess: 4 }));
    var capMat = keep(new T.MeshPhongMaterial({ color: 0xf4faff, flatShading: true, shininess: 20 }));
    for (var pk = 0; pk < 14; pk++) {
      var px = rand(-170, 170), pz = rand(-260, -150);
      var ph = rand(26, 62), pr = rand(24, 46);
      var m = new T.Mesh(peakGeo, peakMat);
      m.position.set(px, ph / 2 - 2, pz);
      m.scale.set(pr, ph, pr);
      m.rotation.y = rand(0, TAU);
      scene.add(m);
      var cap = new T.Mesh(peakGeo, capMat);
      cap.position.set(px, ph * 0.78 - 2, pz);
      cap.scale.set(pr * 0.42, ph * 0.34, pr * 0.42);
      cap.rotation.y = m.rotation.y;
      scene.add(cap);
    }

    /* ===== roadside conifers (instanced, recycled toward the camera) ===== */
    var TREE_N = 76;
    var coneGeo = keep(new T.ConeGeometry(0.85, 2.6, 6));
    var coneMat = keep(new T.MeshPhongMaterial({ color: 0x1f4433, flatShading: true, shininess: 3 }));
    var sideTrees = new T.InstancedMesh(coneGeo, coneMat, TREE_N);
    sideTrees.frustumCulled = false;
    scene.add(sideTrees);

    var snowCapGeo = keep(new T.ConeGeometry(0.5, 0.85, 6));
    var sideCaps = new T.InstancedMesh(snowCapGeo, capMat, TREE_N);
    sideCaps.frustumCulled = false;
    scene.add(sideCaps);

    var treeSlots = [];
    for (var ti = 0; ti < TREE_N; ti++) {
      var side = ti % 2 === 0 ? -1 : 1;
      treeSlots.push({
        x: side * rand(4.2, 16),
        z: -rand(0, 100),
        s: rand(0.8, 1.9)
      });
    }
    var tm = new T.Matrix4(), tq = new T.Quaternion(),
        tv = new T.Vector3(), ts = new T.Vector3();

    /* ===== piste edge markers ===== */
    var MARK_N = 22;
    var markGeo = keep(new T.CylinderGeometry(0.045, 0.045, 1.2, 6));
    var markMat = keep(new T.MeshPhongMaterial({ color: 0xff7a2f, shininess: 30 }));
    var marks = new T.InstancedMesh(markGeo, markMat, MARK_N);
    marks.frustumCulled = false;
    scene.add(marks);
    var markSlots = [];
    for (var mi = 0; mi < MARK_N; mi++) {
      markSlots.push({ x: (mi % 2 === 0 ? -1 : 1) * 3.1, z: -(mi >> 1) * 9 });
    }

    /* ===== obstacles + gates (pooled) ===== */
    var rockGeo = keep(new T.IcosahedronGeometry(0.52, 0));
    var rockMat = keep(new T.MeshPhongMaterial({ color: 0x6a7381, flatShading: true, shininess: 8 }));
    var trunkGeo = keep(new T.CylinderGeometry(0.11, 0.15, 0.7, 6));
    var trunkMat = keep(new T.MeshPhongMaterial({ color: 0x4a3527, flatShading: true, shininess: 4 }));
    var obTreeGeo = keep(new T.ConeGeometry(0.72, 2.1, 7));

    var poleGeo = keep(new T.CylinderGeometry(0.035, 0.035, 1.5, 5));
    var flagGeo = keep(new T.PlaneGeometry(0.38, 0.26));
    var poleRedMat = keep(new T.MeshPhongMaterial({ color: 0xe33b4e, shininess: 30 }));
    var poleBlueMat = keep(new T.MeshPhongMaterial({ color: 0x2f7ae0, shininess: 30 }));
    var flagRedMat = keep(new T.MeshBasicMaterial({ color: 0xe33b4e, side: T.DoubleSide }));
    var flagBlueMat = keep(new T.MeshBasicMaterial({ color: 0x2f7ae0, side: T.DoubleSide }));

    var POOL = 16;
    var obstacles = [];
    for (var oi = 0; oi < POOL; oi++) {
      var g = new T.Group();

      var rock = new T.Mesh(rockGeo, rockMat);
      rock.position.y = 0.3;
      rock.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      g.add(rock);

      var tree = new T.Group();
      var trunk = new T.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.35;
      tree.add(trunk);
      var crown = new T.Mesh(obTreeGeo, coneMat);
      crown.position.y = 1.4;
      tree.add(crown);
      var crownCap = new T.Mesh(snowCapGeo, capMat);
      crownCap.position.y = 2.15;
      crownCap.scale.setScalar(0.85);
      tree.add(crownCap);
      g.add(tree);

      // gate: a pole either side of one lane, with little flags
      var gate = new T.Group();
      [-1, 1].forEach(function (sgn, idx) {
        var pm = idx === 0 ? poleRedMat : poleBlueMat;
        var fm = idx === 0 ? flagRedMat : flagBlueMat;
        var p = new T.Mesh(poleGeo, pm);
        p.position.set(sgn * 0.62, 0.75, 0);
        gate.add(p);
        var f = new T.Mesh(flagGeo, fm);
        f.position.set(sgn * 0.62 + sgn * 0.19, 1.28, 0);
        gate.add(f);
      });
      g.add(gate);

      g.visible = false;
      scene.add(g);
      obstacles.push({
        g: g, rock: rock, tree: tree, gate: gate,
        kind: 'rock', lane: 1, z: 0, active: false, scored: false
      });
    }

    /* ===== skier ===== */
    var suitMat = keep(new T.MeshPhongMaterial({ color: 0xff4d3d, flatShading: true, shininess: 26 }));
    var pantMat = keep(new T.MeshPhongMaterial({ color: 0x232838, flatShading: true, shininess: 16 }));
    var helmMat = keep(new T.MeshPhongMaterial({ color: 0xf4f6f8, flatShading: true, shininess: 60 }));
    var gogMat  = keep(new T.MeshBasicMaterial({ color: 0x1a2740 }));
    var skiMat  = keep(new T.MeshPhongMaterial({ color: 0xffd23f, shininess: 70 }));
    var poleMat2 = keep(new T.MeshPhongMaterial({ color: 0x9aa3b0, shininess: 40 }));

    var torsoGeo = keep(new T.CylinderGeometry(0.19, 0.22, 0.46, 8));
    var headGeo  = keep(new T.SphereGeometry(0.145, 12, 10));
    var gogGeo   = keep(new T.BoxGeometry(0.24, 0.075, 0.06));
    var limbGeo  = keep(new T.CylinderGeometry(0.055, 0.05, 0.34, 6));
    var skiGeo   = keep(new T.BoxGeometry(0.13, 0.04, 1.5));
    var poleGeo2 = keep(new T.CylinderGeometry(0.018, 0.018, 0.85, 5));

    var skier = new T.Group();
    var body = new T.Group();
    skier.add(body);

    var torso = new T.Mesh(torsoGeo, suitMat); torso.position.y = 0.66; body.add(torso);
    var head = new T.Mesh(headGeo, helmMat); head.position.set(0, 0.98, 0); body.add(head);
    var gog = new T.Mesh(gogGeo, gogMat); gog.position.set(0, 1.0, -0.12); body.add(gog);

    function limb(mat, x, y) {
      var gg = new T.Group();
      gg.position.set(x, y, 0);
      var m2 = new T.Mesh(limbGeo, mat);
      m2.position.y = -0.17;
      gg.add(m2);
      return gg;
    }
    var legL = limb(pantMat, -0.1, 0.42), legR = limb(pantMat, 0.1, 0.42);
    var armL = limb(suitMat, -0.23, 0.84), armR = limb(suitMat, 0.23, 0.84);
    body.add(legL); body.add(legR); body.add(armL); body.add(armR);

    // poles trail backward under the arm, the way they do in a tuck — upright
    // they read as grab handles rather than ski poles
    var poleL = new T.Mesh(poleGeo2, poleMat2);
    poleL.position.set(-0.04, -0.26, 0.34); poleL.rotation.x = 1.45; armL.add(poleL);
    var poleR = new T.Mesh(poleGeo2, poleMat2);
    poleR.position.set(0.04, -0.26, 0.34); poleR.rotation.x = 1.45; armR.add(poleR);

    var skiL = new T.Mesh(skiGeo, skiMat); skiL.position.set(-0.13, 0.03, -0.1); skier.add(skiL);
    var skiR = new T.Mesh(skiGeo, skiMat); skiR.position.set(0.13, 0.03, -0.1); skier.add(skiR);

    var shTex = keep(softDot(T, 'rgba(40,70,110,0.5)', 'rgba(40,70,110,0)'));
    var shGeo = keep(new T.PlaneGeometry(1.5, 2.0));
    var shMat = keep(new T.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.5, depthWrite: false }));
    var shadow = new T.Mesh(shGeo, shMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    skier.add(shadow);

    skier.position.set(0, 0, SKIER_Z);
    scene.add(skier);

    /* ===== snow spray ===== */
    var SPRAY = 90;
    var sprayGeo = keep(new T.BufferGeometry());
    var sprayPos = new Float32Array(SPRAY * 3);
    var sprays = [];
    for (var si = 0; si < SPRAY; si++) {
      sprays.push({ life: 0, vx: 0, vy: 0, vz: 0 });
      sprayPos[si * 3 + 1] = -80;
    }
    sprayGeo.setAttribute('position', new T.BufferAttribute(sprayPos, 3));
    var sprayTex = keep(softDot(T, 'rgba(255,255,255,1)', 'rgba(214,234,255,0)'));
    var sprayMat = keep(new T.PointsMaterial({
      size: 0.2, map: sprayTex, transparent: true, opacity: 0.9,
      depthWrite: false, sizeAttenuation: true
    }));
    var sprayPts = new T.Points(sprayGeo, sprayMat);
    sprayPts.frustumCulled = false;
    scene.add(sprayPts);
    var sprayNext = 0;

    function emitSpray(x, y, z, n, spread, up) {
      for (var i = 0; i < n; i++) {
        var p = sprays[sprayNext];
        sprayPos[sprayNext * 3] = x;
        sprayPos[sprayNext * 3 + 1] = y;
        sprayPos[sprayNext * 3 + 2] = z;
        p.life = rand(0.25, 0.65);
        p.vx = rand(-spread, spread);
        p.vy = rand(up * 0.3, up);
        p.vz = rand(1, 5);
        sprayNext = (sprayNext + 1) % SPRAY;
      }
    }

    /* ===== ui ===== */
    var ui = document.createElement('div');
    ui.className = 'dh-ui';
    ui.innerHTML =
      '<div class="dh-vig"></div>' +
      '<div class="dh-flash"></div>' +
      '<div class="dh-zone l"></div>' +
      '<div class="dh-zone r"></div>' +
      '<div class="dh-speed"><b>0</b> km/h</div>' +
      '<div class="dh-toast"></div>' +
      '<div class="dh-hint">tap a side to carve</div>';
    ctx.overlay.appendChild(ui);

    var elFlash = ui.querySelector('.dh-flash');
    var elZoneL = ui.querySelector('.dh-zone.l');
    var elZoneR = ui.querySelector('.dh-zone.r');
    var elToast = ui.querySelector('.dh-toast');
    var elHint  = ui.querySelector('.dh-hint');
    var elSpeed = ui.querySelector('.dh-speed b');

    var toastT = 0;
    function toast(text, color) {
      elToast.textContent = text;
      elToast.style.color = color || '#f4f3ef';
      toastT = 0.8;
    }
    var flashT = 0, flashRGB = '255,255,255';
    function flash(rgb, dur) { flashT = dur || 0.35; flashRGB = rgb; }
    var zoneT = 0, zoneSide = 0;

    /* ===== state ===== */
    var lane = 1;
    var sx = 0;                       // actual x, lerps toward the lane
    var dist = 0, bonus = 0, shown = -1;
    var speed = 15;
    var dead = false;
    var crashT = 0;
    var nextSpawnAt = 14;             // in metres of travel
    var camShake = 0;
    var lastSpeedShown = -1;

    var camPos = new T.Vector3(0, 3.15, 7.6);
    var camAim = new T.Vector3(0, 0.75, -15);
    camera.position.copy(camPos);
    camera.lookAt(camAim);

    function setScore() {
      var n = Math.floor(dist) + bonus;
      if (n !== shown) { shown = n; ctx.setScore(n); }
    }

    /* Rows never block all three lanes, and a gate is always reachable from at
       least one safe lane, so every row has a legal answer. */
    function spawnRow() {
      var free = [0, 1, 2];
      var blockCount = dist < 60 ? 1 : (Math.random() < clamp((dist - 60) / 700, 0, 0.55) ? 2 : 1);
      var blocked = [];
      for (var b = 0; b < blockCount; b++) {
        var idx = randi(0, free.length);
        blocked.push(free[idx]);
        free.splice(idx, 1);
      }

      blocked.forEach(function (ln) {
        var o = takeFree();
        if (!o) return;
        o.kind = Math.random() < 0.55 ? 'rock' : 'tree';
        o.lane = ln;
        o.z = SPAWN_Z;
        o.active = true;
        o.scored = false;
        o.rock.visible = o.kind === 'rock';
        o.tree.visible = o.kind === 'tree';
        o.gate.visible = false;
        o.g.visible = true;
        o.g.position.set(LANES[ln], 0, o.z);
        o.g.rotation.y = rand(0, TAU) * (o.kind === 'rock' ? 1 : 0);
      });

      // a gate in one of the still-open lanes, once the run is under way
      if (dist > 40 && free.length && Math.random() < 0.42) {
        var gl = free[randi(0, free.length)];
        var go = takeFree();
        if (go) {
          go.kind = 'gate';
          go.lane = gl;
          go.z = SPAWN_Z;
          go.active = true;
          go.scored = false;
          go.rock.visible = false;
          go.tree.visible = false;
          go.gate.visible = true;
          go.g.visible = true;
          go.g.position.set(LANES[gl], 0, go.z);
          go.g.rotation.y = 0;
        }
      }
    }

    function takeFree() {
      for (var i = 0; i < obstacles.length; i++) {
        if (!obstacles[i].active) return obstacles[i];
      }
      return null;
    }

    function crash(o) {
      if (dead) return;
      dead = true;
      crashT = 0;
      toast('WIPEOUT', '#ff6b53');
      flash('255,90,70', 0.5);
      camShake = 0.7;
      emitSpray(sx, 0.4, SKIER_Z, 26, 1.6, 3.4);
      if (navigator.vibrate) navigator.vibrate([50, 60, 90]);
      ctx.gameOver();
    }

    function pointer(type, x) {
      if (dead || killed) return;
      if (type !== 'down') return;
      var left = x < vw / 2;
      var next = clamp(lane + (left ? -1 : 1), 0, 2);
      if (next !== lane) {
        lane = next;
        emitSpray(sx, 0.1, SKIER_Z + 0.4, 7, 0.5, 1.1);
        if (navigator.vibrate) navigator.vibrate(9);
      }
      zoneT = 0.15;
      zoneSide = left ? -1 : 1;
      if (dist > 24) elHint.style.opacity = '0';
    }

    function update(dt) {
      if (killed) return;

      if (dead) {
        // let the wipeout play out; the harness stops calling update once the
        // card is swiped away, and tapping restarts the whole game
        crashT += dt;
        body.rotation.x += dt * 5.5;
        body.rotation.z += dt * 3.2;
        body.position.y = Math.max(0, 0.4 - crashT * crashT * 2.2);
        if (camShake > 0) camShake -= dt * 1.4;
        return;
      }

      /* ---- speed and distance ---- */
      speed = Math.min(36, 15 + dist * 0.022);
      dist += speed * dt;
      setScore();

      var kmh = Math.round(speed * 3.6);
      if (kmh !== lastSpeedShown) { lastSpeedShown = kmh; elSpeed.textContent = String(kmh); }

      /* ---- lane carve ---- */
      var targetX = LANES[lane];
      var prevX = sx;
      sx = lerp(sx, targetX, 1 - Math.pow(0.00035, dt));
      var carve = clamp((sx - prevX) / Math.max(dt, 0.001) / 6, -1, 1);
      skier.position.x = sx;

      body.rotation.z = -carve * 0.5;
      body.rotation.x = 0.32 + Math.abs(carve) * 0.1;      // tuck
      skiL.rotation.z = -carve * 0.25;
      skiR.rotation.z = -carve * 0.25;
      skier.rotation.y = -carve * 0.22;
      armL.rotation.x = -0.9; armR.rotation.x = -0.9;

      // spray off the edges while carving
      if (Math.abs(carve) > 0.25 && Math.random() < 0.6) {
        emitSpray(sx - Math.sign(carve) * 0.2, 0.06, SKIER_Z + 0.5, 2, 0.3, 0.9);
      }
      if (Math.random() < 0.35) {
        emitSpray(sx + rand(-0.2, 0.2), 0.05, SKIER_Z + 0.6, 1, 0.2, 0.5);
      }

      /* ---- scroll the world ---- */
      var travel = speed * dt;
      pisteTex.offset.y -= travel / 420 * 46;
      snowTex.offset.y -= travel / 420 * 90;

      for (var i = 0; i < TREE_N; i++) {
        var t2 = treeSlots[i];
        t2.z += travel;
        if (t2.z > RECYCLE_Z + 6) {
          t2.z -= 106;
          t2.x = (i % 2 === 0 ? -1 : 1) * rand(4.2, 16);
          t2.s = rand(0.8, 1.9);
        }
        tv.set(t2.x, t2.s * 1.3 - 0.3, t2.z);
        ts.set(t2.s, t2.s, t2.s);
        tm.compose(tv, tq, ts);
        sideTrees.setMatrixAt(i, tm);
        tv.set(t2.x, t2.s * 2.55 - 0.3, t2.z);
        ts.set(t2.s, t2.s, t2.s);
        tm.compose(tv, tq, ts);
        sideCaps.setMatrixAt(i, tm);
      }
      sideTrees.instanceMatrix.needsUpdate = true;
      sideCaps.instanceMatrix.needsUpdate = true;

      for (var mk = 0; mk < MARK_N; mk++) {
        var ms = markSlots[mk];
        ms.z += travel;
        if (ms.z > RECYCLE_Z) ms.z -= MARK_N / 2 * 9;
        tv.set(ms.x, 0.6, ms.z);
        ts.set(1, 1, 1);
        tm.compose(tv, tq, ts);
        marks.setMatrixAt(mk, tm);
      }
      marks.instanceMatrix.needsUpdate = true;

      /* ---- obstacles ---- */
      if (dist >= nextSpawnAt) {
        spawnRow();
        // rows get tighter as you speed up, but never closer than reaction time
        var gap = Math.max(11, 26 - dist * 0.012);
        nextSpawnAt = dist + gap * rand(0.85, 1.2);
      }

      for (var oi2 = 0; oi2 < obstacles.length; oi2++) {
        var o = obstacles[oi2];
        if (!o.active) continue;
        o.z += travel;
        o.g.position.z = o.z;
        if (o.kind === 'rock') o.rock.rotation.y += dt * 0.5;

        if (!o.scored && Math.abs(o.z - SKIER_Z) < HIT_Z) {
          if (o.kind === 'gate') {
            if (Math.abs(o.g.position.x - sx) < 0.55) {
              o.scored = true;
              bonus += 5;
              setScore();
              toast('+5', '#7ee0a0');
              flash('140,255,190', 0.22);
              if (navigator.vibrate) navigator.vibrate(12);
            }
          } else if (Math.abs(o.g.position.x - sx) < HIT_X) {
            o.scored = true;
            crash(o);
            return;
          }
        }

        if (o.z > RECYCLE_Z) {
          o.active = false;
          o.g.visible = false;
        }
      }

      /* ---- spray ---- */
      var sp = sprayGeo.attributes.position;
      for (var q = 0; q < SPRAY; q++) {
        var pr = sprays[q];
        if (pr.life <= 0) continue;
        pr.life -= dt;
        pr.vy -= 5.5 * dt;
        sp.setX(q, sp.getX(q) + pr.vx * dt);
        sp.setY(q, Math.max(0.02, sp.getY(q) + pr.vy * dt));
        sp.setZ(q, sp.getZ(q) + (pr.vz + speed * 0.35) * dt);
        if (pr.life <= 0 || sp.getZ(q) > RECYCLE_Z) sp.setY(q, -80);
      }
      sp.needsUpdate = true;

      /* ---- camera: widens with speed, which is most of the sensation ---- */
      var t3 = clamp((speed - 15) / 21, 0, 1);
      var wantFov = BASE_FOV + t3 * 12;
      if (Math.abs(camera.fov - wantFov) > 0.05) {
        camera.fov = lerp(camera.fov, wantFov, 1 - Math.pow(0.02, dt));
        camera.updateProjectionMatrix();
      }
      camera.position.set(camPos.x + sx * 0.42, camPos.y, camPos.z);
      if (camShake > 0) {
        camShake -= dt * 1.6;
        var k2 = Math.max(0, camShake) * 0.22;
        camera.position.x += rand(-k2, k2);
        camera.position.y += rand(-k2, k2);
      }
      camera.lookAt(camAim.x + sx * 0.55, camAim.y, camAim.z);

      /* ---- ui ---- */
      if (toastT > 0) {
        toastT -= dt;
        var tt = clamp(toastT / 0.8, 0, 1);
        elToast.style.opacity = String(Math.min(1, tt * 2.6));
        elToast.style.transform = 'translateY(' + (1 - tt) * -12 + 'px) scale(' + (0.93 + tt * 0.11) + ')';
      } else if (elToast.style.opacity !== '0') {
        elToast.style.opacity = '0';
      }

      if (flashT > 0) {
        flashT -= dt;
        elFlash.style.background =
          'radial-gradient(120% 80% at 50% 45%,rgba(' + flashRGB + ',0) 35%,rgba(' + flashRGB + ',.8) 100%)';
        elFlash.style.opacity = String(clamp(flashT * 2.4, 0, 1) * 0.7);
      } else if (elFlash.style.opacity !== '0') {
        elFlash.style.opacity = '0';
      }

      if (zoneT > 0) {
        zoneT -= dt;
        var z2 = clamp(zoneT / 0.15, 0, 1);
        (zoneSide < 0 ? elZoneL : elZoneR).style.opacity = String(z2);
        (zoneSide < 0 ? elZoneR : elZoneL).style.opacity = '0';
      } else {
        elZoneL.style.opacity = '0';
        elZoneR.style.opacity = '0';
      }
    }

    function resize(w, h) {
      vw = w; vh = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function dispose() {
      killed = true;
      for (var i = 0; i < trash.length; i++) {
        if (trash[i] && trash[i].dispose) trash[i].dispose();
      }
      trash.length = 0;
      obstacles.length = 0;
      treeSlots.length = 0;
      markSlots.length = 0;
      sprays.length = 0;
      if (sideTrees.dispose) sideTrees.dispose();
      if (sideCaps.dispose) sideCaps.dispose();
      if (marks.dispose) marks.dispose();
    }

    ctx.setScore(0);

    return {
      scene: scene, camera: camera,
      update: update, pointer: pointer, resize: resize, dispose: dispose
    };
  }

  window.__TIPTAP_GAMES__ = window.__TIPTAP_GAMES__ || [];
  window.__TIPTAP_GAMES__.push({
    slug: 'downhill',
    title: 'Downhill',
    rule: 'Carve past the rocks. Ski the gates.',
    create: create
  });
})();
