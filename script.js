/* ==========================================================================
   CINEMATIC PORTFOLIO — script.js
   --------------------------------------------------------------------------
   Vanilla JS. No dependencies. No layout-triggering animations: every moving
   property is transform / opacity / filter, so the compositor does the work.

   Architecture
     CONFIG      tuning knobs
     SECTIONS    your content — the only block you normally need to edit
     util        DOM helpers + a registry so every listener/timer can be torn down
     Intro       phase 1: video, skip, fallback title card, handoff
     Slider      phase 2: a 4-element ring that rotates through 8 sections
     Autoplay    optional timed advance, drawn on the active dot
     Input       keyboard, wheel, swipe
   ========================================================================== */

'use strict';

/* ==========================================================================
   CONFIG
   ========================================================================== */
const CONFIG = {
  autoplay:       true,   // EDIT: set false to require manual navigation
  autoplayDelay:  7000,   // ms each section holds before advancing
  transition:     900,    // keep in sync with --t-slide in style.css
  panelOut:       380,    // how long the left text takes to clear out
  introFallback:  4600,   // duration of the scripted title card (no video)
  introWatchdog:  2200,   // if the video hasn't started by now, use the fallback
  wheelLock:      760     // throttle for trackpad / wheel navigation
};


/* ==========================================================================
   SECTIONS — EDIT EVERYTHING BELOW
   --------------------------------------------------------------------------
   title  : shown large on the left
   ar     : Arabic label shown beside the index
   desc   : two crisp lines; keep it under ~150 characters
   href   : EDIT — the subpage the "Enter" button routes to
   image  : EDIT — full-bleed background + thumbnail (1920px wide works well)
   ========================================================================== */
const SECTIONS = [
  {
    title: 'About Me',
    ar:    'نبذة عني',
    desc:  'Inspired by early wonder, shaped by time. Honoring my roots, crafting the future, and staying true to the initial spark.',
    href:  'https://hussienalomari7-ui.github.io/about/',                                  // EDIT: target page
    image: 'old.jpeg' // EDIT: image URL
  },
  {
    title: 'Projects',
    ar:    'مشاريعي',
    desc:  'Selected builds and case studies, traced from the first sketch to the shipped product and the decisions in between.',
    href:  'https://hussienalomari7-ui.github.io/project/',                                // EDIT: target page
    image: 'proj.jpeg' // EDIT: image URL
  },
  {
    title: 'Tech Stack',
    ar:    'المكدس التقني المصنف',
    desc:  'The tools I actually reach for, sorted by depth and context — languages, frameworks, and the glue that holds them together.',
    href:  'https://hussienalomari7-ui.github.io/tech/',                                   // EDIT: target page
    image: 'tech.jpeg' // EDIT: image URL
  },
  {
    title: 'Certificates',
    ar:    'شهاداتي',
    desc:  'Verified credentials and completed programs, each one a checkpoint along a longer and deliberate learning path.',
    href:  'https://hussienalomari7-ui.github.io/cer/',                            // EDIT: target page
    image: 'cer.png' // EDIT: image URL
  },
  {
    title: 'Writing',
    ar:    'المدونة والكتابات الفنية',
    desc:  "A window into how I think, build, and solve problems — long-form essays grounded in real-world craft and timeless lessons.",
    href:  'pages/blog.html',                                    // EDIT: target page
    image: 'whrite.jpeg' // EDIT: image URL
  },
  {
    title: 'Impact',
    ar:    'المبادرات والمشاركات',
    desc:  'Talks, mentoring, and volunteer work — where the technical practice meets people and produces something real.',
    href:  'https://hussienalomari7-ui.github.io/impact-/',                                  // EDIT: target page
    image: 'impact.jpeg' // EDIT: image URL
  },
  {
    title: 'Open Resources',
    ar:    'الموارد المجتمعية',
    desc:  'Templates, snippets, and starter kits released for anyone to use — maintained, documented, and ready to fork.',
    href:  ' https://hussienalomari7-ui.github.io/resources/',                               // EDIT: target page
    image: 'open.jpeg' // EDIT: image URL
  },
  {
    title: 'Contact',
    ar:    'صفحة الاتصال',
    desc:  'Open to collaboration, consulting, and conversation. Every reliable way to reach me lives on one page.',
    href:  'https://hussienalomari7-ui.github.io/contact/',                                 // EDIT: target page
    image: 'contact.jpg' // EDIT: image URL
  }
];


/* ==========================================================================
   UTIL — DOM helpers + teardown registry
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);

const cleanups = [];
const timers   = new Set();

/** addEventListener that remembers how to remove itself. */
function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  cleanups.push(() => target.removeEventListener(type, handler, opts));
}

/** setTimeout that can be cancelled in bulk. */
function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
  timers.add(id);
  return id;
}

/** Force a synchronous reflow so the next class change starts from a clean state. */
const reflow = (el) => void el.offsetWidth;

const pad = (n) => String(n).padStart(2, '0');

function destroy() {
  cleanups.forEach((fn) => fn());
  cleanups.length = 0;
  timers.forEach(clearTimeout);
  timers.clear();
  cancelAnimationFrame(apRaf);
}


/* ==========================================================================
   DOM REFERENCES
   ========================================================================== */
const intro     = $('#intro');
const introVid  = $('#introVideo');
const skipBtn   = $('#skipIntro');
const veil      = $('#veil');

const hero      = $('#hero');
const bgLayers  = [$('.bg__layer[data-layer="0"]'), $('.bg__layer[data-layer="1"]')];
const panel     = $('#panel');
const metaNum   = $('#metaNum');
const metaAr    = $('#metaAr');
const metaTitle = $('#metaTitle');
const metaDesc  = $('#metaDesc');
const metaCta   = $('#metaCta');
const rail      = $('.rail');
const stackEl   = $('#stack');
const dotsEl    = $('#dots');
const countNow  = $('#countNow');
const countAll  = $('#countAll');
const live      = $('#liveRegion');

const TOTAL  = SECTIONS.length;
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/* ==========================================================================
   SLIDER STATE
   --------------------------------------------------------------------------
   `order` holds four card elements in visual order:
     [0] front   [1] mid   [2] back   [3] queued off-stage
   Advancing rotates the array — the front card is released to the backdrop and
   recycled to the end of the queue, so only four nodes ever exist in the DOM.
   ========================================================================== */
let index   = 0;
let order   = [];
let bgActive = 0;
let busy    = false;
let pending = 0;      // extra steps queued by a two-deep thumbnail click


/* ==========================================================================
   PHASE 1 — INTRO
   ========================================================================== */
function initIntro() {
  let finished = false;
  let watchdog = 0;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    timers.delete(watchdog);
    try { introVid.pause(); } catch (err) { /* nothing to pause */ }
    reveal();
  };

  // No file, blocked autoplay, or a decode error: run the scripted title card.
  const fallback = () => {
    if (finished || intro.classList.contains('is-fallback')) return;
    intro.classList.add('is-fallback');
    later(finish, REDUCE ? 900 : CONFIG.introFallback);
  };

  on(skipBtn, 'click', finish);
  on(introVid, 'ended', finish);
  on(introVid, 'error', fallback, true);   // capture: <source> errors don't bubble

  // A <source> that 404s never fires an error on <video>, so poll once instead.
  watchdog = later(() => {
    const rolling = introVid.readyState >= 2 && !introVid.paused && introVid.currentTime > 0;
    if (!rolling) fallback();
  }, CONFIG.introWatchdog);

  const attempt = introVid.play();
  if (attempt && typeof attempt.catch === 'function') attempt.catch(fallback);
}

/** The black/blur dissolve that hands the screen to the hero. */
function reveal() {
  veil.classList.add('is-on');
  intro.classList.add('is-leaving');

  later(() => {
    intro.classList.add('is-gone');
    intro.setAttribute('aria-hidden', 'true');

    setBackground(index);                 // paint behind the veil, then lift it
    hero.setAttribute('aria-hidden', 'false');
    hero.classList.add('is-live');
    panel.classList.add('is-in');
    veil.classList.remove('is-on');

    startAutoplay();
  }, REDUCE ? 120 : 620);

  // Hand the rail back its own (faster) transition once the entrance is done.
  later(() => hero.classList.add('is-settled'), 1900);
}


/* ==========================================================================
   PHASE 2 — RENDERING
   ========================================================================== */

/** Write one section's data into a card element. */
function fillCard(el, i) {
  const s = SECTIONS[i];
  el.dataset.index = String(i);
  el.style.backgroundImage = `url("${s.image}")`;
  el.setAttribute('aria-label', `Go to ${s.title}`);
  $('.card__num', el).textContent  = pad(i + 1);
  $('.card__name', el).textContent = s.title;
}

/** Move a card to a slot with no tween — used for recycling and teleports. */
function setSlot(el, i, slot) {
  el.className = `card no-anim ${slot}`;
  fillCard(el, i);
  reflow(el);
  el.classList.remove('no-anim');
}

/** Re-apply slot classes from the current ring order. */
function applySlots(skipLast) {
  order.forEach((el, k) => {
    if (k === 3 && skipLast) return;      // that node is mid-exit; leave it alone
    el.className = `card ${k < 3 ? `slot-${k}` : 'slot-hidden'}`;
  });
}

function buildCards() {
  const frag = document.createDocumentFragment();

  for (let k = 0; k < 4; k++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `card ${k < 3 ? `slot-${k}` : 'slot-hidden'}`;
    el.innerHTML =
      '<span class="card__edge"></span>' +
      '<span class="card__cap">' +
        '<span class="card__num"></span>' +
        '<span class="card__name"></span>' +
      '</span>';
    fillCard(el, k % TOTAL);
    frag.appendChild(el);
    order.push(el);
  }

  stackEl.appendChild(frag);
  on(stackEl, 'click', (e) => {
    const card = e.target.closest('.card');
    if (card) pick(order.indexOf(card));
  });
}

function buildDots() {
  const frag = document.createDocumentFragment();

  for (let i = 0; i < TOTAL; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dot${i === 0 ? ' is-active' : ''}`;
    b.dataset.index = String(i);
    b.setAttribute('aria-label', SECTIONS[i].title);
    if (i === 0) b.setAttribute('aria-current', 'true');
    b.innerHTML = '<span class="dot__fill"></span>';
    frag.appendChild(b);
  }

  dotsEl.appendChild(frag);
  on(dotsEl, 'click', (e) => {
    const dot = e.target.closest('.dot');
    if (dot) goTo(Number(dot.dataset.index));
  });
}

/** Crossfade the two background layers and restart the slow pan. */
function setBackground(i) {
  const next = bgLayers[1 - bgActive];
  const curr = bgLayers[bgActive];

  next.style.backgroundImage = `url("${SECTIONS[i].image}")`;
  next.classList.remove('is-anim');
  reflow(next);
  next.classList.add('is-anim', 'is-active');
  curr.classList.remove('is-active');

  bgActive = 1 - bgActive;
}

/** Set the left-hand text without animating. */
function writePanel(i) {
  const s = SECTIONS[i];
  metaNum.textContent   = pad(i + 1);
  metaAr.textContent    = s.ar;
  metaTitle.textContent = s.title;
  metaDesc.textContent  = s.desc;
  metaCta.setAttribute('href', s.href);
  metaCta.setAttribute('aria-label', `Enter ${s.title}`);
}

/** Staggered exit, silent swap, staggered entrance. */
function cyclePanel(i) {
  panel.classList.remove('is-in');
  panel.classList.add('is-out');

  later(() => {
    writePanel(i);
    panel.classList.add('no-anim');
    panel.classList.remove('is-out');
    reflow(panel);                        // land on the base state invisibly
    panel.classList.remove('no-anim');
    panel.classList.add('is-in');
  }, REDUCE ? 120 : CONFIG.panelOut);
}

function updateHud(i) {
  countNow.textContent = pad(i + 1);

  dotsEl.querySelectorAll('.dot').forEach((dot, k) => {
    const active = k === i;
    dot.classList.toggle('is-active', active);
    if (active) dot.setAttribute('aria-current', 'true');
    else dot.removeAttribute('aria-current');
  });

  live.textContent = `${i + 1} of ${TOTAL}. ${SECTIONS[i].title}.`;
}

/** Everything that reacts to a new active index. */
function paint(i) {
  setBackground(i);
  cyclePanel(i);
  updateHud(i);
  resetAutoplay();
}


/* ==========================================================================
   PHASE 2 — NAVIGATION
   ========================================================================== */

/**
 * Advance one section. dir = 1 forward, -1 back.
 * Forward: the front card scales up, blurs, and dissolves into the new
 * background while the ring rotates beneath it.
 * Back: the queued card is teleported to that expanded state and pulled
 * back down into the front slot — the same move, played in reverse.
 */
function step(dir) {
  if (busy) return;
  busy = true;

  const target = (index + dir + TOTAL) % TOTAL;

  if (dir > 0) {
    const front = order.shift();
    order.push(front);

    front.className = 'card is-exiting';
    applySlots(true);

    // Once it's out of sight, recycle it to the back of the queue.
    later(() => setSlot(front, (target + 3) % TOTAL, 'slot-hidden'),
          Math.round(CONFIG.transition * 0.75));
  } else {
    const back = order.pop();
    order.unshift(back);

    setSlot(back, target, 'is-exiting');
    // Two frames guarantees the expanded state is painted before it animates in.
    requestAnimationFrame(() => requestAnimationFrame(() => applySlots(false)));
  }

  index = target;
  paint(target);

  later(() => {
    busy = false;
    if (pending > 0) { pending--; step(1); }
  }, CONFIG.transition);
}

/** Jump straight to any index: the rail clears, re-seeds, and returns. */
function hop(target) {
  busy = true;
  index = target;
  rail.classList.add('is-swapping');
  paint(target);

  later(() => {
    order.forEach((el, k) => {
      setSlot(el, (target + k) % TOTAL, k < 3 ? `slot-${k}` : 'slot-hidden');
    });
    rail.classList.remove('is-swapping');
  }, 330);

  later(() => { busy = false; }, CONFIG.transition);
}

/** Route to a section by the shortest available move. */
function goTo(target) {
  if (busy || target === index || target < 0 || target >= TOTAL) return;
  const forward = (target - index + TOTAL) % TOTAL;

  if (forward === 1)              step(1);
  else if (forward === TOTAL - 1) step(-1);
  else                            hop(target);
}

/** Thumbnail click: slot 1 is one step away, slot 2 is two. */
function pick(pos) {
  if (busy || pos < 1) return;
  if (pos === 2) pending = 1;
  step(1);
}


/* ==========================================================================
   AUTOPLAY — progress is drawn as the fill on the active dot
   ========================================================================== */
let apRaf     = 0;
let apLast    = 0;
let apElapsed = 0;
let apPaused  = false;
let apOn      = false;

function setProgress(p) {
  dotsEl.style.setProperty('--p', String(p));
}

function apLoop(now) {
  if (!apOn) return;

  const dt = apLast ? now - apLast : 0;
  apLast = now;

  if (!apPaused && !busy) {
    apElapsed += dt;
    const p = Math.min(1, apElapsed / CONFIG.autoplayDelay);
    setProgress(p);
    if (p >= 1) { apElapsed = 0; step(1); }
  }

  apRaf = requestAnimationFrame(apLoop);
}

function startAutoplay() {
  if (!CONFIG.autoplay || REDUCE) return;
  apOn = true;
  apLast = 0;
  apElapsed = 0;
  setProgress(0);
  cancelAnimationFrame(apRaf);
  apRaf = requestAnimationFrame(apLoop);
}

function resetAutoplay() {
  if (!apOn) return;
  apElapsed = 0;
  setProgress(0);
}

const pauseAutoplay  = () => { apPaused = true; };
const resumeAutoplay = () => { apPaused = false; apLast = 0; };


/* ==========================================================================
   INPUT — keyboard, wheel, swipe
   ========================================================================== */
function initInput() {
  /* Keyboard ------------------------------------------------------------ */
  on(document, 'keydown', (e) => {
    if (!hero.classList.contains('is-live')) {
      if (e.key === 'Escape' || e.key === 'Enter') skipBtn.click();
      return;
    }
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown': e.preventDefault(); step(1); break;
      case 'ArrowLeft':
      case 'ArrowUp':   e.preventDefault(); step(-1); break;
      case 'Home':      e.preventDefault(); goTo(0); break;
      case 'End':       e.preventDefault(); goTo(TOTAL - 1); break;
      default: break;
    }
  });

  /* Wheel / trackpad ---------------------------------------------------- */
  let wheelReady = true;
  on(hero, 'wheel', (e) => {
    if (!wheelReady) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 18) return;

    wheelReady = false;
    step(delta > 0 ? 1 : -1);
    later(() => { wheelReady = true; }, CONFIG.wheelLock);
  }, { passive: true });

  /* Swipe --------------------------------------------------------------- */
  let sx = 0, sy = 0, tracking = false;

  on(hero, 'pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    sx = e.clientX; sy = e.clientY; tracking = true;
  }, { passive: true });

  on(hero, 'pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    step(dx < 0 ? 1 : -1);
  }, { passive: true });

  on(hero, 'pointercancel', () => { tracking = false; }, { passive: true });

  /* Arrows -------------------------------------------------------------- */
  on($('#prevBtn'), 'click', () => step(-1));
  on($('#nextBtn'), 'click', () => step(1));

  /* CTA press feedback --------------------------------------------------- */
  on(metaCta, 'pointerdown', () => metaCta.classList.add('is-pressed'));
  ['pointerup', 'pointerleave', 'blur'].forEach((evt) => {
    on(metaCta, evt, () => metaCta.classList.remove('is-pressed'));
  });

  /* Pause the timer whenever attention is elsewhere ---------------------- */
  on(hero, 'pointerenter', pauseAutoplay);
  on(hero, 'pointerleave', resumeAutoplay);
  on(window, 'blur', pauseAutoplay);
  on(window, 'focus', resumeAutoplay);
  on(document, 'visibilitychange', () => {
    if (document.hidden) pauseAutoplay(); else resumeAutoplay();
  });
}


/* ==========================================================================
   BOOT
   ========================================================================== */
function preloadImages() {
  const warm = (i) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = SECTIONS[i].image;
  };

  // The first three are visible immediately; the rest can wait for idle time.
  for (let i = 0; i < Math.min(3, TOTAL); i++) warm(i);

  const rest = () => { for (let i = 3; i < TOTAL; i++) warm(i); };
  if ('requestIdleCallback' in window) requestIdleCallback(rest, { timeout: 2500 });
  else later(rest, 1200);
}

function init() {
  countAll.textContent = pad(TOTAL);

  buildCards();
  buildDots();
  writePanel(0);
  updateHud(0);
  preloadImages();

  initIntro();
  initInput();

  on(window, 'pagehide', destroy);

  requestAnimationFrame(() => document.body.classList.remove('is-booting'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
