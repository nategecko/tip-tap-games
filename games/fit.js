/* Fit — rotate the block so it passes through the hole. */

(function () {
  'use strict';

  var SHAPES = [
    [[1,0,0],[1,0,0],[1,1,0]],   // L
    [[0,1,1],[1,1,0],[0,1,0]],   // S-plus
    [[1,1,1],[0,1,0],[0,0,0]],   // T
    [[1,1,0],[0,1,0],[0,1,1]]    // Z
  ];

  function rot90(p) {
    var o = [[0,0,0],[0,0,0],[0,0,0]];
    for (var r = 0; r < 3; r++)
      for (var c = 0; c < 3; c++)
        o[c][2 - r] = p[r][c];
    return o;
  }
  function rotN(p, n) {
    var o = p;
    for (var i = 0; i < ((n % 4) + 4) % 4; i++) o = rot90(o);
    return o;
  }
  function same(a, b) {
    for (var r = 0; r < 3; r++)
      for (var c = 0; c < 3; c++)
        if (a[r][c] !== b[r][c]) return false;
    return true;
  }

  function create(ctx) {
    var T = ctx.THREE;

    var COL_BG    = 0x11111a;
    var COL_BLOCK = 0xf2c14e;
    var COL_WALL  = 0x2e2b45;
    var COL_EDGE  = 0x4a4470;

    var scene = new T.Scene();
    scene.background = new T.Color(COL_BG);
    scene.fog = new T.Fog(COL_BG, 18, 44);

    var camera = new T.PerspectiveCamera(58, ctx.width / ctx.height, 0.1, 90);
    camera.position.set(0, 0, 7.5);

    scene.add(new T.AmbientLight(0xffffff, 0.55));
    var key = new T.DirectionalLight(0xffffff, 0.85);
    key.position.set(3, 5, 6);
    scene.add(key);

    var cubeGeo = new T.BoxGeometry(0.92, 0.92, 0.92);
    var wallGeo = new T.BoxGeometry(0.98, 0.98, 0.7);
    var matBlock = new T.MeshLambertMaterial({ color: COL_BLOCK, flatShading: true });
    var matWall  = new T.MeshLambertMaterial({ color: COL_WALL,  flatShading: true });
    var matEdge  = new T.MeshLambertMaterial({ color: COL_EDGE,  flatShading: true });

    /* ---- the player's block ---- */
    var shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    var block = new T.Group();
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        if (!shape[r][c]) continue;
        var m = new T.Mesh(cubeGeo, matBlock);
        m.position.set((c - 1), (1 - r), 0);
        block.add(m);
      }
    }
    scene.add(block);

    /* ---- walls ---- */
    var walls = [];
    var SPAWN_Z = -46;

    function buildWall(steps) {
      var hole = rotN(shape, steps);
      var g = new T.Group();
      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 7; c++) {
          var inCore = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          if (inCore && hole[r - 2][c - 2]) continue;
          var m = new T.Mesh(wallGeo, inCore ? matEdge : matWall);
          m.position.set((c - 3), (3 - r), 0);
          g.add(m);
        }
      }
      g.position.z = SPAWN_Z;
      g.userData = { steps: steps, judged: false };
      scene.add(g);
      walls.push(g);
      return g;
    }

    buildWall(Math.floor(Math.random() * 4));

    /* ---- state ---- */
    var score = 0;
    var speed = 10;
    var rotZ = 0;
    var targetRot = 0;
    var dragging = false;
    var lastX = 0;
    var moved = 0;
    var shakeT = 0;
    var dead = false;

    function pointer(type, x) {
      if (dead) return;
      if (type === 'down') { dragging = true; lastX = x; moved = 0; }
      else if (type === 'move' && dragging) {
        var dx = x - lastX;
        lastX = x;
        moved += Math.abs(dx);
        rotZ -= dx * 0.016;
        targetRot = Math.round(rotZ / (Math.PI / 2)) * (Math.PI / 2);
      } else if (type === 'up') {
        dragging = false;
        if (moved < 8) targetRot += Math.PI / 2;   // a tap is one quarter turn
        else targetRot = Math.round(rotZ / (Math.PI / 2)) * (Math.PI / 2);
      }
    }

    function update(dt) {
      if (dead) return;

      if (!dragging) rotZ += (targetRot - rotZ) * Math.min(1, dt * 14);
      block.rotation.z = rotZ;

      speed = Math.min(26, 10 + score * 0.4);

      for (var i = walls.length - 1; i >= 0; i--) {
        var w = walls[i];
        w.position.z += speed * dt;

        if (!w.userData.judged && w.position.z >= -0.35) {
          w.userData.judged = true;
          var steps = ((Math.round(rotZ / (Math.PI / 2)) % 4) + 4) % 4;
          var playerPattern = rotN(shape, steps);
          var holePattern = rotN(shape, w.userData.steps);
          if (same(playerPattern, holePattern)) {
            score++;
            ctx.setScore(score);
            shakeT = 0.12;
            if (navigator.vibrate) navigator.vibrate(12);
          } else {
            dead = true;
            ctx.gameOver();
            return;
          }
        }

        if (w.position.z > 9) {
          scene.remove(w);
          walls.splice(i, 1);
        }
      }

      var lastWall = walls[walls.length - 1];
      if (!lastWall || lastWall.position.z > -22) {
        buildWall(Math.floor(Math.random() * 4));
      }

      if (shakeT > 0) {
        shakeT -= dt;
        camera.position.x = (Math.random() - 0.5) * 0.18;
        camera.position.y = (Math.random() - 0.5) * 0.18;
      } else {
        camera.position.x = 0;
        camera.position.y = 0;
      }
    }

    function resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function dispose() {
      cubeGeo.dispose(); wallGeo.dispose();
      matBlock.dispose(); matWall.dispose(); matEdge.dispose();
      scene.traverse(function (o) { if (o.isMesh) o.geometry = null; });
      walls.length = 0;
    }

    return {
      scene: scene, camera: camera,
      update: update, pointer: pointer, resize: resize, dispose: dispose
    };
  }

  window.__TIPTAP_GAMES__ = window.__TIPTAP_GAMES__ || [];
  window.__TIPTAP_GAMES__.push({
    slug: 'fit',
    title: 'Fit',
    rule: 'Drag to rotate. Match the hole.',
    create: create
  });
})();
