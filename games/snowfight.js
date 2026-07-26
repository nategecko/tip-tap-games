/* Snow Fight — forts across the yard, heads popping up for about a second.
   Tap a red jacket to throw. Blue jackets are your own team, so tapping
   everything that moves is exactly how you lose. Let a red one finish winding
   up and you wear the snowball instead. Three mistakes and it's over. */

(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b)); }
  function ease(t) { return t * t * (3 - 2 * t); }

  function hash2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u),
                lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
  }

  /* Forts sit in three receding rows rather than one wide line: portrait gives
     roughly 30 degrees horizontally, so spreading them sideways would push the
     outer forts off screen. Depth is the axis we actually have. */
  var FORTS = [
    { x:  0.00, z:  -1.2 },
    { x: -1.00, z:  -4.5 },
    { x:  1.00, z:  -4.5 },
    { x: -1.85, z:  -8.0 },
    { x:  0.00, z:  -8.0 },
    { x:  1.85, z:  -8.0 },
    { x: -2.50, z: -11.5 },
    { x:  2.50, z: -11.5 }
  ];

  /* ---------------- control-layer css ---------------- */
  var CSS_ID = 'snowfight-ui-css';
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
.sf-ui{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;
  font-variant-numeric:tabular-nums}

.sf-vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(125% 78% at 50% 40%,rgba(0,0,0,0) 46%,rgba(24,38,60,.45) 100%)}

.sf-lives{position:absolute;left:19px;top:calc(82px + var(--safe-t));display:flex;gap:7px}
.sf-lives i{width:10px;height:10px;border-radius:50%;background:#f4f8ff;
  box-shadow:0 0 8px rgba(210,232,255,.9),inset 0 -2px 3px rgba(150,180,215,.55);
  transition:background .3s ease,box-shadow .3s ease,transform .3s ease}
.sf-lives i.gone{background:rgba(255,255,255,.16);box-shadow:none;transform:scale(.68)}

.sf-combo{position:absolute;right:19px;top:calc(80px + var(--safe-t));
  font-size:15px;font-weight:700;color:#ffd76a;opacity:0;
  text-shadow:0 2px 10px rgba(0,0,0,.55);transition:opacity .25s ease}
.sf-combo.on{opacity:1}

.sf-toast{position:absolute;left:0;right:0;top:32%;text-align:center;
  font-size:31px;font-weight:700;letter-spacing:-.02em;opacity:0;
  text-shadow:0 3px 20px rgba(0,0,0,.6)}

.sf-hint{position:absolute;left:0;right:0;bottom:calc(104px + var(--safe-b));
  text-align:center;font-size:13px;color:rgba(244,243,239,.8);
  text-shadow:0 2px 10px rgba(0,0,0,.6);transition:opacity .3s ease}

.sf-flash{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0}

/* snow in the face when one of them lands a throw */
.sf-splat{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0;
  background:radial-gradient(38% 30% at 50% 46%,rgba(255,255,255,.97) 0%,
    rgba(255,255,255,.85) 42%,rgba(255,255,255,0) 72%)}
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

  /* ---------------- the game ---------------- */
  function create(ctx) {
    var T = ctx.THREE;
    injectCSS();

    var killed = false;
    var trash = [];
    function keep(o) { trash.push(o); return o; }

    var vw = ctx.width, vh = ctx.height;

    /* ===== scene: cold clear afternoon, low warm sun ===== */
    var scene = new T.Scene();
    scene.fog = new T.Fog(0xd6e6f4, 30, 110);

    var camera = new T.PerspectiveCamera(60, vw / vh, 0.1, 400);

    var skyGeo = keep(new T.SphereGeometry(200, 24, 16));
    var skyMat = keep(new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new T.Color(0x3d7cce) },
        mid: { value: new T.Color(0xcfe3f6) },
        bot: { value: new T.Color(0xf3d9b4) }
      },
      vertexShader:
        'varying float vH;' +
        'void main(){ vH = normalize(position).y;' +
        'gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float vH;' +
        'void main(){ vec3 c = vH > 0.0 ? mix(mid, top, pow(vH, 0.55))' +
        ' : mix(mid, bot, pow(-vH, 0.45));' +
        'gl_FragColor = vec4(c, 1.0); }'
    }));
    scene.add(new T.Mesh(skyGeo, skyMat));

    scene.add(new T.HemisphereLight(0xa8cbf0, 0xc9d8e8, 0.5));
    var sun = new T.DirectionalLight(0xfff0cf, 1.0);
    sun.position.set(-14, 9, 7);          // low and to the side, for long shadows
    scene.add(sun);
    var fill = new T.DirectionalLight(0x8fb6e4, 0.34);
    fill.position.set(10, 6, -8);
    scene.add(fill);

    /* ===== snow ground ===== */
    var GSEG = 70;
    var groundGeo = keep(new T.PlaneGeometry(140, 140, GSEG, GSEG));
    groundGeo.rotateX(-Math.PI / 2);
    var gp = groundGeo.attributes.position;
    var gcol = new Float32Array(gp.count * 3);
    var cShade = new T.Color(0x86a6cc), cMid = new T.Color(0xc2d8ee), cHi = new T.Color(0xe6f0fb);
    var tc = new T.Color();
    for (var vi = 0; vi < gp.count; vi++) {
      var px = gp.getX(vi), pz = gp.getZ(vi);
      var drift = vnoise(px * 0.11 + 20, pz * 0.11 + 20);
      var fine = vnoise(px * 0.55, pz * 0.55);
      gp.setY(vi, (drift - 0.5) * 0.34 + (fine - 0.5) * 0.05);
      var t = clamp(drift * 1.3 - 0.12, 0, 1);
      if (t < 0.5) tc.copy(cShade).lerp(cMid, t * 2);
      else tc.copy(cMid).lerp(cHi, (t - 0.5) * 2);
      tc.offsetHSL(0, 0, (fine - 0.5) * 0.045);
      gcol[vi * 3] = tc.r; gcol[vi * 3 + 1] = tc.g; gcol[vi * 3 + 2] = tc.b;
    }
    groundGeo.setAttribute('color', new T.BufferAttribute(gcol, 3));
    groundGeo.computeVertexNormals();
    var groundMat = keep(new T.MeshPhongMaterial({ vertexColors: true, shininess: 18, specular: 0x9ab4d0 }));
    scene.add(new T.Mesh(groundGeo, groundMat));

    /* ===== treeline ===== */
    var pineGeo = keep(new T.ConeGeometry(1, 3.2, 6));
    var pineMat = keep(new T.MeshPhongMaterial({ color: 0x1d3f31, flatShading: true, shininess: 3 }));
    var capMat = keep(new T.MeshPhongMaterial({ color: 0xf2f9ff, flatShading: true, shininess: 22 }));
    var capGeo = keep(new T.ConeGeometry(0.6, 1.1, 6));
    var PINES = 210;
    var pines = new T.InstancedMesh(pineGeo, pineMat, PINES);
    var pineCaps = new T.InstancedMesh(capGeo, capMat, PINES);
    var pm = new T.Matrix4(), pq = new T.Quaternion(), pv = new T.Vector3(), ps = new T.Vector3();
    for (var pi = 0; pi < PINES; pi++) {
      var pa = rand(0, TAU), prr = rand(14, 46);
      var pxx = Math.cos(pa) * prr, pzz = Math.sin(pa) * prr - 8;
      // keep the play corridor clear so nothing hides a fort
      if (Math.abs(pxx) < 5.2 && pzz > -15) { pxx += (pxx < 0 ? -5.2 : 5.2); }
      var sc = rand(0.75, 1.8);
      pv.set(pxx, sc * 1.6 - 0.4, pzz); ps.set(sc, sc, sc);
      pm.compose(pv, pq, ps); pines.setMatrixAt(pi, pm);
      pv.set(pxx, sc * 3.0 - 0.4, pzz);
      pm.compose(pv, pq, ps); pineCaps.setMatrixAt(pi, pm);
    }
    pines.instanceMatrix.needsUpdate = true;
    pineCaps.instanceMatrix.needsUpdate = true;
    scene.add(pines); scene.add(pineCaps);

    /* ===== cabin, for somewhere to be ===== */
    var cabinMat = keep(new T.MeshPhongMaterial({ color: 0x5a4030, flatShading: true, shininess: 5 }));
    var roofMat = keep(new T.MeshPhongMaterial({ color: 0xeef6ff, flatShading: true, shininess: 20 }));
    var winMat = keep(new T.MeshBasicMaterial({ color: 0xffc978 }));
    var cabin = new T.Group();
    var cb = new T.Mesh(keep(new T.BoxGeometry(5, 2.6, 4)), cabinMat);
    cb.position.y = 1.3; cabin.add(cb);
    var cr = new T.Mesh(keep(new T.ConeGeometry(4.1, 1.7, 4)), roofMat);
    cr.position.y = 3.4; cr.rotation.y = Math.PI / 4; cabin.add(cr);
    [-1.1, 1.1].forEach(function (wx) {
      var w = new T.Mesh(keep(new T.PlaneGeometry(0.75, 0.62)), winMat);
      w.position.set(wx, 1.5, 2.01);
      cabin.add(w);
    });
    cabin.position.set(-9.5, 0, -17);
    cabin.rotation.y = 0.42;
    scene.add(cabin);

    /* ===== forts ===== */
    var snowBlockMat = keep(new T.MeshPhongMaterial({ color: 0xc8dcf0, flatShading: true, shininess: 40, specular: 0xdbe9f7 }));
    var blockGeo = keep(new T.BoxGeometry(0.34, 0.26, 0.3));

    // two courses of blocks, offset like brickwork and bowed slightly toward the
    // camera, so it reads as a built wall rather than scattered debris
    function buildFort(x, z) {
      var g = new T.Group();
      g.position.set(x, 0, z);
      for (var row = 0; row < 2; row++) {
        var n = row === 0 ? 5 : 4;
        for (var i = 0; i < n; i++) {
          var t = (i - (n - 1) / 2) * 0.33;
          var b = new T.Mesh(blockGeo, snowBlockMat);
          b.position.set(t, 0.13 + row * 0.26, Math.abs(t) * 0.16);
          b.rotation.y = -t * 0.3;
          b.rotation.z = rand(-0.035, 0.035);
          g.add(b);
        }
      }
      scene.add(g);
      return g;
    }

    /* ===== kids ===== */
    var redMat  = keep(new T.MeshPhongMaterial({ color: 0xe23b4e, flatShading: true, shininess: 18 }));
    var blueMat = keep(new T.MeshPhongMaterial({ color: 0x3b7ee2, flatShading: true, shininess: 18 }));
    var skinMat = keep(new T.MeshPhongMaterial({ color: 0xe8b48c, flatShading: true, shininess: 10 }));
    var hatRedMat  = keep(new T.MeshPhongMaterial({ color: 0xb0202f, flatShading: true, shininess: 8 }));
    var hatBlueMat = keep(new T.MeshPhongMaterial({ color: 0x2557a8, flatShading: true, shininess: 8 }));
    var pomMat = keep(new T.MeshPhongMaterial({ color: 0xf6fbff, flatShading: true, shininess: 20 }));
    var ballMat = keep(new T.MeshPhongMaterial({ color: 0xf7fbff, flatShading: true, shininess: 30 }));

    var kTorsoGeo = keep(new T.CylinderGeometry(0.2, 0.24, 0.5, 8));
    var kHeadGeo  = keep(new T.SphereGeometry(0.16, 12, 10));
    var kHatGeo   = keep(new T.ConeGeometry(0.2, 0.26, 8));
    var kPomGeo   = keep(new T.SphereGeometry(0.065, 8, 6));
    var kArmGeo   = keep(new T.CylinderGeometry(0.06, 0.055, 0.34, 6));
    var kBallGeo  = keep(new T.SphereGeometry(0.11, 10, 8));

    function buildKid() {
      var g = new T.Group();
      var torso = new T.Mesh(kTorsoGeo, redMat); torso.position.y = 0.68; g.add(torso);
      var head = new T.Mesh(kHeadGeo, skinMat); head.position.y = 1.06; g.add(head);
      var hat = new T.Mesh(kHatGeo, hatRedMat); hat.position.y = 1.22; g.add(hat);
      var pom = new T.Mesh(kPomGeo, pomMat); pom.position.y = 1.37; g.add(pom);

      var armL = new T.Group(); armL.position.set(-0.235, 0.88, 0);
      var aL = new T.Mesh(kArmGeo, redMat); aL.position.y = -0.16; armL.add(aL); g.add(armL);
      var armR = new T.Group(); armR.position.set(0.235, 0.88, 0);
      var aR = new T.Mesh(kArmGeo, redMat); aR.position.y = -0.16; armR.add(aR); g.add(armR);

      var held = new T.Mesh(kBallGeo, ballMat);
      held.position.set(0, -0.34, 0.02);
      armR.add(held);

      return {
        g: g, torso: torso, hat: hat, armL: armL, armR: armR, held: held,
        setTeam: function (enemy) {
          torso.material = enemy ? redMat : blueMat;
          aL.material = enemy ? redMat : blueMat;
          aR.material = enemy ? redMat : blueMat;
          hat.material = enemy ? hatRedMat : hatBlueMat;
          held.visible = enemy;
        }
      };
    }

    var slots = [];
    for (var fi = 0; fi < FORTS.length; fi++) {
      var f = FORTS[fi];
      buildFort(f.x, f.z);
      var kid = buildKid();
      kid.g.position.set(f.x, -1.15, f.z - 0.42);   // hidden behind the wall
      kid.g.visible = false;
      scene.add(kid.g);
      slots.push({
        x: f.x, z: f.z - 0.42, kid: kid,
        state: 'idle',      // idle | up | hit | ducking
        enemy: true, t: 0, window: 1.2, hitT: 0
      });
    }

    /* ===== snowballs (pooled) ===== */
    var BALLS = 14;
    var balls = [];
    for (var bi = 0; bi < BALLS; bi++) {
      var m = new T.Mesh(kBallGeo, ballMat);
      m.visible = false;
      scene.add(m);
      balls.push({ m: m, active: false, t: 0, dur: 1, from: new T.Vector3(), to: new T.Vector3(), arc: 1, incoming: false, land: null });
    }
    function throwBall(fx, fy, fz, tx, ty, tz, dur, arc, incoming) {
      for (var i = 0; i < BALLS; i++) {
        var b = balls[i];
        if (b.active) continue;
        b.active = true; b.t = 0; b.dur = dur; b.arc = arc; b.incoming = !!incoming; b.land = null;
        b.from.set(fx, fy, fz); b.to.set(tx, ty, tz);
        b.m.visible = true;
        b.m.position.set(fx, fy, fz);
        b.m.scale.setScalar(1);
        return b;
      }
      return null;
    }

    /* ===== puffs ===== */
    var PUFF = 44;
    var puffGeo = keep(new T.BufferGeometry());
    var puffPos = new Float32Array(PUFF * 3);
    var puffs = [];
    for (var qi = 0; qi < PUFF; qi++) {
      puffs.push({ life: 0, vx: 0, vy: 0, vz: 0 });
      puffPos[qi * 3 + 1] = -70;
    }
    puffGeo.setAttribute('position', new T.BufferAttribute(puffPos, 3));
    var puffTex = keep(softDot(T, 'rgba(255,255,255,1)', 'rgba(206,230,255,0)'));
    var puffMat = keep(new T.PointsMaterial({
      size: 0.28, map: puffTex, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true
    }));
    var puffPts = new T.Points(puffGeo, puffMat);
    puffPts.frustumCulled = false;
    scene.add(puffPts);
    var puffNext = 0;
    function burst(x, y, z, n, spread, up) {
      for (var i = 0; i < n; i++) {
        var p = puffs[puffNext];
        puffPos[puffNext * 3] = x; puffPos[puffNext * 3 + 1] = y; puffPos[puffNext * 3 + 2] = z;
        p.life = rand(0.3, 0.75);
        p.vx = rand(-spread, spread); p.vy = rand(up * 0.35, up); p.vz = rand(-spread, spread);
        puffNext = (puffNext + 1) % PUFF;
      }
    }

    /* ===== drifting snow ===== */
    var SNOW = 300;
    var snowGeo = keep(new T.BufferGeometry());
    var snowPos = new Float32Array(SNOW * 3);
    var snowVel = new Float32Array(SNOW);
    for (var ni = 0; ni < SNOW; ni++) {
      snowPos[ni * 3] = rand(-16, 16);
      snowPos[ni * 3 + 1] = rand(0, 13);
      snowPos[ni * 3 + 2] = rand(-20, 8);
      snowVel[ni] = rand(0.4, 1.1);
    }
    snowGeo.setAttribute('position', new T.BufferAttribute(snowPos, 3));
    var snowMat = keep(new T.PointsMaterial({
      size: 0.1, map: puffTex, transparent: true, opacity: 0.75,
      depthWrite: false, sizeAttenuation: true
    }));
    scene.add(new T.Points(snowGeo, snowMat));

    /* ===== ui ===== */
    var ui = document.createElement('div');
    ui.className = 'sf-ui';
    ui.innerHTML =
      '<div class="sf-vig"></div>' +
      '<div class="sf-flash"></div>' +
      '<div class="sf-splat"></div>' +
      '<div class="sf-lives"><i></i><i></i><i></i></div>' +
      '<div class="sf-combo">x2</div>' +
      '<div class="sf-toast"></div>' +
      '<div class="sf-hint">tap the red ones</div>';
    ctx.overlay.appendChild(ui);

    var elFlash = ui.querySelector('.sf-flash');
    var elSplat = ui.querySelector('.sf-splat');
    var elToast = ui.querySelector('.sf-toast');
    var elHint = ui.querySelector('.sf-hint');
    var elCombo = ui.querySelector('.sf-combo');
    var lifeDots = ui.querySelectorAll('.sf-lives i');

    var toastT = 0;
    function toast(text, color) {
      elToast.textContent = text;
      elToast.style.color = color || '#f4f3ef';
      toastT = 0.8;
    }
    var flashT = 0, flashRGB = '255,255,255';
    function flash(rgb, dur) { flashT = dur || 0.32; flashRGB = rgb; }
    var splatT = 0;

    /* ===== state ===== */
    var score = 0, lives = 3, dead = false;
    var streak = 0, mult = 1;
    var spawnT = 0.8, popped = 0;
    var throwCool = 0;
    var camShake = 0;
    var shots = 0;

    var camPos = new T.Vector3(0, 1.7, 2.6);
    var camAim = new T.Vector3(0, 0.9, -7);
    camera.position.copy(camPos);
    camera.lookAt(camAim);

    var projV = new T.Vector3();

    function setMult() {
      var m = streak >= 12 ? 3 : (streak >= 5 ? 2 : 1);
      if (m !== mult) {
        mult = m;
        if (m > 1) { elCombo.textContent = 'x' + m; elCombo.classList.add('on'); }
        else elCombo.classList.remove('on');
      }
    }

    function loseLife(why) {
      lives--;
      for (var i = 0; i < lifeDots.length; i++) {
        if (i >= lives) lifeDots[i].classList.add('gone');
      }
      streak = 0; setMult();
      toast(why, '#ff7a6b');
      camShake = 0.5;
      if (navigator.vibrate) navigator.vibrate([40, 50, 70]);
      if (lives <= 0 && !dead) {
        dead = true;
        ctx.gameOver();
      }
    }

    function spawn() {
      var free = [];
      for (var i = 0; i < slots.length; i++) if (slots[i].state === 'idle') free.push(i);
      if (!free.length) return;
      var s = slots[free[randi(0, free.length)]];

      // teammates only start showing up once the throw itself is understood
      var teamChance = shots < 4 ? 0 : clamp(0.1 + shots * 0.006, 0, 0.28);
      s.enemy = Math.random() > teamChance;
      s.kid.setTeam(s.enemy);
      s.state = 'up';
      s.t = 0;
      s.window = clamp(1.35 - shots * 0.016, 0.55, 1.35);
      s.kid.g.visible = true;
      s.kid.g.rotation.z = 0;
      s.kid.armR.rotation.x = 0;
      shots++;
      popped++;
      burst(s.x, 0.62, s.z + 0.3, 5, 0.3, 1.0);
    }

    // hit testing in screen space rather than by raycast: targets are small and
    // far, and a generous radius that scales with depth is much kinder on a phone
    // Centre of the visible mass — head plus upper torso. The kid group sits at
    // y = -1.15 when hidden and 0 when up, so the world height is simply the
    // local offset plus that. (Adding the 1.15 back on top put the hit zone a
    // full metre above the character, which is why taps on a visible kid
    // registered as misses.)
    var aimWorld = new T.Vector3();
    function hitPointOf(s) {
      return aimWorld.set(s.x, 0.95 + s.kid.g.position.y, s.z);
    }
    function screenOf(s) {
      var p = hitPointOf(s);
      var dist = camera.position.distanceTo(p);
      projV.copy(p).project(camera);
      return {
        x: (projV.x * 0.5 + 0.5) * vw,
        y: (-projV.y * 0.5 + 0.5) * vh,
        d: dist
      };
    }

    /* Where a thrown ball should land when you don't hit anyone: along the ray
       through the tap, meeting the snow if it points downward. A fixed target
       made every miss fly to the same spot regardless of aim. */
    var rayV = new T.Vector3();
    function aimPoint(x, y) {
      rayV.set((x / vw) * 2 - 1, -((y / vh) * 2 - 1), 0.5);
      rayV.unproject(camera).sub(camera.position).normalize();
      var t;
      if (rayV.y < -0.02) {
        t = clamp((0.05 - camera.position.y) / rayV.y, 1.5, 34);   // hits the snow
      } else {
        t = 26;                                                     // sails over
      }
      return {
        x: camera.position.x + rayV.x * t,
        y: Math.max(0.05, camera.position.y + rayV.y * t),
        z: camera.position.z + rayV.z * t
      };
    }

    function pointer(type, x, y) {
      if (dead || killed || type !== 'down') return;
      if (throwCool > 0) return;
      throwCool = 0.1;

      var best = null, bestD = 1e9;
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        if (s.state !== 'up') continue;
        var sc = screenOf(s);
        var radius = clamp(760 / sc.d, 34, 92);
        var dx = sc.x - x, dy = sc.y - y;
        var d = Math.hypot(dx, dy);
        if (d < radius && d < bestD) { bestD = d; best = s; }
      }

      // the throw is cosmetic; the hit is decided on tap so it always feels honest
      var b;
      if (best) {
        var hp = hitPointOf(best);
        b = throwBall(0, 1.0, 2.0, hp.x, hp.y, hp.z, 0.22, 0.35, false);
        if (b) b.land = { x: hp.x, y: hp.y, z: hp.z, n: 12, spread: 0.5, up: 2.0 };
      } else {
        var ap = aimPoint(x, y);
        b = throwBall(0, 1.0, 2.0, ap.x, ap.y, ap.z, 0.5, 1.1, false);
        if (b) b.land = { x: ap.x, y: ap.y, z: ap.z, n: 7, spread: 0.35, up: 1.3 };
      }
      if (navigator.vibrate) navigator.vibrate(8);

      if (!best) return;

      if (best.enemy) {
        streak++; setMult();
        score += mult;
        ctx.setScore(score);
        best.state = 'hit';
        best.hitT = 0;
        flash('180,235,255', 0.16);
        if (mult > 1) toast('+' + mult, '#9fe8ff');
      } else {
        best.state = 'ducking';
        best.t = 0;
        flash('255,120,90', 0.4);
        loseLife('OWN TEAM');
      }
      if (shots > 3) elHint.style.opacity = '0';
    }

    function update(dt) {
      if (killed) return;

      if (dead) {
        if (camShake > 0) camShake -= dt * 1.4;
        if (splatT > 0) splatT -= dt;
        return;
      }

      if (throwCool > 0) throwCool -= dt;

      /* ---- spawning ---- */
      spawnT -= dt;
      if (spawnT <= 0) {
        var maxUp = shots < 6 ? 1 : (shots < 18 ? 2 : 3);
        var upNow = 0;
        for (var c = 0; c < slots.length; c++) if (slots[c].state === 'up') upNow++;
        if (upNow < maxUp) spawn();
        spawnT = clamp(1.15 - shots * 0.014, 0.42, 1.15) * rand(0.85, 1.2);
      }

      /* ---- targets ---- */
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        var kg = s.kid.g;

        if (s.state === 'up') {
          s.t += dt;
          var up = clamp(s.t / 0.16, 0, 1);
          kg.position.y = lerp(-1.15, 0, ease(up));
          // enemies wind up over the window so the throw is telegraphed
          if (s.enemy) {
            var w = clamp(s.t / s.window, 0, 1);
            s.kid.armR.rotation.x = -w * 2.1;
            kg.rotation.z = Math.sin(s.t * 12) * 0.02 * w;
          } else {
            s.kid.armL.rotation.x = Math.sin(s.t * 6) * 0.5;   // waving, not throwing
          }
          if (s.t >= s.window) {
            if (s.enemy) {
              // they got their throw off
              throwBall(s.x, 1.2, s.z, camPos.x, camPos.y - 0.2, camPos.z - 0.6, 0.42, 0.9, true);
              s.state = 'ducking';
              s.t = 0;
            } else {
              s.state = 'ducking';
              s.t = 0;
            }
          }
        } else if (s.state === 'ducking') {
          s.t += dt;
          var dn = clamp(s.t / 0.22, 0, 1);
          kg.position.y = lerp(0, -1.15, ease(dn));
          s.kid.armR.rotation.x = lerp(s.kid.armR.rotation.x, 0, dt * 8);
          s.kid.armL.rotation.x = lerp(s.kid.armL.rotation.x, 0, dt * 8);
          if (dn >= 1) { s.state = 'idle'; kg.visible = false; }
        } else if (s.state === 'hit') {
          s.hitT += dt;
          kg.rotation.z = -Math.sin(clamp(s.hitT / 0.3, 0, 1) * Math.PI) * 0.9;
          kg.position.y = lerp(0, -1.15, clamp((s.hitT - 0.18) / 0.3, 0, 1));
          if (s.hitT > 0.5) { s.state = 'idle'; kg.visible = false; kg.rotation.z = 0; }
        }
      }

      /* ---- snowballs ---- */
      for (var bi2 = 0; bi2 < BALLS; bi2++) {
        var b = balls[bi2];
        if (!b.active) continue;
        b.t += dt / b.dur;
        var t3 = clamp(b.t, 0, 1);
        b.m.position.lerpVectors(b.from, b.to, t3);
        b.m.position.y += Math.sin(t3 * Math.PI) * b.arc;
        if (b.incoming) b.m.scale.setScalar(1 + t3 * 2.6);
        if (b.t >= 1) {
          b.active = false;
          b.m.visible = false;
          if (b.incoming) {
            splatT = 0.55;
            loseLife('SNOWBALLED');
          } else if (b.land) {
            burst(b.land.x, b.land.y, b.land.z, b.land.n, b.land.spread, b.land.up);
            b.land = null;
          }
        }
      }

      /* ---- puffs ---- */
      var pa2 = puffGeo.attributes.position;
      for (var q = 0; q < PUFF; q++) {
        var p2 = puffs[q];
        if (p2.life <= 0) continue;
        p2.life -= dt;
        p2.vy -= 5 * dt;
        pa2.setX(q, pa2.getX(q) + p2.vx * dt);
        pa2.setY(q, Math.max(0.02, pa2.getY(q) + p2.vy * dt));
        pa2.setZ(q, pa2.getZ(q) + p2.vz * dt);
        if (p2.life <= 0) pa2.setY(q, -70);
      }
      pa2.needsUpdate = true;

      /* ---- drifting snow ---- */
      var sa = snowGeo.attributes.position;
      for (var k = 0; k < SNOW; k++) {
        var yy = sa.getY(k) - snowVel[k] * dt;
        var xx = sa.getX(k) + Math.sin(yy * 0.5 + k) * 0.22 * dt;
        if (yy < 0) { yy = 13; xx = rand(-16, 16); sa.setZ(k, rand(-20, 8)); }
        sa.setY(k, yy); sa.setX(k, xx);
      }
      sa.needsUpdate = true;

      /* ---- camera ---- */
      camera.position.copy(camPos);
      if (camShake > 0) {
        camShake -= dt * 1.6;
        var kk = Math.max(0, camShake) * 0.26;
        camera.position.x += rand(-kk, kk);
        camera.position.y += rand(-kk, kk);
      }
      camera.lookAt(camAim);

      /* ---- ui ---- */
      if (toastT > 0) {
        toastT -= dt;
        var tt = clamp(toastT / 0.8, 0, 1);
        elToast.style.opacity = String(Math.min(1, tt * 2.6));
        elToast.style.transform = 'translateY(' + (1 - tt) * -12 + 'px) scale(' + (0.93 + tt * 0.1) + ')';
      } else if (elToast.style.opacity !== '0') {
        elToast.style.opacity = '0';
      }

      if (flashT > 0) {
        flashT -= dt;
        elFlash.style.background =
          'radial-gradient(120% 80% at 50% 45%,rgba(' + flashRGB + ',0) 38%,rgba(' + flashRGB + ',.75) 100%)';
        elFlash.style.opacity = String(clamp(flashT * 2.6, 0, 1) * 0.7);
      } else if (elFlash.style.opacity !== '0') {
        elFlash.style.opacity = '0';
      }

      if (splatT > 0) {
        splatT -= dt;
        elSplat.style.opacity = String(clamp(splatT / 0.55, 0, 1));
      } else if (elSplat.style.opacity !== '0') {
        elSplat.style.opacity = '0';
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
      slots.length = 0;
      balls.length = 0;
      puffs.length = 0;
      if (pines.dispose) pines.dispose();
      if (pineCaps.dispose) pineCaps.dispose();
    }

    ctx.setScore(0);


    return {
      scene: scene, camera: camera,
      update: update, pointer: pointer, resize: resize, dispose: dispose
    };
  }

  window.__TIPTAP_GAMES__ = window.__TIPTAP_GAMES__ || [];
  window.__TIPTAP_GAMES__.push({
    slug: 'snowfight',
    title: 'Snow Fight',
    rule: 'Tap the red ones. Blue is your team.',
    create: create
  });
})();
