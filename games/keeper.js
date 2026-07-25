/* Keeper — you're in goal under the floodlights.
   Tap a side to dive that way. Shots down the middle you block by standing
   still, so a dive is a commitment rather than a reflex. Some shots curl late:
   go early and you're beaten, read it and you get there. Concede three and
   the run ends. */

(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
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

  /* Arcade scale on purpose. A regulation 7.32m goal will not fit a 9:16
     viewport without pushing the camera so far back the keeper is a speck. */
  var GOAL_W = 3.9, GOAL_H = 1.95, POST_R = 0.07;
  var HW = GOAL_W / 2;
  var LANES = [-1.35, 0, 1.35];
  var REACH = 0.95;                  // < lane spacing, so a wrong guess always concedes
  var KEEPER_Z = -0.3;
  var SPAWN_Z = -18;

  /* ---------------- control-layer css ---------------- */
  var CSS_ID = 'keeper-ui-css';
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
.keep-ui{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;
  font-variant-numeric:tabular-nums}

.keep-vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(125% 75% at 50% 38%,rgba(0,0,0,0) 40%,rgba(2,4,14,.6) 100%)}

.keep-zone{position:absolute;top:0;bottom:0;width:50%;opacity:0}
.keep-zone.l{left:0;background:linear-gradient(90deg,rgba(255,255,255,.18),rgba(255,255,255,0))}
.keep-zone.r{right:0;background:linear-gradient(270deg,rgba(255,255,255,.18),rgba(255,255,255,0))}

.keep-lives{position:absolute;left:19px;top:calc(82px + var(--safe-t));display:flex;gap:7px}
.keep-lives i{width:9px;height:9px;border-radius:50%;background:#ff5f4d;
  box-shadow:0 0 9px rgba(255,95,77,.75);
  transition:background .3s ease,box-shadow .3s ease,transform .3s ease}
.keep-lives i.gone{background:rgba(255,255,255,.15);box-shadow:none;transform:scale(.68)}

.keep-toast{position:absolute;left:0;right:0;top:33%;text-align:center;
  font-size:34px;font-weight:700;letter-spacing:-.02em;opacity:0;
  text-shadow:0 3px 22px rgba(0,0,0,.75)}

.keep-hint{position:absolute;left:0;right:0;bottom:calc(104px + var(--safe-b));
  text-align:center;font-size:13px;color:rgba(244,243,239,.7);
  text-shadow:0 2px 10px rgba(0,0,0,.7);transition:opacity .3s ease}

.keep-flash{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0}
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
    c.width = c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#f6f6f2';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#1b1f2e';
    var spots = [[128, 40], [40, 116], [216, 116], [86, 206], [170, 206], [128, 126]];
    for (var i = 0; i < spots.length; i++) {
      var p = spots[i], r = (i === 5) ? 30 : 26;
      g.beginPath();
      for (var k = 0; k < 5; k++) {
        var a = -Math.PI / 2 + k * TAU / 5 + i * 0.42;
        var x = p[0] + Math.cos(a) * r, y = p[1] + Math.sin(a) * r;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.fill();
    }
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

    /* ===== scene, night sky ===== */
    var scene = new T.Scene();
    scene.fog = new T.Fog(0x141c34, 24, 88);

    var camera = new T.PerspectiveCamera(72, vw / vh, 0.1, 400);

    var skyGeo = keep(new T.SphereGeometry(200, 24, 16));
    var skyMat = keep(new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new T.Color(0x04060f) },
        mid: { value: new T.Color(0x18213d) },
        bot: { value: new T.Color(0x222b4c) }
      },
      vertexShader:
        'varying float vH;' +
        'void main(){ vH = normalize(position).y;' +
        'gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float vH;' +
        'void main(){ vec3 c = vH > 0.0 ? mix(mid, top, pow(vH, 0.5))' +
        ' : mix(mid, bot, pow(-vH, 0.6));' +
        'gl_FragColor = vec4(c, 1.0); }'
    }));
    scene.add(new T.Mesh(skyGeo, skyMat));

    scene.add(new T.HemisphereLight(0x9fb6e8, 0x1d3a22, 0.45));
    var keyL = new T.DirectionalLight(0xfff2da, 0.8); keyL.position.set(-16, 20, -12); scene.add(keyL);
    var keyR = new T.DirectionalLight(0xfff2da, 0.8); keyR.position.set(16, 20, -12); scene.add(keyR);
    var rimL = new T.DirectionalLight(0x7fb0ff, 0.32); rimL.position.set(0, 8, 14); scene.add(rimL);

    /* ===== pitch, mown in stripes ===== */
    var PITCH = 150, PSEG = 84;
    var pitchGeo = keep(new T.PlaneGeometry(PITCH, PITCH, PSEG, PSEG));
    pitchGeo.rotateX(-Math.PI / 2);
    var pp = pitchGeo.attributes.position;
    var pcol = new Float32Array(pp.count * 3);
    var gDark = new T.Color(0x24592c), gLight = new T.Color(0x35803c);
    var tc = new T.Color();
    for (var vi = 0; vi < pp.count; vi++) {
      var px = pp.getX(vi), pz = pp.getZ(vi);
      var stripe = Math.floor((pz + 300) / 4.2) % 2 === 0;
      tc.copy(stripe ? gLight : gDark);
      var n = vnoise(px * 0.5, pz * 0.5);
      tc.offsetHSL(0, 0, (n - 0.5) * 0.055);
      pp.setY(vi, (vnoise(px * 0.09, pz * 0.09) - 0.5) * 0.06);
      pcol[vi * 3] = tc.r; pcol[vi * 3 + 1] = tc.g; pcol[vi * 3 + 2] = tc.b;
    }
    pitchGeo.setAttribute('color', new T.BufferAttribute(pcol, 3));
    pitchGeo.computeVertexNormals();
    var pitchMat = keep(new T.MeshPhongMaterial({ vertexColors: true, shininess: 6 }));
    scene.add(new T.Mesh(pitchGeo, pitchMat));

    /* markings */
    var lineMat = keep(new T.MeshBasicMaterial({ color: 0xe8f0ea, transparent: true, opacity: 0.5 }));
    function paint(w, d, x, z) {
      var g = keep(new T.PlaneGeometry(w, d));
      var m = new T.Mesh(g, lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.014, z);
      scene.add(m);
    }
    paint(44, 0.09, 0, 0);
    paint(0.09, 5.6, -5.6, -2.8);
    paint(0.09, 5.6, 5.6, -2.8);
    paint(11.2, 0.09, 0, -5.6);
    paint(0.09, 2.1, -2.9, -1.05);
    paint(0.09, 2.1, 2.9, -1.05);
    paint(5.8, 0.09, 0, -2.1);

    /* ===== goal frame ===== */
    var postGeo = keep(new T.CylinderGeometry(POST_R, POST_R, GOAL_H, 10));
    var barGeo = keep(new T.CylinderGeometry(POST_R, POST_R, GOAL_W + POST_R * 2, 10));
    var whiteMat = keep(new T.MeshPhongMaterial({ color: 0xf2f5f4, shininess: 70 }));

    var postL = new T.Mesh(postGeo, whiteMat); postL.position.set(-HW, GOAL_H / 2, 0); scene.add(postL);
    var postR = new T.Mesh(postGeo, whiteMat); postR.position.set(HW, GOAL_H / 2, 0); scene.add(postR);
    var crossbar = new T.Mesh(barGeo, whiteMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, GOAL_H, 0);
    scene.add(crossbar);

    /* Net. The camera has to sit ~5u behind the goal line to fit the goal into
       a portrait frame, which means the net is unavoidably between the camera
       and the action — exactly like a TV camera behind the goal. So keep it
       sparse and faint: back panel plus the two side edges, nothing else. */
    var NET_D = 0.85, NX = 10, NY = 6;
    var netPts = [];
    function seg(ax, ay, az, bx, by, bz) { netPts.push(ax, ay, az, bx, by, bz); }
    for (var ix = 0; ix < NX; ix++) {
      var nx = -HW + (ix / (NX - 1)) * GOAL_W;
      seg(nx, 0, NET_D, nx, GOAL_H, NET_D);
    }
    for (var iy = 0; iy < NY; iy++) {
      var ny = (iy / (NY - 1)) * GOAL_H;
      seg(-HW, ny, NET_D, HW, ny, NET_D);
    }
    // side edges only, so the goal reads as a box without a grid over the grass
    seg(-HW, GOAL_H, 0, -HW, GOAL_H, NET_D);
    seg(HW, GOAL_H, 0, HW, GOAL_H, NET_D);
    seg(-HW, 0, NET_D, -HW, GOAL_H, NET_D);
    seg(HW, 0, NET_D, HW, GOAL_H, NET_D);
    var netGeo = keep(new T.BufferGeometry());
    var netArr = new Float32Array(netPts);
    var netBase = netArr.slice(0);
    netGeo.setAttribute('position', new T.BufferAttribute(netArr, 3));
    var netMat = keep(new T.LineBasicMaterial({ color: 0xd4e4ec, transparent: true, opacity: 0.17 }));
    var net = new T.LineSegments(netGeo, netMat);
    net.frustumCulled = false;
    scene.add(net);
    var netHit = { t: 0, x: 0, y: 0 };

    /* ===== stands + crowd ===== */
    var standMat = keep(new T.MeshPhongMaterial({ color: 0x1e2540, shininess: 3, flatShading: true }));
    function stand(w, h, d, x, y, z) {
      var g = keep(new T.BoxGeometry(w, h, d));
      var m = new T.Mesh(g, standMat);
      m.position.set(x, y, z);
      scene.add(m);
    }
    stand(90, 10, 12, 0, 5, -58);
    stand(12, 10, 80, -32, 5, -20);
    stand(12, 10, 80, 32, 5, -20);

    var CROWD = 250;
    var crowdGeo = keep(new T.BoxGeometry(0.75, 1.0, 0.6));
    var crowdMat = keep(new T.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 2 }));
    var crowd = new T.InstancedMesh(crowdGeo, crowdMat, CROWD);
    var cCol = new Float32Array(CROWD * 3);
    var seats = [];
    var cMat4 = new T.Matrix4(), cQuat = new T.Quaternion(),
        cPos = new T.Vector3(), cScale = new T.Vector3(1, 1, 1);
    var cCo = new T.Color();
    for (var ci = 0; ci < CROWD; ci++) {
      var side = Math.random(), sx, sz;
      if (side < 0.5) { sx = rand(-42, 42); sz = rand(-62, -54); }
      else if (side < 0.75) { sx = rand(-36, -29); sz = rand(-58, 18); }
      else { sx = rand(29, 36); sz = rand(-58, 18); }
      // sit them on top of the stands rather than floating above
      seats.push({ x: sx, y: rand(10.1, 10.5), z: sz, ph: rand(0, TAU) });
      cCo.setHSL(Math.random(), 0.34, rand(0.3, 0.56));
      cCol[ci * 3] = cCo.r; cCol[ci * 3 + 1] = cCo.g; cCol[ci * 3 + 2] = cCo.b;
    }
    crowdGeo.setAttribute('color', new T.InstancedBufferAttribute(cCol, 3));
    scene.add(crowd);

    /* ===== floodlights ===== */
    var poleGeo = keep(new T.CylinderGeometry(0.22, 0.34, 20, 8));
    var poleMat = keep(new T.MeshPhongMaterial({ color: 0x1b2033, shininess: 10, flatShading: true }));
    var lampGeo = keep(new T.BoxGeometry(4.2, 1.5, 0.5));
    var lampMat = keep(new T.MeshBasicMaterial({ color: 0xfff6e2, fog: false }));
    var glowTex = keep(softDot(T, 'rgba(255,246,220,0.9)', 'rgba(255,215,140,0)'));
    var glowGeo = keep(new T.PlaneGeometry(15, 15));
    var glows = [];
    // the far pair sit inside the horizontal frustum so they actually appear in
    // frame and give the empty upper half something to look at
    var TOWERS = [[-16, -64], [16, -64], [-32, 8], [32, 8]];
    for (var ti = 0; ti < TOWERS.length; ti++) {
      var tp = TOWERS[ti];
      var pole = new T.Mesh(poleGeo, poleMat);
      pole.position.set(tp[0], 10, tp[1]);
      scene.add(pole);
      var lamp = new T.Mesh(lampGeo, lampMat);
      lamp.position.set(tp[0], 20.2, tp[1]);
      lamp.lookAt(0, 0, -6);
      scene.add(lamp);
      var gMat = keep(new T.MeshBasicMaterial({
        map: glowTex, transparent: true, opacity: 0.45, depthWrite: false,
        blending: T.AdditiveBlending, fog: false
      }));
      var gl = new T.Mesh(glowGeo, gMat);
      gl.position.set(tp[0], 20.2, tp[1]);
      scene.add(gl);
      glows.push(gl);
    }

    /* ===== keeper rig ===== */
    var kitMat   = keep(new T.MeshPhongMaterial({ color: 0xffe14d, flatShading: true, shininess: 24 }));
    var shortMat = keep(new T.MeshPhongMaterial({ color: 0x1d2233, flatShading: true, shininess: 12 }));
    var skinMat  = keep(new T.MeshPhongMaterial({ color: 0xe3ab82, flatShading: true, shininess: 10 }));
    var gloveMat = keep(new T.MeshPhongMaterial({ color: 0x30e0d0, flatShading: true, shininess: 40 }));
    var hairMat  = keep(new T.MeshPhongMaterial({ color: 0x2b2118, flatShading: true, shininess: 8 }));

    var torsoGeo = keep(new T.CylinderGeometry(0.16, 0.19, 0.5, 9));
    var headGeo  = keep(new T.SphereGeometry(0.145, 12, 10));
    var hairGeo  = keep(new T.SphereGeometry(0.152, 12, 10));
    var limbGeo  = keep(new T.CylinderGeometry(0.058, 0.05, 0.36, 7));
    var gloveGeo = keep(new T.SphereGeometry(0.075, 8, 6));
    var bootGeo  = keep(new T.BoxGeometry(0.12, 0.085, 0.2));

    var keeper = new T.Group();
    var kBody = new T.Group();
    keeper.add(kBody);

    var torso = new T.Mesh(torsoGeo, kitMat); torso.position.y = 0.68; kBody.add(torso);
    // keeper faces downfield (-z), so the back of his head points at the camera
    var hair = new T.Mesh(hairGeo, hairMat); hair.position.set(0, 1.03, 0.025); kBody.add(hair);
    var head = new T.Mesh(headGeo, skinMat); head.position.set(0, 1.02, -0.02); kBody.add(head);

    function limb(mat, x, y) {
      var g = new T.Group();
      g.position.set(x, y, 0);
      var m = new T.Mesh(limbGeo, mat);
      m.position.y = -0.18;
      g.add(m);
      return g;
    }
    var legL = limb(shortMat, -0.08, 0.43), legR = limb(shortMat, 0.08, 0.43);
    var armL = limb(kitMat, -0.235, 0.87), armR = limb(kitMat, 0.235, 0.87);
    kBody.add(legL); kBody.add(legR); kBody.add(armL); kBody.add(armR);

    var bootL = new T.Mesh(bootGeo, shortMat); bootL.position.set(0, -0.35, 0.03); legL.add(bootL);
    var bootR = new T.Mesh(bootGeo, shortMat); bootR.position.set(0, -0.35, 0.03); legR.add(bootR);
    var gloveL = new T.Mesh(gloveGeo, gloveMat); gloveL.position.y = -0.37; armL.add(gloveL);
    var gloveR = new T.Mesh(gloveGeo, gloveMat); gloveR.position.y = -0.37; armR.add(gloveR);

    var shTex = keep(softDot(T, 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0)'));
    var shGeo = keep(new T.PlaneGeometry(1.15, 1.15));
    var shMat = keep(new T.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.55, depthWrite: false }));
    var kShadow = new T.Mesh(shGeo, shMat);
    kShadow.rotation.x = -Math.PI / 2;
    kShadow.position.y = 0.016;
    keeper.add(kShadow);

    keeper.position.set(0, 0, KEEPER_Z);
    scene.add(keeper);

    /* ===== striker ===== */
    var strikeKit = keep(new T.MeshPhongMaterial({ color: 0xe23b4e, flatShading: true, shininess: 18 }));
    var striker = new T.Group();
    var sBody = new T.Group();
    striker.add(sBody);
    var sTorso = new T.Mesh(torsoGeo, strikeKit); sTorso.position.y = 0.68; sBody.add(sTorso);
    var sHair = new T.Mesh(hairGeo, hairMat); sHair.position.set(0, 1.03, 0.02); sBody.add(sHair);
    var sHead = new T.Mesh(headGeo, skinMat); sHead.position.set(0, 1.02, -0.02); sBody.add(sHead);
    var sLegL = limb(shortMat, -0.08, 0.43), sLegR = limb(shortMat, 0.08, 0.43);
    var sArmL = limb(strikeKit, -0.215, 0.87), sArmR = limb(strikeKit, 0.215, 0.87);
    sBody.add(sLegL); sBody.add(sLegR); sBody.add(sArmL); sBody.add(sArmR);
    var sShadow = new T.Mesh(shGeo, shMat);
    sShadow.rotation.x = -Math.PI / 2;
    sShadow.position.y = 0.016;
    striker.add(sShadow);
    sBody.rotation.y = Math.PI;          // facing the goal
    striker.position.set(0, 0, SPAWN_Z);
    scene.add(striker);

    /* ===== ball ===== */
    var ballTex = keep(ballTexture(T));
    var ballGeo = keep(new T.SphereGeometry(0.19, 16, 12));
    var ballMat = keep(new T.MeshPhongMaterial({ map: ballTex, shininess: 45 }));
    var ball = new T.Mesh(ballGeo, ballMat);
    ball.visible = false;
    scene.add(ball);

    var bShadow = new T.Mesh(keep(new T.PlaneGeometry(0.5, 0.5)), shMat);
    bShadow.rotation.x = -Math.PI / 2;
    bShadow.position.y = 0.018;
    bShadow.visible = false;
    scene.add(bShadow);

    /* ball trail */
    var TRAIL = 14;
    var trailGeo = keep(new T.BufferGeometry());
    var trailArr = new Float32Array(TRAIL * 3);
    trailGeo.setAttribute('position', new T.BufferAttribute(trailArr, 3));
    var trailMat = keep(new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    var trail = new T.Line(trailGeo, trailMat);
    trail.frustumCulled = false;
    trail.visible = false;
    scene.add(trail);

    /* ===== grass puffs ===== */
    var PUFF = 30;
    var puffGeo = keep(new T.BufferGeometry());
    var puffPos = new Float32Array(PUFF * 3);
    var puffs = [];
    for (var qi = 0; qi < PUFF; qi++) {
      puffs.push({ life: 0, vx: 0, vy: 0, vz: 0 });
      puffPos[qi * 3 + 1] = -60;
    }
    puffGeo.setAttribute('position', new T.BufferAttribute(puffPos, 3));
    var puffTex = keep(softDot(T, 'rgba(180,235,180,1)', 'rgba(120,190,120,0)'));
    var puffMat = keep(new T.PointsMaterial({
      size: 0.22, map: puffTex, transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true
    }));
    var puffPts = new T.Points(puffGeo, puffMat);
    puffPts.frustumCulled = false;
    scene.add(puffPts);
    var puffNext = 0;

    function emitPuff(x, y, z, n, spread, up) {
      for (var i = 0; i < n; i++) {
        var p = puffs[puffNext];
        puffPos[puffNext * 3] = x;
        puffPos[puffNext * 3 + 1] = y;
        puffPos[puffNext * 3 + 2] = z;
        p.life = rand(0.35, 0.8);
        p.vx = rand(-spread, spread);
        p.vy = rand(up * 0.35, up);
        p.vz = rand(-spread, spread);
        puffNext = (puffNext + 1) % PUFF;
      }
    }

    /* ===== ui ===== */
    var ui = document.createElement('div');
    ui.className = 'keep-ui';
    ui.innerHTML =
      '<div class="keep-vig"></div>' +
      '<div class="keep-flash"></div>' +
      '<div class="keep-zone l"></div>' +
      '<div class="keep-zone r"></div>' +
      '<div class="keep-lives"><i></i><i></i><i></i></div>' +
      '<div class="keep-toast"></div>' +
      '<div class="keep-hint">tap a side to dive</div>';
    ctx.overlay.appendChild(ui);

    var elFlash = ui.querySelector('.keep-flash');
    var elZoneL = ui.querySelector('.keep-zone.l');
    var elZoneR = ui.querySelector('.keep-zone.r');
    var elToast = ui.querySelector('.keep-toast');
    var elHint = ui.querySelector('.keep-hint');
    var lifeDots = ui.querySelectorAll('.keep-lives i');

    var toastT = 0;
    function toast(text, color) {
      elToast.textContent = text;
      elToast.style.color = color || '#f4f3ef';
      toastT = 0.95;
    }
    var flashT = 0, flashRGB = '255,255,255';
    function flash(rgb, dur) { flashT = dur || 0.4; flashRGB = rgb; }
    var zoneT = 0, zoneSide = 0;

    /* ===== state ===== */
    var ST_WAIT = 0, ST_FLIGHT = 1, ST_RESULT = 2;
    var state = ST_WAIT;

    var saves = 0, lives = 3, dead = false;
    var shotN = 0;
    var waitT = 0.9;

    var shot = null;      // { lane, endLane, curl, dur, t, y0 }
    var resultT = 0;

    // keeper dive
    var kx = 0, kTargetX = 0, kDive = 0, kDiveDir = 0, kAir = 0;
    var kRecover = 0;

    var camShake = 0, camPunch = 0;
    // 7.2 is the closest the camera can sit and still fit both posts in a
    // portrait frame — any nearer and the goal runs off the sides
    var camPos = new T.Vector3(0, 2.25, 7.2);
    var camAim = new T.Vector3(0, 1.5, -12);
    camera.position.copy(camPos);
    camera.lookAt(camAim);

    var trailPts = [];

    function nextShot() {
      shotN++;
      // ramp: slower and straight early, quick and curling later
      var dur = clamp(1.45 - shotN * 0.045, 0.62, 1.45);
      var curlChance = clamp((shotN - 4) * 0.055, 0, 0.45);
      var lane = Math.floor(rand(0, 3));
      var endLane = lane;
      var curl = Math.random() < curlChance;
      if (curl) {
        // curl to an adjacent lane so the read stays fair
        var opts = lane === 1 ? [0, 2] : [1];
        endLane = opts[Math.floor(rand(0, opts.length))];
      }
      shot = { lane: lane, endLane: endLane, curl: curl, dur: dur, t: 0, y0: rand(0.45, 1.25) };

      striker.position.x = LANES[lane] * rand(1.6, 2.6);
      striker.position.z = SPAWN_Z + rand(-2, 2);
      sBody.rotation.y = Math.PI;

      ball.visible = true;
      bShadow.visible = true;
      trail.visible = true;
      trailPts.length = 0;
      state = ST_FLIGHT;
      elHint.style.opacity = shotN > 2 ? '0' : '1';
    }

    function ballXAt(t) {
      // straight until 55% of the flight, then it bends — commit early and
      // you're beaten, wait and you can read it
      var a = LANES[shot.lane], b = LANES[shot.endLane];
      if (a === b) return a;
      var k = clamp((t - 0.55) / 0.45, 0, 1);
      return lerp(a, b, ease(k));
    }
    function ballYAt(t) {
      var apex = shot.y0 + 0.55;
      return lerp(shot.y0, 0.95, t) + Math.sin(t * Math.PI) * (apex - shot.y0) * 0.6;
    }

    function resolve() {
      var bx = ballXAt(1);
      var saved = Math.abs(bx - kx) < REACH;
      state = ST_RESULT;
      resultT = 0;

      if (saved) {
        saves++;
        ctx.setScore(saves);
        toast('SAVE', '#5be08a');
        flash('130,255,190', 0.3);
        camPunch = 0.5;
        emitPuff(bx, 0.6, 0.1, 12, 1.1, 2.6);
        if (navigator.vibrate) navigator.vibrate(24);
        // deflect
        shot.deflect = { vx: (bx - kx) * 3 + rand(-2, 2), vy: rand(3, 5), vz: rand(-7, -3) };
      } else {
        lives--;
        for (var i = 0; i < lifeDots.length; i++) {
          if (i >= lives) lifeDots[i].classList.add('gone');
        }
        toast('GOAL', '#ff6b53');
        flash('255,80,60', 0.5);
        camShake = 0.55;
        netHit.t = 1;
        netHit.x = bx;
        netHit.y = ballYAt(1);
        if (navigator.vibrate) navigator.vibrate([40, 50, 70]);
        if (lives <= 0) {
          dead = true;
          ctx.gameOver();
        }
      }
    }

    function pointer(type, x) {
      if (dead || killed) return;
      if (type !== 'down') return;
      var left = x < vw / 2;
      // a dive is a commitment: you can't re-aim mid-air
      if (kDive > 0.01 && kRecover <= 0) return;
      kDiveDir = left ? -1 : 1;
      kTargetX = LANES[left ? 0 : 2];
      kDive = 1;
      kRecover = 0;
      kAir = 0;
      emitPuff(kx, 0.1, KEEPER_Z, 5, 0.5, 1.4);
      zoneT = 0.16;
      zoneSide = left ? -1 : 1;
      if (navigator.vibrate) navigator.vibrate(10);
    }

    function update(dt) {
      if (killed || dead) return;

      /* ---- keeper motion ---- */
      if (kDive > 0.01) {
        kAir += dt;
        // out fast, hang, then recover to centre
        if (kAir < 0.26) {
          kx = lerp(kx, kTargetX, 1 - Math.pow(0.0005, dt));
        } else if (kAir > 0.62) {
          kRecover = 1;
          kx = lerp(kx, 0, 1 - Math.pow(0.02, dt));
          if (Math.abs(kx) < 0.05) { kx = 0; kDive = 0; kRecover = 0; kDiveDir = 0; }
        }
      }
      keeper.position.x = kx;

      var diveAmt = clamp(Math.abs(kx) / 1.65, 0, 1);
      var hop = kDive > 0.01 ? Math.sin(clamp(kAir / 0.7, 0, 1) * Math.PI) * 0.42 : 0;
      kBody.position.y = hop;
      kBody.rotation.z = -kDiveDir * diveAmt * 1.15;
      kBody.rotation.x = -diveAmt * 0.18;
      // arms reach toward the dive
      armL.rotation.z = diveAmt * (kDiveDir < 0 ? 1.5 : 0.5);
      armR.rotation.z = -diveAmt * (kDiveDir > 0 ? 1.5 : 0.5);
      legL.rotation.x = -diveAmt * 0.5;
      legR.rotation.x = -diveAmt * 0.5;
      kShadow.position.x = 0;
      shMat.opacity = 0.55;
      kShadow.scale.setScalar(1 - hop * 0.45);

      // idle bounce when set
      if (kDive <= 0.01) {
        var bob = Math.sin(performance.now() * 0.005) * 0.02;
        kBody.position.y = bob;
        armL.rotation.z = 0.35 + bob;
        armR.rotation.z = -0.35 - bob;
      }

      /* ---- shot lifecycle ---- */
      if (state === ST_WAIT) {
        waitT -= dt;
        if (waitT <= 0) nextShot();
      } else if (state === ST_FLIGHT) {
        shot.t += dt / shot.dur;
        var t = shot.t;

        // striker kick animation in the first beat
        var kick = clamp((t - 0.0) / 0.12, 0, 1);
        sLegR.rotation.x = -Math.sin(kick * Math.PI) * 1.3;
        sArmL.rotation.x = Math.sin(kick * Math.PI) * 0.8;

        if (t >= 1) {
          shot.t = 1;
          ball.position.set(ballXAt(1), ballYAt(1), 0);
          resolve();
        } else {
          ball.position.set(ballXAt(t), ballYAt(t), lerp(SPAWN_Z, 0, t));
          ball.rotation.x -= dt * 9;
          ball.rotation.y -= dt * 4;

          trailPts.unshift(ball.position.clone());
          if (trailPts.length > TRAIL) trailPts.pop();
          for (var tp = 0; tp < TRAIL; tp++) {
            var src = trailPts[Math.min(tp, trailPts.length - 1)] || ball.position;
            trailArr[tp * 3] = src.x;
            trailArr[tp * 3 + 1] = src.y;
            trailArr[tp * 3 + 2] = src.z;
          }
          trailGeo.attributes.position.needsUpdate = true;

          bShadow.position.set(ball.position.x, 0.018, ball.position.z);
          var h = clamp(ball.position.y / 2, 0, 1);
          bShadow.scale.setScalar(1 - h * 0.45);
        }
      } else if (state === ST_RESULT) {
        resultT += dt;
        if (shot.deflect) {
          ball.position.x += shot.deflect.vx * dt;
          ball.position.y += shot.deflect.vy * dt;
          ball.position.z += shot.deflect.vz * dt;
          shot.deflect.vy -= 11 * dt;
          if (ball.position.y < 0.19) { ball.position.y = 0.19; shot.deflect.vy *= -0.45; }
          bShadow.position.set(ball.position.x, 0.018, ball.position.z);
        } else {
          // into the net, then settle
          ball.position.z += 5.5 * dt;
          ball.position.y = Math.max(0.19, ball.position.y - 3.2 * dt);
          bShadow.position.set(ball.position.x, 0.018, ball.position.z);
        }
        ball.rotation.x -= dt * 5;

        if (resultT > 0.85) {
          ball.visible = false;
          bShadow.visible = false;
          trail.visible = false;
          shot = null;
          state = ST_WAIT;
          waitT = 0.55;
        }
      }

      /* ---- net ripple ---- */
      if (netHit.t > 0) {
        netHit.t -= dt * 1.8;
        var amp = Math.max(0, netHit.t);
        for (var ni = 0; ni < netArr.length; ni += 3) {
          var bxp = netBase[ni], byp = netBase[ni + 1], bzp = netBase[ni + 2];
          var d = Math.hypot(bxp - netHit.x, byp - netHit.y);
          var push = Math.exp(-d * d * 1.3) * amp * 0.5 * Math.cos(d * 6 - (1 - netHit.t) * 12);
          netArr[ni + 2] = bzp + push;
        }
        netGeo.attributes.position.needsUpdate = true;
      }

      /* ---- crowd ---- */
      var now = performance.now() * 0.001;
      for (var si = 0; si < CROWD; si++) {
        var st = seats[si];
        cPos.set(st.x, st.y + Math.sin(now * 1.6 + st.ph) * 0.07, st.z);
        cMat4.compose(cPos, cQuat, cScale);
        crowd.setMatrixAt(si, cMat4);
      }
      crowd.instanceMatrix.needsUpdate = true;

      /* ---- floodlight glows face camera ---- */
      for (var gi = 0; gi < glows.length; gi++) glows[gi].quaternion.copy(camera.quaternion);

      /* ---- puffs ---- */
      var pAttr = puffGeo.attributes.position;
      for (var pi2 = 0; pi2 < PUFF; pi2++) {
        var q = puffs[pi2];
        if (q.life <= 0) continue;
        q.life -= dt;
        q.vy -= 5 * dt;
        pAttr.setX(pi2, pAttr.getX(pi2) + q.vx * dt);
        pAttr.setY(pi2, Math.max(0.02, pAttr.getY(pi2) + q.vy * dt));
        pAttr.setZ(pi2, pAttr.getZ(pi2) + q.vz * dt);
        if (q.life <= 0) pAttr.setY(pi2, -60);
      }
      pAttr.needsUpdate = true;

      /* ---- camera ---- */
      if (camPunch > 0) camPunch -= dt * 2.2;
      var push = Math.max(0, camPunch) * 0.5;
      camera.position.set(camPos.x + kx * 0.16, camPos.y - push * 0.2, camPos.z - push);
      if (camShake > 0) {
        camShake -= dt * 1.5;
        var s2 = Math.max(0, camShake) * 0.3;
        camera.position.x += rand(-s2, s2);
        camera.position.y += rand(-s2, s2);
      }
      camera.lookAt(camAim.x + kx * 0.1, camAim.y, camAim.z);

      /* ---- ui ---- */
      if (toastT > 0) {
        toastT -= dt;
        var tt = clamp(toastT / 0.95, 0, 1);
        elToast.style.opacity = String(Math.min(1, tt * 2.6));
        elToast.style.transform = 'translateY(' + (1 - tt) * -14 + 'px) scale(' + (0.92 + tt * 0.12) + ')';
      } else if (elToast.style.opacity !== '0') {
        elToast.style.opacity = '0';
      }

      if (flashT > 0) {
        flashT -= dt;
        elFlash.style.background =
          'radial-gradient(120% 80% at 50% 45%,rgba(' + flashRGB + ',0) 35%,rgba(' + flashRGB + ',.8) 100%)';
        elFlash.style.opacity = String(clamp(flashT * 2, 0, 1) * 0.75);
      } else if (elFlash.style.opacity !== '0') {
        elFlash.style.opacity = '0';
      }

      if (zoneT > 0) {
        zoneT -= dt;
        var z = clamp(zoneT / 0.16, 0, 1);
        (zoneSide < 0 ? elZoneL : elZoneR).style.opacity = String(z);
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
      seats.length = 0;
      trailPts.length = 0;
      if (crowd && crowd.dispose) crowd.dispose();
    }

    ctx.setScore(0);

    return {
      scene: scene, camera: camera,
      update: update, pointer: pointer, resize: resize, dispose: dispose
    };
  }

  window.__TIPTAP_GAMES__ = window.__TIPTAP_GAMES__ || [];
  window.__TIPTAP_GAMES__.push({
    slug: 'keeper',
    title: 'Keeper',
    rule: 'Tap a side to dive. Stay put for the middle.',
    create: create
  });
})();
