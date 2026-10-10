/* Abhi Ayur – section reveals, count-ups and the projection chart. */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── count-up for headline figures ──
  function countUp(el) {
    var to = parseFloat(el.getAttribute("data-count"));
    var dec = parseInt(el.getAttribute("data-dec") || "0", 10);
    var pre = el.getAttribute("data-prefix") || "", suf = el.getAttribute("data-suffix") || "";
    var final = el.textContent, t0 = performance.now();
    if (reduce) return;
    (function tick(now) {
      var k = Math.min(1, (now - t0) / 1100);
      el.textContent = pre + (to * (1 - Math.pow(1 - k, 4))).toFixed(dec) + suf;
      if (k < 1) requestAnimationFrame(tick); else el.textContent = final;
    })(t0);
  }

  // ── reveal on scroll ──
  var targets = [].slice.call(document.querySelectorAll(".reveal"));
  if (!("IntersectionObserver" in window) || reduce) {
    targets.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        [].forEach.call(e.target.querySelectorAll("[data-count]"), countUp);
        if (e.target.hasAttribute("data-count")) countUp(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.2 });
    targets.forEach(function (el) { io.observe(el); });
  }

  // ── projection chart: grouped columns, one axis (₹ crore) ──
  var fig = document.getElementById("projection-chart");
  if (!fig) return;
  var data = JSON.parse(fig.getAttribute("data-chart"));
  var plot = fig.querySelector(".chart-plot");
  var tip = fig.querySelector(".chart-tip");
  var NS = "http://www.w3.org/2000/svg";
  var W = 900, H = 340, padL = 44, padR = 8, padT = 24, padB = 46;
  var max = 60, ticks = [0, 15, 30, 45, 60];
  var y = function (v) { return padT + (H - padT - padB) * (1 - v / max); };
  var band = (W - padL - padR) / data.length;
  var barW = 24, gap = 2;
  var colors = { rev: getComputedStyle(root).getPropertyValue("--leaf").trim() || "#2f7d3f", ebitda: getComputedStyle(root).getPropertyValue("--brass").trim() || "#c49a45" };

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  // column with a 4px rounded top and square base
  function colPath(x, top, w, base) {
    var r = Math.min(4, (base - top) / 2);
    return "M" + x + "," + base + "V" + (top + r) + "Q" + x + "," + top + " " + (x + r) + "," + top +
      "H" + (x + w - r) + "Q" + (x + w) + "," + top + " " + (x + w) + "," + (top + r) + "V" + base + "Z";
  }

  var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Column chart of total revenue and EBITDA for years 1 to 5 across 50 centres. Figures are in the table below." });
  var axis = el("g", { class: "axis" }, svg);
  ticks.forEach(function (v) {
    el("line", { class: v === 0 ? "baseline" : "grid-line", x1: padL, x2: W - padR, y1: y(v), y2: y(v) }, axis);
    var t = el("text", { x: padL - 10, y: y(v) + 4, "text-anchor": "end" }, axis); t.textContent = v;
  });
  var base = y(0);
  data.forEach(function (d, i) {
    var cx = padL + band * i + band / 2;
    var g = el("g", {}, svg);
    [["rev", -barW - gap / 2], ["ebitda", gap / 2]].forEach(function (s, j) {
      var x = cx + s[1], top = y(d[s[0]]);
      var bar = el("path", { class: "bar", d: colPath(x, top, barW, base), fill: colors[s[0]] }, g);
      bar.style.transitionDelay = (i * 90 + j * 60) + "ms";
    });
    var v = el("text", { class: "val", x: cx - barW / 2 - gap / 2, y: y(d.rev) - 8, "text-anchor": "middle" }, g);
    v.textContent = d.rev.toFixed(2);
    var lbl = el("text", { x: cx, y: H - padB + 20, "text-anchor": "middle" }, axis); lbl.textContent = d.y;
    var cap = el("text", { class: "cap", x: cx, y: H - padB + 37, "text-anchor": "middle" }, axis); cap.textContent = d.cap + " capacity";
    var hit = el("rect", { class: "bar-hit", x: cx - band / 2 + 6, y: padT, width: band - 12, height: base - padT }, g);
    function show() {
      tip.hidden = false;
      tip.innerHTML = "<strong>" + d.y + "</strong> · " + d.cap + " capacity<br>Revenue <b>₹" + d.rev.toFixed(2) + " Cr</b> · EBITDA <b>₹" + d.ebitda.toFixed(2) + " Cr</b><br>Net profit ₹" + d.net.toFixed(2) + " Cr";
      var box = svg.getBoundingClientRect(), fb = fig.getBoundingClientRect();
      tip.style.left = (box.left - fb.left + (cx / W) * box.width) + "px";
      tip.style.top = (box.top - fb.top + (y(d.rev) / H) * box.height - 14) + "px";
    }
    hit.addEventListener("mouseenter", show);
    hit.addEventListener("mouseleave", function () { tip.hidden = true; });
    hit.setAttribute("tabindex", "0");
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", function () { tip.hidden = true; });
  });
  plot.appendChild(svg);
})();
