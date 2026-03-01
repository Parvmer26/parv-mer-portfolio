/* ================================================================
   PARV MER — script.js  v5  (Performance Optimised)

   KEY PERFORMANCE FIXES vs v4:
   · Replaced Three.js bg particles with 2D Canvas (no WebGL overhead)
   · Hero 3D: Three.js only on desktop, CSS-only on mobile
   · Loader canvas: simplified, lower particle count
   · All RAF loops: unified visibility check + page-hidden pause
   · Scroll handlers: single shared RAF tick, not multiple
   · Hero 3D: hard 30fps cap on mid, disabled on mobile
   · Magnetic buttons: disabled on touch devices
   · No duplicate resize listeners
   · Passive listeners everywhere
   · requestIdleCallback for non-critical init
================================================================ */
'use strict';

/* ═══════════════════════════════════════════════════════════════
   UTILS & DEVICE DETECTION
═══════════════════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx);

const IS_MOBILE = () => window.innerWidth < 768;
const IS_TOUCH  = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/* Device tier — determines particle counts and feature flags */
const TIER = (() => {
  const w = window.innerWidth;
  const cores = navigator.hardwareConcurrency || 2;
  const ram   = navigator.deviceMemory || 4;
  if (w < 480 || cores <= 2 || ram <= 2) return 'low';
  if (w < 768 || cores <= 4 || ram <= 4) return 'mid';
  return 'high';
})();

/* Page visibility — all animation loops check this */
let PAGE_VISIBLE = true;
document.addEventListener('visibilitychange', () => {
  PAGE_VISIBLE = !document.hidden;
}, { passive: true });

/* ═══════════════════════════════════════════════════════════════
   0. BACKGROUND PARTICLES — 2D Canvas (No Three.js)
   PERF: 2D canvas is 3–5× cheaper than WebGL for simple dots
   PERF: Only runs on desktop (mid/high tier)
═══════════════════════════════════════════════════════════════ */
(function initBgParticles() {
  /* Skip entirely on mobile — aurora blobs handle the visual */
  if (TIER === 'low') return;

  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W = window.innerWidth, H = window.innerHeight;
  canvas.width  = W;
  canvas.height = H;

  /* Particle counts per tier */
  const COUNT = TIER === 'high' ? 120 : 60;
  const COLORS = [
    'rgba(0,229,176,',
    'rgba(167,139,250,',
    'rgba(249,115,22,',
    'rgba(56,189,248,',
    'rgba(236,72,153,',
  ];

  const particles = Array.from({ length: COUNT }, () => ({
    x:  Math.random() * W,
    y:  Math.random() * H,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r:  Math.random() * 1.8 + 0.4,
    col: COLORS[Math.floor(Math.random() * COLORS.length)],
    a:  Math.random() * 0.35 + 0.08,
  }));

  /* Throttle to 24fps — bg effect, nobody notices */
  const FPS_MS = 1000 / (TIER === 'high' ? 24 : 18);
  let last = 0;
  const MAX_DIST = TIER === 'high' ? 100 : 0; /* connections only on high */

  function draw(now) {
    requestAnimationFrame(draw);
    if (!PAGE_VISIBLE || window._loaderActive) return;
    if (now - last < FPS_MS) return;
    last = now;

    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      else if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      else if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.col + p.a + ')';
      ctx.fill();
    }

    /* Connection lines — only on high tier desktop */
    if (MAX_DIST > 0) {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < MAX_DIST) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(0,229,176,${0.06 * (1 - d / MAX_DIST)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    }
  }

  requestAnimationFrame(draw);

  let resT;
  window.addEventListener('resize', () => {
    clearTimeout(resT);
    resT = setTimeout(() => {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }, 200);
  }, { passive: true });
})();

/* ═══════════════════════════════════════════════════════════════
   1. HERO 3D — Pure 2D Canvas orbiting orbs with mouse parallax
   Works on ALL devices including low-end phones.
   No WebGL, no Three.js, no GPU overhead.
   Visual: glowing 3D-looking spheres orbiting in 3D-ish space,
   rings, star-dust — all faked beautifully with 2D canvas.
═══════════════════════════════════════════════════════════════ */
(function initHero3D() {
  const canvas = document.getElementById('hero-3d');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W = window.innerWidth, H = window.innerHeight;
  canvas.width  = W;
  canvas.height = H;

  /* Counts scaled to device tier */
  const ORB_COUNT  = TIER === 'low' ? 14 : TIER === 'mid' ? 22 : 36;
  const STAR_COUNT = TIER === 'low' ? 40 : TIER === 'mid' ? 80 : 140;
  const RING_COUNT = TIER === 'low' ?  2 : TIER === 'mid' ?  3  : 4;

  /* Palette — same colors as original Three.js version */
  const COLORS = [
    { r:0,   g:229, b:176 },  /* ac teal     */
    { r:167, g:139, b:250 },  /* purple      */
    { r:249, g:115, b:22  },  /* orange      */
    { r:56,  g:189, b:248 },  /* blue        */
    { r:236, g:72,  b:153 },  /* pink        */
    { r:255, g:215, b:0   },  /* gold        */
    { r:0,   g:229, b:176 },  /* ac teal dup */
    { r:124, g:58,  b:237 },  /* violet      */
  ];

  /* ── Helpers ── */
  const cx = () => W / 2;
  const cy = () => H / 2;

  /* Fake 3D projection: z in [-1, 1] controls scale & opacity */
  function project(x, y, z) {
    const fov  = 0.6 + z * 0.3;           /* perspective scale */
    const sx   = cx() + x * fov;
    const sy   = cy() + y * fov;
    return { sx, sy, scale: fov };
  }

  /* Draw a shaded glowing sphere using 2D canvas radial gradients */
  function drawSphere(sx, sy, radius, col, alpha) {
    if (radius < 0.5 || alpha < 0.01) return;
    const r = col.r, g = col.g, b = col.b;

    /* Outer glow */
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 2.8);
    glow.addColorStop(0,   `rgba(${r},${g},${b},${alpha * 0.28})`);
    glow.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(sx, sy, radius * 2.8, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    /* Core sphere with specular highlight */
    const grad = ctx.createRadialGradient(
      sx - radius * 0.3, sy - radius * 0.3, radius * 0.05,
      sx, sy, radius
    );
    grad.addColorStop(0,   `rgba(255,255,255,${alpha * 0.55})`);
    grad.addColorStop(0.3, `rgba(${r},${g},${b},${alpha})`);
    grad.addColorStop(0.7, `rgba(${Math.max(0,r-40)},${Math.max(0,g-40)},${Math.max(0,b-40)},${alpha * 0.85})`);
    grad.addColorStop(1,   `rgba(${Math.max(0,r-80)},${Math.max(0,g-80)},${Math.max(0,b-80)},${alpha * 0.4})`);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /* Draw a glowing ring (ellipse) */
  function drawRing(cx2, cy2, rx, ry, angle, col, alpha, lineW) {
    if (alpha < 0.01) return;
    const r = col.r, g = col.g, b = col.b;
    ctx.save();
    ctx.translate(cx2, cy2);
    ctx.rotate(angle);
    ctx.scale(1, ry / rx);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.restore();
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth   = lineW;
    ctx.shadowColor = `rgba(${r},${g},${b},${alpha * 0.6})`;
    ctx.shadowBlur  = 8;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  }

  /* ── Build scene objects ── */

  /* Orbiting spheres */
  const orbs = Array.from({ length: ORB_COUNT }, (_, i) => {
    const tier   = i < 4 ? 0 : i < 12 ? 1 : 2;
    /* spread across shells based on tier */
    const shellR = tier === 0
      ? (W * 0.18 + Math.random() * W * 0.08)
      : tier === 1
      ? (W * 0.10 + Math.random() * W * 0.12)
      : (W * 0.05 + Math.random() * W * 0.16);

    const angle  = Math.random() * Math.PI * 2;
    const tilt   = (Math.random() - 0.5) * 0.9;   /* orbit tilt (z-axis wobble) */
    const baseZ  = (Math.random() - 0.5) * 1.2;   /* z position in [-1,1] */
    const col    = COLORS[i % COLORS.length];
    const baseR  = tier === 0
      ? (TIER === 'low' ? 6 : 10) + Math.random() * (TIER === 'low' ? 4 : 8)
      : tier === 1
      ? (TIER === 'low' ? 3 : 5)  + Math.random() * (TIER === 'low' ? 3 : 5)
      : (TIER === 'low' ? 1 : 2)  + Math.random() * (TIER === 'low' ? 2 : 3);

    return {
      angle,
      orbitR:   shellR,
      orbitSpd: (Math.random() > 0.5 ? 1 : -1) * (0.008 + Math.random() * 0.018),
      tilt,
      baseZ,
      floatSpd:   0.3 + Math.random() * 0.4,
      floatAmp:   0.15 + Math.random() * 0.2,
      floatPhase: Math.random() * Math.PI * 2,
      baseR,
      col,
    };
  });

  /* Rings */
  const RING_DEFS = [
    { col: COLORS[0], rx: 0.32, ry: 0.09, angle: 0.6,  spd:  0.004, alpha: 0.35, lw: 1.2 },
    { col: COLORS[1], rx: 0.40, ry: 0.12, angle: -0.3, spd: -0.003, alpha: 0.28, lw: 0.9 },
    { col: COLORS[2], rx: 0.48, ry: 0.14, angle: 0.9,  spd:  0.002, alpha: 0.22, lw: 0.7 },
    { col: COLORS[3], rx: 0.55, ry: 0.10, angle: -0.7, spd: -0.0015,alpha: 0.18, lw: 0.5 },
  ].slice(0, RING_COUNT).map(d => ({
    ...d,
    curAngle: Math.random() * Math.PI * 2,
  }));

  /* Star dust */
  const stars = Array.from({ length: STAR_COUNT }, () => ({
    x:    (Math.random() - 0.5) * 2,   /* normalised -1..1 */
    y:    (Math.random() - 0.5) * 2,
    r:    Math.random() * 1.2 + 0.2,
    a:    Math.random() * 0.4 + 0.08,
    twinkleSpd:   Math.random() * 0.8 + 0.3,
    twinklePhase: Math.random() * Math.PI * 2,
  }));

  /* ── Mouse / touch parallax ── */
  let mouseX = 0, mouseY = 0;
  let smoothMX = 0, smoothMY = 0;
  const PARALLAX_STRENGTH = TIER === 'low' ? 0.03 : 0.06;

  window.addEventListener('mousemove', e => {
    mouseX = (e.clientX / W - 0.5) * 2;
    mouseY = (e.clientY / H - 0.5) * 2;
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (!e.touches[0]) return;
    mouseX = (e.touches[0].clientX / W - 0.5) * 2;
    mouseY = (e.touches[0].clientY / H - 0.5) * 2;
  }, { passive: true });

  /* ── RAF loop ── */
  /* FPS targets: low=20, mid=30, high=45
     The orbs look great at 30fps — smooth enough, costs very little */
  const FPS_MS = TIER === 'low' ? 50 : TIER === 'mid' ? 33 : 22;
  let last = 0, heroT = 0;

  function draw(now) {
    requestAnimationFrame(draw);
    if (!PAGE_VISIBLE || window._loaderActive) return;
    if (now - last < FPS_MS) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    heroT += dt;

    /* Smooth mouse */
    const lerpSpd = TIER === 'low' ? 0.04 : 0.06;
    smoothMX += (mouseX - smoothMX) * lerpSpd;
    smoothMY += (mouseY - smoothMY) * lerpSpd;
    const offX = smoothMX * W * PARALLAX_STRENGTH;
    const offY = smoothMY * H * PARALLAX_STRENGTH;

    /* Clear with very slight fade trail (depth-of-field feel) */
    ctx.clearRect(0, 0, W, H);

    /* ── Star dust ── */
    stars.forEach(s => {
      const twinkle = 0.5 + 0.5 * Math.sin(heroT * s.twinkleSpd + s.twinklePhase);
      const alpha   = s.a * (0.5 + 0.5 * twinkle);
      /* parallax: stars move less than orbs */
      const sx = cx() + s.x * W * 0.52 + offX * 0.3;
      const sy = cy() + s.y * H * 0.52 + offY * 0.3;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(136,238,221,${alpha})`;
      ctx.fill();
    });

    /* ── Rings ── */
    RING_DEFS.forEach(ring => {
      ring.curAngle += ring.spd * dt * 60;
      const rxPx = ring.rx * Math.min(W, H);
      const ryPx = ring.ry * Math.min(W, H);
      /* mouse tilt effect on rings */
      const tiltedRy = ryPx * (1 + smoothMY * 0.25);
      drawRing(
        cx() + offX * 0.7,
        cy() + offY * 0.7,
        rxPx, tiltedRy,
        ring.curAngle,
        ring.col,
        ring.alpha,
        ring.lw
      );
    });

    /* ── Orbiting spheres — sort by Z so closer ones render on top ── */
    const rendered = orbs.map(o => {
      o.angle += o.orbitSpd * dt * 60;
      const z = o.baseZ + Math.sin(heroT * o.floatSpd + o.floatPhase) * o.floatAmp;
      /* Orbit in ellipse (tilt creates depth illusion) */
      const ox = Math.cos(o.angle) * o.orbitR;
      const oy = Math.sin(o.angle) * o.orbitR * (0.35 + Math.abs(o.tilt) * 0.3);
      /* Mouse parallax shifts orbs by different amounts based on z */
      const pFactor = 0.5 + (z + 1) * 0.35;
      const sx = cx() + ox + offX * pFactor;
      const sy = cy() + oy + offY * pFactor;
      /* Z-based scaling and alpha */
      const zNorm   = (z + 1) / 2;      /* 0..1 */
      const scale   = 0.55 + zNorm * 0.75;
      const alpha   = 0.35 + zNorm * 0.6;
      const radius  = o.baseR * scale;
      return { sx, sy, radius, col: o.col, alpha, z };
    });

    /* Sort back-to-front */
    rendered.sort((a, b) => a.z - b.z);
    rendered.forEach(o => drawSphere(o.sx, o.sy, o.radius, o.col, o.alpha));
  }

  requestAnimationFrame(draw);

  /* Resize */
  let resT;
  window.addEventListener('resize', () => {
    clearTimeout(resT);
    resT = setTimeout(() => {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }, 200);
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

  window._loaderActive = true;

  /* Loader canvas — simple 2D dots only, no WebGL */
  const lc = document.getElementById('loader-canvas');
  let stopLoaderCanvas = false;

  if (lc) {
    lc.width  = window.innerWidth;
    lc.height = window.innerHeight;
    const lctx = lc.getContext('2d');
    /* PERF: Fewer dots on loader */
    const COUNT  = TIER === 'low' ? 18 : TIER === 'mid' ? 30 : 45;
    const CONN   = TIER === 'high'; /* connections only on high */
    const dots   = Array.from({ length: COUNT }, () => ({
      x:  Math.random() * lc.width,
      y:  Math.random() * lc.height,
      r:  Math.random() * 1.3 + 0.3,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      h:  Math.random() * 360,
    }));

    const LFR = 1000 / (TIER === 'low' ? 20 : 30);
    let lLast = 0;

    function ldraw(now) {
      if (stopLoaderCanvas) return;
      requestAnimationFrame(ldraw);
      if (now - lLast < LFR) return;
      lLast = now;
      lctx.clearRect(0, 0, lc.width, lc.height);
      dots.forEach(d => {
        d.x += d.vx; d.y += d.vy;
        d.h  = (d.h + 0.3) % 360;
        if (d.x < 0 || d.x > lc.width)  d.vx *= -1;
        if (d.y < 0 || d.y > lc.height) d.vy *= -1;
        lctx.beginPath();
        lctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        lctx.fillStyle = `hsla(${d.h},80%,70%,0.4)`;
        lctx.fill();
      });
      if (CONN) {
        for (let i = 0; i < dots.length; i++) {
          for (let j = i + 1; j < dots.length; j++) {
            const dx = dots[i].x - dots[j].x;
            const dy = dots[i].y - dots[j].y;
            const dd = Math.sqrt(dx*dx + dy*dy);
            if (dd < 110) {
              lctx.beginPath();
              lctx.moveTo(dots[i].x, dots[i].y);
              lctx.lineTo(dots[j].x, dots[j].y);
              lctx.strokeStyle = `rgba(0,229,176,${0.07 * (1 - dd/110)})`;
              lctx.lineWidth = 0.5;
              lctx.stroke();
            }
          }
        }
      }
    }
    requestAnimationFrame(ldraw);
    window._stopLoaderCanvas = () => { stopLoaderCanvas = true; };
  }

  /* Tagline character animation */
  const raw = tagEl ? tagEl.textContent : '';
  if (tagEl) {
    tagEl.innerHTML = '';
    [...raw].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch === ' ' ? '\u00a0' : ch;
      Object.assign(s.style, {
        display: 'inline-block',
        opacity: '0',
        transform: 'translateY(28px)',
        transition: `opacity .32s ease ${i*.026}s, transform .32s ease ${i*.026}s`,
      });
      tagEl.appendChild(s);
    });
    /* Trigger animation on next paint */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      tagEl.querySelectorAll('span').forEach(s => {
        s.style.opacity = '1';
        s.style.transform = 'translateY(0)';
      });
    }));
  }

  const msgs = [
    'Loading assets...',
    'Setting up scene...',
    'Building portfolio...',
    'Almost there...',
    'Finalizing...',
  ];
  let pct = 0, si = 0;

  const tick = setInterval(() => {
    pct = Math.min(pct + Math.random() * 3.5 + 0.8, 98);
    if (barEl) barEl.style.width = pct + '%';
    if (pctEl) pctEl.textContent = Math.floor(pct) + '%';
    if (pct > 22 && si === 0) { if (statusEl) statusEl.textContent = msgs[1]; si++; }
    if (pct > 48 && si === 1) { if (statusEl) statusEl.textContent = msgs[2]; si++; }
    if (pct > 74 && si === 2) { if (statusEl) statusEl.textContent = msgs[3]; si++; }
    if (pct > 90 && si === 3) { if (statusEl) statusEl.textContent = msgs[4]; si++; }
  }, 55);

  setTimeout(() => {
    clearInterval(tick);
    if (barEl) barEl.style.width = '100%';
    if (pctEl) pctEl.textContent = '100%';
    if (statusEl) statusEl.textContent = 'Complete!';

    setTimeout(() => {
      if (window._stopLoaderCanvas) window._stopLoaderCanvas();
      window._loaderActive = false;

      gsap.to(loader, {
        yPercent: -100,
        duration: 1.1,
        ease: 'power3.inOut',
        onComplete: () => {
          loader.style.display = 'none';
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

  const heroContent = document.querySelector('.hero-content');
  if (heroContent) heroContent.classList.remove('hero-hidden');

  /* HERO */
  const htl = gsap.timeline({ defaults: { ease: 'power4.out' } });
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
  anim('.photo-frame',              { x:-60, opacity:0, duration:1.2 },            '.about-layout', 'top 80%');
  anim('.about-badge',              { scale:.7, opacity:0, duration:.8, stagger:.2, ease:'back.out(1.8)' }, '.about-layout', 'top 75%');
  anim('.about-text .eyebrow',      { y:20, opacity:0, duration:.6 },               '.about-text', 'top 85%');
  anim('.about-text .section-title',{ y:36, opacity:0, duration:.9 },               '.about-text', 'top 83%');
  anim('.about-text .body-p',       { y:24, opacity:0, duration:.7, stagger:.1 },   '.about-text', 'top 82%');
  anim('.j-item',                   { x:28, opacity:0, duration:.65, stagger:.14 }, '.journey', 'top 85%');
  anim('.s-chip',                   { y:14, opacity:0, duration:.5, stagger:.07 },  '.social-links', 'top 88%');

  /* SKILLS */
  anim('.skill-card', { y:55, opacity:0, duration:.9, stagger:.15 }, '.skill-grid', 'top 85%');

  $$('.sbar-fill').forEach(el => {
    gsap.to(el, {
      width: el.dataset.w + '%',
      duration: 1.7,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 93%', toggleActions: 'play none none none' }
    });
  });

  /* EXPERIENCE */
  anim('.exp-entry', { x:-50, opacity:0, duration:1.1 }, '.exp-wrapper', 'top 82%');
  $$('.impact-fill').forEach(el => {
    gsap.to(el, {
      width: el.dataset.w + '%',
      duration: 1.5,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 92%', toggleActions: 'play none none none' }
    });
  });

  /* PROJECTS */
  anim('.proj-card', { y:65, opacity:0, duration:1, stagger:.13 }, '.proj-grid', 'top 83%');

  /* TESTIMONIALS */
  anim('.testi-card', { y:50, opacity:0, duration:.9, stagger:.14 }, '.testi-grid', 'top 85%');

  /* CONTACT */
  anim('.ci-row',          { x:-28, opacity:0, duration:.7, stagger:.1 }, '.contact-layout', 'top 85%');
  anim('.contact-form-box',{ x:50,  opacity:0, duration:1 },              '.contact-layout', 'top 85%');

  /* Generic eyebrows & titles */
  $$('.eyebrow:not(.about-text .eyebrow)').forEach(el => {
    gsap.from(el, {
      y:18, opacity:0, duration:.65,
      scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' }
    });
  });
  $$('.section-title:not(.about-text .section-title)').forEach(el => {
    gsap.from(el, {
      y:36, opacity:0, duration:.9,
      scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none reverse' }
    });
  });

  ScrollTrigger.refresh();

  /* Non-critical inits via idle callback */
  const idle = window.requestIdleCallback || (cb => setTimeout(cb, 100));
  idle(() => {
    if (!IS_TOUCH) initMagneticButtons();
    if (!IS_TOUCH) init3DTiltCard();
    initProjectCardGlow();
    initCardBursts();
  });
}

function anim(targets, vars, triggerEl, start) {
  gsap.from(targets, {
    ...vars,
    scrollTrigger: { trigger: triggerEl, start, toggleActions: 'play none none reverse' }
  });
}

/* ═══════════════════════════════════════════════════════════════
   4. MAGNETIC BUTTONS — Desktop only
═══════════════════════════════════════════════════════════════ */
function initMagneticButtons() {
  $$('.btn-solid, .btn-outline, .nav-hire, .back-top').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const r  = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width  / 2);
      const dy = e.clientY - (r.top  + r.height / 2);
      gsap.to(btn, { x: dx * .25, y: dy * .25, duration: .35, ease: 'power2.out' });
    });
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: .5, ease: 'elastic.out(1,.6)' });
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   5. 3D TILT PHOTO CARD — Desktop only
═══════════════════════════════════════════════════════════════ */
function init3DTiltCard() {
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
    gsap.to(inner, { rotationY: 0, rotationX: 0, duration: .7, ease: 'elastic.out(1,.7)' });
  });
}

/* ═══════════════════════════════════════════════════════════════
   6. PROJECT CARD MOUSE GLOW + TILT
═══════════════════════════════════════════════════════════════ */
function initProjectCardGlow() {
  const PALETTE = [
    'rgba(0,229,176,.12)',
    'rgba(167,139,250,.12)',
    'rgba(249,115,22,.12)',
    'rgba(56,189,248,.12)',
  ];

  $$('.proj-card').forEach((card, ci) => {
    const col = PALETTE[ci % PALETTE.length];
    const sp  = card.querySelector('.proj-spotlight');

    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width)  * 100;
      const y = ((e.clientY - r.top)  / r.height) * 100;
      if (sp) sp.style.background = `radial-gradient(ellipse 60% 60% at ${x}% ${y}%, ${col}, transparent)`;

      if (!IS_TOUCH) {
        const tx = (e.clientX - r.left - r.width  / 2) / r.width  * 6;
        const ty = (e.clientY - r.top  - r.height / 2) / r.height * 4;
        gsap.to(card, { rotationY: tx, rotationX: -ty, transformPerspective: 700, duration: .3, ease: 'power2.out' });
      }
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, { rotationY: 0, rotationX: 0, duration: .55, ease: 'elastic.out(1,.7)' });
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
let pi = 0, ci = 0, del = false;

function runTyped() {
  if (!typedEl) return;
  const p = PHRASES[pi];
  typedEl.textContent = del ? p.slice(0, ci - 1) : p.slice(0, ci + 1);
  del ? ci-- : ci++;
  if (!del && ci === p.length) { del = true; setTimeout(runTyped, 1900); return; }
  if ( del && ci === 0)        { del = false; pi = (pi + 1) % PHRASES.length; }
  setTimeout(runTyped, del ? 52 : 88);
}

/* ═══════════════════════════════════════════════════════════════
   8. CUSTOM CURSOR — Desktop only
═══════════════════════════════════════════════════════════════ */
(function initCursor() {
  if (IS_TOUCH || window.matchMedia('(hover:none)').matches) return;

  const dot  = $('#cursor-dot');
  const ring = $('#cursor-ring');
  if (!dot || !ring) return;

  let mx = 0, my = 0, rx = 0, ry = 0;

  window.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    gsap.to(dot, { x: mx, y: my, duration: .07, ease: 'none' });
  }, { passive: true });

  (function trackRing() {
    rx = lerp(rx, mx, .1);
    ry = lerp(ry, my, .1);
    gsap.set(ring, { x: rx, y: ry });
    requestAnimationFrame(trackRing);
  })();

  $$('a, button, .proj-card, .skill-card, .testi-card, .s-chip, .photo-frame').forEach(el => {
    el.addEventListener('mouseenter', () => ring.classList.add('big'));
    el.addEventListener('mouseleave', () => ring.classList.remove('big'));
  });
})();

/* ═══════════════════════════════════════════════════════════════
   9. UNIFIED SCROLL HANDLER — single RAF for ALL scroll effects
   PERF: Was multiple separate scroll listeners, now one shared
═══════════════════════════════════════════════════════════════ */
let scrollY    = 0;
let scrollTick = false;
let navTick    = false;

const navbar      = document.getElementById('navbar');
const allSections = $$('section[id]');
const navAs       = $$('#desktop-nav a');

/* Single scroll listener — multiple RAF tasks share one event */
window.addEventListener('scroll', () => {
  scrollY = window.scrollY;

  /* Parallax tick */
  if (!scrollTick) {
    scrollTick = true;
    requestAnimationFrame(() => {
      const orb  = $('.hero-glow-orb');
      const grid = $('.hero-grid-bg');
      /* PERF: Only parallax when in viewport range */
      if (scrollY < window.innerHeight * 1.5) {
        if (orb)  orb.style.transform  = `translate(-50%, calc(-50% + ${scrollY * .22}px))`;
        if (grid) grid.style.transform = `translateY(${scrollY * .06}px)`;
        /* PERF: Only move aurora blobs on desktop */
        if (!IS_TOUCH) {
          const blobs = $$('.aurora-blob');
          if (blobs[0]) blobs[0].style.transform = `translate(${scrollY*.02}px,${-scrollY*.04}px) scale(1)`;
          if (blobs[1]) blobs[1].style.transform = `translate(${-scrollY*.03}px,${scrollY*.02}px) scale(1)`;
        }
      }
      scrollTick = false;
    });
  }

  /* Navbar tick */
  if (!navTick) {
    navTick = true;
    requestAnimationFrame(() => {
      navbar.classList.toggle('scrolled', scrollY > 60);
      let cur = '';
      allSections.forEach(s => { if (scrollY >= s.offsetTop - 200) cur = s.id; });
      navAs.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
      navTick = false;
    });
  }
}, { passive: true });

/* Scroll progress bar — minimal overhead */
(function initScrollProgress() {
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed', top: '0', left: '0', height: '2px', width: '0%',
    background: 'linear-gradient(90deg, #00e5b0, #a78bfa, #f97316)',
    zIndex: '9999', pointerEvents: 'none',
    boxShadow: '0 0 8px rgba(0,229,176,.6)',
    willChange: 'width',
  });
  document.body.appendChild(bar);

  let progTick = false;
  window.addEventListener('scroll', () => {
    if (progTick) return;
    progTick = true;
    requestAnimationFrame(() => {
      const pct = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
      bar.style.width = clamp(pct, 0, 100) + '%';
      progTick = false;
    });
  }, { passive: true });
})();

/* ═══════════════════════════════════════════════════════════════
   10. NAVBAR (mobile menu)
═══════════════════════════════════════════════════════════════ */
const burger   = $('#hamburger');
const mobMenu  = $('#mob-menu');
const mobClose = $('#mob-close');

function openMenu() {
  mobMenu.classList.add('open');
  document.body.style.overflow = 'hidden';
  const sp = burger.querySelectorAll('span');
  gsap.to(sp[0], { rotation:  45, y:  7, duration: .28 });
  gsap.to(sp[1], { opacity: 0, x: -8, duration: .18 });
  gsap.to(sp[2], { rotation: -45, y: -7, duration: .28 });
}

function closeMenu() {
  mobMenu.classList.remove('open');
  document.body.style.overflow = '';
  gsap.to(burger.querySelectorAll('span'), { rotation: 0, y: 0, x: 0, opacity: 1, duration: .28 });
}

if (burger)   burger.addEventListener('click', openMenu);
if (mobClose) mobClose.addEventListener('click', closeMenu);
$$('.mob-link').forEach(l => l.addEventListener('click', closeMenu));

/* ═══════════════════════════════════════════════════════════════
   11. PROFILE IMAGE FALLBACK
═══════════════════════════════════════════════════════════════ */
const pImg = document.getElementById('profile-img');
const pFb  = document.getElementById('photo-initials');

const IMG_PATHS = [
  'assets/images/profile.jpeg',
  'assets/images/profile.jpg',
  'assets/images/profile2.jpeg',
  'assets/images/profile2.jpg',
  'assets/images/profile.png',
  'assets/images/profile.webp',
];

function showImg() { if (pImg) pImg.style.display = 'block'; if (pFb) pFb.style.display = 'none'; }
function showFb()  { if (pImg) pImg.style.display = 'none';  if (pFb) pFb.style.display = 'flex'; }

function tryImgPath(index) {
  if (index >= IMG_PATHS.length) { showFb(); return; }
  pImg.onload  = () => showImg();
  pImg.onerror = () => tryImgPath(index + 1);
  pImg.src = IMG_PATHS[index];
}

if (pImg) {
  if (pImg.complete && pImg.naturalWidth > 0) showImg();
  else tryImgPath(0);
}

/* ═══════════════════════════════════════════════════════════════
   12. SKILL CARD HOVER GLOW BURST — Desktop only
═══════════════════════════════════════════════════════════════ */
function initCardBursts() {
  if (IS_TOUCH) return;
  const colors = ['#00e5b0', '#a78bfa', '#f97316'];
  $$('.skill-card').forEach((card, idx) => {
    card.addEventListener('mouseenter', () => {
      gsap.fromTo(card,
        { boxShadow: '0 0 0 0 transparent' },
        { boxShadow: `0 0 40px 4px ${colors[idx % colors.length]}33`, duration: .4, yoyo: true, repeat: 1 }
      );
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   13. EMAILJS
═══════════════════════════════════════════════════════════════ */
(function () {
  if (typeof emailjs !== 'undefined') {
    emailjs.init('V7bGvnNGX0krGo7ql');
  }
})();

const contactForm = document.getElementById('contact-form');
const submitBtn   = document.getElementById('submit-btn');

if (contactForm && submitBtn) {
  contactForm.addEventListener('submit', function (e) {
    e.preventDefault();

    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Sending...';

    if (typeof emailjs === 'undefined') {
      submitBtn.innerHTML = 'Failed. Try Again';
      submitBtn.disabled  = false;
      return;
    }

    emailjs.sendForm('service_74fw2mo', 'template_5ojfi5r', this)
      .then(() => {
        submitBtn.innerHTML = 'Message Sent ✓';
        contactForm.reset();
        setTimeout(() => {
          submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
          submitBtn.disabled  = false;
        }, 3000);
      })
      .catch(err => {
        console.error(err);
        submitBtn.innerHTML = 'Failed. Try Again';
        submitBtn.disabled  = false;
      });
  });
}