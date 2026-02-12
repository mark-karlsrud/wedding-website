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
       Constants  (glass SVG viewBox coords)
       ============================ */
    const BOWL_TOP      = 58;   // y where bowl rim begins
    const BOWL_BOTTOM   = 270;  // y where bowl meets stem
    const BOWL_RANGE    = BOWL_BOTTOM - BOWL_TOP;  // 212
    const MAX_ANGLE     = 45;
    const MAX_BUBBLES   = 28;
    const SPAWN_MS      = 120;

    /* ============================
       State
       ============================ */
    let bubbles      = [];
    let bubbleTimer  = null;
    let filling      = false;
    let fillPct      = 0;

    /* ============================
       Helpers
       ============================ */
    const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const rand   = (lo, hi) => lo + Math.random() * (hi - lo);

    /** Return left/right x bounds of the glass bowl at a given y. */
    function bowlBounds(y) {
        const t = (y - BOWL_TOP) / BOWL_RANGE;  // 0 at top, 1 at bottom
        const bulge = 4 * t * (1 - t);          // peaks at 1.0 when t=0.5
        // Straight: l 353→343, r 452→377  +  outward curve
        return {
            l: 353 - 10 * t - 30 * bulge,
            r: 452 - 75 * t + 25 * bulge
        };
    }

    /* ============================
       Parallax
       ============================ */
    function updateParallax(scrollY) {
        const heroH = hero.offsetHeight;
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
        const heroH        = hero.offsetHeight;
        const maxScroll    = document.documentElement.scrollHeight - window.innerHeight;
        const contentRange = maxScroll - heroH;

        if (contentRange <= 0) return;

        const contentScroll = clamp(scrollY - heroH, 0, contentRange);

        // Bottle finishes rotating at 10% of content scroll
        const bottleEnd = contentRange * 0.10;
        // Glass fills from 10% to 40%
        const fillStart = bottleEnd;
        const fillEnd   = contentRange * 0.40;

        if (contentScroll <= bottleEnd) {
            /* Phase 1 — tip the bottle 0 → 45° */
            const tipPct = clamp(contentScroll / bottleEnd, 0, 1);
            bottleWrapper.style.transform = 'rotate(' + (tipPct * MAX_ANGLE) + 'deg)';

            if (liquidFill) {
                liquidFill.setAttribute('y', BOWL_BOTTOM);
                liquidFill.setAttribute('height', 0);
            }
            fillPct = 0;
            stopBubbles();
        } else {
            /* Phase 2 — bottle locked at 45°, glass fills */
            bottleWrapper.style.transform = 'rotate(' + MAX_ANGLE + 'deg)';

            fillPct = clamp((contentScroll - fillStart) / (fillEnd - fillStart), 0, 1);
            const h = fillPct * BOWL_RANGE;
            if (liquidFill) {
                liquidFill.setAttribute('y', BOWL_BOTTOM - h);
                liquidFill.setAttribute('height', h);
            }

            if (fillPct > 0 && !filling) startBubbles();
            if (fillPct <= 0) stopBubbles();
        }
    }

    /* ============================
       Bubbles
       ============================ */
    function spawnBubble() {
        if (!bubblesGroup || bubbles.length >= MAX_BUBBLES || fillPct <= 0) return;

        const fillH     = fillPct * BOWL_RANGE;
        const liquidTop = BOWL_BOTTOM - fillH;

        const spawnY = BOWL_BOTTOM - rand(0, Math.min(fillH * 0.3, 80));
        const bounds = bowlBounds(spawnY);
        const r      = rand(3, 8);
        const cx     = rand(bounds.l + r + 2, bounds.r - r - 2);

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
            speed:     rand(0.5, 2.2),
            wobPhase:  rand(0, Math.PI * 2),
            wobSpeed:  rand(2, 5),
            wobAmp:    rand(1.5, 6)
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

            const bounds = bowlBounds(b.cy);
            b.cx = clamp(b.cx, bounds.l + b.r, bounds.r - b.r);

            b.el.setAttribute('cx', b.cx);
            b.el.setAttribute('cy', b.cy);

            const dist = b.cy - liquidTop;
            if (dist < 25) {
                b.el.setAttribute('fill',
                    'rgba(255,252,235,' + (Math.max(0, dist / 25) * 0.6).toFixed(2) + ')');
            }

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
    onScroll();
    requestAnimationFrame(animate);

})();
