/* Home Run Derby — pitches keep coming, you just have to square one up.
   Tap to swing. Timing sets power AND direction: early pulls it foul, late
   slices it foul, dead-on goes out to centre. Three pitch types arrive at
   different speeds, so a fixed rhythm gets you nothing — you have to read the
   ball out of the hand. Three misses and you're done. */

(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var FT = 0.3048;                 // the field is built to real dimensions

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b)); }
  function ease(t) { return t * t * (3 - 2 * t); }

  var MOUND_Z = -60.5 * FT;        // -18.4
  var BASE_OFF = 90 * FT / Math.SQRT2;
  var WALL_CF = 400 * FT, WALL_LF = 330 * FT;

  /* Flight times are the whole difficulty: a swing tuned to the fastball is
     far too early for the change-up, so you cannot just find a rhythm. */
  var PITCHES = [
    { name: 'fastball', flight: 0.70, breakX: 0.00, breakY: -0.10, col: 0xffffff, odds: 46 },
    { name: 'curve',    flight: 0.92, breakX: -0.55, breakY: -0.85, col: 0xffffff, odds: 28 },
    { name: 'change',   flight: 1.06, breakX: 0.20, breakY: -0.35, col: 0xffffff, odds: 26 }
  ];
  function rollPitch() {
    var tot = 0, i;
    for (i = 0; i < PITCHES.length; i++) tot += PITCHES[i].odds;
    var r = Math.random() * tot;
    for (i = 0; i < PITCHES.length; i++) { r -= PITCHES[i].odds; if (r <= 0) return PITCHES[i]; }
    return PITCHES[0];
  }

  /* ---------------- control-layer css ---------------- */
  var CSS_ID = 'homerun-ui-css';
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
.hr-ui{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;
  font-variant-numeric:tabular-nums}

.hr-vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(125% 78% at 50% 42%,rgba(0,0,0,0) 46%,rgba(30,20,8,.46) 100%)}

.hr-outs{position:absolute;left:19px;top:calc(82px + var(--safe-t));
  display:flex;gap:7px;align-items:center}
.hr-outs span{font-size:10px;color:rgba(255,244,228,.7);margin-right:2px;letter-spacing:.08em}
.hr-outs i{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.2);
  transition:background .3s ease,box-shadow .3s ease,transform .3s ease}
.hr-outs i.used{background:#ff5f4d;box-shadow:0 0 9px rgba(255,95,77,.8);transform:scale(1.12)}

.hr-streak{position:absolute;right:19px;top:calc(80px + var(--safe-t));
  font-size:15px;font-weight:800;color:#ffd166;opacity:0;
  text-shadow:0 2px 10px rgba(0,0,0,.55);transition:opacity .25s ease}
.hr-streak.on{opacity:1}

.hr-call{position:absolute;left:0;right:0;top:26%;text-align:center;
  font-size:34px;font-weight:800;letter-spacing:-.02em;opacity:0;
  text-shadow:0 3px 22px rgba(0,0,0,.65)}
.hr-dist{position:absolute;left:0;right:0;top:36%;text-align:center;
  font-size:52px;font-weight:800;letter-spacing:-.04em;opacity:0;color:#fff3d6;
  text-shadow:0 4px 26px rgba(0,0,0,.7)}
.hr-dist small{font-size:20px;font-weight:600;opacity:.8}

.hr-hint{position:absolute;left:0;right:0;bottom:calc(104px + var(--safe-b));
  text-align:center;font-size:13px;color:rgba(255,244,228,.85);
  text-shadow:0 2px 10px rgba(0,0,0,.6);transition:opacity .3s ease}

.hr-flash{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0}
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

  function ballTexture(T) {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#fbfaf6';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#c9243f';
    g.lineWidth = 3;
    [34, 94].forEach(function (cx) {          // two seam arcs
      g.beginPath();
      g.arc(cx, 64, 42, -Math.PI / 2.4, Math.PI / 2.4);
      g.stroke();
      for (var i = -5; i <= 5; i++) {          // stitches
        var a = i * 0.19;
        var x = cx + Math.cos(a) * 42, y = 64 + Math.sin(a) * 42;
        g.beginPath();
        g.moveTo(x - 4, y - 3); g.lineTo(x + 4, y + 3);
        g.stroke();
      }
    });
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

    /* ===== scene: late afternoon ballpark ===== */
    var scene = new T.Scene();
    scene.fog = new T.Fog(0xe4c9a4, 90, 300);

    var camera = new T.PerspectiveCamera(58, vw / vh, 0.1, 900);

    var skyGeo = keep(new T.SphereGeometry(420, 24, 16));
    var skyMat = keep(new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new T.Color(0x2f6fb8) },
        mid: { value: new T.Color(0xa8cfe8) },
        bot: { value: new T.Color(0xf6dcb0) }
      },
      vertexShader:
        'varying float vH;' +
        'void main(){ vH = normalize(position).y;' +
        'gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float vH;' +
        'void main(){ vec3 c = vH > 0.0 ? mix(mid, top, pow(vH, 0.5))' +
        ' : mix(mid, bot, pow(-vH, 0.5));' +
        'gl_FragColor = vec4(c, 1.0); }'
    }));
    scene.add(new T.Mesh(skyGeo, skyMat));

    scene.add(new T.HemisphereLight(0xbfd9f2, 0x6d5a3e, 0.66));
    var sun = new T.DirectionalLight(0xffe6b8, 1.1);
    sun.position.set(-60, 45, 30);
    scene.add(sun);
    var fill = new T.DirectionalLight(0x88a8d8, 0.28);
    fill.position.set(40, 20, -60);
    scene.add(fill);

    /* ===== the field ===== */
    var FSEG = 150, FSIZE = 340;
    var fieldGeo = keep(new T.PlaneGeometry(FSIZE, FSIZE, FSEG, FSEG));
    fieldGeo.rotateX(-Math.PI / 2);
    var fp = fieldGeo.attributes.position;
    var fcol = new Float32Array(fp.count * 3);

    var grassA = new T.Color(0x3f8a3a), grassB = new T.Color(0x4d9c45);
    var dirt = new T.Color(0xa9764a), dirtDark = new T.Color(0x936441);
    var tc = new T.Color();

    // basepath segments, for the dirt lanes between bases
    var BASES = [
      [0, 0], [BASE_OFF, -BASE_OFF], [0, -BASE_OFF * 2], [-BASE_OFF, -BASE_OFF]
    ];
    function distToSeg(px, pz, ax, az, bx, bz) {
      var dx = bx - ax, dz = bz - az;
      var l2 = dx * dx + dz * dz;
      var t = l2 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
      return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
    }

    for (var vi = 0; vi < fp.count; vi++) {
      var x = fp.getX(vi), z = fp.getZ(vi);
      var d = Math.hypot(x, z);
      var foul = Math.abs(x) > -z;                 // outside the 90-degree wedge
      var onPath = false;
      for (var b = 0; b < 4 && !onPath; b++) {
        if (distToSeg(x, z, BASES[b][0], BASES[b][1],
                      BASES[(b + 1) % 4][0], BASES[(b + 1) % 4][1]) < 1.5) onPath = true;
      }
      var isDirt = d < 3.8 || onPath || Math.hypot(x, z - MOUND_Z) < 2.7 || (foul && d < 30);

      if (isDirt) {
        tc.copy(d < 3.8 || Math.hypot(x, z - MOUND_Z) < 2.7 ? dirt : dirtDark);
        tc.offsetHSL(0, 0, (Math.sin(x * 3.1 + z * 2.7) * 0.5) * 0.03);
      } else {
        // mown arcs radiating from the plate, the way a groundskeeper cuts them
        tc.copy(Math.floor(d / 9) % 2 === 0 ? grassA : grassB);
        tc.offsetHSL(0, 0, (Math.sin(x * 1.7) * Math.cos(z * 1.9)) * 0.018);
      }
      fcol[vi * 3] = tc.r; fcol[vi * 3 + 1] = tc.g; fcol[vi * 3 + 2] = tc.b;
    }
    fieldGeo.setAttribute('color', new T.BufferAttribute(fcol, 3));
    fieldGeo.computeVertexNormals();
    var fieldMat = keep(new T.MeshPhongMaterial({ vertexColors: true, shininess: 5 }));
    scene.add(new T.Mesh(fieldGeo, fieldMat));

    /* mound + plate + bases */
    var whiteMat = keep(new T.MeshPhongMaterial({ color: 0xf6f4ee, shininess: 26 }));
    var moundGeo = keep(new T.CylinderGeometry(2.7, 3.1, 0.25, 20));
    var moundMat = keep(new T.MeshPhongMaterial({ color: 0xa9764a, flatShading: true, shininess: 3 }));
    var mound = new T.Mesh(moundGeo, moundMat);
    mound.position.set(0, 0.11, MOUND_Z);
    scene.add(mound);

    var plate = new T.Mesh(keep(new T.BoxGeometry(0.43, 0.04, 0.43)), whiteMat);
    plate.position.set(0, 0.03, 0);
    plate.rotation.y = Math.PI / 4;
    scene.add(plate);

    var baseGeo = keep(new T.BoxGeometry(0.38, 0.06, 0.38));
    for (var bi = 1; bi < 4; bi++) {
      var bm = new T.Mesh(baseGeo, whiteMat);
      bm.position.set(BASES[bi][0], 0.04, BASES[bi][1]);
      scene.add(bm);
    }

    /* foul lines */
    var lineMat = keep(new T.MeshBasicMaterial({ color: 0xf2f0e8 }));
    [-1, 1].forEach(function (sgn) {
      var len = WALL_LF;
      var g2 = keep(new T.PlaneGeometry(0.14, len));
      var m2 = new T.Mesh(g2, lineMat);
      m2.rotation.x = -Math.PI / 2;
      m2.rotation.z = sgn * Math.PI / 4;
      m2.position.set(sgn * len / 2 * Math.SQRT1_2, 0.02, -len / 2 * Math.SQRT1_2);
      scene.add(m2);
    });

    /* ===== outfield wall, following a real-ish arc ===== */
    function wallRadius(a) {          // a = -45deg (LF) .. +45deg (RF), 0 = CF
      return lerp(WALL_CF, WALL_LF, Math.abs(a) / (Math.PI / 4));
    }
    var WALLN = 46;
    var wallGeo = keep(new T.BoxGeometry(1, 3.0, 0.5));
    var wallMat = keep(new T.MeshPhongMaterial({ color: 0x1f4d2e, flatShading: true, shininess: 6 }));
    var wall = new T.InstancedMesh(wallGeo, wallMat, WALLN);
    var wm = new T.Matrix4(), wq = new T.Quaternion(), wv = new T.Vector3(), ws = new T.Vector3();
    var wallEuler = new T.Euler();
    for (var wi = 0; wi < WALLN; wi++) {
      var a = -Math.PI / 4 + (wi / (WALLN - 1)) * (Math.PI / 2);
      var r = wallRadius(a);
      var seg = (r * (Math.PI / 2) / WALLN) * 1.25;
      wv.set(Math.sin(a) * r, 1.5, -Math.cos(a) * r);
      wallEuler.set(0, a, 0);
      wq.setFromEuler(wallEuler);
      ws.set(seg, 1, 1);
      wm.compose(wv, wq, ws);
      wall.setMatrixAt(wi, wm);
    }
    wall.instanceMatrix.needsUpdate = true;
    scene.add(wall);

    /* bleachers + crowd behind the wall */
    var standMat = keep(new T.MeshPhongMaterial({ color: 0x5d5566, flatShading: true, shininess: 3 }));
    var standGeo = keep(new T.BoxGeometry(1, 19, 16));
    var stands = new T.InstancedMesh(standGeo, standMat, WALLN);
    for (var si2 = 0; si2 < WALLN; si2++) {
      var a2 = -Math.PI / 4 + (si2 / (WALLN - 1)) * (Math.PI / 2);
      var r2 = wallRadius(a2) + 13;
      var seg2 = (r2 * (Math.PI / 2) / WALLN) * 1.3;
      wv.set(Math.sin(a2) * r2, 9.5, -Math.cos(a2) * r2);
      wallEuler.set(0, a2, 0);
      wq.setFromEuler(wallEuler);
      ws.set(seg2, 1, 1);
      wm.compose(wv, wq, ws);
      stands.setMatrixAt(si2, wm);
    }
    stands.instanceMatrix.needsUpdate = true;
    scene.add(stands);

    var CROWD = 620;
    var crowdGeo = keep(new T.BoxGeometry(0.85, 1.1, 0.7));
    var crowdMat = keep(new T.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 2 }));
    var crowd = new T.InstancedMesh(crowdGeo, crowdMat, CROWD);
    var ccol = new Float32Array(CROWD * 3);
    var seats = [];
    var cc = new T.Color();
    for (var ci = 0; ci < CROWD; ci++) {
      var a3 = rand(-Math.PI / 4, Math.PI / 4);
      var r3 = wallRadius(a3) + rand(2.5, 9);
      seats.push({ x: Math.sin(a3) * r3, y: 4.5 + (r3 - wallRadius(a3)) * 1.5, z: -Math.cos(a3) * r3, ph: rand(0, TAU) });
      cc.setHSL(Math.random(), 0.4, rand(0.3, 0.6));
      ccol[ci * 3] = cc.r; ccol[ci * 3 + 1] = cc.g; ccol[ci * 3 + 2] = cc.b;
    }
    crowdGeo.setAttribute('color', new T.InstancedBufferAttribute(ccol, 3));
    scene.add(crowd);

    /* foul poles */
    var poleMat = keep(new T.MeshPhongMaterial({ color: 0xffd23f, shininess: 40 }));
    var poleGeo = keep(new T.CylinderGeometry(0.22, 0.22, 14, 8));
    [-1, 1].forEach(function (sgn) {
      var p = new T.Mesh(poleGeo, poleMat);
      var a4 = sgn * Math.PI / 4;
      p.position.set(Math.sin(a4) * WALL_LF, 7, -Math.cos(a4) * WALL_LF);
      scene.add(p);
    });

    /* ===== people ===== */
    var homeKit = keep(new T.MeshPhongMaterial({ color: 0xf2f3f5, flatShading: true, shininess: 14 }));
    var awayKit = keep(new T.MeshPhongMaterial({ color: 0x2f4d8a, flatShading: true, shininess: 14 }));
    var pantMat = keep(new T.MeshPhongMaterial({ color: 0xdfe2e6, flatShading: true, shininess: 10 }));
    var skinMat = keep(new T.MeshPhongMaterial({ color: 0xd9a077, flatShading: true, shininess: 10 }));
    var helmMat = keep(new T.MeshPhongMaterial({ color: 0x18243d, flatShading: true, shininess: 60 }));
    var batMat  = keep(new T.MeshPhongMaterial({ color: 0xb98346, flatShading: true, shininess: 40 }));

    var torsoGeo = keep(new T.CylinderGeometry(0.19, 0.22, 0.5, 8));
    var headGeo  = keep(new T.SphereGeometry(0.15, 12, 10));
    var helmGeo  = keep(new T.SphereGeometry(0.165, 12, 10));
    var limbGeo  = keep(new T.CylinderGeometry(0.058, 0.05, 0.36, 6));
    var batGeo   = keep(new T.CylinderGeometry(0.035, 0.058, 0.86, 8));

    function buildPlayer(kit) {
      var g = new T.Group();
      var torso = new T.Mesh(torsoGeo, kit); torso.position.y = 0.7; g.add(torso);
      var head = new T.Mesh(headGeo, skinMat); head.position.y = 1.08; g.add(head);
      function limb(mat, x, y) {
        var l = new T.Group(); l.position.set(x, y, 0);
        var m = new T.Mesh(limbGeo, mat); m.position.y = -0.18; l.add(m);
        g.add(l); return l;
      }
      var legL = limb(pantMat, -0.09, 0.45), legR = limb(pantMat, 0.09, 0.45);
      var armL = limb(kit, -0.235, 0.9), armR = limb(kit, 0.235, 0.9);
      return { g: g, head: head, legL: legL, legR: legR, armL: armL, armR: armR };
    }

    var batter = buildPlayer(homeKit);
    var helm = new T.Mesh(helmGeo, helmMat); helm.position.y = 1.1; batter.g.add(helm);
    batter.head.visible = false;
    var batPivot = new T.Group();
    batPivot.position.set(0.1, 0.98, 0);
    var bat = new T.Mesh(batGeo, batMat);
    bat.position.y = 0.43;
    batPivot.add(bat);
    batter.g.add(batPivot);
    batter.g.position.set(-0.85, 0, 1.0);
    batter.g.rotation.y = 0.35;
    scene.add(batter.g);

    var pitcher = buildPlayer(awayKit);
    pitcher.g.position.set(0, 0.25, MOUND_Z);
    pitcher.g.rotation.y = Math.PI;
    scene.add(pitcher.g);

    var shTex = keep(softDot(T, 'rgba(40,26,10,0.55)', 'rgba(40,26,10,0)'));
    var shGeo = keep(new T.PlaneGeometry(1.4, 1.4));
    var shMat = keep(new T.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.55, depthWrite: false }));
    [batter, pitcher].forEach(function (p) {
      var sh = new T.Mesh(shGeo, shMat);
      sh.rotation.x = -Math.PI / 2;
      sh.position.y = p === pitcher ? -0.24 : 0.02;
      p.g.add(sh);
    });

    /* ===== ball ===== */
    var ballTex = keep(ballTexture(T));
    // arcade-scaled: a real ball is 37mm across and is a single pixel at the
    // mound on a phone screen. Tracking it is the entire game, so it gets bigger.
    var ballGeo = keep(new T.SphereGeometry(0.105, 14, 10));
    var ballMat = keep(new T.MeshPhongMaterial({ map: ballTex, shininess: 40 }));
    var ball = new T.Mesh(ballGeo, ballMat);
    ball.visible = false;
    scene.add(ball);

    /* The ball's shadow racing toward the plate is the timing cue — much easier
       to read than a ball coming straight at the camera. */
    var bShadow = new T.Mesh(keep(new T.PlaneGeometry(0.55, 0.55)), shMat);
    bShadow.rotation.x = -Math.PI / 2;
    bShadow.position.y = 0.03;
    bShadow.visible = false;
    scene.add(bShadow);

    /* ===== dust / contact spark ===== */
    var PUFF = 40;
    var puffGeo = keep(new T.BufferGeometry());
    var puffPos = new Float32Array(PUFF * 3);
    var puffs = [];
    for (var qi = 0; qi < PUFF; qi++) { puffs.push({ life: 0, vx: 0, vy: 0, vz: 0 }); puffPos[qi * 3 + 1] = -90; }
    puffGeo.setAttribute('position', new T.BufferAttribute(puffPos, 3));
    var puffTex = keep(softDot(T, 'rgba(255,242,214,1)', 'rgba(200,168,120,0)'));
    var puffMat = keep(new T.PointsMaterial({
      size: 0.4, map: puffTex, transparent: true, opacity: 0.85,
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
        p.life = rand(0.35, 0.85);
        p.vx = rand(-spread, spread); p.vy = rand(up * 0.3, up); p.vz = rand(-spread, spread);
        puffNext = (puffNext + 1) % PUFF;
      }
    }

    /* ===== ui ===== */
    var ui = document.createElement('div');
    ui.className = 'hr-ui';
    ui.innerHTML =
      '<div class="hr-vig"></div>' +
      '<div class="hr-flash"></div>' +
      '<div class="hr-outs"><span>OUTS</span><i></i><i></i><i></i></div>' +
      '<div class="hr-streak"></div>' +
      '<div class="hr-call"></div>' +
      '<div class="hr-dist"></div>' +
      '<div class="hr-hint">tap to swing</div>';
    ctx.overlay.appendChild(ui);

    var elFlash = ui.querySelector('.hr-flash');
    var elCall = ui.querySelector('.hr-call');
    var elDist = ui.querySelector('.hr-dist');
    var elHint = ui.querySelector('.hr-hint');
    var elStreak = ui.querySelector('.hr-streak');
    var outDots = ui.querySelectorAll('.hr-outs i');

    var callT = 0, distT = 0;
    function call(text, color) {
      elCall.textContent = text;
      elCall.style.color = color || '#fff3d6';
      callT = 1.1;
    }
    var flashT = 0, flashRGB = '255,255,255';
    function flash(rgb, dur) { flashT = dur || 0.3; flashRGB = rgb; }

    /* ===== state ===== */
    var ST_WIND = 0, ST_PITCH = 1, ST_FLIGHT = 2, ST_RESET = 3;
    var state = ST_WIND;
    var stateT = 0;

    var totalFeet = 0, outs = 0, dead = false;
    var pitchCount = 0, homers = 0, streak = 0;
    var pitch = null, swung = false;
    var hit = null;                 // { vx, vy, vz, t, feet, foul, homer }
    var shownDist = 0;
    var camShake = 0;

    var relPos = new T.Vector3(0.34, 1.82, MOUND_Z + 1.1);
    var platePos = new T.Vector3(0, 0.95, 0.25);

    var camHome = new T.Vector3(-0.02, 2.35, 4.4);
    var camAim = new T.Vector3(0.06, 1.15, -12);
    var camPos = camHome.clone();
    var aimPos = camAim.clone();
    camera.position.copy(camPos);
    camera.lookAt(aimPos);

    function setOuts() {
      for (var i = 0; i < outDots.length; i++) outDots[i].classList.toggle('used', i < outs);
    }

    function takeOut(why) {
      outs++;
      setOuts();
      streak = 0;
      elStreak.classList.remove('on');
      call(why, '#ff7a6b');
      flash('255,90,70', 0.35);
      camShake = 0.3;
      if (navigator.vibrate) navigator.vibrate([40, 50]);
      if (outs >= 3) {
        dead = true;
        ctx.gameOver();
      }
    }

    function newPitch() {
      pitch = rollPitch();
      pitch.t = 0;
      swung = false;
      hit = null;
      pitchCount++;
      state = ST_WIND;
      stateT = 0;
      ball.visible = false;
      bShadow.visible = false;
    }

    /* ball position along the pitch, with the break arriving late so a curve
       actually has to be read rather than predicted at release */
    var tmpV = new T.Vector3();
    function ballAt(u) {
      var e = ease(clamp(u, 0, 1));
      var x = lerp(relPos.x, platePos.x, e);
      var y = lerp(relPos.y, platePos.y, e);
      var z = lerp(relPos.z, platePos.z, u);
      var bk = u * u * u;                       // break loads up late
      x += pitch.breakX * bk;
      y += pitch.breakY * bk;
      y += Math.sin(u * Math.PI) * 0.12;        // slight hump
      return tmpV.set(x, y, z);
    }

    function swing() {
      if (swung || !pitch) return;
      swung = true;
      var err = pitch.t - pitch.flight;         // <0 early, >0 late
      var ae = Math.abs(err);

      if (ae > 0.20) {
        ball.visible = false;
        bShadow.visible = false;
        state = ST_RESET;
        stateT = 0;
        takeOut(err < 0 ? 'WAY EARLY' : 'SWING AND MISS');
        return;
      }

      // timing sets direction as well as power: early pulls, late slices
      var quality = 1 - clamp(ae / 0.20, 0, 1);            // 0..1
      // batter stands on the third-base side, so he's right-handed: swinging
      // early pulls to LEFT field (-x), late slices to right
      var spray = clamp(err * 5.2, -0.62, 0.62);           // radians off centre
      var foul = Math.abs(spray) > 0.46;

      var feet;
      if (quality > 0.78)      feet = rand(392, 468) * (1 + (0.70 - pitch.flight) * 0.22);
      else if (quality > 0.46) feet = rand(288, 384);
      else                     feet = rand(96, 235);
      feet = Math.round(feet);

      var launch = lerp(0.22, 0.62, quality) + rand(-0.05, 0.05);
      var metres = feet * FT;
      var speedH = metres / 3.0;                            // ~3s hang time

      hit = {
        t: 0,
        dur: lerp(1.5, 3.2, quality),
        feet: feet,
        foul: foul,
        spray: spray,
        launch: launch,
        dist: metres,
        homer: false,
        from: ball.position.clone()
      };
      // over the wall in that direction?
      hit.homer = !foul && metres >= wallRadius(spray);
      if (hit.homer) { homers++; streak++; }
      else streak = 0;

      if (foul) {
        call('FOUL', '#ffc46b');
      } else {
        totalFeet += feet;
        ctx.setScore(totalFeet);
      }

      elStreak.textContent = streak > 1 ? streak + ' IN A ROW' : '';
      elStreak.classList.toggle('on', streak > 1);

      burst(ball.position.x, ball.position.y, ball.position.z, 10, 0.4, 1.4);
      flash(hit.homer ? '255,214,120' : '255,255,255', hit.homer ? 0.5 : 0.2);
      camShake = hit.homer ? 0.55 : 0.28;
      if (navigator.vibrate) navigator.vibrate(hit.homer ? [25, 40, 60] : 18);

      shownDist = 0;
      state = ST_FLIGHT;
      stateT = 0;
      if (pitchCount > 2) elHint.style.opacity = '0';
    }

    function pointer(type) {
      if (dead || killed || type !== 'down') return;
      if (state === ST_PITCH) swing();
    }

    function update(dt) {
      if (killed) return;
      if (dead) { if (camShake > 0) camShake -= dt * 1.4; return; }

      stateT += dt;

      /* ---- pitch lifecycle ---- */
      if (state === ST_WIND) {
        var w = clamp(stateT / 0.75, 0, 1);
        pitcher.armR.rotation.x = -Math.sin(w * Math.PI) * 2.6;
        pitcher.legL.rotation.x = Math.sin(w * Math.PI) * 0.7;
        if (stateT >= 0.75) {
          state = ST_PITCH;
          stateT = 0;
          pitch.t = 0;
          ball.visible = true;
          bShadow.visible = true;
        }
      } else if (state === ST_PITCH) {
        pitch.t += dt;
        var u = pitch.t / pitch.flight;
        var p = ballAt(u);
        ball.position.copy(p);
        ball.rotation.x -= dt * 26;
        bShadow.position.set(p.x, 0.03, p.z);
        var h = clamp(p.y / 2, 0, 1);
        bShadow.scale.setScalar(1 - h * 0.4);

        if (pitch.t > pitch.flight + 0.20) {
          // it went by untouched
          ball.visible = false;
          bShadow.visible = false;
          state = ST_RESET;
          stateT = 0;
          takeOut(swung ? 'SWING AND MISS' : 'CALLED STRIKE');
        }
      } else if (state === ST_FLIGHT) {
        hit.t += dt / hit.dur;
        var ht = clamp(hit.t, 0, 1);
        var reach = hit.dist * ht;
        ball.position.set(
          Math.sin(hit.spray) * reach,
          Math.max(0.04, Math.sin(ht * Math.PI) * hit.dist * hit.launch * 0.55 + 0.9 * (1 - ht)),
          -Math.cos(hit.spray) * reach
        );
        ball.rotation.x -= dt * 12;
        // the chase camera falls a long way behind on a 450ft shot, so scale the
        // ball with distance or the payoff is a single pixel in the sky
        var camDist = camera.position.distanceTo(ball.position);
        ball.scale.setScalar(clamp(camDist / 11, 1, 9));
        bShadow.position.set(ball.position.x, 0.03, ball.position.z);
        bShadow.scale.setScalar(clamp(1 - ball.position.y / 40, 0.25, 1));

        shownDist = Math.round(hit.feet * ht);
        elDist.innerHTML = shownDist + '<small> ft</small>';
        elDist.style.opacity = '1';

        if (hit.t >= 1) {
          burst(ball.position.x, 0.2, ball.position.z, 8, 1.2, 1.6);
          if (hit.foul) call('FOUL BALL', '#ffc46b');
          else if (hit.homer) { call('HOME RUN', '#ffd166'); flash('255,214,120', 0.5); }
          else call('IN PLAY', '#dfe9f5');
          distT = 1.3;
          state = ST_RESET;
          stateT = 0;
        }
      } else if (state === ST_RESET) {
        if (stateT > 1.15) {
          ball.visible = false;
          bShadow.visible = false;
          newPitch();
        }
      }

      /* ---- batter swing pose ---- */
      var swingPhase = 0;
      if (swung && (state === ST_FLIGHT || state === ST_RESET)) {
        swingPhase = clamp(stateT / 0.32, 0, 1);
      }
      batPivot.rotation.z = lerp(-0.30, 1.85, ease(swingPhase));
      batPivot.rotation.x = lerp(-0.95, 0.35, ease(swingPhase));
      batter.g.rotation.y = 0.35 + swingPhase * 0.5;
      batter.armR.rotation.x = -0.7 - swingPhase * 0.5;
      batter.armL.rotation.x = -0.7 - swingPhase * 0.5;

      /* ---- crowd ---- */
      var now = performance.now() * 0.001;
      var hype = state === ST_FLIGHT && hit && hit.homer ? 3.2 : 1;
      for (var ci2 = 0; ci2 < CROWD; ci2++) {
        var st = seats[ci2];
        wv.set(st.x, st.y + Math.sin(now * 2.1 * hype + st.ph) * 0.09 * hype, st.z);
        ws.set(1, 1, 1);
        wm.compose(wv, new T.Quaternion(), ws);
        crowd.setMatrixAt(ci2, wm);
      }
      crowd.instanceMatrix.needsUpdate = true;

      /* ---- puffs ---- */
      var pa = puffGeo.attributes.position;
      for (var q = 0; q < PUFF; q++) {
        var pk = puffs[q];
        if (pk.life <= 0) continue;
        pk.life -= dt;
        pk.vy -= 4.4 * dt;
        pa.setX(q, pa.getX(q) + pk.vx * dt);
        pa.setY(q, Math.max(0.02, pa.getY(q) + pk.vy * dt));
        pa.setZ(q, pa.getZ(q) + pk.vz * dt);
        if (pk.life <= 0) pa.setY(q, -90);
      }
      pa.needsUpdate = true;

      /* ---- camera: sits behind the plate, then rides the ball out ---- */
      var wantPos, wantAim;
      if (state === ST_FLIGHT) {
        var back = 14 + hit.t * 26;
        wantPos = tmpV.set(
          ball.position.x * 0.35 - Math.sin(hit.spray) * back * 0.15,
          3.5 + ball.position.y * 0.55,
          4.6 + hit.t * 10
        ).clone();
        wantAim = ball.position.clone();
      } else {
        wantPos = camHome;
        wantAim = camAim;
      }
      camPos.lerp(wantPos, 1 - Math.pow(state === ST_FLIGHT ? 0.02 : 0.0005, dt));
      aimPos.lerp(wantAim, 1 - Math.pow(state === ST_FLIGHT ? 0.005 : 0.0005, dt));
      camera.position.copy(camPos);
      if (camShake > 0) {
        camShake -= dt * 1.5;
        var k2 = Math.max(0, camShake) * 0.26;
        camera.position.x += rand(-k2, k2);
        camera.position.y += rand(-k2, k2);
      }
      camera.lookAt(aimPos);

      /* ---- ui ---- */
      if (callT > 0) {
        callT -= dt;
        var ct = clamp(callT / 1.1, 0, 1);
        elCall.style.opacity = String(Math.min(1, ct * 2.6));
        elCall.style.transform = 'translateY(' + (1 - ct) * -12 + 'px) scale(' + (0.93 + ct * 0.1) + ')';
      } else if (elCall.style.opacity !== '0') {
        elCall.style.opacity = '0';
      }

      if (state !== ST_FLIGHT) {
        if (distT > 0) { distT -= dt; elDist.style.opacity = String(clamp(distT / 1.3, 0, 1)); }
        else if (elDist.style.opacity !== '0') elDist.style.opacity = '0';
      }

      if (flashT > 0) {
        flashT -= dt;
        elFlash.style.background =
          'radial-gradient(120% 80% at 50% 45%,rgba(' + flashRGB + ',0) 36%,rgba(' + flashRGB + ',.8) 100%)';
        elFlash.style.opacity = String(clamp(flashT * 2.4, 0, 1) * 0.7);
      } else if (elFlash.style.opacity !== '0') {
        elFlash.style.opacity = '0';
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
      seats.length = 0;
      puffs.length = 0;
      if (wall.dispose) wall.dispose();
      if (stands.dispose) stands.dispose();
      if (crowd.dispose) crowd.dispose();
    }

    ctx.setScore(0);
    setOuts();
    newPitch();


    return {
      scene: scene, camera: camera,
      update: update, pointer: pointer, resize: resize, dispose: dispose
    };
  }

  window.__TIPTAP_GAMES__ = window.__TIPTAP_GAMES__ || [];
  window.__TIPTAP_GAMES__.push({
    slug: 'homerun',
    title: 'Home Run Derby',
    rule: 'Tap to swing. Time it and send it.',
    create: create
  });
})();
