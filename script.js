/* ============================================================
   SOPHIA & MARK WEDDING WEBSITE — script.js
   ============================================================ */

'use strict';

/* --- LOCK HERO HEIGHT to initial viewport (prevents resize/scroll-bar shifts) --- */
(function lockHeroHeight() {
  const vh = window.innerHeight;
  document.documentElement.style.setProperty('--hero-vh', vh + 'px');
})();

/* --- NAV: scroll styling + mobile toggle --- */
(function initNav() {
  const nav    = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');
  const links  = document.getElementById('navLinks');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
    links.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => links.classList.remove('open'))
    );
    document.addEventListener('click', e => {
      if (!nav.contains(e.target)) links.classList.remove('open');
    });
  }
})();


/* --- CAROUSEL: loads from pics/manifest.json --- */
(async function initCarousel() {
  const track  = document.getElementById('carouselTrack');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const dotsEl  = document.getElementById('carouselDots');

  if (!track) return;

  // ── 1. Load manifest ──────────────────────────────────────
  let files = [];
  try {
    const res = await fetch('pics/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    files = data.files || [];
  } catch (e) {
    console.warn('Carousel: could not load pics/manifest.json —', e.message);
    return;
  }
  if (!files.length) return;

  // ── 2. Build slides ───────────────────────────────────────
  const VIDEO_EXTS = new Set(['mp4', 'webm']);

  files.forEach((filename, i) => {
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';

    const ext = filename.split('.').pop().toLowerCase();
    const src = `pics/${encodeURIComponent(filename)}`;

    if (VIDEO_EXTS.has(ext)) {
      const v = document.createElement('video');
      v.dataset.src = src;
      v.muted = true;
      v.loop  = true;
      v.playsInline = true;
      v.preload = 'none';
      slide.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.dataset.src = src;
      img.alt = 'Sophia and Mark';
      slide.appendChild(img);
    }

    track.appendChild(slide);
  });

  // ── 3. Build dots ─────────────────────────────────────────
  if (dotsEl) {
    files.forEach((_, i) => {
      const btn = document.createElement('button');
      btn.className = 'dot' + (i === 0 ? ' active' : '');
      btn.dataset.index = i;
      btn.setAttribute('aria-label', `Photo ${i + 1}`);
      dotsEl.appendChild(btn);
    });
  }

  // ── 4. Carousel logic ─────────────────────────────────────
  const slides = track.querySelectorAll('.carousel-slide');
  const dots   = dotsEl ? dotsEl.querySelectorAll('.dot') : [];
  const total  = slides.length;
  let current  = 0;
  let startX   = null;

  function loadSlide(i) {
    const slide = slides[(i + total) % total];
    const el = slide.querySelector('img, video');
    if (el && el.dataset.src) {
      el.src = el.dataset.src;
      delete el.dataset.src;
    }
  }

  function goTo(index) {
    current = (index + total) % total;

    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === current));

    // Load current + neighbours
    loadSlide(current);
    loadSlide(current + 1);
    loadSlide(current - 1);

    // Play active video, pause others
    slides.forEach((slide, i) => {
      const video = slide.querySelector('video');
      if (!video) return;
      if (i === current) video.play().catch(() => {});
      else { video.pause(); video.currentTime = 0; }
    });
  }

  prevBtn && prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn && nextBtn.addEventListener('click', () => goTo(current + 1));
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  goTo(current - 1);
    if (e.key === 'ArrowRight') goTo(current + 1);
  });

  // Touch / swipe
  const win = track.closest('.carousel-window');
  if (win) {
    win.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
    }, { passive: true });
    win.addEventListener('touchend', e => {
      if (startX === null) return;
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) goTo(diff > 0 ? current + 1 : current - 1);
      startX = null;
    }, { passive: true });
  }

  goTo(0);

  // ── 5. Lightbox ───────────────────────────────────────────────
  const lb = document.createElement('div');
  lb.id = 'carouselLightbox';
  lb.innerHTML = `
    <button class="lb-close" aria-label="Close">&times;</button>
    <button class="lb-prev" aria-label="Previous">&#8249;</button>
    <img class="lb-img" src="" alt="Sophia and Mark">
    <button class="lb-next" aria-label="Next">&#8250;</button>
  `;
  document.body.appendChild(lb);

  const lbImg  = lb.querySelector('.lb-img');
  let lbIdx    = 0;
  let lbStartX = null;

  function lbOpen(i) {
    lbIdx = i;
    lbImg.src = `pics/${encodeURIComponent(files[lbIdx])}`;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function lbClose() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
  }
  function lbGo(i) {
    lbIdx = (i + files.length) % files.length;
    lbImg.src = `pics/${encodeURIComponent(files[lbIdx])}`;
  }

  slides.forEach((slide, i) => {
    const img = slide.querySelector('img');
    if (!img) return;
    let tapX = 0, tapY = 0;
    img.addEventListener('touchstart', e => {
      tapX = e.touches[0].clientX;
      tapY = e.touches[0].clientY;
    }, { passive: true });
    img.addEventListener('touchend', e => {
      const dx = Math.abs(e.changedTouches[0].clientX - tapX);
      const dy = Math.abs(e.changedTouches[0].clientY - tapY);
      if (dx < 10 && dy < 10) lbOpen(i);
    });
    img.addEventListener('click', () => lbOpen(i));
  });

  lb.querySelector('.lb-close').addEventListener('click', lbClose);
  lb.querySelector('.lb-prev').addEventListener('click', () => lbGo(lbIdx - 1));
  lb.querySelector('.lb-next').addEventListener('click', () => lbGo(lbIdx + 1));
  lb.addEventListener('click', e => { if (e.target === lb) lbClose(); });

  lb.addEventListener('touchstart', e => { lbStartX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (lbStartX === null) return;
    const diff = lbStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) lbGo(diff > 0 ? lbIdx + 1 : lbIdx - 1);
    lbStartX = null;
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape')      lbClose();
    if (e.key === 'ArrowLeft')   lbGo(lbIdx - 1);
    if (e.key === 'ArrowRight')  lbGo(lbIdx + 1);
  });
})();


/* --- RSVP: submit to Google Apps Script --- */
(function initRsvp() {
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzwJzMl2PK3SwYZ7zBJPNcpm4Cem8Ikl-hq9gF03SrKdD6qZk5HYXPQ8ILm50Cy-_bj3A/exec';

  const form        = document.getElementById('rsvpForm');
  const success     = document.getElementById('rsvpSuccess');
  const successText = success && success.querySelector('.rsvp-success-text');
  const drinksField = document.getElementById('rsvpDrinksField');
  const errMsg      = document.getElementById('rsvpError');
  const submitErr   = document.getElementById('rsvpSubmitError');

  if (!form) return;

  form.querySelectorAll('input[name="Attending"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (drinksField) drinksField.style.display = radio.value === 'No' ? 'none' : '';
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const fd        = new FormData(form);
    const name      = (fd.get('Name') || '').trim();
    const attending = fd.get('Attending') || '';

    if (!name || !attending) {
      errMsg.hidden = false;
      return;
    }
    errMsg.hidden    = true;
    submitErr.hidden = true;

    const btn = form.querySelector('.rsvp-submit');
    btn.textContent = 'Sending…';
    btn.disabled    = true;

    fetch('https://script.google.com/macros/s/AKfycbzwJzMl2PK3SwYZ7zBJPNcpm4Cem8Ikl-hq9gF03SrKdD6qZk5HYXPQ8ILm50Cy-_bj3A/exec', {
      method: 'POST',
      body: fd
    })
    .then(function(res) { return res.json(); })
    .then(function() {
      if (successText) {
        successText.textContent = attending === 'No'
          ? 'Thank you for letting us know.'
          : "Thank you — we can't wait to celebrate with you.";
      }
      form.hidden      = true;
      success.hidden   = false;
      btn.textContent  = 'Send RSVP';
      btn.disabled     = false;
      success.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (attending !== 'No') launchConfetti();
    })
    .catch(function() {
      submitErr.hidden = false;
      btn.textContent  = 'Send RSVP';
      btn.disabled     = false;
    });
  });
})();


/* --- CONFETTI --- */
function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORS = ['#BF9E6C', '#D4BC96', '#F7F4EE', '#EDE8DF', '#2A2820', '#ffffff'];
  const particles = Array.from({ length: 130 }, () => ({
    x:       canvas.width  * (0.3 + Math.random() * 0.4),
    y:       canvas.height * 0.5,
    vx:      (Math.random() - 0.5) * 20,
    vy:      -(Math.random() * 14 + 4),
    color:   COLORS[Math.floor(Math.random() * COLORS.length)],
    w:       Math.random() * 9 + 4,
    h:       Math.random() * 5 + 3,
    angle:   Math.random() * Math.PI * 2,
    spin:    (Math.random() - 0.5) * 0.25,
    gravity: 0.4 + Math.random() * 0.2,
  }));

  let raf;
  (function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      p.vy  += p.gravity;
      p.vx  *= 0.98;
      p.x   += p.vx;
      p.y   += p.vy;
      p.angle += p.spin;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (alive) { raf = requestAnimationFrame(draw); }
    else        { canvas.remove(); }
  })();
}

/* --- HERO PARALLAX --- */
(function initParallax() {
  const hero = document.getElementById('hero');
  const layers = document.querySelectorAll('.parallax-layer');
  if (!layers.length) return;

  // Initial vertical offsets at scroll=0 (negative = lifted above baseline).
  // Background layers start highest; foreground nearly at baseline.
  // Order matches HTML: building4, building2, building1, building3, bridge, statue.
  const spreadOffsets = [-230, -135, -90, -80, -25, -12];

  let ticking = false;

  function update() {
    const scrollY = window.scrollY;
    const heroHeight = hero.offsetHeight;
    // progress 0 (top) → 1 (scrolled past hero)
    const progress = Math.min(scrollY / heroHeight, 1);

    layers.forEach((layer, i) => {
      const base = spreadOffsets[i] ?? 0;
      // Layers start spread; converge toward baseline as progress → 1
      const translateY = base * (1 - progress);
      layer.style.transform = `translateY(${translateY}px)`;
    });
    ticking = false;
  }

  update(); // set initial positions on load

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
})();



/* --- BUILDING1 TILE --- */
(function initBuilding1Tile() {
  const layer = document.querySelector('.parallax-layer:nth-child(3)');
  if (!layer) return;
  const src = layer.querySelector('img').src;

  function tile() {
    const probe = new Image();
    probe.onload = function () {
      // Displayed width respects max-width: 100vw
      const tileW = Math.min(probe.naturalWidth, window.innerWidth);
      const overlap = Math.round(tileW * 0.4);
      layer.style.left  = -overlap + 'px';
      layer.style.right = -overlap + 'px';
      const totalWidth = window.innerWidth + overlap * 2;
      // At least 2 tiles so one is always fully visible
      const count = Math.max(Math.ceil(totalWidth / tileW) + 1, 2);
      layer.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const el = document.createElement('img');
        el.src = src;
        el.alt = '';
        if (i % 2 === 1) el.style.transform = 'scaleX(-1)';
        layer.appendChild(el);
      }
    };
    probe.src = src;
  }

  tile();
  window.addEventListener('resize', tile, { passive: true });
})();


/* --- SCROLL REVEAL (subtle fade-in) --- */
(function initReveal() {
  if (!('IntersectionObserver' in window)) return;

  const targets = document.querySelectorAll(
    '.event, .hotel-card, .registry-item, .section-header'
  );

  const style = document.createElement('style');
  style.textContent = `
    .event, .hotel-card, .registry-item, .section-header {
      opacity: 0;
      transform: translateY(16px);
      transition: opacity 0.6s ease, transform 0.6s ease;
    }
    .event.revealed, .hotel-card.revealed, .registry-item.revealed, .section-header.revealed {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  targets.forEach((el, i) => {
    el.style.transitionDelay = `${(i % 4) * 0.07}s`;
    observer.observe(el);
  });
})();
