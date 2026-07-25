/* Hardwater — ice fishing.
   Thumbstick to walk the lake. Stand on a glowing hole to drop a line.
   When one bites, crank the reel in circles — but ease off while it runs
   or the line snaps. Every fish you land buys you more daylight. */

(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* value noise, for the snow drifts on the ice */
  function hash2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(
      lerp(hash2(xi, yi), hash2(xi + 1, yi), u),
      lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u),
      v
    );
  }
  function fbm(x, y) {
    return vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
  }

  /* ---------------- species ---------------- */
  var SPECIES = [
    { name: 'perch',   body: 0x9ec46a, belly: 0xf0e6c4, len: 0.30, depth: 5.5,  pull: 0.50, runP: 0.20, lb: [1, 3],   time: 5.5, odds: 46 },
    { name: 'walleye', body: 0xc7a969, belly: 0xf3ecd6, len: 0.46, depth: 8.5,  pull: 0.82, runP: 0.34, lb: [3, 7],   time: 7.5, odds: 30 },
    { name: 'pike',    body: 0x62a074, belly: 0xe8efd2, len: 0.68, depth: 12.5, pull: 1.22, runP: 0.48, lb: [8, 17],  time: 10,  odds: 18 },
    { name: 'laker',   body: 0xffd166, belly: 0xfff3d0, len: 0.88, depth: 16.5, pull: 1.55, runP: 0.58, lb: [22, 34], time: 13,  odds: 6  }
  ];

  function rollSpecies() {
    var total = 0, i;
    for (i = 0; i < SPECIES.length; i++) total += SPECIES[i].odds;
    var r = Math.random() * total;
    for (i = 0; i < SPECIES.length; i++) {
      r -= SPECIES[i].odds;
      if (r <= 0) return SPECIES[i];
    }
    return SPECIES[0];
  }

  /* ---------------- control-layer css (injected once) ---------------- */
  var CSS_ID = 'ice-ui-css';
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
.card.ice .hud-bottom{top:calc(88px + var(--safe-t));bottom:auto;right:18px}
.card.ice .rail{transition:opacity .28s ease}
.card.ice.fighting .rail{opacity:0;pointer-events:none}

.ice-ui{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;
  font-variant-numeric:tabular-nums}

.ice-vig{position:absolute;left:0;right:0;top:0;bottom:0;
  background:radial-gradient(120% 78% at 50% 42%,rgba(0,0,0,0) 42%,rgba(4,6,20,.58) 100%)}

.ice-flash{position:absolute;left:0;right:0;top:0;bottom:0;opacity:0;
  background:radial-gradient(120% 80% at 50% 55%,rgba(255,255,255,0) 35%,rgba(255,120,80,.9) 100%)}

.ice-clock{position:absolute;left:0;right:0;top:0;height:3px;background:rgba(255,255,255,.12)}
.ice-clock i{display:block;height:100%;width:100%;transform-origin:0 50%;
  background:linear-gradient(90deg,#6fe3ff,#9effd6);transition:background .3s ease}
.ice-clock.low i{background:linear-gradient(90deg,#ff6b5a,#ffb057)}

.ice-toast{position:absolute;left:0;right:0;top:36%;text-align:center;
  font-size:30px;font-weight:700;letter-spacing:-.02em;opacity:0;
  text-shadow:0 3px 20px rgba(0,0,0,.7)}
.ice-sub{position:absolute;left:0;right:0;bottom:calc(202px + var(--safe-b));
  padding:0 18px;text-align:center;font-size:13px;color:rgba(244,243,239,.72);
  text-shadow:0 2px 10px rgba(0,0,0,.6);transition:opacity .25s ease}

/* thumbstick */
.ice-stick{position:absolute;left:14px;bottom:calc(24px + var(--safe-b));
  width:132px;height:132px;pointer-events:auto;touch-action:none;
  transition:opacity .25s ease}
.ice-stick.off{opacity:.22;pointer-events:none}
.ice-stick-ring{position:absolute;left:16px;top:16px;width:100px;height:100px;
  border-radius:50%;border:1.5px solid rgba(255,255,255,.26);
  background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.10),rgba(255,255,255,.02));
  backdrop-filter:blur(2px)}
.ice-stick-knob{position:absolute;left:44px;top:44px;width:44px;height:44px;
  border-radius:50%;background:radial-gradient(circle at 40% 35%,#fff,#b9cbd8);
  box-shadow:0 4px 14px rgba(0,0,0,.5);will-change:transform}

/* reel */
.ice-reel{position:absolute;right:10px;bottom:calc(26px + var(--safe-b));
  width:62px;height:62px;pointer-events:auto;touch-action:none;
  transition:width .3s cubic-bezier(.2,1.4,.4,1),height .3s cubic-bezier(.2,1.4,.4,1),
             right .3s ease,bottom .3s ease,opacity .25s ease;
  opacity:.34}
.ice-reel.live{width:150px;height:150px;right:16px;bottom:calc(26px + var(--safe-b));opacity:1}
.ice-reel svg{position:absolute;left:0;top:0;width:100%;height:100%;
  transform:rotate(-90deg);overflow:visible}
.ice-reel circle{fill:none;stroke-linecap:round}
.ice-arc-bg{stroke:rgba(255,255,255,.14);stroke-width:5}
.ice-arc-line{stroke:#7de3ff;stroke-width:5;filter:drop-shadow(0 0 5px rgba(125,227,255,.8))}
.ice-arc-ten{stroke:#5be08a;stroke-width:7}
.ice-reel-hub{position:absolute;left:50%;top:50%;width:46%;height:46%;
  transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(circle at 38% 32%,#4a5570,#1b2030);
  box-shadow:0 4px 16px rgba(0,0,0,.55),inset 0 1px 2px rgba(255,255,255,.22)}
.ice-crank{position:absolute;left:0;top:0;width:100%;height:100%;will-change:transform}
.ice-crank span{position:absolute;left:50%;top:-7%;width:22%;height:22%;
  margin-left:-11%;border-radius:50%;
  background:radial-gradient(circle at 40% 35%,#ffe9b0,#e8a13c);
  box-shadow:0 2px 8px rgba(0,0,0,.5)}
.ice-reel-lbl{position:absolute;left:0;right:0;bottom:-16px;text-align:center;
  font-size:10px;color:rgba(244,243,239,.9);opacity:0;transition:opacity .25s ease}
.ice-reel.live .ice-reel-lbl{opacity:1}

.ice-spin{position:absolute;left:0;top:0;width:100%;height:100%;
  animation:iceSpin 1.6s linear infinite;opacity:0}
.ice-reel.live.idlehint .ice-spin{opacity:.85}
.ice-spin span{position:absolute;left:50%;top:2%;width:11%;height:11%;margin-left:-5.5%;
  border-radius:50%;background:#fff;box-shadow:0 0 10px rgba(255,255,255,.9)}
@keyframes iceSpin{to{transform:rotate(360deg)}}

@media (prefers-reduced-motion:reduce){.ice-spin{animation:none}}
`;
    document.head.appendChild(s);
  }

  /* ---------------- procedural textures ---------------- */
  function softDot(T, inner, outer) {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, inner);
    rg.addColorStop(1, outer);
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  /* ---------------- the game ---------------- */
  function create(ctx) {
    var T = ctx.THREE;
    injectCSS();

    var killed = false;
    var trash = [];
    function keep(o) { trash.push(o); return o; }

    /* ===== scene, sky, light ===== */
    var HORIZON = 0xe8825f;

    var scene = new T.Scene();
    scene.fog = new T.Fog(0x8d7f9e, 42, 165);

    var camera = new T.PerspectiveCamera(50, ctx.width / ctx.height, 0.1, 700);

    var skyGeo = keep(new T.SphereGeometry(320, 24, 16));
    var skyMat = keep(new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new T.Color(0x121a44) },
        mid: { value: new T.Color(HORIZON) },
        bot: { value: new T.Color(0x2b3157) }
      },
      vertexShader:
        'varying float vH;' +
        'void main(){ vH = normalize(position).y;' +
        'gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float vH;' +
        'void main(){ vec3 c = vH > 0.0 ? mix(mid, top, pow(vH, 0.42))' +
        ': mix(mid, bot, pow(-vH, 0.55));' +
        'gl_FragColor = vec4(c, 1.0); }'
    }));
    scene.add(new T.Mesh(skyGeo, skyMat));

    // cool ambient + one warm low key light: the combination that reads as snow at dusk
    scene.add(new T.HemisphereLight(0x9dbcf0, 0x2c3a57, 0.5));
    var sun = new T.DirectionalLight(0xffc79a, 1.0);
    sun.position.set(-26, 7, -20);
    scene.add(sun);
    var rim = new T.DirectionalLight(0x6fb6ff, 0.28);
    rim.position.set(18, 5, 22);
    scene.add(rim);

    /* stars, low in the eastern sky */
    var starGeo = keep(new T.BufferGeometry());
    var starPos = new Float32Array(220 * 3);
    for (var si = 0; si < 220; si++) {
      var sa = rand(0, TAU), sy = rand(0.18, 0.85), sr = 250;
      var sh = Math.sqrt(1 - sy * sy);
      starPos[si * 3] = Math.cos(sa) * sh * sr;
      starPos[si * 3 + 1] = sy * sr;
      starPos[si * 3 + 2] = Math.sin(sa) * sh * sr;
    }
    starGeo.setAttribute('position', new T.BufferAttribute(starPos, 3));
    var starTex = keep(softDot(T, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
    var starMat = keep(new T.PointsMaterial({
      size: 2.6, map: starTex, transparent: true, opacity: 0.75,
      depthWrite: false, sizeAttenuation: false, fog: false
    }));
    scene.add(new T.Points(starGeo, starMat));

    /* ===== the ice ===== */
    var LAKE = 220, SEG = 96;
    var iceGeo = keep(new T.PlaneGeometry(LAKE, LAKE, SEG, SEG));
    iceGeo.rotateX(-Math.PI / 2);
    var ipos = iceGeo.attributes.position;
    var icol = new Float32Array(ipos.count * 3);
    var cLow = new T.Color(0x4d6788), cMid = new T.Color(0x87a5c4), cHi = new T.Color(0xc6dbec);
    var tmpC = new T.Color();
    for (var vi = 0; vi < ipos.count; vi++) {
      var vx = ipos.getX(vi), vz = ipos.getZ(vi);
      var drift = fbm(vx * 0.055 + 40, vz * 0.055 + 40);
      var fine = fbm(vx * 0.42, vz * 0.42);
      ipos.setY(vi, (drift - 0.5) * 0.5 + (fine - 0.5) * 0.07);
      var t = clamp(drift * 1.35 - 0.18, 0, 1);
      if (t < 0.5) tmpC.copy(cLow).lerp(cMid, t * 2);
      else tmpC.copy(cMid).lerp(cHi, (t - 0.5) * 2);
      tmpC.offsetHSL(0, 0, (fine - 0.5) * 0.05);
      icol[vi * 3] = tmpC.r; icol[vi * 3 + 1] = tmpC.g; icol[vi * 3 + 2] = tmpC.b;
    }
    iceGeo.setAttribute('color', new T.BufferAttribute(icol, 3));
    iceGeo.computeVertexNormals();
    var iceMat = keep(new T.MeshPhongMaterial({
      vertexColors: true, shininess: 62, specular: 0x8fa9c4
    }));
    scene.add(new T.Mesh(iceGeo, iceMat));

    /* ===== treeline ===== */
    var treeGeo = keep(new T.ConeGeometry(1, 4, 6));
    var treeMat = keep(new T.MeshPhongMaterial({ color: 0x141a30, shininess: 0, flatShading: true }));
    var trees = new T.InstancedMesh(treeGeo, treeMat, 260);
    var m4 = new T.Matrix4(), q4 = new T.Quaternion(), v3 = new T.Vector3(), s3 = new T.Vector3();
    for (var ti = 0; ti < 260; ti++) {
      var ta = rand(0, TAU), tr = rand(62, 108);
      var hs = rand(0.7, 2.1);
      v3.set(Math.cos(ta) * tr, hs * 2 - 0.6, Math.sin(ta) * tr);
      s3.set(rand(0.7, 1.3), hs, rand(0.7, 1.3));
      m4.compose(v3, q4, s3);
      trees.setMatrixAt(ti, m4);
    }
    trees.instanceMatrix.needsUpdate = true;
    scene.add(trees);

    /* ===== shanties, for scale and warmth ===== */
    var hutBody = keep(new T.BoxGeometry(1.5, 1.35, 1.8));
    var hutRoof = keep(new T.ConeGeometry(1.5, 0.6, 4));
    var hutMat = keep(new T.MeshPhongMaterial({ color: 0x2a2438, flatShading: true, shininess: 4 }));
    var roofMat = keep(new T.MeshPhongMaterial({ color: 0x1c1930, flatShading: true, shininess: 4 }));
    var winGeo = keep(new T.PlaneGeometry(0.42, 0.34));
    var winMat = keep(new T.MeshBasicMaterial({ color: 0xffb765, fog: true }));
    for (var hi = 0; hi < 5; hi++) {
      var ha = rand(0, TAU), hr = rand(19, 34);
      var hut = new T.Group();
      hut.position.set(Math.cos(ha) * hr, 0, Math.sin(ha) * hr);
      hut.rotation.y = rand(0, TAU);
      var b = new T.Mesh(hutBody, hutMat); b.position.y = 0.68; hut.add(b);
      var rf = new T.Mesh(hutRoof, roofMat); rf.position.y = 1.62; rf.rotation.y = Math.PI / 4; hut.add(rf);
      var wn = new T.Mesh(winGeo, winMat); wn.position.set(0, 0.82, 0.91); hut.add(wn);
      scene.add(hut);
    }

    /* ===== drifting snow ===== */
    var SNOW = 460;
    var snowGeo = keep(new T.BufferGeometry());
    var snowPos = new Float32Array(SNOW * 3);
    var snowVel = new Float32Array(SNOW);
    for (var ni = 0; ni < SNOW; ni++) {
      snowPos[ni * 3] = rand(-22, 22);
      snowPos[ni * 3 + 1] = rand(0, 16);
      snowPos[ni * 3 + 2] = rand(-22, 22);
      snowVel[ni] = rand(0.35, 1.15);
    }
    snowGeo.setAttribute('position', new T.BufferAttribute(snowPos, 3));
    var snowTex = keep(softDot(T, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
    var snowMat = keep(new T.PointsMaterial({
      size: 0.11, map: snowTex, transparent: true, opacity: 0.8,
      depthWrite: false, sizeAttenuation: true
    }));
    var snow = new T.Points(snowGeo, snowMat);
    scene.add(snow);

    /* ===== holes ===== */
    var glowTex = keep(softDot(T, 'rgba(150,244,255,0.95)', 'rgba(90,190,230,0)'));
    var shadowTex = keep(softDot(T, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'));

    var waterGeo = keep(new T.CircleGeometry(0.5, 26));
    var rimGeo = keep(new T.TorusGeometry(0.52, 0.085, 6, 20));
    var haloGeo = keep(new T.PlaneGeometry(2.9, 2.9));
    var auraGeo = keep(new T.PlaneGeometry(2.2, 2.2));
    var fishSilGeo = keep(new T.CircleGeometry(0.16, 12));

    var rimMat = keep(new T.MeshPhongMaterial({ color: 0xeaf4fb, flatShading: true, shininess: 70 }));

    var holes = [];
    function addHole(x, z, heat) {
      var g = new T.Group();
      g.position.set(x, 0, z);

      var wMat = keep(new T.MeshBasicMaterial({ color: 0x0a1c2e }));
      var water = new T.Mesh(waterGeo, wMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.012;
      g.add(water);

      var rimM = new T.Mesh(rimGeo, rimMat);
      rimM.rotation.x = -Math.PI / 2;
      rimM.position.y = 0.03;
      g.add(rimM);

      var hMat = keep(new T.MeshBasicMaterial({
        map: glowTex, transparent: true, opacity: 0.3, depthWrite: false,
        blending: T.AdditiveBlending, fog: false
      }));
      var halo = new T.Mesh(haloGeo, hMat);
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.02;
      g.add(halo);

      // camera-facing soft aura — reads as glow without any hard silhouette
      var aMat = keep(new T.MeshBasicMaterial({
        map: glowTex, transparent: true, opacity: 0.1, depthWrite: false,
        blending: T.AdditiveBlending, fog: false
      }));
      var aura = new T.Mesh(auraGeo, aMat);
      aura.position.y = 0.5;
      g.add(aura);

      var sMat = keep(new T.MeshBasicMaterial({
        color: 0x061524, transparent: true, opacity: 0, depthWrite: false
      }));
      var sil = new T.Mesh(fishSilGeo, sMat);
      sil.rotation.x = -Math.PI / 2;
      sil.position.y = 0.016;
      sil.scale.set(1.9, 1, 1);
      g.add(sil);

      scene.add(g);
      holes.push({
        g: g, x: x, z: z, heat: heat,
        haloMat: hMat, aura: aura, auraMat: aMat,
        sil: sil, silMat: sMat, phase: rand(0, TAU)
      });
    }

    (function scatterHoles() {
      var tries = 0;
      while (holes.length < 11 && tries < 400) {
        tries++;
        var a = rand(0, TAU), r = rand(2.6, 15);
        var x = Math.cos(a) * r, z = Math.sin(a) * r, ok = true;
        for (var i = 0; i < holes.length; i++) {
          var dx = holes[i].x - x, dz = holes[i].z - z;
          if (dx * dx + dz * dz < 10.5) { ok = false; break; }
        }
        if (ok) addHole(x, z, rand(0.1, 0.5));
      }
      addHole(1.7, -2.2, 1);          // the opener, right next to spawn
    })();

    /* the shoal — roams under the ice and re-warms holes it passes */
    var shoal = { x: rand(-8, 8), z: rand(-8, 8), a: rand(0, TAU) };

    /* ===== player ===== */
    var parka = keep(new T.MeshPhongMaterial({ color: 0xff7a3d, flatShading: true, shininess: 12 }));
    var pants = keep(new T.MeshPhongMaterial({ color: 0x2c3350, flatShading: true, shininess: 8 }));
    var skin  = keep(new T.MeshPhongMaterial({ color: 0xe8b48c, flatShading: true, shininess: 10 }));
    var fur   = keep(new T.MeshPhongMaterial({ color: 0xf4ead6, flatShading: true, shininess: 6 }));
    var dark  = keep(new T.MeshPhongMaterial({ color: 0x1a1c2c, flatShading: true, shininess: 20 }));

    var torsoGeo = keep(new T.CylinderGeometry(0.2, 0.235, 0.52, 9));
    var headGeo  = keep(new T.SphereGeometry(0.148, 12, 10));
    var hoodGeo  = keep(new T.SphereGeometry(0.195, 12, 10));
    var limbGeo  = keep(new T.CylinderGeometry(0.062, 0.055, 0.38, 7));
    var bootGeo  = keep(new T.BoxGeometry(0.13, 0.09, 0.2));
    var mittGeo  = keep(new T.SphereGeometry(0.062, 7, 6));

    var player = new T.Group();
    var pBody = new T.Group();
    player.add(pBody);

    var torso = new T.Mesh(torsoGeo, parka); torso.position.y = 0.7; pBody.add(torso);
    // fur hood shell sits behind the face sphere — reads as a parka from every angle
    var hood = new T.Mesh(hoodGeo, fur); hood.position.set(0, 1.07, -0.045); pBody.add(hood);
    var head = new T.Mesh(headGeo, skin); head.position.set(0, 1.06, 0.045); pBody.add(head);

    function limb(mat, x, y) {
      var g = new T.Group();
      g.position.set(x, y, 0);
      var m = new T.Mesh(limbGeo, mat);
      m.position.y = -0.19;
      g.add(m);
      return g;
    }
    var legL = limb(pants, -0.085, 0.44), legR = limb(pants, 0.085, 0.44);
    var armL = limb(parka, -0.235, 0.9), armR = limb(parka, 0.235, 0.9);
    pBody.add(legL); pBody.add(legR); pBody.add(armL); pBody.add(armR);

    var bootL = new T.Mesh(bootGeo, dark); bootL.position.set(0, -0.36, 0.03); legL.add(bootL);
    var bootR = new T.Mesh(bootGeo, dark); bootR.position.set(0, -0.36, 0.03); legR.add(bootR);
    var mittL = new T.Mesh(mittGeo, dark); mittL.position.y = -0.38; armL.add(mittL);
    var mittR = new T.Mesh(mittGeo, dark); mittR.position.y = -0.38; armR.add(mittR);

    var shMat = keep(new T.MeshBasicMaterial({
      map: shadowTex, transparent: true, opacity: 0.5, depthWrite: false
    }));
    var shGeo = keep(new T.PlaneGeometry(1.1, 1.1));
    var pShadow = new T.Mesh(shGeo, shMat);
    pShadow.rotation.x = -Math.PI / 2;
    pShadow.position.y = 0.014;
    player.add(pShadow);

    /* rod, three segments so it can bend into a curve */
    var rodGeo = keep(new T.CylinderGeometry(0.012, 0.017, 0.3, 5));
    var rodMat = keep(new T.MeshPhongMaterial({ color: 0x2b2f42, shininess: 40 }));
    var rod = new T.Group();
    rod.position.set(0.24, 0.86, 0.12);
    var rodSegs = [];
    var parentSeg = rod;
    for (var ri = 0; ri < 3; ri++) {
      var seg = new T.Group();
      seg.position.y = ri === 0 ? 0 : 0.3;
      var mesh = new T.Mesh(rodGeo, rodMat);
      mesh.position.y = 0.15;
      seg.add(mesh);
      parentSeg.add(seg);
      rodSegs.push(seg);
      parentSeg = seg;
    }
    var rodTip = new T.Object3D();
    rodTip.position.y = 0.3;
    parentSeg.add(rodTip);
    pBody.add(rod);

    /* strike bead on the rod tip */
    var beadGeo = keep(new T.SphereGeometry(0.032, 8, 6));
    var beadMat = keep(new T.MeshBasicMaterial({ color: 0xff5a3c, fog: false }));
    var bead = new T.Mesh(beadGeo, beadMat);
    rodTip.add(bead);

    player.position.set(0, 0, 1.4);
    scene.add(player);

    /* fishing line */
    var LINE_PTS = 12;
    var lineGeo = keep(new T.BufferGeometry());
    var linePos = new Float32Array(LINE_PTS * 3);
    lineGeo.setAttribute('position', new T.BufferAttribute(linePos, 3));
    var lineMat = keep(new T.LineBasicMaterial({
      color: 0xdfefff, transparent: true, opacity: 0.85
    }));
    var line = new T.Line(lineGeo, lineMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);

    /* ===== the caught fish ===== */
    function buildFish(sp) {
      var g = new T.Group();
      var prof = [];
      for (var i = 0; i <= 10; i++) {
        var t = i / 10;
        var rr = Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.5 + 0.02;
        prof.push(new T.Vector2(Math.max(0.012, rr * 0.42), t - 0.5));
      }
      var bodyGeo = new T.LatheGeometry(prof, 12);
      bodyGeo.rotateZ(Math.PI / 2);
      var bodyMat = new T.MeshPhongMaterial({
        color: sp.body, shininess: 90, specular: 0xffffff, flatShading: true
      });
      var body = new T.Mesh(bodyGeo, bodyMat);
      body.scale.set(1, 1, 0.62);
      g.add(body);

      var tailGeo = new T.ConeGeometry(0.2, 0.3, 3);
      var tail = new T.Mesh(tailGeo, bodyMat);
      tail.rotation.z = Math.PI / 2;
      tail.position.x = -0.6;
      tail.scale.set(1, 1, 0.22);
      g.add(tail);

      var finGeo = new T.ConeGeometry(0.13, 0.22, 3);
      var fin = new T.Mesh(finGeo, bodyMat);
      fin.position.set(0.02, 0.2, 0);
      fin.scale.set(1, 1, 0.18);
      g.add(fin);

      var bellyGeo = new T.SphereGeometry(0.19, 10, 7);
      var bellyMat = new T.MeshPhongMaterial({ color: sp.belly, shininess: 70, flatShading: true });
      var belly = new T.Mesh(bellyGeo, bellyMat);
      belly.position.set(0.02, -0.11, 0);
      belly.scale.set(1.9, 0.55, 0.5);
      g.add(belly);

      var eyeGeo = new T.SphereGeometry(0.042, 7, 6);
      var eyeMat = new T.MeshPhongMaterial({ color: 0x10131c, shininess: 100 });
      var e1 = new T.Mesh(eyeGeo, eyeMat); e1.position.set(0.34, 0.07, 0.11); g.add(e1);
      var e2 = new T.Mesh(eyeGeo, eyeMat); e2.position.set(0.34, 0.07, -0.11); g.add(e2);

      g.userData.dispose = function () {
        bodyGeo.dispose(); tailGeo.dispose(); finGeo.dispose();
        bellyGeo.dispose(); eyeGeo.dispose();
        bodyMat.dispose(); bellyMat.dispose(); eyeMat.dispose();
      };
      g.scale.setScalar(sp.len / 0.5 * 1.3);   // oversized on purpose — this is the payoff beat
      return g;
    }

    var trophy = null;

    /* splash + footstep puffs */
    var PUFF = 26;
    var puffGeo = keep(new T.BufferGeometry());
    var puffPos = new Float32Array(PUFF * 3);
    var puffs = [];
    for (var pi = 0; pi < PUFF; pi++) {
      puffs.push({ life: 0, vx: 0, vy: 0, vz: 0 });
      puffPos[pi * 3 + 1] = -50;
    }
    puffGeo.setAttribute('position', new T.BufferAttribute(puffPos, 3));
    var puffMat = keep(new T.PointsMaterial({
      size: 0.2, map: snowTex, transparent: true, opacity: 0.9,
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
        p.life = rand(0.4, 0.9);
        p.vx = rand(-spread, spread);
        p.vy = rand(up * 0.3, up);
        p.vz = rand(-spread, spread);
        puffNext = (puffNext + 1) % PUFF;
      }
    }

    /* ===== control layer ===== */
    var ui = document.createElement('div');
    ui.className = 'ice-ui';
    ui.innerHTML =
      '<div class="ice-vig"></div>' +
      '<div class="ice-flash"></div>' +
      '<div class="ice-clock"><i></i></div>' +
      '<div class="ice-toast"></div>' +
      '<div class="ice-sub"></div>' +
      '<div class="ice-stick"><div class="ice-stick-ring"></div><div class="ice-stick-knob"></div></div>' +
      '<div class="ice-reel">' +
        '<svg viewBox="0 0 100 100">' +
          '<circle class="ice-arc-bg" cx="50" cy="50" r="44"></circle>' +
          '<circle class="ice-arc-line" cx="50" cy="50" r="44"></circle>' +
          '<circle class="ice-arc-ten" cx="50" cy="50" r="33"></circle>' +
        '</svg>' +
        '<div class="ice-spin"><span></span></div>' +
        '<div class="ice-crank"><span></span></div>' +
        '<div class="ice-reel-hub"></div>' +
        '<div class="ice-reel-lbl">reel</div>' +
      '</div>';
    ctx.overlay.appendChild(ui);
    ctx.card.classList.add('ice');

    var elFlash = ui.querySelector('.ice-flash');
    var elClock = ui.querySelector('.ice-clock');
    var elClockFill = ui.querySelector('.ice-clock i');
    var elToast = ui.querySelector('.ice-toast');
    var elSub = ui.querySelector('.ice-sub');
    var elStick = ui.querySelector('.ice-stick');
    var elKnob = ui.querySelector('.ice-stick-knob');
    var elReel = ui.querySelector('.ice-reel');
    var elCrank = ui.querySelector('.ice-crank');
    var elArcLine = ui.querySelector('.ice-arc-line');
    var elArcTen = ui.querySelector('.ice-arc-ten');

    var C_LINE = TAU * 44, C_TEN = TAU * 33;
    elArcLine.style.strokeDasharray = C_LINE;
    elArcTen.style.strokeDasharray = C_TEN;

    /* thumbstick input */
    var stickId = null, stickVX = 0, stickVY = 0;
    var STICK_R = 44;

    function stickCenter() {
      var r = elStick.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function stickSet(e) {
      var c = stickCenter();
      var dx = e.clientX - c.x, dy = e.clientY - c.y;
      var d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx = dx / d * STICK_R; dy = dy / d * STICK_R; d = STICK_R; }
      stickVX = dx / STICK_R;
      stickVY = dy / STICK_R;
      if (d < 7) { stickVX = 0; stickVY = 0; }
      elKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function capture(el, id) {
      // throws if the pointer is already gone; never worth killing the handler over
      try { el.setPointerCapture(id); } catch (err) { /* no-op */ }
    }

    elStick.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      if (stickId !== null) return;
      stickId = e.pointerId;
      capture(elStick, e.pointerId);
      stickSet(e);
    });
    elStick.addEventListener('pointermove', function (e) {
      if (e.pointerId !== stickId) return;
      e.stopPropagation();
      stickSet(e);
    });
    function stickUp(e) {
      if (e.pointerId !== stickId) return;
      e.stopPropagation();
      stickId = null; stickVX = 0; stickVY = 0;
      elKnob.style.transform = 'translate(0,0)';
    }
    elStick.addEventListener('pointerup', stickUp);
    elStick.addEventListener('pointercancel', stickUp);

    /* reel input — accumulate clockwise rotation */
    var reelId = null, reelAng = 0, crankAng = 0, turnThisFrame = 0, reelRate = 0;

    function reelCenter() {
      var r = elReel.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    elReel.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      if (reelId !== null) return;
      reelId = e.pointerId;
      capture(elReel, e.pointerId);
      var c = reelCenter();
      reelAng = Math.atan2(e.clientY - c.y, e.clientX - c.x);
    });
    elReel.addEventListener('pointermove', function (e) {
      if (e.pointerId !== reelId) return;
      e.stopPropagation();
      var c = reelCenter();
      var a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      var d = a - reelAng;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      reelAng = a;
      crankAng += d;
      if (d > 0) turnThisFrame += d;          // clockwise only; reversing just idles
      elCrank.style.transform = 'rotate(' + crankAng + 'rad)';
    });
    function reelUp(e) {
      if (e.pointerId !== reelId) return;
      e.stopPropagation();
      reelId = null;
    }
    elReel.addEventListener('pointerup', reelUp);
    elReel.addEventListener('pointercancel', reelUp);

    /* ui helpers */
    var toastT = 0;
    function toast(text, color) {
      elToast.textContent = text;
      elToast.style.color = color || '#f4f3ef';
      toastT = 1.1;
    }
    var subText = '';
    function sub(text) {
      if (text === subText) return;
      subText = text;
      elSub.textContent = text;
      elSub.style.opacity = text ? '1' : '0';
    }
    var flashT = 0, flashHue = '255,120,80';
    function flash(rgb) { flashT = 0.5; flashHue = rgb; }

    /* ===== state ===== */
    var ST_WALK = 0, ST_WAIT = 1, ST_FIGHT = 2, ST_LAND = 3;
    var state = ST_WALK;

    var timeLeft = 34, timeMax = 34;
    var totalLb = 0;
    var dead = false;

    var facing = 0, walkPhase = 0, stepTimer = 0;
    var vel = new T.Vector3();
    var atHole = null, stillT = 0;
    var biteAt = 0, waitT = 0;
    var stanceX = 0, stanceZ = 0;

    var fish = null;          // { sp, depth, depth0, lb, running, timer, warn }
    var landT = 0, landPeak = 0;
    var tension = 0;
    var camShake = 0;

    var camPos = new T.Vector3(0, 4.6, 7.2);
    var camAim = new T.Vector3(0, 0.8, 0);
    camera.position.copy(camPos);

    function nearestHole() {
      var best = null, bd = 1e9;
      for (var i = 0; i < holes.length; i++) {
        var dx = holes[i].x - player.position.x;
        var dz = holes[i].z - player.position.z;
        var d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = holes[i]; }
      }
      return bd < 6.0 ? best : null;   // ~2.4 units — generous on purpose; you glide in on drop
    }

    function dropLine(hole) {
      state = ST_WAIT;
      waitT = 0;
      // settle onto a tidy stance beside the hole so the pose always reads right
      var ox = player.position.x - hole.x, oz = player.position.z - hole.z;
      var od = Math.hypot(ox, oz) || 1;
      stanceX = hole.x + ox / od * 0.85;
      stanceZ = hole.z + oz / od * 0.85;
      // hot holes bite almost instantly, cold ones make you wait
      biteAt = lerp(5.5, 0.7, clamp(hole.heat, 0, 1)) * rand(0.75, 1.25);
      line.visible = true;
      sub('waiting on a bite');
    }

    function hookUp() {
      var sp = rollSpecies();
      fish = {
        sp: sp,
        depth: sp.depth,
        depth0: sp.depth,
        lb: Math.round(rand(sp.lb[0], sp.lb[1])),
        running: false,
        timer: rand(0.5, 1.1),
        warn: 0
      };
      tension = 0;
      state = ST_FIGHT;
      ctx.card.classList.add('fighting');
      elReel.classList.add('live', 'idlehint');
      elStick.classList.add('off');
      toast('FISH ON', '#ffd166');
      flash('255,190,90');
      sub('crank the reel — ease off when it runs');
      camShake = 0.5;
      if (navigator.vibrate) navigator.vibrate([28, 40, 28]);
    }

    function endFight() {
      state = ST_WALK;
      fish = null;
      line.visible = false;
      ctx.card.classList.remove('fighting');
      elReel.classList.remove('live', 'idlehint');
      elStick.classList.remove('off');
      atHole = null;
      stillT = 0;
    }

    function loseFish(why) {
      toast(why, '#ff7a6b');
      flash('255,90,70');
      if (navigator.vibrate) navigator.vibrate(90);
      camShake = 0.35;
      endFight();
      sub('find another hole');
    }

    function landFish() {
      var sp = fish.sp, lb = fish.lb;
      totalLb += lb;
      ctx.setScore(totalLb);
      timeLeft = Math.min(timeMax, timeLeft + sp.time);

      trophy = buildFish(sp);
      trophy.position.set(atHole.x, 0.1, atHole.z);
      scene.add(trophy);
      landT = 0;
      landPeak = 1.0 + sp.len;
      sub('');
      state = ST_LAND;

      emitPuff(atHole.x, 0.1, atHole.z, 14, 1.2, 3.2);
      toast('+' + lb + ' lb ' + sp.name, sp.name === 'laker' ? '#ffd166' : '#9effd6');
      flash('150,255,220');
      camShake = 0.3;
      atHole.heat = Math.max(0, atHole.heat - 0.55);   // fish moved off
      line.visible = false;
      ctx.card.classList.remove('fighting');
      elReel.classList.remove('live', 'idlehint');
      if (navigator.vibrate) navigator.vibrate([20, 30, 60]);
    }

    function die() {
      if (dead) return;
      dead = true;
      elStick.classList.add('off');
      elReel.classList.remove('live');
      ui.style.pointerEvents = 'none';
      elStick.style.pointerEvents = 'none';
      elReel.style.pointerEvents = 'none';
      sub('');
      ctx.gameOver();
    }

    /* ===== update ===== */
    var tmpV = new T.Vector3();

    function update(dt) {
      if (killed || dead) return;

      timeLeft -= dt;
      if (timeLeft <= 0) { timeLeft = 0; die(); return; }

      /* -------- movement -------- */
      var canWalk = (state === ST_WALK || state === ST_WAIT);
      var mx = canWalk ? stickVX : 0;
      var mz = canWalk ? stickVY : 0;
      var mag = Math.hypot(mx, mz);

      // camera yaw is fixed, so stick up is always "away from camera"
      var wantX = mx * 3.1, wantZ = mz * 3.1;
      vel.x = lerp(vel.x, wantX, 1 - Math.pow(0.0012, dt));
      vel.z = lerp(vel.z, wantZ, 1 - Math.pow(0.0012, dt));

      player.position.x += vel.x * dt;
      player.position.z += vel.z * dt;

      if (state === ST_WAIT || state === ST_FIGHT || state === ST_LAND) {
        var glide = 1 - Math.pow(0.004, dt);
        player.position.x = lerp(player.position.x, stanceX, glide);
        player.position.z = lerp(player.position.z, stanceZ, glide);
      }

      var rr = Math.hypot(player.position.x, player.position.z);
      if (rr > 17) {
        player.position.x *= 17 / rr;
        player.position.z *= 17 / rr;
      }

      var speed = Math.hypot(vel.x, vel.z);
      if (speed > 0.12) {
        facing = Math.atan2(vel.x, vel.z);
        walkPhase += dt * speed * 3.1;
        stepTimer -= dt;
        if (stepTimer <= 0) {
          stepTimer = 0.62 / Math.max(0.6, speed);
          emitPuff(player.position.x, 0.05, player.position.z, 3, 0.28, 0.9);
        }
      } else {
        walkPhase = lerp(walkPhase % TAU, 0, Math.min(1, dt * 8));
      }

      var yawTarget = facing;
      if (state === ST_WAIT || state === ST_FIGHT || state === ST_LAND) {
        if (atHole) {
          yawTarget = Math.atan2(atHole.x - player.position.x, atHole.z - player.position.z);
        }
      }
      var dy = yawTarget - pBody.rotation.y;
      while (dy > Math.PI) dy -= TAU;
      while (dy < -Math.PI) dy += TAU;
      pBody.rotation.y += dy * Math.min(1, dt * 11);

      // walk cycle
      var swing = Math.sin(walkPhase) * Math.min(1, speed / 2.4);
      legL.rotation.x = swing * 0.95;
      legR.rotation.x = -swing * 0.95;
      armL.rotation.x = -swing * 0.7;
      armR.rotation.x = (state === ST_WALK ? swing * 0.7 : -0.95);
      pBody.position.y = Math.abs(Math.sin(walkPhase * 2)) * 0.035 * Math.min(1, speed / 2);
      pBody.rotation.z = -mx * 0.1;

      rod.visible = (state !== ST_WALK);
      line.visible = (state === ST_WAIT || state === ST_FIGHT);

      /* -------- hole logic -------- */
      var near = nearestHole();
      if (state === ST_WALK) {
        atHole = null;
        if (near) {
          if (mag < 0.12) {
            stillT += dt;
            sub('hold still to drop your line');
            if (stillT > 0.32) { atHole = near; dropLine(near); }
          } else {
            stillT = 0;
            sub('stop on the hole to fish');
          }
        } else {
          stillT = 0;
          sub(totalLb > 0 ? 'find a glowing hole' : 'walk to the glowing hole');
        }
      } else if (state === ST_WAIT) {
        waitT += dt;
        if (!near || near !== atHole) { state = ST_WALK; line.visible = false; sub(''); }
        else if (mag > 0.35) { state = ST_WALK; line.visible = false; }
        else if (waitT >= biteAt) hookUp();
      }

      /* -------- the fight -------- */
      if (state === ST_FIGHT && fish) {
        fish.timer -= dt;
        if (fish.timer <= 0) {
          if (fish.running) {
            fish.running = false;
            fish.timer = rand(0.9, 2.0);
          } else {
            fish.running = true;
            fish.timer = rand(0.7, 1.5);
            camShake = Math.max(camShake, 0.22);
            if (navigator.vibrate) navigator.vibrate(45);
          }
        }
        // telegraph the run just before it starts
        fish.warn = (!fish.running && fish.timer < 0.38) ? 1 : 0;

        var turn = turnThisFrame;
        reelRate = lerp(reelRate, turn / Math.max(dt, 0.001), 0.35);

        fish.depth -= turn * 0.14;
        fish.depth += (fish.running ? fish.sp.pull : fish.sp.pull * 0.14) * dt;

        tension += turn * (fish.running ? 0.075 : 0.012);
        tension -= 0.9 * dt;
        tension = clamp(tension, 0, 1.2);

        if (tension >= 1) { loseFish('LINE SNAPPED'); }
        else if (fish.depth > fish.depth0 * 1.5) { loseFish('IT GOT AWAY'); }
        else if (fish.depth <= 0) { landFish(); }

        if (turn > 0.02) elReel.classList.remove('idlehint');
      }
      turnThisFrame = 0;

      /* -------- landing animation -------- */
      if (state === ST_LAND && trophy) {
        landT += dt;
        var t = Math.min(1, landT / 1.25);
        var arc = Math.sin(t * Math.PI);
        var hx = atHole ? atHole.x : 0, hz = atHole ? atHole.z : 0;
        trophy.position.x = lerp(hx, player.position.x, t * 0.5);
        trophy.position.z = lerp(hz, player.position.z, t * 0.5);
        trophy.position.y = 0.1 + arc * landPeak;
        trophy.rotation.z = Math.cos(t * Math.PI) * 0.7;   // nose up on the rise, down on the fall
        trophy.rotation.y = t * 1.3;
        trophy.rotation.x = Math.sin(t * Math.PI * 2) * 0.35;
        if (t >= 1) {
          scene.remove(trophy);
          if (trophy.userData.dispose) trophy.userData.dispose();
          trophy = null;
          endFight();
          sub('');
        }
      }

      /* -------- rod bend + line -------- */
      var bend = 0;
      if (state === ST_FIGHT && fish) {
        bend = 0.18 + tension * 0.55 + (fish.running ? 0.3 : 0);
      } else if (state === ST_WAIT) {
        bend = 0.06 + Math.sin(waitT * 2.1) * 0.03;
      }
      // rod lies forward toward the hole; load curves the tip down, not back over the head
      rod.rotation.x = 1.12 + bend * 0.28;
      for (var rs = 0; rs < rodSegs.length; rs++) {
        rodSegs[rs].rotation.x = bend * (0.12 + rs * 0.12);
      }

      beadMat.color.setHex(
        state === ST_FIGHT
          ? (fish && (fish.running || fish.warn) ? 0xff3b2f : 0xffd166)
          : 0xff5a3c
      );
      bead.scale.setScalar(state === ST_WAIT
        ? 1 + Math.sin(waitT * 9) * 0.12
        : 1 + Math.sin(landT * 20) * 0.1);

      if (line.visible && atHole) {
        rodTip.getWorldPosition(tmpV);
        var ax = tmpV.x, ay = tmpV.y, az = tmpV.z;
        var bx = atHole.x, by = 0.02, bz = atHole.z;
        var taut = state === ST_FIGHT ? clamp(tension + 0.35, 0, 1) : 0.15;
        var jitter = state === ST_FIGHT && fish && fish.running ? 0.035 : 0;
        for (var li = 0; li < LINE_PTS; li++) {
          var lt = li / (LINE_PTS - 1);
          var sag = Math.sin(lt * Math.PI) * (1 - taut) * 0.22;
          linePos[li * 3] = lerp(ax, bx, lt) + (jitter ? rand(-jitter, jitter) : 0);
          linePos[li * 3 + 1] = lerp(ay, by, lt) - sag;
          linePos[li * 3 + 2] = lerp(az, bz, lt) + (jitter ? rand(-jitter, jitter) : 0);
        }
        lineGeo.attributes.position.needsUpdate = true;
        lineGeo.computeBoundingSphere();
        lineMat.color.setHex(tension > 0.72 ? 0xff6b53 : (fish && fish.warn ? 0xffc46b : 0xdfefff));
      }

      /* -------- shoal + holes -------- */
      shoal.a += rand(-1, 1) * dt * 1.2;
      shoal.x += Math.cos(shoal.a) * 1.6 * dt;
      shoal.z += Math.sin(shoal.a) * 1.6 * dt;
      var sr = Math.hypot(shoal.x, shoal.z);
      if (sr > 14) { shoal.x *= 14 / sr; shoal.z *= 14 / sr; shoal.a += Math.PI; }

      for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        var hdx = h.x - shoal.x, hdz = h.z - shoal.z;
        var hd = Math.hypot(hdx, hdz);
        if (hd < 4.2) h.heat = Math.min(1, h.heat + dt * 0.35 * (1 - hd / 4.2));
        else h.heat = Math.max(0.06, h.heat - dt * 0.045);

        h.phase += dt * (0.8 + h.heat * 2.2);
        var pulse = Math.sin(h.phase) * 0.06 * h.heat;
        // the hole you're standing on lifts, so "I'm in range" is never ambiguous
        h.haloMat.opacity = 0.09 + h.heat * 0.58 + pulse + (h === near ? 0.22 : 0);
        h.auraMat.opacity = 0.04 + h.heat * 0.3 + pulse;
        h.aura.quaternion.copy(camera.quaternion);
        h.aura.scale.setScalar(0.75 + h.heat * 0.5);

        // shadows circling under the ice
        var showSil = 0;
        if (state === ST_FIGHT && fish && h === atHole) {
          showSil = 0.85;
          var rise = 1 - clamp(fish.depth / fish.depth0, 0, 1);
          var gs = 0.5 + rise * 1.1;                    // capped so it stays inside the hole
          h.sil.scale.set(1.7 * gs, 1, gs);
          var wob = fish.running ? Math.sin(h.phase * 9) * 0.16 : Math.sin(h.phase * 2) * 0.07;
          h.sil.position.x = wob;
          h.sil.position.z = Math.cos(h.phase * 1.7) * 0.07;
        } else if (state === ST_WAIT && h === atHole) {
          var approach = clamp(waitT / Math.max(biteAt, 0.001), 0, 1);
          showSil = approach * 0.7;
          var orbit = (1 - approach) * 0.28;
          h.sil.position.x = Math.cos(h.phase * 2.2) * orbit;
          h.sil.position.z = Math.sin(h.phase * 2.2) * orbit;
          h.sil.scale.set(1.9, 1, 1);
        } else if (h.heat > 0.55) {
          showSil = (h.heat - 0.55) * 0.7;
          h.sil.position.x = Math.cos(h.phase * 1.6) * 0.34;
          h.sil.position.z = Math.sin(h.phase * 1.6) * 0.34;
          h.sil.scale.set(1.6, 1, 0.8);
        }
        h.silMat.opacity = lerp(h.silMat.opacity, showSil, Math.min(1, dt * 8));
      }

      /* -------- snow + puffs -------- */
      var sp2 = snowGeo.attributes.position;
      for (var ki = 0; ki < SNOW; ki++) {
        var y = sp2.getY(ki) - snowVel[ki] * dt;
        var x = sp2.getX(ki) + Math.sin(y * 0.6 + ki) * 0.35 * dt;
        if (y < 0) {
          y = 16;
          x = player.position.x + rand(-22, 22);
          sp2.setZ(ki, player.position.z + rand(-22, 22));
        }
        sp2.setY(ki, y);
        sp2.setX(ki, x);
      }
      sp2.needsUpdate = true;

      var pp = puffGeo.attributes.position;
      for (var qi = 0; qi < PUFF; qi++) {
        var q = puffs[qi];
        if (q.life <= 0) continue;
        q.life -= dt;
        q.vy -= 4.2 * dt;
        pp.setX(qi, pp.getX(qi) + q.vx * dt);
        pp.setY(qi, Math.max(0.02, pp.getY(qi) + q.vy * dt));
        pp.setZ(qi, pp.getZ(qi) + q.vz * dt);
        if (q.life <= 0) pp.setY(qi, -50);
      }
      pp.needsUpdate = true;

      /* -------- camera -------- */
      var closeUp = (state === ST_FIGHT || state === ST_LAND) ? 1 : 0;
      var want = tmpV.set(
        player.position.x + lerp(0, 0.7, closeUp),
        lerp(3.3, 2.5, closeUp),
        player.position.z + lerp(8.6, 6.2, closeUp)
      );
      camPos.lerp(want, 1 - Math.pow(0.0015, dt));
      camera.position.copy(camPos);
      if (camShake > 0) {
        camShake -= dt * 1.6;
        var k2 = Math.max(0, camShake) * 0.28;
        camera.position.x += rand(-k2, k2);
        camera.position.y += rand(-k2, k2);
      }
      var aimT = tmpV.set(
        player.position.x,
        lerp(1.75, 1.25, closeUp),
        player.position.z + lerp(0, -1.1, closeUp)
      );
      camAim.lerp(aimT, 1 - Math.pow(0.002, dt));
      camera.lookAt(camAim);

      snow.position.set(player.position.x, 0, player.position.z);
      pShadow.position.x = 0;
      pShadow.position.z = 0;

      /* -------- ui -------- */
      var frac = clamp(timeLeft / timeMax, 0, 1);
      elClockFill.style.transform = 'scaleX(' + frac + ')';
      if (timeLeft < 10) elClock.classList.add('low');
      else elClock.classList.remove('low');

      if (state === ST_FIGHT && fish) {
        var prog = 1 - clamp(fish.depth / fish.depth0, 0, 1);
        elArcLine.style.strokeDashoffset = C_LINE * (1 - prog);
        var tn = clamp(tension, 0, 1);
        elArcTen.style.strokeDashoffset = C_TEN * (1 - tn);
        elArcTen.style.stroke = tn > 0.72 ? '#ff5b45' : (tn > 0.42 ? '#ffc14d' : '#5be08a');
        elReel.style.transform = tn > 0.8 ? 'translate(' + rand(-2, 2) + 'px,' + rand(-2, 2) + 'px)' : '';
      } else {
        elArcLine.style.strokeDashoffset = C_LINE;
        elArcTen.style.strokeDashoffset = C_TEN;
        elReel.style.transform = '';
      }

      if (toastT > 0) {
        toastT -= dt;
        var tt = clamp(toastT / 1.1, 0, 1);
        elToast.style.opacity = String(Math.min(1, tt * 2.4));
        elToast.style.transform = 'translateY(' + (1 - tt) * -16 + 'px) scale(' + (0.94 + tt * 0.1) + ')';
      } else if (elToast.style.opacity !== '0') {
        elToast.style.opacity = '0';
      }

      if (flashT > 0) {
        flashT -= dt;
        elFlash.style.background =
          'radial-gradient(120% 80% at 50% 55%,rgba(' + flashHue + ',0) 30%,rgba(' + flashHue + ',.85) 100%)';
        elFlash.style.opacity = String(clamp(flashT / 0.5, 0, 1) * 0.8);
      } else if (elFlash.style.opacity !== '0') {
        elFlash.style.opacity = '0';
      }
    }

    /* ===== lifecycle ===== */
    function resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function dispose() {
      killed = true;
      if (trophy) {
        scene.remove(trophy);
        if (trophy.userData.dispose) trophy.userData.dispose();
        trophy = null;
      }
      for (var i = 0; i < trash.length; i++) {
        if (trash[i] && trash[i].dispose) trash[i].dispose();
      }
      trash.length = 0;
      holes.length = 0;
      scene.traverse(function (o) {
        if (o.isInstancedMesh && o.dispose) o.dispose();
      });
      // the ui node is removed by the harness when it wipes the overlay
    }

    ctx.setScore(0);
    sub('walk to the glowing hole');


    return {
      scene: scene, camera: camera,
      update: update, resize: resize, dispose: dispose
    };
  }

  window.__TIPTAP_GAMES__ = window.__TIPTAP_GAMES__ || [];
  window.__TIPTAP_GAMES__.push({
    slug: 'hardwater',
    title: 'Hardwater',
    rule: 'Walk the ice. Crank the reel. Ease off when it runs.',
    create: create
  });
})();
