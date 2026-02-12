(function () {
    'use strict';

    /* ============================
       DOM refs
       ============================ */
    const hero          = document.getElementById('hero');
    const sets          = document.querySelectorAll('.parallax-set');
    const bottleWrapper = document.getElementById('bottleWrapper');
    const liquidFill    = document.getElementById('liquidFill');
    const bubblesGroup  = document.getElementById('bubblesGroup');

    /* ============================
       Constants
       ============================ */
    const BOWL_TOP      = 30;   // y in glass SVG where bowl begins
    const BOWL_BOTTOM   = 138;  // y in glass SVG where bowl ends
    const BOWL_RANGE    = BOWL_BOTTOM - BOWL_TOP;   // 108
    const MAX_ANGLE     = 45;   // degrees
    const MAX_BUBBLES   = 28;
    const SPAWN_MS      = 120;  // bubble spawn interval

    /* ============================
       State
       ============================ */
    let bubbles      = [];
    let bubbleTimer  = null;
    let filling      = false;
    let fillPct      = 0;      // 0 → 1

    /* ============================
       Helpers
       ============================ */
    const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const rand   = (lo, hi) => lo + Math.random() * (hi - lo);

    /** Return left/right x bounds of the glass bowl at a given y. */
    function bowlBounds(y) {
        const t = (y - BOWL_TOP) / BOWL_RANGE;           // 0 at top, 1 at bottom
        return { l: 25 + 14 * t, r: 75 - 14 * t };      // matches clip-path coords
    }

    /* ============================
       Parallax
       ============================ */
    function updateParallax(scrollY) {
        const heroH = hero.offsetHeight;
        // only apply effect while hero is in view
        if (scrollY > heroH) return;

        sets.forEach(set => {
            const speed = parseFloat(set.dataset.speed);
            set.style.transform = 'translateY(' + -(scrollY * speed) + 'px)';
        });
    }

    /* ============================
       Bottle & Glass
       ============================ */
    function updateBottleGlass(scrollY) {
        const heroH       = hero.offsetHeight;
        const maxScroll   = document.documentElement.scrollHeight - window.innerHeight;
        const contentRange = maxScroll - heroH;

        if (contentRange <= 0) return;

        const contentScroll = clamp(scrollY - heroH, 0, contentRange);
        const mid           = contentRange / 2;

        if (contentScroll <= mid) {
            /* Phase 1 — tip the bottle 0 → 45° */
            const tipPct = clamp(contentScroll / mid, 0, 1);
            bottleWrapper.style.transform = 'rotate(' + (tipPct * MAX_ANGLE) + 'deg)';

            /* Glass stays empty */
            liquidFill.setAttribute('y', BOWL_BOTTOM);
            liquidFill.setAttribute('height', 0);
            fillPct = 0;
            stopBubbles();
        } else {
            /* Phase 2 — bottle locked at 45°, glass fills */
            bottleWrapper.style.transform = 'rotate(' + MAX_ANGLE + 'deg)';

            fillPct = clamp((contentScroll - mid) / mid, 0, 1);
            const h = fillPct * BOWL_RANGE;
            liquidFill.setAttribute('y', BOWL_BOTTOM - h);
            liquidFill.setAttribute('height', h);

            if (fillPct > 0 && !filling) startBubbles();
            if (fillPct <= 0) stopBubbles();
        }
    }

    /* ============================
       Bubbles
       ============================ */
    function spawnBubble() {
        if (bubbles.length >= MAX_BUBBLES || fillPct <= 0) return;

        const fillH     = fillPct * BOWL_RANGE;
        const liquidTop = BOWL_BOTTOM - fillH;

        // spawn in the bottom third of current liquid
        const spawnY = BOWL_BOTTOM - rand(0, Math.min(fillH * 0.3, 18));
        const bounds = bowlBounds(spawnY);
        const r      = rand(0.7, 2.4);
        const cx     = rand(bounds.l + r + 1, bounds.r - r - 1);

        const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        el.setAttribute('cx', cx);
        el.setAttribute('cy', spawnY);
        el.setAttribute('r', r);
        el.setAttribute('fill', 'rgba(255,252,235,0.60)');

        bubblesGroup.appendChild(el);

        bubbles.push({
            el,
            cx,
            baseCx:    cx,
            cy:        spawnY,
            r,
            speed:     rand(0.12, 0.55),
            wobPhase:  rand(0, Math.PI * 2),
            wobSpeed:  rand(2, 5),
            wobAmp:    rand(0.3, 1.6)
        });
    }

    function tickBubbles() {
        const fillH     = fillPct * BOWL_RANGE;
        const liquidTop = BOWL_BOTTOM - fillH;

        for (let i = bubbles.length - 1; i >= 0; i--) {
            const b = bubbles[i];

            b.cy -= b.speed;
            b.wobPhase += b.wobSpeed * 0.016;
            b.cx = b.baseCx + Math.sin(b.wobPhase) * b.wobAmp;

            // keep inside bowl
            const bounds = bowlBounds(b.cy);
            b.cx = clamp(b.cx, bounds.l + b.r, bounds.r - b.r);

            b.el.setAttribute('cx', b.cx);
            b.el.setAttribute('cy', b.cy);

            // fade near surface
            const dist = b.cy - liquidTop;
            if (dist < 10) {
                b.el.setAttribute('fill',
                    'rgba(255,252,235,' + (Math.max(0, dist / 10) * 0.6).toFixed(2) + ')');
            }

            // remove when above liquid
            if (b.cy <= liquidTop || b.cy < BOWL_TOP) {
                b.el.remove();
                bubbles.splice(i, 1);
            }
        }
    }

    function startBubbles() {
        if (filling) return;
        filling = true;
        bubbleTimer = setInterval(spawnBubble, SPAWN_MS);
    }

    function stopBubbles() {
        if (!filling) return;
        filling = false;
        clearInterval(bubbleTimer);
        bubbles.forEach(b => b.el.remove());
        bubbles = [];
    }

    /* ============================
       Animation loop (bubbles)
       ============================ */
    function animate() {
        if (filling) tickBubbles();
        requestAnimationFrame(animate);
    }

    /* ============================
       Scroll orchestrator
       ============================ */
    let ticking = false;

    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
            const y = window.scrollY;
            updateParallax(y);
            updateBottleGlass(y);
            ticking = false;
        });
    }

    /* ============================
       Init
       ============================ */
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();                       // run once on load
    requestAnimationFrame(animate);   // kick off bubble loop

})();
