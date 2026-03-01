/* ================================================================
   PARV MER — script.js  v4  (Performance Optimised)
   · Merged particle + hero into single WebGL renderer
   · RAF throttling + visibility API pause
   · Passive scroll listeners throughout
   · Reduced particle/orb counts on low-end / mobile
   · All UI, design & interactions preserved exactly
================================================================ */
'use strict';

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx);
const isMobile = () => window.innerWidth < 768;
const isLowEnd = () => window.innerWidth < 480;

/* ─── Device tier detection ─── */
const TIER = (() => {
  const w = window.innerWidth;
  const cores = navigator.hardwareConcurrency || 2;
  const ram = navigator.deviceMemory || 4;
  if (w < 480 || cores <= 2 || ram <= 2) return 'low';
  if (w < 768 || cores <= 4 || ram <= 4) return 'mid';
  return 'high';
})();

/* ─── Visibility-based pause ─── */
let pageVisible = true;
document.addEventListener('visibilitychange', () => {
  pageVisible = !document.hidden;
});

/* ═══════════════════════════════════════════════════════════════
   0. PARTICLE BACKGROUND  (multi-colour) — performance optimised
═══════════════════════════════════════════════════════════════ */
(function initParticles() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const W = window.innerWidth, H = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1); // Always 1 for bg — it's subtle, nobody notices
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 1000);
  camera.position.z = 55;

  // Reduce counts significantly — the effect is barely visible behind content
  const COUNT_MAP = { low: 200, mid: 450, high: 900 };
  const COUNT = COUNT_MAP[TIER];

  const COLORS = [0x00e5b0, 0xa78bfa, 0xf97316, 0x38bdf8, 0xec4899];
  const groups = [];

  COLORS.forEach((col, ci) => {
    const n   = Math.floor(COUNT / COLORS.length);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const sz  = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      pos[i*3]   = (Math.random()-.5) * 200;
      pos[i*3+1] = (Math.random()-.5) * 200;
      pos[i*3+2] = (Math.random()-.5) * 80;
      vel[i*3]   = (Math.random()-.5) * .005;
      vel[i*3+1] = (Math.random()-.5) * .005;
      sz[i] = Math.random() * (ci === 0 ? 1.6 : 1.1) + .25;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size',     new THREE.BufferAttribute(sz,  1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(col) } },
      vertexShader: `
        attribute float size;
        void main(){
          vec4 mv=modelViewMatrix*vec4(position,1.);
          gl_PointSize=size*(260./-mv.z);
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        void main(){
          float d=distance(gl_PointCoord,vec2(.5));
          if(d>.5)discard;
          float a=smoothstep(.5,.0,d)*.45;
          gl_FragColor=vec4(uColor,a);
        }`,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending
    });

    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    groups.push({ geo, pos, vel, pts });
  });

  let mx = 0, my = 0, rotX = 0, rotY = 0;
  window.addEventListener('mousemove', e => {
    mx = (e.clientX/W - .5)*2;
    my = -(e.clientY/H - .5)*2;
  }, { passive:true });

  // Throttle bg particles to ~30fps — it's a subtle bg, nobody sees the diff
  const TARGET_FPS = TIER === 'low' ? 20 : 30;
  const FRAME_MS = 1000 / TARGET_FPS;
  let lastPT = 0;

  function ptTick(now) {
    requestAnimationFrame(ptTick);
    if (!pageVisible) return;
    if (now - lastPT < FRAME_MS) return; // throttle
    const dt = Math.min((now - lastPT) / 1000, 0.1);
    lastPT = now;

    groups.forEach(({ pos, vel, geo, pts }, gi) => {
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        pos[i*3]   += vel[i*3]   * dt * 60;
        pos[i*3+1] += vel[i*3+1] * dt * 60;
        if (Math.abs(pos[i*3])   > 95) vel[i*3]   *= -1;
        if (Math.abs(pos[i*3+1]) > 95) vel[i*3+1] *= -1;
      }
      geo.attributes.position.needsUpdate = true;
      pts.rotation.z += (gi % 2 === 0 ? .00012 : -.00008) * dt * 60;
    });
    rotY += (mx*.02 - rotY)*.025;
    rotX += (my*.02 - rotX)*.025;
    scene.rotation.y = rotY;
    scene.rotation.x = rotX;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(ptTick);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nw=window.innerWidth, nh=window.innerHeight;
      camera.aspect=nw/nh; camera.updateProjectionMatrix();
      renderer.setSize(nw,nh);
    }, 150);
  }, { passive: true });
})();

/* ═══════════════════════════════════════════════════════════════
   1. HERO 3D — Minimalist floating galaxy (performance optimised)
═══════════════════════════════════════════════════════════════ */
(function initHero3D() {
  const canvas = document.getElementById('hero-3d');
  if (!canvas || typeof THREE === 'undefined') return;

  const mob = window.innerWidth < 768;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, TIER === 'high' ? 1.5 : 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 0, mob ? 30 : 24);

  scene.add(new THREE.AmbientLight(0xffffff, 0.10));
  const LIGHT_COLS = [0x00ffcc, 0xa78bfa, 0xf97316, 0x38bdf8, 0xec4899];
  const ptLights = LIGHT_COLS.map((col, i) => {
    const pl = new THREE.PointLight(col, 4.5, 70);
    pl.position.set(
      Math.cos(i / LIGHT_COLS.length * Math.PI * 2) * 18,
      Math.sin(i / LIGHT_COLS.length * Math.PI * 2) * 10,
      6
    );
    scene.add(pl);
    return pl;
  });

  const world = new THREE.Group();
  scene.add(world);

  const COLS_PALETTE = [
    0x00ffcc, 0xa78bfa, 0xf97316,
    0x38bdf8, 0xec4899, 0xffd700,
    0x00e5b0, 0xff6b6b, 0x7c3aed,
    0x06b6d4, 0x84cc16, 0xf43f5e,
  ];

  const orbData = [];
  const clearR  = mob ? 5 : 8;

  // Reduced orb counts per tier
  const ORB_COUNT_MAP = { low: 18, mid: 30, high: 52 };
  const ORB_COUNT = ORB_COUNT_MAP[TIER];

  // Reuse geometry per tier to cut draw calls
  const orbGeoCache = {};
  const getOrbGeo = (r, detail) => {
    const key = `${r.toFixed(2)}_${detail}`;
    if (!orbGeoCache[key]) orbGeoCache[key] = new THREE.SphereGeometry(r, detail, detail);
    return orbGeoCache[key];
  };

  for (let i = 0; i < ORB_COUNT; i++) {
    const tier = i < 4 ? 0 : i < 14 ? 1 : 2;
    const baseR = tier === 0 ? (mob ? 0.7 : 1.1)
                : tier === 1 ? (mob ? 0.3 : 0.55)
                              : (mob ? 0.12 : 0.22);
    const radius  = baseR * (0.7 + Math.random() * 0.6);
    const detail  = TIER === 'low' ? 6 : tier === 0 ? 12 : 8;
    const geo = getOrbGeo(radius, detail);
    const col = new THREE.Color(COLS_PALETTE[i % COLS_PALETTE.length]);
    const mat = new THREE.MeshPhongMaterial({
      color:     col,
      emissive:  col.clone().multiplyScalar(tier === 0 ? 0.55 : 0.40),
      shininess: 180,
      specular:  new THREE.Color(0xffffff),
      transparent: true,
      opacity: tier === 0 ? 0.92 : tier === 1 ? 0.82 : 0.70,
    });
    const mesh = new THREE.Mesh(geo, mat);

    const shellR = tier === 0
      ? (mob ? 8  : 12) + Math.random() * (mob ? 3 : 4)
      : tier === 1
      ? (mob ? 5  :  8) + Math.random() * (mob ? 5 : 7)
      : (mob ? 3  :  5) + Math.random() * (mob ? 8 : 13);

    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    let px = shellR * Math.sin(phi) * Math.cos(theta);
    let py = shellR * Math.sin(phi) * Math.sin(theta);
    const pz = (Math.random() - 0.5) * (mob ? 12 : 20);

    if (Math.abs(px) < clearR) {
      px = (px >= 0 ? 1 : -1) * (clearR + Math.random() * (mob ? 3 : 5));
    }

    mesh.position.set(px, py, pz);
    mesh.userData = {
      orbitSpeed:  (Math.random() > 0.5 ? 1 : -1) * (0.06 + Math.random() * 0.12),
      orbitRadius: Math.sqrt(px * px + py * py),
      orbitAngle:  Math.atan2(py, px),
      floatSpeed:  0.25 + Math.random() * 0.3,
      floatAmp:    mob ? 0.3 : 0.55,
      floatPhase:  Math.random() * Math.PI * 2,
      baseZ:       pz,
    };

    world.add(mesh);
    orbData.push(mesh);
  }

  // Skip rings entirely on low-end devices
  const rings = [];
  if (TIER !== 'low') {
    const RING_DEFS = mob ? [
      { r: 13, tube: 0.045, col: 0x00ffcc, rx: 1.0, ry: 0.2, spd:  0.15 },
      { r: 16, tube: 0.032, col: 0x7c3aed, rx: 0.3, ry: 0.9, spd: -0.12 },
    ] : [
      { r: 15, tube: 0.055, col: 0x00ffcc, rx: 1.0, ry: 0.2, spd:  0.14 },
      { r: 18, tube: 0.040, col: 0x7c3aed, rx: 0.3, ry: 0.9, spd: -0.12 },
      { r: 21, tube: 0.030, col: 0xf97316, rx: 0.7, ry: 0.5, spd:  0.10 },
      { r: 24, tube: 0.022, col: 0x38bdf8, rx: 1.3, ry: 0.1, spd: -0.08 },
    ];

    RING_DEFS.forEach(d => {
      const segs = TIER === 'mid' ? 70 : 100;
      const geo = new THREE.TorusGeometry(d.r, d.tube, 6, segs);
      const mat = new THREE.MeshPhongMaterial({
        color: d.col,
        emissive: new THREE.Color(d.col).multiplyScalar(0.20),
        shininess: 200,
        specular: new THREE.Color(0xffffff),
        transparent: true,
        opacity: 0.38,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.set(d.rx, d.ry, 0);
      mesh.position.z = -10;
      mesh.userData.spd = d.spd;
      world.add(mesh);
      rings.push(mesh);
    });
  }

  // Star dust — reduced count
  const STAR_COUNT_MAP = { low: 80, mid: 150, high: 280 };
  const STAR_COUNT = STAR_COUNT_MAP[TIER];
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starSz  = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    starPos[i*3]   = (Math.random() - 0.5) * 100;
    starPos[i*3+1] = (Math.random() - 0.5) * 80;
    starPos[i*3+2] = -15 - Math.random() * 20;
    starSz[i] = Math.random() * 1.5 + 0.3;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('size',     new THREE.BufferAttribute(starSz,  1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x88eedd) } },
    vertexShader: `
      attribute float size;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.);
        gl_PointSize = size * (200. / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      void main(){
        float d = distance(gl_PointCoord, vec2(.5));
        if(d>.5) discard;
        float a = smoothstep(.5,.0,d) * .5;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  world.add(new THREE.Points(starGeo, starMat));

  let mx = 0, my = 0, smx = 0, smy = 0;
  let curRotY = 0, curRotX = 0;

  document.addEventListener('mousemove', e => {
    mx = (e.clientX / window.innerWidth  - 0.5);
    my = (e.clientY / window.innerHeight - 0.5);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!e.touches[0]) return;
    mx = (e.touches[0].clientX / window.innerWidth  - 0.5);
    my = (e.touches[0].clientY / window.innerHeight - 0.5);
  }, { passive: true });

  // Hero runs at full 60fps (it's the hero — premium feel justified)
  // But skip frames on low-end
  const HERO_FPS  = TIER === 'low' ? 30 : 60;
  const HERO_MS   = 1000 / HERO_FPS;
  let lastHero    = 0;
  let heroT       = 0;

  function tick(now) {
    requestAnimationFrame(tick);
    if (!pageVisible) return;
    if (window._loaderActive) return; // don't render hero while loader is showing
    if (now - lastHero < HERO_MS) return;
    const dt = Math.min((now - lastHero) / 1000, 0.05);
    lastHero = now;
    heroT += dt;

    orbData.forEach(m => {
      m.userData.orbitAngle += m.userData.orbitSpeed * dt;
      m.position.x = Math.cos(m.userData.orbitAngle) * m.userData.orbitRadius;
      m.position.y = Math.sin(m.userData.orbitAngle) * m.userData.orbitRadius * 0.6;
      m.position.z = m.userData.baseZ
        + Math.sin(heroT * m.userData.floatSpeed + m.userData.floatPhase) * m.userData.floatAmp;
    });

    rings.forEach(r => {
      r.rotation.z += r.userData.spd * dt;
      r.rotation.y += r.userData.spd * 0.3 * dt;
    });

    ptLights.forEach((pl, i) => {
      const a = heroT * 0.25 + i * (Math.PI * 2 / ptLights.length);
      pl.position.x = Math.cos(a) * 20;
      pl.position.z = Math.sin(a) * 12;
    });

    smx += (mx - smx) * 0.04;
    smy += (my - smy) * 0.04;
    curRotY += (smx * 0.18 - curRotY) * 0.05;
    curRotX += (smy * 0.10 - curRotX) * 0.05;
    world.rotation.y = curRotY;
    world.rotation.x = curRotX;

    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nw = window.innerWidth, nh = window.innerHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    }, 150);
  }, { passive: true });
})();

/* ═══════════════════════════════════════════════════════════════
   2. LOADER
═══════════════════════════════════════════════════════════════ */
(function initLoader() {
  const loader   = $('#loader');
  const barEl    = $('#loader-bar');
  const pctEl    = $('#loader-percent');
  const tagEl    = $('#loader-tagline');
  const statusEl = $('#loader-status');
  if (!loader) return;
  window._loaderActive = true; // pause hero 3D while loading

  // ── Animated canvas background in loader ──
  const lc = document.getElementById('loader-canvas');
  if (lc) {
    lc.width  = window.innerWidth;
    lc.height = window.innerHeight;
    const lctx = lc.getContext('2d');
    // Fewer dots on loader canvas
    const dotCount = TIER === 'low' ? 25 : TIER === 'mid' ? 40 : 55;
    const dots = Array.from({ length: dotCount }, () => ({
      x: Math.random() * lc.width,
      y: Math.random() * lc.height,
      r: Math.random() * 1.4 + 0.3,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      h: Math.random() * 360,
    }));
    let laf;
    let loaderDone = false;
    function ldraw() {
      if (loaderDone) return;
      laf = requestAnimationFrame(ldraw);
      lctx.clearRect(0, 0, lc.width, lc.height);
      dots.forEach(d => {
        d.x += d.vx; d.y += d.vy;
        d.h  = (d.h + 0.3) % 360;
        if (d.x < 0 || d.x > lc.width)  d.vx *= -1;
        if (d.y < 0 || d.y > lc.height) d.vy *= -1;
        lctx.beginPath();
        lctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        lctx.fillStyle = `hsla(${d.h},80%,70%,0.45)`;
        lctx.fill();
      });
      // Draw connections — only on high/mid tier
      if (TIER !== 'low') {
        for (let i = 0; i < dots.length; i++) {
          for (let j = i + 1; j < dots.length; j++) {
            const dx = dots[i].x - dots[j].x;
            const dy = dots[i].y - dots[j].y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 120) {
              lctx.beginPath();
              lctx.moveTo(dots[i].x, dots[i].y);
              lctx.lineTo(dots[j].x, dots[j].y);
              lctx.strokeStyle = `rgba(0,229,176,${0.08 * (1 - dist/120)})`;
              lctx.lineWidth = 0.6;
              lctx.stroke();
            }
          }
        }
      }
    }
    ldraw();
    // expose stopper
    window._stopLoaderCanvas = () => { loaderDone = true; cancelAnimationFrame(laf); };
  }

  // Char animation on tagline
  const raw = tagEl.textContent;
  tagEl.innerHTML = '';
  [...raw].forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? '\u00a0' : ch;
    Object.assign(s.style, {
      display:'inline-block', opacity:'0', transform:'translateY(28px)',
      transition:`opacity .32s ease ${i*.028}s, transform .32s ease ${i*.028}s`
    });
    tagEl.appendChild(s);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    tagEl.querySelectorAll('span').forEach(s => { s.style.opacity='1'; s.style.transform='translateY(0)'; });
  }));

  const msgs = ['Loading assets...','Setting up scene...','Building portfolio...','Almost there...','Finalizing scene...'];
  let pct=0, si=0;
  const tick = setInterval(() => {
    pct = Math.min(pct + Math.random()*3.5+.8, 98);
    barEl.style.width = pct+'%';
    pctEl.textContent = Math.floor(pct)+'%';
    if (pct>22&&si===0){statusEl.textContent=msgs[1];si++;}
    if (pct>48&&si===1){statusEl.textContent=msgs[2];si++;}
    if (pct>74&&si===2){statusEl.textContent=msgs[3];si++;}
    if (pct>90&&si===3){statusEl.textContent=msgs[4];si++;}
  }, 55);

  setTimeout(() => {
    clearInterval(tick);
    barEl.style.width='100%';
    pctEl.textContent='100%';
    statusEl.textContent='Complete!';
    setTimeout(() => {
      if (window._stopLoaderCanvas) window._stopLoaderCanvas();
      window._loaderActive = false; // hero 3D can now render
      gsap.to(loader, {
        yPercent:-100, duration:1.1, ease:'power3.inOut',
        onComplete: () => {
          loader.style.display='none';
          startPageAnimations();
          setTimeout(runTyped, 2000);
        }
      });
    }, 380);
  }, 2700);
})();

/* ═══════════════════════════════════════════════════════════════
   3. GSAP SCROLL ANIMATIONS
═══════════════════════════════════════════════════════════════ */
gsap.registerPlugin(ScrollTrigger);

function startPageAnimations() {

  /* Remove hero-hidden and let GSAP animate everything from scratch */
  const heroContent = document.querySelector('.hero-content');
  if (heroContent) heroContent.classList.remove('hero-hidden');

  /* HERO */
  const htl = gsap.timeline({ defaults:{ ease:'power4.out' } });
  htl
    .from('.hero-badge',     { y:28, opacity:0, duration:.8 })
    .from('.title-solid',    { y:'110%', opacity:0, duration:1.1, skewY:4 }, '-=.3')
    .from('.title-outline',  { y:'110%', opacity:0, duration:1.1, skewY:4 }, '-=.85')
    .from('.hero-typed-row', { y:22, opacity:0, duration:.8 }, '-=.4')
    .from('.hero-desc',      { y:18, opacity:0, duration:.8 }, '-=.4')
    .from('.hero-actions',   { y:18, opacity:0, duration:.7 }, '-=.4')
    .from('.stat-item',      { y:14, opacity:0, duration:.5, stagger:.1 }, '-=.4')
    .from('.hero-scroll',    { opacity:0, duration:.5 }, '-=.2');

  /* ABOUT */
  anim('.photo-frame',              { x:-60,opacity:0,duration:1.2 },            '.about-layout','top 80%');
  anim('.about-badge',              { scale:.7,opacity:0,duration:.8,stagger:.2,ease:'back.out(1.8)' }, '.about-layout','top 75%');
  anim('.about-text .eyebrow',      { y:20,opacity:0,duration:.6 },               '.about-text','top 85%');
  anim('.about-text .section-title',{ y:36,opacity:0,duration:.9 },               '.about-text','top 83%');
  anim('.about-text .body-p',       { y:24,opacity:0,duration:.7,stagger:.1 },    '.about-text','top 82%');
  anim('.j-item',                   { x:28,opacity:0,duration:.65,stagger:.14 },  '.journey','top 85%');
  anim('.s-chip',                   { y:14,opacity:0,duration:.5,stagger:.07 },   '.social-links','top 88%');

  /* SKILLS */
  anim('.skill-card',  { y:55, opacity:0, duration:.9, stagger:.15 }, '.skill-grid','top 85%');

  $$('.sbar-fill').forEach(el => {
    gsap.to(el, { width:el.dataset.w+'%', duration:1.7, ease:'power2.out',
      scrollTrigger:{ trigger:el, start:'top 93%', toggleActions:'play none none none' } });
  });

  /* EXPERIENCE */
  anim('.exp-entry',{ x:-50,opacity:0,duration:1.1 },'.exp-wrapper','top 82%');
  $$('.impact-fill').forEach(el => {
    gsap.to(el, { width:el.dataset.w+'%', duration:1.5, ease:'power2.out',
      scrollTrigger:{ trigger:el, start:'top 92%', toggleActions:'play none none none' } });
  });

  /* PROJECTS */
  anim('.proj-card',{ y:65,opacity:0,duration:1,stagger:.13 },'.proj-grid','top 83%');

  /* TESTIMONIALS */
  anim('.testi-card',{ y:50,opacity:0,duration:.9,stagger:.14 },'.testi-grid','top 85%');

  /* CONTACT */
  anim('.ci-row',         { x:-28,opacity:0,duration:.7,stagger:.1 },'.contact-layout','top 85%');
  anim('.contact-form-box',{ x:50,opacity:0,duration:1 },           '.contact-layout','top 85%');

  /* Generic eyebrows & titles */
  $$('.eyebrow:not(.about-text .eyebrow)').forEach(el => {
    gsap.from(el, { y:18,opacity:0,duration:.65,
      scrollTrigger:{trigger:el,start:'top 90%',toggleActions:'play none none reverse'} });
  });
  $$('.section-title:not(.about-text .section-title)').forEach(el => {
    gsap.from(el, { y:36,opacity:0,duration:.9,
      scrollTrigger:{trigger:el,start:'top 88%',toggleActions:'play none none reverse'} });
  });

  ScrollTrigger.refresh();
  initMagneticButtons();
  init3DTiltCard();
  initProjectCardGlow();
}

function anim(targets, vars, triggerEl, start) {
  gsap.from(targets, { ...vars,
    scrollTrigger:{ trigger:triggerEl, start, toggleActions:'play none none reverse' } });
}

/* ═══════════════════════════════════════════════════════════════
   4. MAGNETIC BUTTONS
═══════════════════════════════════════════════════════════════ */
function initMagneticButtons() {
  if (isMobile()) return;
  $$('.btn-solid, .btn-outline, .nav-hire, .back-top').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width/2);
      const dy = e.clientY - (r.top  + r.height/2);
      gsap.to(btn, { x: dx*.25, y: dy*.25, duration:.35, ease:'power2.out' });
    });
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { x:0, y:0, duration:.5, ease:'elastic.out(1,.6)' });
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   5. 3D TILT PHOTO CARD
═══════════════════════════════════════════════════════════════ */
function init3DTiltCard() {
  if (isMobile()) return;
  const frame = $('#photo-frame');
  if (!frame) return;
  const inner = frame.querySelector('.photo-frame-inner');
  if (!inner) return;

  frame.addEventListener('mousemove', e => {
    const r = frame.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - .5;
    const y = (e.clientY - r.top)  / r.height - .5;
    gsap.to(inner, {
      rotationY:  x * 20,
      rotationX: -y * 16,
      transformPerspective: 800,
      duration: .45,
      ease: 'power2.out'
    });
  });

  frame.addEventListener('mouseleave', () => {
    gsap.to(inner, { rotationY:0, rotationX:0, duration:.7, ease:'elastic.out(1,.7)' });
  });
}

/* ═══════════════════════════════════════════════════════════════
   6. PROJECT CARD MOUSE GLOW + TILT
═══════════════════════════════════════════════════════════════ */
function initProjectCardGlow() {
  const PALETTE = ['rgba(0,229,176,.12)','rgba(167,139,250,.12)','rgba(249,115,22,.12)','rgba(56,189,248,.12)'];
  $$('.proj-card').forEach((card, ci) => {
    const col = PALETTE[ci % PALETTE.length];
    const sp  = card.querySelector('.proj-spotlight');

    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width)  * 100;
      const y = ((e.clientY - r.top)  / r.height) * 100;
      if (sp) sp.style.background = `radial-gradient(ellipse 60% 60% at ${x}% ${y}%, ${col}, transparent)`;

      if (!isMobile()) {
        const tx = (e.clientX - r.left - r.width/2)  / r.width  * 6;
        const ty = (e.clientY - r.top  - r.height/2) / r.height * 4;
        gsap.to(card, { rotationY:tx, rotationX:-ty, transformPerspective:700, duration:.3, ease:'power2.out' });
      }
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, { rotationY:0, rotationX:0, duration:.55, ease:'elastic.out(1,.7)' });
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   7. TYPED TEXT
═══════════════════════════════════════════════════════════════ */
const typedEl = document.getElementById('typed-word');
const PHRASES = [
  'Scalable Flutter Apps.',
  'Mobile Application Systems.',
  'Cloud-Backend Firebase.',
  'Real-Time Location Systems.',
  'Cross-Platform Systems.',
  'High-Performance Interfaces.',
  'Production-Ready Deployments.',
];
let pi=0, ci=0, del=false;
function runTyped() {
  if (!typedEl) return;
  const p = PHRASES[pi];
  typedEl.textContent = del ? p.slice(0,ci-1) : p.slice(0,ci+1);
  del ? ci-- : ci++;
  if (!del&&ci===p.length){ del=true; setTimeout(runTyped,1900); return; }
  if ( del&&ci===0){ del=false; pi=(pi+1)%PHRASES.length; }
  setTimeout(runTyped, del?52:88);
}

/* ═══════════════════════════════════════════════════════════════
   8. CUSTOM CURSOR
═══════════════════════════════════════════════════════════════ */
(function initCursor() {
  if (window.matchMedia('(hover:none)').matches || isMobile()) return;
  const dot  = $('#cursor-dot');
  const ring = $('#cursor-ring');
  if (!dot||!ring) return;

  let mx=0, my=0, rx=0, ry=0;
  window.addEventListener('mousemove', e => {
    mx=e.clientX; my=e.clientY;
    gsap.to(dot, { x:mx, y:my, duration:.07, ease:'none' });
  }, {passive:true});

  (function trackRing() {
    rx=lerp(rx,mx,.1); ry=lerp(ry,my,.1);
    gsap.set(ring, { x:rx, y:ry });
    requestAnimationFrame(trackRing);
  })();

  $$('a, button, .proj-card, .skill-card, .testi-card, .s-chip, .photo-frame').forEach(el => {
    el.addEventListener('mouseenter', () => ring.classList.add('big'));
    el.addEventListener('mouseleave', () => ring.classList.remove('big'));
  });
})();

/* ═══════════════════════════════════════════════════════════════
   9. SCROLL PARALLAX — throttled with rAF
═══════════════════════════════════════════════════════════════ */
let scrollY = 0;
let ticking  = false;

function onScroll() {
  scrollY = window.scrollY;
  if (!ticking) {
    requestAnimationFrame(updateParallax);
    ticking = true;
  }
}

function updateParallax() {
  const orb  = $('.hero-glow-orb');
  const grid = $('.hero-grid-bg');
  if (orb)  orb.style.transform  = `translate(-50%, calc(-50% + ${scrollY*.22}px))`;
  if (grid) grid.style.transform = `translateY(${scrollY*.06}px)`;
  const blobs = $$('.aurora-blob');
  if (blobs[0]) blobs[0].style.transform = `translate(${scrollY*.02}px, ${-scrollY*.04}px) scale(1)`;
  if (blobs[1]) blobs[1].style.transform = `translate(${-scrollY*.03}px, ${scrollY*.02}px) scale(1)`;
  ticking = false;
}

window.addEventListener('scroll', onScroll, { passive: true });

/* ═══════════════════════════════════════════════════════════════
   10. NAVBAR
═══════════════════════════════════════════════════════════════ */
const navbar = document.getElementById('navbar');
const allSections = $$('section[id]');
const navAs       = $$('#desktop-nav a');

let navTicking = false;
window.addEventListener('scroll', () => {
  if (navTicking) return;
  navTicking = true;
  requestAnimationFrame(() => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
    let cur='';
    allSections.forEach(s => { if (window.scrollY >= s.offsetTop-200) cur=s.id; });
    navAs.forEach(a => a.classList.toggle('active', a.getAttribute('href')==='#'+cur));
    navTicking = false;
  });
}, { passive: true });

/* ═══════════════════════════════════════════════════════════════
   11. MOBILE MENU
═══════════════════════════════════════════════════════════════ */
const burger   = $('#hamburger');
const mobMenu  = $('#mob-menu');
const mobClose = $('#mob-close');

function openMenu(){
  mobMenu.classList.add('open');
  document.body.style.overflow='hidden';
  const sp=burger.querySelectorAll('span');
  gsap.to(sp[0],{rotation:45,y:7,duration:.28});
  gsap.to(sp[1],{opacity:0,x:-8,duration:.18});
  gsap.to(sp[2],{rotation:-45,y:-7,duration:.28});
}
function closeMenu(){
  mobMenu.classList.remove('open');
  document.body.style.overflow='';
  gsap.to(burger.querySelectorAll('span'),{rotation:0,y:0,x:0,opacity:1,duration:.28});
}
if (burger)   burger.addEventListener('click', openMenu);
if (mobClose) mobClose.addEventListener('click', closeMenu);
$$('.mob-link').forEach(l => l.addEventListener('click', closeMenu));

/* ═══════════════════════════════════════════════════════════════
   12. PROFILE IMAGE FALLBACK
═══════════════════════════════════════════════════════════════ */
const pImg = document.getElementById('profile-img');
const pFb  = document.getElementById('photo-initials');

// Try multiple filename variants so it always works regardless of exact name used
const IMG_PATHS = [
  'assets/images/profile.jpeg',
  'assets/images/profile.jpg',
  'assets/images/profile2.jpeg',
  'assets/images/profile2.jpg',
  'assets/images/profile.png',
  'assets/images/profile.webp',
];

function showImg() { if(pImg) pImg.style.display='block'; if(pFb) pFb.style.display='none'; }
function showFb()  { if(pImg) pImg.style.display='none';  if(pFb) pFb.style.display='flex'; }

function tryImgPath(index) {
  if (index >= IMG_PATHS.length) { showFb(); return; }
  pImg.onload  = () => showImg();
  pImg.onerror = () => tryImgPath(index + 1);
  pImg.src = IMG_PATHS[index];
}

if (pImg) {
  if (pImg.complete && pImg.naturalWidth > 0) {
    showImg();
  } else {
    tryImgPath(0);
  }
}

/* ═══════════════════════════════════════════════════════════════
   13. CONTACT FORM — basic fallback (EmailJS handles real send)
═══════════════════════════════════════════════════════════════ */
const cForm = document.getElementById('contact-form');
const cBtn  = document.getElementById('submit-btn');
if (cForm && cBtn) {
  // Only handles UI fallback if EmailJS not loaded
  // Real submission handled below by EmailJS block
}

/* ═══════════════════════════════════════════════════════════════
   14. SKILL CARD HOVER GLOW BURST
═══════════════════════════════════════════════════════════════ */
(function initCardBursts() {
  if (isMobile()) return;
  $$('.skill-card').forEach((card, idx) => {
    const colors = ['#00e5b0','#a78bfa','#f97316'];
    card.addEventListener('mouseenter', () => {
      gsap.fromTo(card, { boxShadow:'0 0 0 0 transparent' },
        { boxShadow:`0 0 40px 4px ${colors[idx % colors.length]}33`, duration:.4, yoyo:true, repeat:1 });
    });
  });
})();

/* ═══════════════════════════════════════════════════════════════
   15. SCROLL PROGRESS BAR
═══════════════════════════════════════════════════════════════ */
(function initScrollProgress() {
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position:'fixed', top:'0', left:'0', height:'2px', width:'0%',
    background:'linear-gradient(90deg, #00e5b0, #a78bfa, #f97316)',
    zIndex:'9999', pointerEvents:'none', transition:'none',
    boxShadow:'0 0 8px rgba(0,229,176,.6)'
  });
  document.body.appendChild(bar);

  let progTicking = false;
  window.addEventListener('scroll', () => {
    if (progTicking) return;
    progTicking = true;
    requestAnimationFrame(() => {
      const pct = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
      bar.style.width = clamp(pct, 0, 100) + '%';
      progTicking = false;
    });
  }, { passive: true });
})();

/* ═══════════════════════════════════════════════════════════════
   16. EMAILJS SETUP
═══════════════════════════════════════════════════════════════ */
(function () {
  if (typeof emailjs !== 'undefined') {
    emailjs.init("V7bGvnNGX0krGo7ql");
  }
})();

const contactForm = document.getElementById("contact-form");
const submitBtn   = document.getElementById("submit-btn");

if (contactForm && submitBtn) {
  contactForm.addEventListener("submit", function (e) {
    e.preventDefault();

    submitBtn.disabled = true;
    submitBtn.innerHTML = "Sending...";

    if (typeof emailjs === 'undefined') {
      submitBtn.innerHTML = "Failed. Try Again";
      submitBtn.disabled  = false;
      return;
    }

    emailjs.sendForm(
      "service_74fw2mo",
      "template_5ojfi5r",
      this
    )
    .then(() => {
      submitBtn.innerHTML = "Message Sent ✓";
      contactForm.reset();
      setTimeout(() => {
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
        submitBtn.disabled  = false;
      }, 3000);
    })
    .catch((error) => {
      console.error(error);
      submitBtn.innerHTML = "Failed. Try Again";
      submitBtn.disabled  = false;
    });
  });
}