/* Drift — a mountain pass at sunset, throttle pinned.
   Hold to break traction. The corner throws you toward the outside; the slip
   you build fights it. Too little and you understeer off the edge, too much
   and you rotate into the inside barrier, so it's a balance rather than a
   timing window. Coast through a corner without drifting and the combo
   resets — that costs you without killing you. Touching either edge does. */

(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function sign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }

  var SEGS = 78, SEG_LEN = 3.2;
  var BACK = 5;              // segments drawn behind the car, so the ribbon
                             // reaches past the chase camera instead of ending
                             // in a hard edge at the bottom of frame
  var ROAD_W = 6.6, HALF_W = ROAD_W / 2;
  var EDGE = HALF_W - 0.75;          // how far the car centre may stray

  /* The road as a function of distance. Layered sines give a road that always
     flows, and the dead zone turns the shallow parts into genuine straights so
     corners arrive as events rather than a constant wiggle. */
  function curveAt(d) {
    var raw = Math.sin(d * 0.0100) * 0.75 +
              Math.sin(d * 0.0270 + 2.1) * 0.42 +
              Math.sin(d * 0.0061 + 0.7) * 0.50;
    var dead = 0.28;
    if (Math.abs(raw) < dead) return 0;
    return (raw - sign(raw) * dead) * 1.25;
  }

  /* ---------------- control-layer css ---------------- */
  var CSS_ID = 'drift-ui-css';
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
.df-ui{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;
  font-variant-numeric:tabular-nums}

.df-vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(125% 78% at 50% 42%,rgba(0,0,0,0) 44%,rgba(28,14,6,.5) 100%)}

.df-hold{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0;
  background:radial-gradient(130% 90% at 50% 100%,rgba(255,170,60,.3) 0%,rgba(255,140,40,0) 62%);
  transition:opacity .12s ease}
.df-hold.on{opacity:1}

.df-speed{position:absolute;left:19px;top:calc(82px + var(--safe-t));
  font-size:12px;color:rgba(255,240,225,.85);letter-spacing:.04em;
  text-shadow:0 2px 8px rgba(0,0,0,.6)}
.df-speed b{font-size:16px;font-weight:700}

.df-combo{position:absolute;right:19px;top:calc(78px + var(--safe-t));
  font-size:19px;font-weight:800;color:#ffd166;opacity:0;
  text-shadow:0 2px 12px rgba(0,0,0,.6);transition:opacity .2s ease}
.df-combo.on{opacity:1}

/* how close the car is to losing the road */
.df-grip{position:absolute;left:0;right:0;bottom:calc(94px + var(--safe-b));
  height:4px;margin:0 60px;border-radius:3px;background:rgba(255,255,255,.16)}
.df-grip i{display:block;height:100%;width:50%;border-radius:3px;
  background:#7ee0a0;transform-origin:50% 50%;transition:background .18s ease}
.df-grip.warn i{background:#ffb84d}
.df-grip.bad  i{background:#ff5f4d}

.df-toast{position:absolute;left:0;right:0;top:31%;text-align:center;
  font-size:31px;font-weight:800;letter-spacing:-.02em;opacity:0;
  text-shadow:0 3px 20px rgba(0,0,0,.6)}

.df-hint{position:absolute;left:0;right:0;bottom:calc(112px + var(--safe-b));
  text-align:center;font-size:13px;color:rgba(255,240,225,.85);
  text-shadow:0 2px 10px rgba(0,0,0,.6);transition:opacity .3s ease}

.df-flash{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0}
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

  function roadTexture(T) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#3a3540';
    g.fillRect(0, 0, 128, 128);
    // grain
    for (var i = 0; i < 700; i++) {
      g.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,255,255,' : '0,0,0,') + rand(0.02, 0.07).toFixed(2) + ')';
      g.fillRect(rand(0, 128), rand(0, 128), rand(1, 3), rand(1, 3));
    }
    // edge lines
    g.fillStyle = '#f2e6d2';
    g.fillRect(4, 0, 6, 128);
    g.fillRect(118, 0, 6, 128);
    // centre dash — one per texture tile, so it flows with the road
    g.fillStyle = 'rgba(242,230,210,.75)';
    g.fillRect(62, 18, 5, 46);
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

    /* ===== scene: mountain pass, low sun ===== */
    var scene = new T.Scene();
    scene.fog = new T.Fog(0xe8a877, 60, 210);

    var camera = new T.PerspectiveCamera(64, vw / vh, 0.1, 600);

    var skyGeo = keep(new T.SphereGeometry(300, 24, 16));
    var skyMat = keep(new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new T.Color(0x2a3f7a) },
        mid: { value: new T.Color(0xf2a45c) },
        bot: { value: new T.Color(0xc9764a) }
      },
      vertexShader:
        'varying float vH;' +
        'void main(){ vH = normalize(position).y;' +
        'gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float vH;' +
        'void main(){ vec3 c = vH > 0.0 ? mix(mid, top, pow(vH, 0.42))' +
        ' : mix(mid, bot, pow(-vH, 0.6));' +
        'gl_FragColor = vec4(c, 1.0); }'
    }));
    scene.add(new T.Mesh(skyGeo, skyMat));

    scene.add(new T.HemisphereLight(0xffc79a, 0x53406a, 0.72));
    var sun = new T.DirectionalLight(0xffd9a8, 1.15);
    sun.position.set(-30, 14, -22);
    scene.add(sun);
    var rim = new T.DirectionalLight(0x7fa0ff, 0.32);
    rim.position.set(20, 8, 18);
    scene.add(rim);

    /* ===== the mountainside the road is cut into ===== */
    var slopeMat = keep(new T.MeshPhongMaterial({ color: 0x6b5a52, flatShading: true, shininess: 4 }));
    var slopeGeo = keep(new T.PlaneGeometry(400, 400, 1, 1));
    slopeGeo.rotateX(-Math.PI / 2);
    var slope = new T.Mesh(slopeGeo, slopeMat);
    slope.position.set(0, -1.6, -120);
    scene.add(slope);

    /* distant ridges */
    var ridgeGeo = keep(new T.ConeGeometry(1, 1, 4));
    var ridgeMat = keep(new T.MeshPhongMaterial({ color: 0x8a6a7a, flatShading: true, shininess: 2 }));
    for (var rg = 0; rg < 18; rg++) {
      var m = new T.Mesh(ridgeGeo, ridgeMat);
      var rr = rand(90, 240);
      var ra = rand(-1.5, 1.5);
      m.position.set(Math.sin(ra) * rr, rand(6, 26), -Math.abs(Math.cos(ra)) * rr - 60);
      m.scale.set(rand(30, 70), rand(24, 62), rand(30, 70));
      m.rotation.y = rand(0, TAU);
      scene.add(m);
    }

    /* ===== road ribbon: one geometry, rewritten every frame ===== */
    var roadTex = keep(roadTexture(T));
    var roadGeo = keep(new T.BufferGeometry());
    var roadPos = new Float32Array(SEGS * 6 * 3);      // 2 tris per segment
    var roadUv  = new Float32Array(SEGS * 6 * 2);
    roadGeo.setAttribute('position', new T.BufferAttribute(roadPos, 3));
    roadGeo.setAttribute('uv', new T.BufferAttribute(roadUv, 2));
    var roadMat = keep(new T.MeshBasicMaterial({ map: roadTex }));
    var road = new T.Mesh(roadGeo, roadMat);
    road.frustumCulled = false;
    scene.add(road);

    /* guardrail posts and roadside pines, both instanced and both driven by the
       same per-segment offsets as the road, so everything bends together */
    var postGeo = keep(new T.BoxGeometry(0.16, 0.78, 0.16));
    var postMat = keep(new T.MeshPhongMaterial({ color: 0xd8d2c6, flatShading: true, shininess: 16 }));
    var posts = new T.InstancedMesh(postGeo, postMat, SEGS * 2);
    posts.frustumCulled = false;
    scene.add(posts);

    var pineGeo = keep(new T.ConeGeometry(1.1, 4.2, 6));
    var pineMat = keep(new T.MeshPhongMaterial({ color: 0x2c3a2c, flatShading: true, shininess: 2 }));
    var pines = new T.InstancedMesh(pineGeo, pineMat, SEGS * 2);
    pines.frustumCulled = false;
    scene.add(pines);

    var im = new T.Matrix4(), iq = new T.Quaternion(),
        iv = new T.Vector3(), is = new T.Vector3();
    var segX = new Float32Array(SEGS);
    var segY = new Float32Array(SEGS);
    var pineSide = [];
    for (var ps = 0; ps < SEGS * 2; ps++) {
      pineSide.push({ off: rand(2.2, 9), h: rand(0.6, 1.5), show: Math.random() < 0.55 });
    }

    /* ===== car ===== */
    var bodyMat  = keep(new T.MeshPhongMaterial({ color: 0xff5a3c, flatShading: true, shininess: 70, specular: 0xffd6c0 }));
    var glassMat = keep(new T.MeshPhongMaterial({ color: 0x1d2438, flatShading: true, shininess: 90 }));
    var tyreMat  = keep(new T.MeshPhongMaterial({ color: 0x14151c, flatShading: true, shininess: 8 }));
    var trimMat  = keep(new T.MeshPhongMaterial({ color: 0x2a2c36, flatShading: true, shininess: 40 }));
    var lampMat  = keep(new T.MeshBasicMaterial({ color: 0xffe9b0 }));

    var car = new T.Group();
    var shell = new T.Group();
    car.add(shell);

    var lowerGeo = keep(new T.BoxGeometry(1.5, 0.36, 3.0));
    var upperGeo = keep(new T.BoxGeometry(1.24, 0.34, 1.5));
    var noseGeo  = keep(new T.BoxGeometry(1.42, 0.22, 0.55));
    var wingGeo  = keep(new T.BoxGeometry(1.44, 0.07, 0.3));
    var wingPGeo = keep(new T.BoxGeometry(0.1, 0.24, 0.1));
    var tyreGeo  = keep(new T.CylinderGeometry(0.34, 0.34, 0.26, 12));
    var lampGeo  = keep(new T.BoxGeometry(0.34, 0.12, 0.06));

    var lower = new T.Mesh(lowerGeo, bodyMat); lower.position.y = 0.42; shell.add(lower);
    var upper = new T.Mesh(upperGeo, glassMat); upper.position.set(0, 0.72, -0.15); shell.add(upper);
    var nose = new T.Mesh(noseGeo, bodyMat); nose.position.set(0, 0.34, 1.6); shell.add(nose);
    var wing = new T.Mesh(wingGeo, trimMat); wing.position.set(0, 0.86, -1.5); shell.add(wing);
    [-0.5, 0.5].forEach(function (wx) {
      var wp = new T.Mesh(wingPGeo, trimMat);
      wp.position.set(wx, 0.72, -1.5);
      shell.add(wp);
    });
    [-0.42, 0.42].forEach(function (lx) {
      var lp = new T.Mesh(lampGeo, lampMat);
      lp.position.set(lx, 0.4, 1.86);
      shell.add(lp);
    });

    var wheels = [];
    [[-0.78, 1.0], [0.78, 1.0], [-0.8, -1.05], [0.8, -1.05]].forEach(function (w) {
      var t2 = new T.Mesh(tyreGeo, tyreMat);
      t2.rotation.z = Math.PI / 2;
      t2.position.set(w[0], 0.34, w[1]);
      shell.add(t2);
      wheels.push(t2);
    });

    var shTex = keep(softDot(T, 'rgba(30,12,6,0.6)', 'rgba(30,12,6,0)'));
    var shGeo = keep(new T.PlaneGeometry(3.4, 4.4));
    var shMat = keep(new T.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.6, depthWrite: false }));
    var carShadow = new T.Mesh(shGeo, shMat);
    carShadow.rotation.x = -Math.PI / 2;
    carShadow.position.y = 0.02;
    car.add(carShadow);

    scene.add(car);

    /* ===== tyre smoke ===== */
    var SMOKE = 90;
    var smokeGeo = keep(new T.BufferGeometry());
    var smokePos = new Float32Array(SMOKE * 3);
    var smokes = [];
    for (var si = 0; si < SMOKE; si++) {
      smokes.push({ life: 0, vx: 0, vy: 0, vz: 0, max: 1 });
      smokePos[si * 3 + 1] = -90;
    }
    smokeGeo.setAttribute('position', new T.BufferAttribute(smokePos, 3));
    var smokeTex = keep(softDot(T, 'rgba(255,240,228,0.95)', 'rgba(220,200,190,0)'));
    var smokeMat = keep(new T.PointsMaterial({
      size: 0.85, map: smokeTex, transparent: true, opacity: 0.5,
      depthWrite: false, sizeAttenuation: true
    }));
    var smokePts = new T.Points(smokeGeo, smokeMat);
    smokePts.frustumCulled = false;
    scene.add(smokePts);
    var smokeNext = 0;

    function puff(x, y, z, n, spread) {
      for (var i = 0; i < n; i++) {
        var p = smokes[smokeNext];
        smokePos[smokeNext * 3] = x;
        smokePos[smokeNext * 3 + 1] = y;
        smokePos[smokeNext * 3 + 2] = z;
        p.life = rand(0.5, 1.1); p.max = p.life;
        p.vx = rand(-spread, spread);
        p.vy = rand(0.3, 1.1);
        p.vz = rand(-1.5, 2.5);
        smokeNext = (smokeNext + 1) % SMOKE;
      }
    }

    /* ===== ui ===== */
    var ui = document.createElement('div');
    ui.className = 'df-ui';
    ui.innerHTML =
      '<div class="df-vig"></div>' +
      '<div class="df-hold"></div>' +
      '<div class="df-flash"></div>' +
      '<div class="df-speed"><b>0</b> km/h</div>' +
      '<div class="df-combo">x1</div>' +
      '<div class="df-grip"><i></i></div>' +
      '<div class="df-toast"></div>' +
      '<div class="df-hint">hold to drift</div>';
    ctx.overlay.appendChild(ui);

    var elHold = ui.querySelector('.df-hold');
    var elFlash = ui.querySelector('.df-flash');
    var elSpeed = ui.querySelector('.df-speed b');
    var elCombo = ui.querySelector('.df-combo');
    var elGrip = ui.querySelector('.df-grip');
    var elGripFill = ui.querySelector('.df-grip i');
    var elToast = ui.querySelector('.df-toast');
    var elHint = ui.querySelector('.df-hint');

    var toastT = 0;
    function toast(text, color) {
      elToast.textContent = text;
      elToast.style.color = color || '#f4f3ef';
      toastT = 0.85;
    }
    var flashT = 0, flashRGB = '255,255,255';
    function flash(rgb, dur) { flashT = dur || 0.35; flashRGB = rgb; }

    /* ===== state ===== */
    var travelled = 0;
    var speed = 22;
    var lat = 0;              // -1 left edge .. +1 right edge
    var slip = 0;             // 0 gripping .. 1 fully sideways
    var holding = false;
    var points = 0, shown = -1;
    var combo = 1, mult = 1;
    var dead = false, crashT = 0;
    var lastDir = 1;
    var inCorner = false, cornerT = 0, driftT = 0;
    var camShake = 0;
    var lastKmh = -1;

    var camPos = new T.Vector3(0, 3.05, 9.2);

    function setCombo(c) {
      combo = c;
      mult = Math.min(combo, 8);
      elCombo.textContent = 'x' + mult;
      elCombo.classList.toggle('on', mult > 1);
    }

    function crash(why) {
      if (dead) return;
      dead = true;
      crashT = 0;
      toast(why, '#ff6b53');
      flash('255,90,60', 0.55);
      camShake = 0.8;
      puff(car.position.x, 0.4, 0, 22, 1.6);
      if (navigator.vibrate) navigator.vibrate([50, 60, 90]);
      ctx.gameOver();
    }

    function pointer(type) {
      if (dead || killed) return;
      if (type === 'down') {
        holding = true;
        elHold.classList.add('on');
        if (travelled > 60) elHint.style.opacity = '0';
      } else if (type === 'up') {
        holding = false;
        elHold.classList.remove('on');
      }
    }

    function update(dt) {
      if (killed) return;

      if (dead) {
        crashT += dt;
        shell.rotation.y += dt * 3.4;
        shell.rotation.z = Math.min(0.8, shell.rotation.z + dt * 1.6);
        if (camShake > 0) camShake -= dt * 1.3;
        return;
      }

      /* ---- speed ---- */
      speed = Math.min(46, 22 + travelled * 0.0055);
      travelled += speed * dt;
      var kmh = Math.round(speed * 3.6);
      if (kmh !== lastKmh) { lastKmh = kmh; elSpeed.textContent = String(kmh); }

      var curve = curveAt(travelled);
      if (curve !== 0) lastDir = sign(curve);

      /* ---- slip: the whole game ---- */
      slip = clamp(slip + (holding ? 2.3 : -2.7) * dt, 0, 1);

      /* The corner throws the car to the outside; slip fights it. Overdo the
         slip and the same force carries you past the apex into the inside. */
      var dir = curve !== 0 ? sign(curve) : lastDir;
      var push = -curve * speed * 0.0295;
      var counter = slip * dir * 1.32;
      lat = clamp(lat + (push + counter) * dt, -1.6, 1.6);

      if (Math.abs(lat) >= 1) {
        crash(lat * dir > 0 ? 'SPUN IN' : 'OFF THE EDGE');
        return;
      }

      /* ---- corner bookkeeping and combo ---- */
      var cornering = Math.abs(curve) > 0.16;
      if (cornering) {
        if (!inCorner) { inCorner = true; cornerT = 0; driftT = 0; }
        cornerT += dt;
        if (slip > 0.4) {
          driftT += dt;
          points += slip * speed * 0.16 * mult * dt;
        }
      } else if (inCorner) {
        inCorner = false;
        if (cornerT > 0.4) {
          if (driftT > cornerT * 0.4) {
            setCombo(combo + 1);
            if (mult > 1) toast('x' + mult, '#ffd166');
          } else if (combo > 1) {
            setCombo(1);
            toast('COMBO LOST', '#ffa07a');
          }
        }
      }

      var n = Math.floor(points);
      if (n !== shown) { shown = n; ctx.setScore(n); }

      /* ---- car pose ---- */
      car.position.x = lat * EDGE;
      // yaw into the slide, and lean on the suspension
      var yaw = -slip * dir * 0.62;
      shell.rotation.y = lerp(shell.rotation.y, yaw, 1 - Math.pow(0.002, dt));
      shell.rotation.z = lerp(shell.rotation.z, curve * 0.06 + slip * dir * 0.08, 1 - Math.pow(0.01, dt));
      shell.position.y = Math.sin(travelled * 0.9) * 0.012;
      for (var wi = 0; wi < wheels.length; wi++) wheels[wi].rotation.x -= speed * dt * 0.9;

      if (slip > 0.28) {
        var rear = 1.0;
        puff(car.position.x - 0.8 * Math.cos(yaw), 0.2, rear, 1, 0.25);
        puff(car.position.x + 0.8 * Math.cos(yaw), 0.2, rear, 1, 0.25);
      }

      /* ---- rebuild the road ribbon ---- */
      var off = travelled % SEG_LEN;
      var dx = 0, x = 0;
      for (var i = 0; i < SEGS; i++) {
        var d = travelled + (i - BACK) * SEG_LEN - off;
        segX[i] = x;                          // record first: the near end of a
        dx += curveAt(d) * 0.16;              // segment carries no bend yet
        x += dx;
      }
      // shift so the car's own segment is the origin — otherwise x = 0 is not
      // the middle of the road and the car sits off to one side
      var base = segX[BACK];
      for (var n2 = 0; n2 < SEGS; n2++) {
        segX[n2] -= base;
        segY[n2] = -Math.abs(segX[n2]) * 0.012;
      }

      var vi = 0, ui2 = 0;
      for (var s2 = 0; s2 < SEGS - 1; s2++) {
        var z0 = -((s2 - BACK) * SEG_LEN - off), z1 = -((s2 + 1 - BACK) * SEG_LEN - off);
        var x0 = segX[s2], x1 = segX[s2 + 1];
        var y0 = segY[s2], y1 = segY[s2 + 1];
        var v0 = (travelled + (s2 - BACK) * SEG_LEN - off) / SEG_LEN;
        var v1 = v0 + 1;

        // two triangles, near edge then far edge
        var pts = [
          [x0 - HALF_W, y0, z0, 0, v0], [x0 + HALF_W, y0, z0, 1, v0], [x1 + HALF_W, y1, z1, 1, v1],
          [x0 - HALF_W, y0, z0, 0, v0], [x1 + HALF_W, y1, z1, 1, v1], [x1 - HALF_W, y1, z1, 0, v1]
        ];
        for (var p2 = 0; p2 < 6; p2++) {
          roadPos[vi++] = pts[p2][0]; roadPos[vi++] = pts[p2][1]; roadPos[vi++] = pts[p2][2];
          roadUv[ui2++] = pts[p2][3]; roadUv[ui2++] = pts[p2][4];
        }
      }
      roadGeo.attributes.position.needsUpdate = true;
      roadGeo.attributes.uv.needsUpdate = true;

      /* posts and pines ride the same offsets */
      for (var g2 = 0; g2 < SEGS; g2++) {
        var gz = -((g2 - BACK) * SEG_LEN - off);
        var gx = segX[g2], gy = segY[g2];
        for (var sd = 0; sd < 2; sd++) {
          var s3 = sd === 0 ? -1 : 1;
          var idx = g2 * 2 + sd;
          iv.set(gx + s3 * (HALF_W + 0.3), gy + 0.39, gz);
          is.set(1, 1, 1);
          im.compose(iv, iq, is);
          posts.setMatrixAt(idx, im);

          var pinf = pineSide[idx];
          if (pinf.show) {
            iv.set(gx + s3 * (HALF_W + pinf.off), gy + pinf.h * 2.1 - 1.2, gz);
            is.set(pinf.h, pinf.h, pinf.h);
          } else {
            iv.set(0, -999, 0);
            is.set(0.001, 0.001, 0.001);
          }
          im.compose(iv, iq, is);
          pines.setMatrixAt(idx, im);
        }
      }
      posts.instanceMatrix.needsUpdate = true;
      pines.instanceMatrix.needsUpdate = true;

      /* ---- smoke ---- */
      var sp = smokeGeo.attributes.position;
      for (var q = 0; q < SMOKE; q++) {
        var pk = smokes[q];
        if (pk.life <= 0) continue;
        pk.life -= dt;
        sp.setX(q, sp.getX(q) + pk.vx * dt);
        sp.setY(q, sp.getY(q) + pk.vy * dt);
        sp.setZ(q, sp.getZ(q) + (pk.vz + speed * 0.75) * dt);
        if (pk.life <= 0 || sp.getZ(q) > 16) sp.setY(q, -90);
      }
      sp.needsUpdate = true;

      /* ---- camera: hangs back and swings wide of the slide ---- */
      camera.position.set(
        camPos.x + car.position.x * 0.55 + slip * dir * 1.5,
        camPos.y,
        camPos.z
      );
      if (camShake > 0) {
        camShake -= dt * 1.5;
        var k2 = Math.max(0, camShake) * 0.22;
        camera.position.x += rand(-k2, k2);
        camera.position.y += rand(-k2, k2);
      }
      // a little look-into-the-corner, but not so much that the car drifts off
      // centre frame while it is actually dead centre of the road
      camera.lookAt(segX[BACK + 6] * 0.22 + car.position.x * 0.35, 0.9, -14);

      /* ---- ui ---- */
      var grip = Math.abs(lat);
      elGripFill.style.transform = 'scaleX(' + (0.12 + grip * 0.88) + ')';
      elGrip.classList.toggle('warn', grip > 0.55 && grip <= 0.8);
      elGrip.classList.toggle('bad', grip > 0.8);

      if (toastT > 0) {
        toastT -= dt;
        var tt = clamp(toastT / 0.85, 0, 1);
        elToast.style.opacity = String(Math.min(1, tt * 2.6));
        elToast.style.transform = 'translateY(' + (1 - tt) * -12 + 'px) scale(' + (0.93 + tt * 0.1) + ')';
      } else if (elToast.style.opacity !== '0') {
        elToast.style.opacity = '0';
      }

      if (flashT > 0) {
        flashT -= dt;
        elFlash.style.background =
          'radial-gradient(120% 80% at 50% 50%,rgba(' + flashRGB + ',0) 36%,rgba(' + flashRGB + ',.8) 100%)';
        elFlash.style.opacity = String(clamp(flashT * 2.4, 0, 1) * 0.72);
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
      smokes.length = 0;
      pineSide.length = 0;
      wheels.length = 0;
      if (posts.dispose) posts.dispose();
      if (pines.dispose) pines.dispose();
    }

    ctx.setScore(0);
    setCombo(1);


    return {
      scene: scene, camera: camera,
      update: update, pointer: pointer, resize: resize, dispose: dispose
    };
  }

  window.__TIPTAP_GAMES__ = window.__TIPTAP_GAMES__ || [];
  window.__TIPTAP_GAMES__.push({
    slug: 'drift',
    title: 'Drift',
    rule: 'Hold to slide. Balance it through the corner.',
    create: create
  });
})();
