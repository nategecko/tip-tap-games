/* Lock — tap when the shrinking ring meets the target ring.
   A real second game so the feed swipe is testable. Replace or keep. */

(function () {
  'use strict';

  function create(ctx) {
    var T = ctx.THREE;

    var COL_BG   = 0x0b1418;
    var COL_RING = 0x4ee1a0;
    var COL_TGT  = 0xf4f3ef;

    var scene = new T.Scene();
    scene.background = new T.Color(COL_BG);

    var camera = new T.PerspectiveCamera(58, ctx.width / ctx.height, 0.1, 60);
    camera.position.set(0, 0, 9);

    scene.add(new T.AmbientLight(0xffffff, 0.7));
    var key = new T.DirectionalLight(0xffffff, 0.7);
    key.position.set(2, 4, 6);
    scene.add(key);

    var TARGET_R = 2.0;
    var tgtGeo = new T.TorusGeometry(TARGET_R, 0.075, 8, 64);
    var tgtMat = new T.MeshBasicMaterial({ color: COL_TGT });
    var target = new T.Mesh(tgtGeo, tgtMat);
    scene.add(target);

    var ringGeo = new T.TorusGeometry(1, 0.11, 8, 48);
    var ringMat = new T.MeshLambertMaterial({ color: COL_RING, flatShading: true });
    var ring = new T.Mesh(ringGeo, ringMat);
    scene.add(ring);

    var coreGeo = new T.IcosahedronGeometry(0.55, 0);
    var coreMat = new T.MeshLambertMaterial({ color: COL_RING, flatShading: true });
    var core = new T.Mesh(coreGeo, coreMat);
    scene.add(core);

    var score = 0;
    var radius = 5.4;
    var speed = 2.6;
    var dead = false;
    var pulse = 0;

    function reset() {
      radius = 5.4;
      speed = Math.min(7.5, 2.6 + score * 0.22);
    }

    function pointer(type) {
      if (dead || type !== 'down') return;
      var err = Math.abs(radius - TARGET_R);
      if (err < 0.34) {
        score++;
        ctx.setScore(score);
        pulse = 0.18;
        if (navigator.vibrate) navigator.vibrate(err < 0.12 ? 20 : 10);
        reset();
      } else {
        dead = true;
        ctx.gameOver();
      }
    }

    function update(dt) {
      if (dead) return;

      radius -= speed * dt;
      if (radius < TARGET_R - 0.34) { dead = true; ctx.gameOver(); return; }

      ring.scale.setScalar(radius);
      ring.rotation.z += dt * 0.6;
      core.rotation.x += dt * 1.1;
      core.rotation.y += dt * 0.8;

      var near = 1 - Math.min(1, Math.abs(radius - TARGET_R) / 2.4);
      core.scale.setScalar(0.85 + near * 0.5 + pulse * 2);
      if (pulse > 0) pulse -= dt;
    }

    function resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function dispose() {
      tgtGeo.dispose(); ringGeo.dispose(); coreGeo.dispose();
      tgtMat.dispose(); ringMat.dispose(); coreMat.dispose();
    }

    return {
      scene: scene, camera: camera,
      update: update, pointer: pointer, resize: resize, dispose: dispose
    };
  }

  window.__TIPTAP_GAMES__ = window.__TIPTAP_GAMES__ || [];
  window.__TIPTAP_GAMES__.push({
    slug: 'lock',
    title: 'Lock',
    rule: 'Tap when the rings meet.',
    create: create
  });
})();
