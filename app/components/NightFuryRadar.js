"use client";

import { useEffect, useRef, useCallback } from "react";

export default function NightFuryRadar() {
  const mountRef = useRef(null);
  const cleanupRef = useRef(null);

  const initGame = useCallback(async (container) => {
    const THREE = await import("three");
    const { EffectComposer } = await import(
      "three/examples/jsm/postprocessing/EffectComposer.js"
    );
    const { RenderPass } = await import(
      "three/examples/jsm/postprocessing/RenderPass.js"
    );
    const { ShaderPass } = await import(
      "three/examples/jsm/postprocessing/ShaderPass.js"
    );
    const { UnrealBloomPass } = await import(
      "three/examples/jsm/postprocessing/UnrealBloomPass.js"
    );

    /* ═══════════════════════════════════════════════════════════════
       §0  CONSTANTS
    ═══════════════════════════════════════════════════════════════ */
    const W = Math.min(1400, window.innerWidth);
    const H = Math.min(800, window.innerHeight);
    const TUNNEL_LENGTH = 600;
    const TUNNEL_RADIUS = 18;
    const LIDAR_DENSITY = 42000;
    const PULSE_SPEED = 80;
    const PULSE_MAX_RADIUS = 65;
    const ALPHA_DURATION = 180;
    const ALPHA_MAX = 100;
    const TRAIL_POOL = 400;
    const PULSE_RING_POOL = 5;

    /* ═══════════════════════════════════════════════════════════════
       §1  PERLIN NOISE
    ═══════════════════════════════════════════════════════════════ */
    class Perlin {
      constructor(seed = 0) {
        this.g = [
          [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
          [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
          [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
        ];
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        let s = seed;
        for (let i = 255; i > 0; i--) {
          s = (s * 16807) % 2147483647;
          const j = s % (i + 1);
          [p[i], p[j]] = [p[j], p[i]];
        }
        this.p = new Uint8Array(512);
        for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
      }
      dot(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }
      n3(x, y, z) {
        const fl = Math.floor;
        const X = fl(x)&255, Y = fl(y)&255, Z = fl(z)&255;
        x -= fl(x); y -= fl(y); z -= fl(z);
        const f = (t) => t*t*t*(t*(t*6-15)+10);
        const u = f(x), v = f(y), w = f(z);
        const p = this.p, g = this.g;
        const A = p[X]+Y, AA = p[A]+Z, AB = p[A+1]+Z;
        const B = p[X+1]+Y, BA = p[B]+Z, BB = p[B+1]+Z;
        const lr = (a, b, t) => a + t*(b-a);
        return lr(
          lr(lr(this.dot(g[p[AA]%12],x,y,z), this.dot(g[p[BA]%12],x-1,y,z),u),
             lr(this.dot(g[p[AB]%12],x,y-1,z), this.dot(g[p[BB]%12],x-1,y-1,z),u),v),
          lr(lr(this.dot(g[p[AA+1]%12],x,y,z-1), this.dot(g[p[BA+1]%12],x-1,y,z-1),u),
             lr(this.dot(g[p[AB+1]%12],x,y-1,z-1), this.dot(g[p[BB+1]%12],x-1,y-1,z-1),u),v),w);
      }
      fbm(x, y, z, oct = 4) {
        let v = 0, a = 1, f = 1, m = 0;
        for (let i = 0; i < oct; i++) {
          v += this.n3(x*f, y*f, z*f) * a;
          m += a; a *= 0.5; f *= 2;
        }
        return v / m;
      }
    }
    const perlin = new Perlin(42);

    /* ═══════════════════════════════════════════════════════════════
       §2  RENDERER + SCENE + CAMERA
    ═══════════════════════════════════════════════════════════════ */
    const renderer = new THREE.WebGLRenderer({
      antialias: false, alpha: false, powerPreference: "high-performance",
    });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x05051a, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      borderRadius: "4px",
      border: "1px solid rgba(160,32,240,0.06)",
      boxShadow: "0 0 60px rgba(160,32,240,0.06)",
    });

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05051a, 0.007);
    scene.background = new THREE.Color(0x05051a);

    const camera = new THREE.PerspectiveCamera(68, W / H, 0.1, 500);
    camera.position.set(0, 0, 25);

    /* ═══════════════════════════════════════════════════════════════
       §3  POST-PROCESSING
       FIX: bloom was 1.4 str / 0.12 thresh → blew out everything.
       Now: 0.45 str / 0.65 thresh → subtle selective glow only.
    ═══════════════════════════════════════════════════════════════ */
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(W, H),
      0.45,   // strength  (was 1.4 — way too high)
      0.7,    // radius
      0.65    // threshold (was 0.12 — everything bloomed)
    );
    composer.addPass(bloom);

    // Chromatic Aberration
    const ChromaShader = {
      uniforms: { tDiffuse: { value: null }, uI: { value: 0.0015 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uI; varying vec2 vUv;
        void main(){
          vec2 c=vUv-0.5; float d=length(c); float a=uI*(1.+d*3.);
          vec2 dir=normalize(c+.001);
          float r=texture2D(tDiffuse,vUv+dir*a).r;
          float g=texture2D(tDiffuse,vUv).g;
          float b=texture2D(tDiffuse,vUv-dir*a).b;
          gl_FragColor=vec4(r,g,b,1.);
        }`,
    };
    const chromaPass = new ShaderPass(ChromaShader);
    composer.addPass(chromaPass);

    // Pulse distortion
    const PulseShader = {
      uniforms: {
        tDiffuse: { value: null },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uRadius: { value: 0 },
        uStr: { value: 0 },
      },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform float uRadius; uniform float uStr;
        varying vec2 vUv;
        void main(){
          vec2 d=vUv-uCenter; float dist=length(d);
          float ring=smoothstep(uRadius-.06,uRadius,dist)*smoothstep(uRadius+.06,uRadius,dist);
          vec2 off=normalize(d+.0001)*ring*uStr*.04;
          gl_FragColor=texture2D(tDiffuse,vUv+off);
        }`,
    };
    const pulseDistPass = new ShaderPass(PulseShader);
    composer.addPass(pulseDistPass);

    // Vignette + Scanlines
    const VigShader = {
      uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uV: { value: 0.5 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uT; uniform float uV; varying vec2 vUv;
        void main(){
          vec4 c=texture2D(tDiffuse,vUv);
          float d=length(vUv-.5);
          c.rgb*=1.-smoothstep(.3,.85,d)*uV;
          c.rgb-=sin(vUv.y*900.+uT*2.)*.02;
          gl_FragColor=c;
        }`,
    };
    const vigPass = new ShaderPass(VigShader);
    composer.addPass(vigPass);

    /* ═══════════════════════════════════════════════════════════════
       §4  GAME STATE
    ═══════════════════════════════════════════════════════════════ */
    const ST = { mode: "START", score: 0, hi: 0, crashT: 0, crashD: 120, time: 0, dt: 0.016 };
    const P = {
      x: 0, y: 0, vx: 0, vy: 0,
      baseSpeed: 0.45, gravity: -0.008, lift: 0.022, drag: 0.97,
      pool: 0, stretch: 1,
    };
    const plasma = { e: 100, max: 100, cost: 25, rBase: 0.06, rFast: 0.20 };
    const alpha = { meter: 0, max: ALPHA_MAX, on: false, timer: 0 };
    const pulses = [];
    const shake = { i: 0, decay: 0.89 };
    const keys = {};
    let scrollZ = 0, frame = 0, sonarE = 0;

    /* ═══════════════════════════════════════════════════════════════
       §5  CAVE TERRAIN
    ═══════════════════════════════════════════════════════════════ */
    function caveR(angle, z) {
      const n1 = perlin.fbm(angle * 0.5, z * 0.012, 0, 4);
      const n2 = perlin.fbm(angle * 1.3, z * 0.007, 5.7, 3);
      const narrow = 0.65 + 0.35 * Math.sin(z * 0.018);
      return TUNNEL_RADIUS * narrow * (0.7 + 0.3 * n1 + 0.15 * n2);
    }

    /* ═══════════════════════════════════════════════════════════════
       §6  LIDAR POINT CLOUD
       FIX: toned down activation colors, capped output brightness,
       reduced sparkle multiplier so it doesn't white-out.
    ═══════════════════════════════════════════════════════════════ */
    const lidarVS = `
      attribute float aAct;
      attribute float aSpark;
      attribute float aRnd;
      uniform float uTime;
      uniform float uScroll;
      uniform float uAlpha;
      varying float vAct;
      varying float vSpark;
      varying float vRnd;
      varying float vDepth;
      void main(){
        vAct=aAct; vSpark=aSpark; vRnd=aRnd;
        vec3 p=position;
        p.z=mod(p.z - uScroll, ${TUNNEL_LENGTH.toFixed(1)}) - ${(TUNNEL_LENGTH * 0.1).toFixed(1)};
        vec4 mv=modelViewMatrix*vec4(p,1.);
        vDepth=-mv.z;
        // Heat distortion on activated points
        if(aAct > 0.3){
          mv.x += sin(uTime*14.+aRnd*50.)*aAct*0.06;
          mv.y += sin(uTime*11.+aRnd*30.)*aAct*0.04;
        }
        gl_Position=projectionMatrix*mv;
        float base = 1.2 + aRnd*0.6;
        float actSize = aAct * 4.5;
        float spSize = aSpark * 5.0;
        gl_PointSize = clamp((base + actSize + spSize)*(130.0/vDepth), 0.5, 16.0);
      }`;

    const lidarFS = `
      uniform float uTime;
      uniform float uAlpha;
      varying float vAct;
      varying float vSpark;
      varying float vRnd;
      varying float vDepth;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if(d > 0.5) discard;
        float soft = 1.0 - smoothstep(0.15, 0.5, d);

        // Base: faint indigo embers in the void
        vec3 base = vec3(0.06, 0.04, 0.15) * 0.08;

        // Activated: bright neon purple-to-cyan gradient so walls POP
        vec3 activeCol = mix(
          vec3(0.6, 0.1, 1.0),    // vivid purple at low activation
          vec3(0.3, 0.9, 1.0),    // bright cyan at full activation
          vAct
        );

        // Sparkle: hot white-purple flash
        vec3 sparkCol = vec3(0.9, 0.7, 1.0) * vSpark * 2.0;

        // Alpha/cloak mode: neon blue tint
        vec3 alphaCol = vec3(0.1, 0.5, 1.0) * uAlpha;

        vec3 col = base + activeCol * vAct * 1.0 + sparkCol + alphaCol * vAct;

        // Cap maximum brightness to prevent bloom blowout
        col = min(col, vec3(0.95));

        // Depth fog
        float fog = exp(-vDepth * 0.007);
        col *= fog;

        float a = (0.04 + vAct * 0.9 + vSpark * 0.7) * soft;
        a = clamp(a, 0.0, 1.0);
        // Faint ambient visibility so tunnel shape is hinted
        a = max(a, 0.03 * soft * fog);

        gl_FragColor = vec4(col, a);
      }`;

    const pos = new Float32Array(LIDAR_DENSITY * 3);
    const act = new Float32Array(LIDAR_DENSITY);
    const spk = new Float32Array(LIDAR_DENSITY);
    const rnd = new Float32Array(LIDAR_DENSITY);

    for (let i = 0; i < LIDAR_DENSITY; i++) {
      const z = Math.random() * TUNNEL_LENGTH;
      const ang = Math.random() * Math.PI * 2;
      const R = caveR(ang, z);
      const rf = 0.82 + Math.random() * 0.35;
      pos[i*3]     = Math.cos(ang) * R * rf;
      pos[i*3 + 1] = Math.sin(ang) * R * rf;
      pos[i*3 + 2] = z;
      rnd[i] = Math.random();
    }

    const lidarGeo = new THREE.BufferGeometry();
    lidarGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    lidarGeo.setAttribute("aAct",   new THREE.BufferAttribute(act, 1));
    lidarGeo.setAttribute("aSpark", new THREE.BufferAttribute(spk, 1));
    lidarGeo.setAttribute("aRnd",   new THREE.BufferAttribute(rnd, 1));

    const lidarMat = new THREE.ShaderMaterial({
      vertexShader: lidarVS,
      fragmentShader: lidarFS,
      uniforms: {
        uTime: { value: 0 }, uScroll: { value: 0 }, uAlpha: { value: 0 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const lidarPts = new THREE.Points(lidarGeo, lidarMat);
    scene.add(lidarPts);

    /* ═══════════════════════════════════════════════════════════════
       §7  DRAGON SPRITE (pixel art from /dragon.png, flipped)
       Uses a textured billboard quad so the dragon is always visible.
       The sprite is flipped horizontally (-scaleX) so it faces right.
    ═══════════════════════════════════════════════════════════════ */
    const dragonTex = new THREE.TextureLoader().load("/dragon.png");
    dragonTex.magFilter = THREE.NearestFilter; // pixel-art crisp
    dragonTex.minFilter = THREE.NearestFilter;
    dragonTex.colorSpace = THREE.SRGBColorSpace;

    const SPRITE_W = 4.5;  // world units wide
    const SPRITE_H = SPRITE_W * (141 / 357); // keep aspect ratio

    const spriteGeo = new THREE.PlaneGeometry(SPRITE_W, SPRITE_H);
    const spriteMat = new THREE.MeshBasicMaterial({
      map: dragonTex,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const dragonMesh = new THREE.Mesh(spriteGeo, spriteMat);
    dragonMesh.renderOrder = 999;

    // Flip horizontally so the dragon faces right (flight direction)
    dragonMesh.scale.x = -1;

    const dragonGroup = new THREE.Group();
    dragonGroup.add(dragonMesh);
    dragonGroup.scale.setScalar(1);
    scene.add(dragonGroup);

    // Eye glow light attached to the dragon
    const eyeLight = new THREE.PointLight(0x39ff14, 0.6, 5);
    eyeLight.position.set(1.8, 0.3, 0.5);
    dragonGroup.add(eyeLight);

    // Subtle purple aura around the dragon
    const auraLight = new THREE.PointLight(0xa020f0, 0.3, 6);
    auraLight.position.set(0, 0, 1);
    dragonGroup.add(auraLight);

    /* ═══════════════════════════════════════════════════════════════
       §8  TRAIL PARTICLES (Object Pool)
    ═══════════════════════════════════════════════════════════════ */
    const tPos = new Float32Array(TRAIL_POOL * 3);
    const tAlp = new Float32Array(TRAIL_POOL);
    const tSiz = new Float32Array(TRAIL_POOL);
    let tHead = 0;

    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3));
    tGeo.setAttribute("aA", new THREE.BufferAttribute(tAlp, 1));
    tGeo.setAttribute("aS", new THREE.BufferAttribute(tSiz, 1));

    const tMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aA; attribute float aS; varying float vA;
        void main(){
          vA=aA; vec4 mv=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*mv;
          gl_PointSize=clamp(aS*(80./-mv.z), 0.3, 12.0);
        }`,
      fragmentShader: `
        varying float vA;
        void main(){
          vec2 c=gl_PointCoord-0.5; float d=length(c);
          if(d>0.5)discard;
          gl_FragColor=vec4(0.45, 0.1, 0.85, vA*(1.-smoothstep(0.1,0.5,d)));
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(tGeo, tMat));

    /* ═══════════════════════════════════════════════════════════════
       §9  PULSE RINGS
    ═══════════════════════════════════════════════════════════════ */
    const pRings = [];
    for (let i = 0; i < PULSE_RING_POOL; i++) {
      const rg = new THREE.RingGeometry(1, 1.08, 64);
      const rm = new THREE.MeshBasicMaterial({
        color: 0xaa44ff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(rg, rm);
      ring.visible = false;
      scene.add(ring);
      pRings.push(ring);
    }

    /* ═══════════════════════════════════════════════════════════════
       §10  HUD (DOM Overlay)
    ═══════════════════════════════════════════════════════════════ */
    const hud = document.createElement("div");
    hud.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;
      pointer-events:none;font-family:'Courier New',monospace;color:#c084fc;z-index:10;`;
    container.appendChild(hud);

    const hudScore = document.createElement("div");
    hudScore.style.cssText = "position:absolute;top:20px;left:20px;font-size:18px;font-weight:bold;text-shadow:0 0 10px #a020f0;";
    hud.appendChild(hudScore);

    const hudBest = document.createElement("div");
    hudBest.style.cssText = "position:absolute;top:44px;left:20px;font-size:12px;color:#7c3aed88;";
    hud.appendChild(hudBest);

    const hudSpd = document.createElement("div");
    hudSpd.style.cssText = "position:absolute;top:64px;left:20px;font-size:11px;";
    hud.appendChild(hudSpd);

    // Plasma bar
    const plOuter = document.createElement("div");
    plOuter.style.cssText = `position:absolute;top:22px;right:20px;width:180px;height:12px;
      background:#1a0030;border:1px solid #a020f033;border-radius:2px;overflow:hidden;`;
    hud.appendChild(plOuter);
    const plInner = document.createElement("div");
    plInner.style.cssText = `width:100%;height:100%;background:linear-gradient(90deg,#6a0dad,#a020f0);
      box-shadow:0 0 8px #a020f0;transition:width .1s;`;
    plOuter.appendChild(plInner);
    const plLabel = document.createElement("div");
    plLabel.style.cssText = "position:absolute;top:25px;right:205px;font-size:10px;color:#c084fc;";
    plLabel.textContent = "PLASMA";
    hud.appendChild(plLabel);

    // Alpha bar
    const alOuter = document.createElement("div");
    alOuter.style.cssText = `position:absolute;top:42px;right:20px;width:180px;height:8px;
      background:#001020;border:1px solid #0055ff22;border-radius:2px;overflow:hidden;`;
    hud.appendChild(alOuter);
    const alInner = document.createElement("div");
    alInner.style.cssText = `width:0%;height:100%;background:linear-gradient(90deg,#0044aa,#00aaff);
      box-shadow:0 0 6px #00aaff;transition:width .1s;`;
    alOuter.appendChild(alInner);
    const alLabel = document.createElement("div");
    alLabel.style.cssText = "position:absolute;top:42px;right:205px;font-size:10px;color:#4488ff;";
    alLabel.textContent = "ALPHA";
    hud.appendChild(alLabel);

    // Sonar waveform
    const sonarCvs = document.createElement("canvas");
    sonarCvs.width = W; sonarCvs.height = 40;
    sonarCvs.style.cssText = "position:absolute;bottom:0;left:0;width:100%;height:40px;opacity:.4;";
    hud.appendChild(sonarCvs);
    const sonarCtx = sonarCvs.getContext("2d");

    // Alpha mode indicator
    const alphaFlash = document.createElement("div");
    alphaFlash.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      font-size:26px;font-weight:bold;color:#00ccff;font-family:'Courier New',monospace;
      text-shadow:0 0 30px #00aaff,0 0 60px #0066ff;display:none;z-index:15;letter-spacing:8px;`;
    alphaFlash.textContent = "◈ CLOAKED ◈";
    hud.appendChild(alphaFlash);

    // Start screen
    const startScr = document.createElement("div");
    startScr.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:radial-gradient(ellipse at center,rgba(20,0,40,.8),rgba(0,0,0,.96) 70%);
      z-index:20;transition:opacity .5s;`;
    startScr.innerHTML = `
      <div style="font-size:44px;font-weight:bold;color:#a020f0;text-shadow:0 0 40px #a020f0,0 0 80px #6a0dad;margin-bottom:6px;letter-spacing:5px;font-family:'Courier New',monospace;">NIGHT FURY</div>
      <div style="font-size:16px;color:#a020f088;margin-bottom:4px;letter-spacing:7px;font-family:'Courier New',monospace;">SPECTRAL SONAR</div>
      <div style="font-size:11px;color:#7c3aed44;margin-bottom:30px;font-family:'Courier New',monospace;">/// FLY BLIND. PULSE TO SEE. ///</div>
      <img src="/dragon.png" style="width:120px;image-rendering:pixelated;margin-bottom:24px;transform:scaleX(-1);filter:drop-shadow(0 0 12px #a020f0);" />
      <div style="font-size:13px;color:#c084fc55;font-family:'Courier New',monospace;margin-bottom:5px;">[WASD / ARROWS] — FLY &nbsp;&nbsp; [SPACE] — PLASMA PULSE</div>
      <div style="font-size:13px;color:#4488ff44;font-family:'Courier New',monospace;margin-bottom:32px;">[SHIFT] — ALPHA CLOAK (when meter full)</div>
      <div id="nfStartPrompt" style="font-size:16px;font-weight:bold;color:#c084fc;font-family:'Courier New',monospace;">[ PRESS SPACE TO FLY ]</div>
      <style>
        #nfStartPrompt{animation:nfsp 2s ease-in-out infinite}
        @keyframes nfsp{0%,100%{opacity:.5;text-shadow:0 0 10px #a020f0}50%{opacity:1;text-shadow:0 0 30px #a020f0,0 0 60px #6a0dad}}
      </style>`;
    hud.appendChild(startScr);

    // Crash overlay
    const crashOv = document.createElement("div");
    crashOv.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;
      display:none;align-items:center;justify-content:center;flex-direction:column;z-index:25;
      font-family:'Courier New',monospace;`;
    hud.appendChild(crashOv);

    /* ═══════════════════════════════════════════════════════════════
       §11  INPUT
    ═══════════════════════════════════════════════════════════════ */
    function onKD(e) {
      keys[e.code] = true;
      if (e.code === "Space") {
        e.preventDefault();
        if (ST.mode === "START") startGame();
        else if (ST.mode === "PLAY") firePulse();
        else if (ST.mode === "CRASH" && ST.crashT <= 0) startGame();
      }
      if ((e.code === "ShiftLeft" || e.code === "ShiftRight") &&
          ST.mode === "PLAY" && alpha.meter >= alpha.max && !alpha.on) {
        activateAlpha();
      }
    }
    function onKU(e) { keys[e.code] = false; }
    window.addEventListener("keydown", onKD);
    window.addEventListener("keyup", onKU);

    /* ═══════════════════════════════════════════════════════════════
       §12  GAME ACTIONS
    ═══════════════════════════════════════════════════════════════ */
    function startGame() {
      ST.mode = "PLAY"; ST.score = 0; ST.crashT = 0;
      P.x = 0; P.y = 0; P.vx = 0; P.vy = 0; P.pool = 0;
      plasma.e = plasma.max;
      alpha.meter = 0; alpha.on = false; alpha.timer = 0;
      pulses.length = 0; scrollZ = 0; shake.i = 0;
      startScr.style.opacity = "0";
      setTimeout(() => { startScr.style.display = "none"; }, 500);
      crashOv.style.display = "none";
      for (let i = 0; i < LIDAR_DENSITY; i++) { act[i] = 0; spk[i] = 0; }
      lidarGeo.attributes.aAct.needsUpdate = true;
      lidarGeo.attributes.aSpark.needsUpdate = true;
      for (let i = 0; i < TRAIL_POOL; i++) tAlp[i] = 0;
    }

    function firePulse() {
      if (plasma.e < plasma.cost) return;
      plasma.e -= plasma.cost;
      pulses.push({
        ox: P.x, oy: P.y, scrollAtFire: scrollZ,
        r: 0.5, a: 1, st: 0,
      });
      shake.i = Math.max(shake.i, 8);
      pulseDistPass.uniforms.uStr.value = 1;
      pulseDistPass.uniforms.uRadius.value = 0;
      sonarE = 1;
    }

    function activateAlpha() {
      alpha.on = true; alpha.timer = ALPHA_DURATION; alpha.meter = 0;
      alphaFlash.style.display = "block"; shake.i = 15;
    }

    function triggerCrash() {
      if (alpha.on) return;
      ST.mode = "CRASH"; ST.crashT = ST.crashD;
      if (ST.score > ST.hi) ST.hi = ST.score;
      shake.i = 25;
      // Reveal all cave walls on crash
      for (let i = 0; i < LIDAR_DENSITY; i++) act[i] = 0.7;
      lidarGeo.attributes.aAct.needsUpdate = true;
      crashOv.style.display = "flex";
      crashOv.innerHTML = `
        <div style="font-size:52px;font-weight:bold;color:#ff0044;text-shadow:0 0 30px #ff0044;
          font-family:'Courier New',monospace;animation:nfgt .1s infinite;">CRASH</div>
        <style>@keyframes nfgt{
          0%{transform:translate(0,0)}25%{transform:translate(-5px,3px)}
          50%{transform:translate(5px,-2px)}75%{transform:translate(-3px,5px)}
          100%{transform:translate(0,0)}}</style>`;
    }

    /* ═══════════════════════════════════════════════════════════════
       §13  COLLISION
    ═══════════════════════════════════════════════════════════════ */
    function checkCollision() {
      if (alpha.on) return false;
      const pAngle = Math.atan2(P.y, P.x);
      const pDist = Math.sqrt(P.x * P.x + P.y * P.y);
      for (let i = 0; i < 8; i++) {
        const a = pAngle + (i / 8) * 0.5 - 0.25;
        const wallR = caveR(a, scrollZ);
        if (pDist > wallR - 1.5) return true;
      }
      return false;
    }

    function gapTight() {
      const a = Math.atan2(P.y, P.x);
      const r = caveR(a, scrollZ);
      return Math.sqrt(P.x * P.x + P.y * P.y) / r;
    }

    /* ═══════════════════════════════════════════════════════════════
       §14  SONAR WAVEFORM
    ═══════════════════════════════════════════════════════════════ */
    function drawSonar() {
      sonarCtx.clearRect(0, 0, W, 40);
      const n = 80, bw = W / n;
      for (let i = 0; i < n; i++) {
        const v = sonarE * Math.sin(i * .4 + ST.time * 6) * (.3 + Math.random() * .7);
        const h = Math.abs(v) * 30;
        sonarCtx.fillStyle = `rgba(160,32,240,${Math.min(1, .2 + Math.abs(v) * 3)})`;
        sonarCtx.fillRect(i * bw + 1, 20 - h / 2, bw - 2, h);
      }
      sonarE *= .94;
    }

    /* ═══════════════════════════════════════════════════════════════
       §15  MAIN LOOP
    ═══════════════════════════════════════════════════════════════ */
    let lastT = performance.now(), animF = null;

    function loop(now) {
      animF = requestAnimationFrame(loop);
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now; ST.time += dt; ST.dt = dt; frame++;

      if (ST.mode === "PLAY") updatePlay(dt);
      if (ST.mode === "CRASH") updateCrash(dt);

      // Uniforms
      vigPass.uniforms.uT.value = ST.time;
      lidarMat.uniforms.uTime.value = ST.time;
      lidarMat.uniforms.uScroll.value = scrollZ;
      lidarMat.uniforms.uAlpha.value = alpha.on ? 1 : 0;

      // Pulse distortion decay
      if (pulseDistPass.uniforms.uStr.value > 0) {
        pulseDistPass.uniforms.uRadius.value += dt * 1.5;
        pulseDistPass.uniforms.uStr.value *= 0.94;
        if (pulseDistPass.uniforms.uStr.value < 0.01)
          pulseDistPass.uniforms.uStr.value = 0;
      }

      updateCamera(dt);
      drawSonar();
      updateHUD();
      composer.render();
    }

    /* ═══════════════════════════════════════════════════════════════
       §16  PLAY UPDATE
    ═══════════════════════════════════════════════════════════════ */
    function updatePlay(dt) {
      const f = dt * 60;
      const up = keys["ArrowUp"] || keys["KeyW"];
      const dn = keys["ArrowDown"] || keys["KeyS"];
      const rt = keys["ArrowRight"] || keys["KeyD"];
      const lt = keys["ArrowLeft"] || keys["KeyA"];

      P.vy += P.gravity * f;
      if (up) P.vy += P.lift * f;
      if (dn) P.vy -= P.lift * 0.8 * f;
      if (rt) P.vx += 0.015 * f;
      if (lt) P.vx -= 0.015 * f;

      // Conservation of Momentum: diving builds speed pool
      if (P.vy < -0.05) {
        P.pool += Math.abs(P.vy) * 0.35 * f;
        P.pool = Math.min(P.pool, 15);
      }
      if (up && P.pool > 0) {
        P.vy += 0.005 * P.pool * f;
        P.pool *= 0.97;
      }

      P.vy *= Math.pow(P.drag, f);
      P.vx *= Math.pow(0.94, f);
      P.y += P.vy * f;
      P.x += P.vx * f;

      // Clamp within tunnel
      const maxR = TUNNEL_RADIUS * 0.55;
      const d = Math.sqrt(P.x * P.x + P.y * P.y);
      if (d > maxR) { const s = maxR / d; P.x *= s; P.y *= s; }

      // Scroll forward
      const sMult = 1 + P.pool * 0.1;
      const sSpd = P.baseSpeed * sMult;
      scrollZ += sSpd * f;
      ST.score = Math.floor(scrollZ * 2);

      // Velocity Stretch on sprite
      const totalV = Math.sqrt(P.vx * P.vx + P.vy * P.vy) + sSpd * 0.3;
      P.stretch = Math.min(1 + totalV * 0.15, 1.8);
      const invS = 1 / (P.stretch * 0.25 + 0.75);
      // The mesh already has scale.x = -1 for the flip, so group uses positive X
      dragonGroup.scale.set(P.stretch, invS, 1);

      // Dragon pose
      dragonGroup.position.set(P.x, P.y, 0);
      const pitch = Math.atan2(P.vy, sSpd) * 0.7;
      dragonGroup.rotation.z = pitch;
      // Billboard: make the dragon always face the camera
      dragonMesh.lookAt(camera.position);
      // Re-apply the flip after lookAt overwrites scale
      dragonMesh.scale.set(-1, 1, 1);

      // Chromatic aberration tied to speed
      chromaPass.uniforms.uI.value = Math.min(0.001 + totalV * 0.003, 0.012);

      // Plasma recharge
      const rr = totalV > 0.8 ? plasma.rFast : plasma.rBase;
      plasma.e = Math.min(plasma.max, plasma.e + rr * f);

      // Alpha meter: tight gaps fill it
      const tight = gapTight();
      if (tight > 0.5) {
        alpha.meter = Math.min(alpha.max, alpha.meter + (tight - 0.5) * 0.9 * f);
      }

      // Alpha mode timer
      if (alpha.on) {
        alpha.timer -= f;
        if (alpha.timer <= 0) {
          alpha.on = false;
          alphaFlash.style.display = "none";
        }
        // Neon blue tint on dragon during cloak
        spriteMat.color.setHex(frame % 8 < 4 ? 0x4488ff : 0x00ccff);
      } else {
        spriteMat.color.setHex(0xffffff); // normal sprite colors
      }

      // ─── Update pulses ───
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.r += PULSE_SPEED * dt;
        p.a = 1 - p.r / PULSE_MAX_RADIUS;
        p.st += dt;
        if (p.r >= PULSE_MAX_RADIUS) { pulses.splice(i, 1); continue; }

        // Activate lidar dots in the pulse ring shell
        const rSq = p.r * p.r;
        const innerR = p.r - 14;
        const innerSq = innerR > 0 ? innerR * innerR : 0;

        for (let j = 0; j < LIDAR_DENSITY; j++) {
          // Compute dot z in the same wrapped space as the shader
          const rawZ = ((pos[j*3+2] - scrollZ) % TUNNEL_LENGTH + TUNNEL_LENGTH) % TUNNEL_LENGTH - TUNNEL_LENGTH * 0.1;
          // Pulse origin z in the same space (it was fired at scrollAtFire)
          const pulseZ = 0; // pulse origin is at the player, which is at z=0 in view space
          // But account for scroll since pulse was fired
          const scrollSinceFire = scrollZ - p.scrollAtFire;
          const dx = pos[j*3] - p.ox;
          const dy = pos[j*3+1] - p.oy;
          const dz = rawZ + scrollSinceFire; // dot's z relative to pulse origin
          const dSq = dx*dx + dy*dy + dz*dz;

          if (dSq < rSq && dSq > innerSq) {
            act[j] = Math.min(0.95, act[j] + 0.55); // strong activation
            if (p.st < 1.5) {
              spk[j] = Math.min(0.8, spk[j] + 0.5 * rnd[j]); // visible sparkle
            }
          }
        }
      }

      // ─── Decay activations & sparkles ───
      let dirty = false;
      for (let i = 0; i < LIDAR_DENSITY; i++) {
        if (act[i] > 0) { act[i] *= 0.992; if (act[i] < 0.005) act[i] = 0; dirty = true; }
        if (spk[i] > 0) { spk[i] *= 0.92;  if (spk[i] < 0.005) spk[i] = 0; dirty = true; }
      }
      if (dirty) {
        lidarGeo.attributes.aAct.needsUpdate = true;
        lidarGeo.attributes.aSpark.needsUpdate = true;
      }

      // ─── Pulse ring visuals ───
      for (let i = 0; i < PULSE_RING_POOL; i++) {
        const ring = pRings[i];
        if (i < pulses.length) {
          const p = pulses[i];
          ring.visible = true;
          ring.position.set(p.ox, p.oy, 0);
          ring.scale.setScalar(p.r);
          ring.material.opacity = p.a * 0.6;
          ring.lookAt(camera.position);
        } else { ring.visible = false; }
      }

      // ─── Trail particles (pooled) ───
      if (frame % 2 === 0) {
        const idx = tHead % TRAIL_POOL;
        tPos[idx*3]     = P.x - 2.5 + (Math.random() - 0.5) * 0.3;
        tPos[idx*3 + 1] = P.y + (Math.random() - 0.5) * 0.4;
        tPos[idx*3 + 2] = (Math.random() - 0.5) * 0.5;
        tAlp[idx] = 0.6;
        tSiz[idx] = 1.2 + Math.random() * 1.8;
        tHead++;
      }
      for (let i = 0; i < TRAIL_POOL; i++) {
        if (tAlp[i] > 0) {
          tAlp[i] -= 0.015 * f;
          tSiz[i] *= 0.995;
          tPos[i*3] -= 0.03 * f;
          if (tAlp[i] < 0) tAlp[i] = 0;
        }
      }
      tGeo.attributes.position.needsUpdate = true;
      tGeo.attributes.aA.needsUpdate = true;
      tGeo.attributes.aS.needsUpdate = true;

      // ─── Shake (velocity-driven) ───
      shake.i = Math.max(shake.i, totalV * 0.4);
      shake.i *= Math.pow(shake.decay, f);
      if (shake.i < 0.08) shake.i = 0;

      // ─── Collision ───
      if (checkCollision()) triggerCrash();
    }

    /* ═══════════════════════════════════════════════════════════════
       §17  CRASH UPDATE
    ═══════════════════════════════════════════════════════════════ */
    function updateCrash(dt) {
      const f = dt * 60;
      ST.crashT -= f;
      // Slowly fade out the revealed cave
      for (let i = 0; i < LIDAR_DENSITY; i++) act[i] *= 0.998;
      lidarGeo.attributes.aAct.needsUpdate = true;
      shake.i *= 0.94;

      if (ST.crashT <= 60 && ST.crashT > 0) {
        crashOv.innerHTML = `
          <div style="font-size:22px;color:#c084fc;font-family:'Courier New',monospace;text-shadow:0 0 10px #a020f0;margin-bottom:12px;">DISTANCE: ${ST.score}</div>
          ${ST.hi > 0 ? `<div style="font-size:14px;color:#7c3aed88;font-family:'Courier New',monospace;margin-bottom:20px;">BEST: ${ST.hi}</div>` : ""}
          <div style="font-size:16px;color:#c084fc;font-family:'Courier New',monospace;animation:nfpp 1.5s ease-in-out infinite;">[ SPACE TO RETRY ]</div>
          <style>@keyframes nfpp{0%,100%{opacity:.5}50%{opacity:1}}</style>`;
      }
    }

    /* ═══════════════════════════════════════════════════════════════
       §18  CAMERA — Perlin Noise Jitter
    ═══════════════════════════════════════════════════════════════ */
    function updateCamera(dt) {
      const tx = P.x * 0.3;
      const ty = P.y * 0.3 + 1;
      camera.position.x += (tx - camera.position.x) * 0.08;
      camera.position.y += (ty - camera.position.y) * 0.08;
      camera.position.z = 25;

      // Perlin shake tied to velocity
      if (shake.i > 0.08) {
        const freq = 1 + shake.i * 0.5;
        camera.position.x += perlin.n3(ST.time * freq * 10, 0, 0) * shake.i * 0.06;
        camera.position.y += perlin.n3(0, ST.time * freq * 10, 5) * shake.i * 0.06;
      }

      camera.lookAt(P.x * 0.5, P.y * 0.5, -10);
    }

    /* ═══════════════════════════════════════════════════════════════
       §19  HUD UPDATE
    ═══════════════════════════════════════════════════════════════ */
    function updateHUD() {
      if (ST.mode !== "PLAY") return;
      hudScore.textContent = `DIST: ${ST.score}`;
      hudBest.textContent = ST.hi > 0 ? `BEST: ${ST.hi}` : "";

      const tv = Math.sqrt(P.vx * P.vx + P.vy * P.vy) + P.baseSpeed;
      const sl = Math.min(3, Math.floor(tv * 1.5));
      const sc = sl >= 3 ? "#ff4444" : sl >= 2 ? "#ffaa00" : "#c084fc";
      hudSpd.innerHTML = `<span style="color:${sc}">SPD: ${"▮".repeat(sl)}${"▯".repeat(3 - sl)}</span>`;

      plInner.style.width = `${(plasma.e / plasma.max) * 100}%`;

      if (alpha.on) {
        alInner.style.background = "linear-gradient(90deg,#00aaff,#00ffff)";
        alInner.style.width = `${(alpha.timer / ALPHA_DURATION) * 100}%`;
        alphaFlash.style.opacity = `${0.5 + 0.5 * Math.sin(ST.time * 10)}`;
      } else {
        alInner.style.background = "linear-gradient(90deg,#0044aa,#00aaff)";
        alInner.style.width = `${(alpha.meter / alpha.max) * 100}%`;
      }
    }

    /* ═══════════════════════════════════════════════════════════════
       §20  START
    ═══════════════════════════════════════════════════════════════ */
    animF = requestAnimationFrame(loop);

    /* ═══════════════════════════════════════════════════════════════
       §21  CLEANUP
    ═══════════════════════════════════════════════════════════════ */
    return () => {
      window.removeEventListener("keydown", onKD);
      window.removeEventListener("keyup", onKU);
      if (animF) cancelAnimationFrame(animF);
      renderer.dispose();
      composer.dispose();
      if (renderer.domElement.parentNode)
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (hud.parentNode) hud.parentNode.removeChild(hud);
    };
  }, []);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let cleanup = null;
    initGame(el).then((fn) => {
      cleanup = fn;
      cleanupRef.current = fn;
    });
    return () => {
      if (cleanup) cleanup();
      else if (cleanupRef.current) cleanupRef.current();
    };
  }, [initGame]);

  return (
    <div
      ref={mountRef}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#05051a",
        overflow: "hidden",
        position: "relative",
      }}
    />
  );
}
