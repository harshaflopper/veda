/* Abhi Ayur – scroll-driven clinic walkthrough (v2).
 *
 * Timeline: opening → Entrance → walk → Reception → walk → … → Pharmacy.
 * At each room the real room photo is shown (crisp signs and text); between rooms the
 * AI walkthrough clip plays as a frame sequence. Playback follows the scroll with
 * easing (no stepping), neighbouring frames are blended, and each photo is moved in
 * lock-step with the clip frame it replaces so hand-offs read as one camera move.
 */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var section = document.getElementById("tour");
  var canvas = section && section.querySelector(".tour-canvas");
  if (!section || !canvas || !canvas.getContext || reduce) return; // stacked layout stays

  var ctx = canvas.getContext("2d", { alpha: false });
  var root = document.documentElement;
  var rooms = [].slice.call(section.querySelectorAll(".room"));
  var railButtons = [].slice.call(section.querySelectorAll("[data-goto]"));
  var railItems = railButtons.map(function (b) { return b.parentNode; });
  var railFill = section.querySelector(".tr-fill");
  var counter = section.querySelector(".tour-counter");
  var counterValue = section.querySelector(".tc-value");
  var counterStep = section.querySelector(".tc-step");
  var indexName = section.querySelector(".tix-name");
  var indexNum = section.querySelector(".tix-num");
  var intro = section.querySelector(".tour-intro");
  var introWords = [].slice.call(section.querySelectorAll(".ti-words"));
  var introApertures = [].slice.call(section.querySelectorAll(".ti-aperture"));
  var introCaption = section.querySelector(".ti-caption");
  var scrim = section.querySelector(".tour-scrim");

  // ── configuration ──
  var FRAMES = { 1: 111, 2: 94, 3: 59, 4: 57, 5: 104 };          // frames per walk (after trimming)
  var WALK_LEN = { 1: 1.15, 2: 1.3, 3: 0.6, 4: 0.85, 5: 1.0 };   // scroll length of each walk
  var INTRO_LEN = 1.15, ROOM_LEN = 1.0, VH_PER_UNIT = 90;
  var HANDOFF = 0.22;   // share of a room stop used to blend photo ↔ walk
  var DAMPING = 0.11;   // seconds; how softly the picture follows the scroll

  // photo → clip-frame alignment measured offline (1280×720 space). ok=false: not alignable, plain dissolve.
  var ID = { s: 1, tx: 0, ty: 0, rot: 0, ok: true };
  var push = function (s) { return { s: s, tx: -(s - 1) * 640, ty: -(s - 1) * 360, rot: 0, ok: false }; };
  var ALIGN = [
    { in: ID, out: { s: 0.9997, tx: 0.1, ty: 0.5, rot: -0.01, ok: true } },
    { in: { s: 0.9973, tx: 7.2, ty: 1.1, rot: -0.05, ok: true }, out: { s: 1.0914, tx: -97.3, ty: -7.4, rot: -0.88, ok: true } },
    { in: { s: 1.1925, tx: -126.7, ty: -17.9, rot: -0.63, ok: true }, out: { s: 1.0001, tx: 0, ty: 0, rot: 0, ok: true } },
    { in: { s: 0.9999, tx: 0.1, ty: 0, rot: 0, ok: true }, out: push(1.16) },
    { in: { s: 1.0837, tx: -67.6, ty: -28.1, rot: 0.16, ok: true }, out: { s: 0.9997, tx: 0.4, ty: 0, rot: 0.02, ok: true } },
    { in: { s: 0.9778, tx: 14.0, ty: 8.4, rot: -0.02, ok: true }, out: ID }
  ];

  // ── timeline ──
  var segments = [], units = 0;
  segments.push({ type: "intro", start: 0, len: INTRO_LEN }); units += INTRO_LEN;
  rooms.forEach(function (_, r) {
    segments.push({ type: "room", room: r, start: units, len: ROOM_LEN }); units += ROOM_LEN;
    if (r < rooms.length - 1) {
      var c = r + 1;
      segments.push({ type: "walk", clip: c, start: units, len: WALK_LEN[c] }); units += WALK_LEN[c];
    }
  });
  var roomSeg = segments.filter(function (s) { return s.type === "room"; });
  var tourStart = INTRO_LEN / units;

  // ── revenue per room ──
  var fmt = new Intl.NumberFormat("en-IN");
  var cumulative = [], running = 0;
  rooms.forEach(function (el, i) { running += Number(el.getAttribute("data-add") || 0); cumulative[i] = running; });

  // stagger index for panel lines
  rooms.forEach(function (el) {
    var i = 0;
    [].forEach.call(el.querySelectorAll(".room-panel > *, .facts > div, .tags li"), function (n) { n.style.setProperty("--i", i++); });
  });

  // ── assets ──
  var SET = "d";
  var stills = [], frames = {};
  Object.keys(FRAMES).forEach(function (c) { frames[c] = []; });
  function stillUrl(i) { return "media/stills/room" + (i + 1) + (SET === "m" ? "-m" : "") + ".webp"; }
  function frameUrl(c, i) { return "media/frames/" + SET + "/c" + c + "_" + String(i + 1).padStart(3, "0") + ".webp"; }

  function startLoading() {
    var queue = [];
    rooms.forEach(function (_, i) { queue.push([stillUrl(i), function (img) { stills[i] = img; }]); });
    var seen = {};
    [8, 4, 2, 1].forEach(function (step) {
      Object.keys(FRAMES).forEach(function (c) {
        var n = FRAMES[c];
        var add = function (i) {
          if (seen[c + ":" + i]) return;
          seen[c + ":" + i] = true;
          queue.push([frameUrl(c, i), function (img) { frames[c][i] = img; }]);
        };
        for (var i = 0; i < n; i += step) add(i);
        add(n - 1);
      });
    });
    var inflight = 0;
    function pump() {
      while (inflight < 6 && queue.length) {
        var job = queue.shift();
        inflight++;
        (function (url, done) {
          var img = new Image();
          img.decoding = "async";
          var finish = function () { inflight--; pump(); };
          img.onload = function () {
            var ready = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
            ready.then(function () { done(img); needsDraw = true; kick(); finish(); });
          };
          img.onerror = finish;
          img.src = url;
        })(job[0], job[1]);
      }
    }
    pump();
  }

  // ── geometry ──
  var BAND = 0.34;
  function isBand() { return window.matchMedia("(orientation: portrait), (max-width: 760px)").matches; }
  function headerH() { return parseFloat(getComputedStyle(root).getPropertyValue("--header-h")) || 64; }
  function fullRect() {
    var cw = canvas.width, ch = canvas.height;
    var s = Math.max(cw / 16, ch / 9), w = 16 * s, h = 9 * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h, clip: [0, 0, cw, ch] };
  }
  // phones: during the opening the picture fills the screen, then settles into the band
  function frameRectFor(seg, t) {
    var R = frameRect();
    if (!isBand() || seg.type !== "intro") return R;
    var F = fullRect(), k = smooth((t - 0.55) / 0.45), l = function (a, b) { return a + (b - a) * k; };
    return { x: l(F.x, R.x), y: l(F.y, R.y), w: l(F.w, R.w), h: l(F.h, R.h),
      clip: [0, l(F.clip[1], R.clip[1]), R.clip[2], l(F.clip[3], R.clip[3])] };
  }
  function frameRect() {
    var cw = canvas.width, ch = canvas.height, dpr = cw / Math.max(1, canvas.clientWidth);
    if (isBand()) {
      var top = headerH() * dpr, bandH = window.innerHeight * BAND * dpr;
      var bw = Math.max(cw, bandH * 16 / 9), bh = bw * 9 / 16;
      return { x: (cw - bw) / 2, y: top + (bandH - bh) / 2, w: bw, h: bh, clip: [0, top, cw, bandH] };
    }
    var s = Math.max(cw / 16, ch / 9), w = 16 * s, h = 9 * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h, clip: null };
  }

  // ── matrices ──
  function M(T) { return new DOMMatrix().translate(T.tx, T.ty).rotate(T.rot).scale(T.s); }
  function lerpT(a, b, e) { return { s: a.s + (b.s - a.s) * e, tx: a.tx + (b.tx - a.tx) * e, ty: a.ty + (b.ty - a.ty) * e, rot: a.rot + (b.rot - a.rot) * e }; }
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  var base = new DOMMatrix();
  function paint(img, matrix, alpha) {
    if (!img || alpha <= 0.002) return;
    var m = base.multiply(matrix);
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(img, 0, 0, 1280, 720);
  }
  function nearest(list, i) {
    for (var d = 0; d <= list.length; d++) { if (list[i - d]) return list[i - d]; if (list[i + d]) return list[i + d]; }
    return null;
  }
  // a walk frame at fractional position f, blended with its neighbour
  function paintWalk(c, f, matrix, alpha) {
    var list = frames[c], n = FRAMES[c];
    f = Math.max(0, Math.min(n - 1, f));
    var i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), a = f - i0;
    var A = list[i0], B = list[i1];
    if (A && B && a > 0.01) { paint(A, matrix, alpha); paint(B, matrix, alpha * a); return true; }
    var img = A || nearest(list, Math.round(f));
    if (img) { paint(img, matrix, alpha); return true; }
    return false;
  }

  // ── state ──
  var target = 0, current = 0, last = 0, rafId = null, needsDraw = true;

  function locate(p) {
    var u = p * units;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      if (u <= s.start + s.len || i === segments.length - 1) return { seg: s, t: Math.min(1, Math.max(0, (u - s.start) / s.len)) };
    }
  }

  function draw() {
    var L = locate(current), seg = L.seg, t = L.t;
    var R = frameRectFor(seg, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0c1b11";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    if (R.clip) { ctx.save(); ctx.beginPath(); ctx.rect(R.clip[0], R.clip[1], R.clip[2], R.clip[3]); ctx.clip(); }
    base = new DOMMatrix().translate(R.x, R.y).scale(R.w / 1280);

    if (seg.type === "intro") {
      // gentle pull-back on the entrance while the opening dissolves
      paint(stills[0], M(lerpT(push(1.12), ID, easeInOut(t))), 1);
    } else if (seg.type === "room") {
      var r = seg.room, A = ALIGN[r];
      if (r > 0 && t < HANDOFF) {
        // arriving: walk's last frame and the photo move together into the photo's framing
        var ea = smooth(t / HANDOFF);
        var S = M(lerpT(A.in, ID, ea));
        paintWalk(r, FRAMES[r] - 1, A.in.ok ? S.multiply(M(A.in).inverse()) : new DOMMatrix(), 1);
        paint(stills[r], S, ea);
      } else if (r < rooms.length - 1 && t > 1 - HANDOFF) {
        // leaving: photo eases into the next walk's opening framing, then hands over
        var el = smooth((t - (1 - HANDOFF)) / HANDOFF);
        var S2 = M(lerpT(ID, A.out, el));
        paintWalk(r + 1, 0, A.out.ok ? S2.multiply(M(A.out).inverse()) : new DOMMatrix(), 1);
        paint(stills[r], S2, 1 - el);
      } else {
        paint(stills[r], new DOMMatrix(), 1);
      }
    } else {
      var c = seg.clip;
      if (!paintWalk(c, t * (FRAMES[c] - 1), new DOMMatrix(), 1)) {
        paint(stills[t < 0.5 ? c - 1 : c], new DOMMatrix(), 1); // frames still loading
      }
    }
    if (R.clip) ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    updateOverlay(seg, t);
  }

  // ── overlay: opening, panels, rail, index, counter ──
  var activeRoom = -1;
  function updateOverlay(seg, t) {
    // opening
    var it = seg.type === "intro" ? t : 1;
    var open = easeInOut(Math.max(0, (it - 0.18) / 0.82));
    introWords.forEach(function (g) { g.style.transform = "scale(" + (1 + open * 2.4).toFixed(4) + ")"; });
    introApertures.forEach(function (c) { c.setAttribute("r", (open * open * 1300).toFixed(1)); });
    intro.style.opacity = it >= 1 ? "0" : (1 - smooth((open - 0.75) / 0.25)).toFixed(3);
    introCaption.style.opacity = Math.max(0, 1 - it * 4).toFixed(3);
    scrim.style.opacity = seg.type === "intro" ? smooth((open - 0.5) * 2).toFixed(3) : "1";
    counter.classList.toggle("on", seg.type !== "intro" || t > 0.85);
    section.classList.toggle("intro-on", seg.type === "intro" && t < 0.8);

    // panels
    rooms.forEach(function (el, r) {
      var a = 0;
      if (seg.type === "room" && seg.room === r) {
        a = 1;
        if (r > 0 && t < HANDOFF) a = smooth((t - HANDOFF * 0.35) / (HANDOFF * 0.65));
        if (r < rooms.length - 1 && t > 1 - HANDOFF) a = Math.min(a, 1 - smooth((t - (1 - HANDOFF)) / (HANDOFF * 0.7)));
      }
      if (r === 0 && seg.type === "intro") a = smooth((t - 0.82) / 0.18);
      el.style.opacity = a.toFixed(3);
      el.classList.toggle("is-visible", a > 0.01);
      el.classList.toggle("is-active", a > 0.35);
      el.setAttribute("aria-hidden", a > 0.01 ? "false" : "true");
    });

    // which room are we at / heading to
    var cur = seg.type === "intro" ? 0 : seg.type === "room" ? seg.room : (t < 0.5 ? seg.clip - 1 : seg.clip);
    if (cur !== activeRoom) setActiveRoom(cur);

    // rail fill (tour only)
    var tp = Math.max(0, (current - tourStart) / (1 - tourStart));
    if (railFill) railFill.style.transform = (isBand() ? "scaleX(" : "scaleY(") + tp.toFixed(4) + ")";

    root.classList.toggle("past-tour", section.getBoundingClientRect().bottom < window.innerHeight * 0.5);
  }

  // place rail stops at each room's position along the tour
  function layoutRail() {
    railItems.forEach(function (li, r) {
      var s = roomSeg[r];
      var pos = ((s.start + s.len * 0.5) / units - tourStart) / (1 - tourStart);
      if (isBand()) { li.style.left = (pos * 100).toFixed(2) + "%"; li.style.top = ""; }
      else { li.style.top = (pos * 100).toFixed(2) + "%"; li.style.left = ""; }
    });
  }

  var shown = 0, countAnim = null;
  function setActiveRoom(r) {
    var prev = activeRoom;
    activeRoom = r;
    railButtons.forEach(function (b, i) { if (i === r) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });

    // big index roll
    indexName.textContent = railButtons[r].textContent.trim();
    var old = indexNum.querySelector(".tix-roll:not(.leaving)");
    var dir = r >= prev ? 1 : -1;
    var neu = document.createElement("span");
    neu.className = "tix-roll";
    neu.textContent = String(r + 1).padStart(2, "0");
    if (old && old.textContent !== neu.textContent) {
      neu.style.transform = "translateY(" + (dir * 100) + "%)";
      indexNum.appendChild(neu);
      old.classList.add("leaving");
      old.style.transform = "translateY(" + (-dir * 100) + "%)";
      old.style.opacity = "0";
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 650);
      requestAnimationFrame(function () { requestAnimationFrame(function () { neu.style.transform = "translateY(0)"; }); });
    }

    // revenue counter
    var add = Number(rooms[r].getAttribute("data-add") || 0);
    var title = ((rooms[r].querySelector("h1, h2") || {}).textContent || "").toLowerCase();
    counterStep.textContent = add && r > prev ? "+₹" + fmt.format(add) + " · " + title : "";
    var from = shown, to = cumulative[r] || 0, t0 = performance.now();
    if (countAnim) cancelAnimationFrame(countAnim);
    (function tick(now) {
      var k = Math.min(1, (now - t0) / 900);
      shown = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 4)));
      counterValue.textContent = "₹" + fmt.format(shown);
      if (k < 1) countAnim = requestAnimationFrame(tick);
    })(t0);
    // the room's own figure counts up too
    var big = rooms[r].querySelector(".stream strong");
    if (big && r !== prev) countUp(big);
  }

  function countUp(el) {
    var final = el.getAttribute("data-final") || el.textContent;
    el.setAttribute("data-final", final);
    var n = Number(final.replace(/[^\d]/g, "")), t0 = performance.now();
    (function tick(now) {
      var k = Math.min(1, (now - t0) / 900);
      el.textContent = "₹" + fmt.format(Math.round(n * (1 - Math.pow(1 - k, 4))));
      if (k < 1) requestAnimationFrame(tick); else el.textContent = final;
    })(t0);
  }

  // ── loop: picture eases toward the scroll position ──
  function readScroll() {
    var total = section.offsetHeight - window.innerHeight;
    var top = section.getBoundingClientRect().top;
    target = total > 0 ? Math.min(1, Math.max(0, -top / total)) : 0;
  }
  function frame(now) {
    rafId = null;
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    var before = current;
    current += (target - current) * (1 - Math.exp(-dt / DAMPING));
    if (Math.abs(target - current) < 0.00002) current = target;
    if (current !== before || needsDraw) { needsDraw = false; draw(); }
    if (current !== target) kick(); else last = 0;
  }
  function kick() { if (rafId === null) rafId = requestAnimationFrame(frame); }

  function onScroll() { readScroll(); kick(); }
  function onResize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    layoutRail();
    readScroll();
    needsDraw = true;
    kick();
  }

  function goTo(r) {
    var s = roomSeg[r];
    var u = s.start + s.len * 0.5;
    var top = section.getBoundingClientRect().top + window.scrollY + (u / units) * (section.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top, behavior: "smooth" });
  }
  railButtons.forEach(function (b) { b.addEventListener("click", function () { goTo(Number(b.getAttribute("data-goto"))); }); });

  // ── start ──
  root.classList.add("tour-on");
  section.style.height = (units * VH_PER_UNIT + 100) + "vh";
  onResize();
  SET = canvas.width < 1100 || isBand() ? "m" : "d";
  readScroll();
  current = target;
  startLoading();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  // test hook: jump without easing
  window.__tourSnap = function () { readScroll(); current = target; needsDraw = true; kick(); };
})();
