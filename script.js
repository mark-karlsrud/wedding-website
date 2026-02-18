/* ============================================================
   SOPHIA & MARK WEDDING WEBSITE — script.js
   ============================================================ */

'use strict';

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
      v.src = src;
      v.muted = true;
      v.loop  = true;
      v.playsInline = true;
      v.preload = 'metadata';
      slide.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Sophia and Mark';
      img.loading = i === 0 ? 'eager' : 'lazy';
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

  function goTo(index) {
    const prev = current;
    current = (index + total) % total;

    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === current));

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
