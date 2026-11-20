// The motion kit's runtime (stage 5). Runs inside the compositor's page:
// MK.mount(spec, el) builds one shot's graphics from its JSON spec, and the
// returned update(local, dur) poses every piece for a moment of the shot.
// Everything is a pure function of time, so a frame looks the same however
// fast the machine draws it. Pieces are fully readable by 0.6 s.
(function () {
  const W = 1080;
  const LIME = "#a3e635";
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const prog = (l, start, len) => clamp((l - start) / Math.max(0.001, len));
  const outCubic = (x) => 1 - Math.pow(1 - x, 3);
  const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const outBack = (x) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const h = (tag, css, html) => {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const decimalsOf = (v) => {
    const m = String(v).match(/\.(\d+)/);
    return m ? Math.min(2, m[1].length) : 0;
  };
  /** Decimals to show: money with cents shows two ($4.20), everything else as written. */
  const decs = (values, prefix, suffix) => {
    const d = Math.max(0, ...values.map(decimalsOf));
    return d && String(prefix || "").includes("$") && !String(suffix || "").trim() ? 2 : d;
  };
  const fmt = (v, dec, prefix, suffix) => (prefix || "") + Number(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (suffix || "");

  const THEMES = {
    navy: ["#070b18", "#141d3a", "#1e3a8a", "#4c1d95"],
    red: ["#14070a", "#3a0d16", "#991b1b", "#7c2d12"],
    green: ["#06120c", "#0f2a1d", "#166534", "#115e59"],
    gold: ["#140f06", "#33250b", "#a16207", "#9a3412"],
    slate: ["#0a0c10", "#1c2230", "#334155", "#1e293b"],
  };

  const ICONS = {
    dollar: "M50 10 V90 M68 28 C62 18 36 16 33 31 C30 46 70 44 67 62 C64 79 36 81 30 70",
    up: "M16 76 L42 50 L58 62 L84 30 M66 30 H84 V48",
    down: "M16 28 L42 54 L58 42 L84 74 M66 74 H84 V56",
    phone: "M33 10 H67 Q74 10 74 17 V83 Q74 90 67 90 H33 Q26 90 26 83 V17 Q26 10 33 10 Z M44 80 H56",
    chip: "M30 30 H70 V70 H30 Z M41 41 H59 V59 H41 Z M38 30 V18 M50 30 V18 M62 30 V18 M38 70 V82 M50 70 V82 M62 70 V82 M30 38 H18 M30 50 H18 M30 62 H18 M70 38 H82 M70 50 H82 M70 62 H82",
    court: "M14 36 L50 14 L86 36 Z M22 42 V72 M38 42 V72 M62 42 V72 M78 42 V72 M14 80 H86 M10 88 H90",
    factory: "M12 88 V50 L32 62 V50 L52 62 V50 L72 62 V18 H84 V88 Z M24 76 H32 M44 76 H52 M64 76 H72",
    house: "M14 48 L50 16 L86 48 M24 40 V86 H76 V40 M42 86 V62 H58 V86",
    car: "M12 66 V54 L24 36 H70 L86 52 V66 Z M20 66 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M64 66 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0",
    cart: "M8 18 H22 L33 64 H78 L87 32 H27 M34 80 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M66 80 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0",
    globe: "M50 12 A38 38 0 1 0 50.01 12 M12 50 H88 M50 12 C30 30 30 70 50 88 M50 12 C70 30 70 70 50 88",
    warning: "M50 12 L90 84 H10 Z M50 38 V60 M50 71 V73",
    clock: "M50 12 A38 38 0 1 0 50.01 12 M50 28 V50 L66 60",
    check: "M20 52 L42 74 L82 28",
    cross: "M26 26 L74 74 M74 26 L26 74",
    question: "M34 36 C34 16 66 16 66 36 C66 50 50 50 50 64 M50 78 V80",
    person: "M50 14 A14 14 0 1 0 50.01 14 M22 88 C22 58 78 58 78 88",
    people: "M36 20 A12 12 0 1 0 36.01 20 M12 82 C12 56 60 56 60 82 M66 24 A11 11 0 1 0 66.01 24 M62 54 C78 52 90 62 90 80",
    lock: "M28 46 H72 V86 H28 Z M38 46 V34 C38 16 62 16 62 34 V46 M50 62 V70",
    bolt: "M56 8 L24 56 H48 L42 92 L76 42 H52 Z",
    game: "M22 38 H78 C92 38 96 78 82 81 C73 83 68 70 62 66 H38 C32 70 27 83 18 81 C4 78 8 38 22 38 Z M30 50 V62 M24 56 H36 M66 51 V53 M72 58 V60",
    calendar: "M16 24 H84 V86 H16 Z M16 40 H84 M34 14 V30 M66 14 V30 M30 54 H38 M46 54 H54 M62 54 H70 M30 68 H38 M46 68 H54",
    egg: "M50 12 C30 12 22 50 22 62 C22 80 36 90 50 90 C64 90 78 80 78 62 C78 50 70 12 50 12 Z",
    chart: "M14 86 H86 M26 86 V58 M44 86 V38 M62 86 V50 M80 86 V20",
    robot: "M26 34 H74 V78 H26 Z M50 34 V20 M50 14 V16 M40 52 V56 M60 52 V56 M40 66 H60 M26 54 H16 M74 54 H84",
    mail: "M12 26 H88 V76 H12 Z M12 26 L50 54 L88 26",
    heart: "M50 84 C20 62 10 46 21 30 C32 15 46 21 50 32 C54 21 68 15 79 30 C90 46 80 62 50 84 Z",
    fire: "M50 8 C60 30 78 40 74 64 C70 84 54 92 50 92 C40 92 26 84 26 64 C26 48 40 42 40 26 C46 34 48 38 50 42 Z",
    plane: "M50 8 C55 8 56 16 56 24 V40 L88 58 V66 L56 56 V76 L66 84 V90 L50 86 L34 90 V84 L44 76 V56 L12 66 V58 L44 40 V24 C44 16 45 8 50 8 Z",
    store: "M14 40 L20 16 H80 L86 40 Z M14 40 C14 50 32 50 32 40 C32 50 50 50 50 40 C50 50 68 50 68 40 C68 50 86 50 86 40 M20 48 V86 H80 V48 M42 86 V64 H58 V86",
    pill: "M30 70 L70 30 A14 14 0 0 0 50 10 L10 50 A14 14 0 0 0 30 70 Z M30 30 L50 50",
    battery: "M12 30 H80 V70 H12 Z M80 42 H88 V58 H80 M22 40 V60 M34 40 V60 M46 40 V60",
  };

  // A piece sits in a box centred on (cx, cy); update poses it at local time l of a shot lasting d.
  const PIECES = {
    title(p) {
      const words = String(p.text || "").split(/\s+/).filter(Boolean);
      const hi = new Set((p.highlight ? String(p.highlight) : "").toLowerCase().split(/\s+/).filter(Boolean));
      const size = Math.min(150, Math.max(84, 1500 / Math.max(6, String(p.text || "").length)));
      const el = h("div", `width:920px;text-align:center;font:900 ${size}px/1.02 Montserrat,sans-serif;text-transform:uppercase;letter-spacing:-.02em;color:#fff`);
      const spans = words.map((w) => {
        const sp = h("span", `display:inline-block;margin:0 .14em;${hi.has(w.toLowerCase().replace(/[^a-z0-9%$.]/g, "")) ? `color:${LIME}` : ""}`, esc(w));
        el.appendChild(sp);
        return sp;
      });
      return {
        el,
        update(l) {
          spans.forEach((sp, k) => {
            const q = prog(l, 0.05 + k * 0.07, 0.42);
            sp.style.opacity = String(clamp(q * 3));
            sp.style.transform = `translateY(${(1 - outBack(q)) * 90}px) scale(${0.7 + 0.3 * outBack(q)})`;
          });
          el.style.transform = `scale(${1 + 0.015 * Math.sin(l * 2.2)})`;
        },
      };
    },

    headline(p) {
      const el = h("div", "width:900px;background:#f8fafc;border-radius:30px;padding:44px 48px 48px 64px;box-shadow:0 30px 80px rgba(0,0,0,.55);position:relative;overflow:hidden;text-align:left");
      const bar = h("div", `position:absolute;left:0;top:0;width:18px;height:0;background:${LIME}`);
      const top = h("div", "display:flex;justify-content:space-between;align-items:center;margin-bottom:24px");
      top.appendChild(h("span", "font:800 30px Montserrat,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:#0f172a;padding:8px 18px;border-radius:10px", esc(p.publisher)));
      top.appendChild(h("span", "font:700 30px Montserrat,sans-serif;color:#64748b", esc(p.date || "")));
      const text = h("div", `font:800 ${String(p.text || "").length > 70 ? 54 : 62}px/1.13 Montserrat,sans-serif;color:#0f172a`, esc(p.text));
      el.append(bar, top, text);
      return {
        el,
        update(l) {
          const q = prog(l, 0, 0.55);
          el.style.opacity = String(clamp(q * 3));
          el.style.transform = `translateY(${(1 - outBack(q)) * 160 + Math.sin(l * 1.6) * 6}px) rotate(${-1.5 - (1 - q) * 4}deg)`;
          bar.style.height = `${outCubic(prog(l, 0.35, 0.5)) * 100}%`;
        },
      };
    },

    counter(p) {
      const to = Number(p.to), from = Number(p.from ?? 0);
      const dec = p.decimals != null ? clamp(Number(p.decimals), 0, 2) : decs([p.to, p.from ?? 0], p.prefix, p.suffix);
      const longest = fmt(Math.max(Math.abs(to), Math.abs(from)), dec, p.prefix, p.suffix).length;
      // Sized to sit inside the ring (about 560 px across).
      const size = Math.min(220, Math.floor(880 / Math.max(3, longest)));
      const el = h("div", "width:900px;height:760px;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center");
      const ring = s("svg", { width: 760, height: 760, viewBox: "0 0 760 760", style: "position:absolute;left:70px;top:0" });
      ring.appendChild(s("circle", { cx: 380, cy: 380, r: 340, fill: "none", stroke: "rgba(255,255,255,.08)", "stroke-width": 18 }));
      const arc = s("circle", { cx: 380, cy: 380, r: 340, fill: "none", stroke: LIME, "stroke-width": 18, "stroke-linecap": "round", transform: "rotate(-90 380 380)", "stroke-dasharray": String(2 * Math.PI * 340), "stroke-dashoffset": String(2 * Math.PI * 340) });
      ring.appendChild(arc);
      const num = h("div", `position:relative;font:900 ${size}px/1 Montserrat,sans-serif;color:#fff;letter-spacing:-.03em;text-shadow:0 0 40px rgba(163,230,53,.35);font-variant-numeric:tabular-nums`);
      const label = h("div", "position:relative;margin-top:26px;max-width:600px;text-align:center;font:800 50px/1.12 Montserrat,sans-serif;text-transform:uppercase;letter-spacing:.03em;color:rgba(255,255,255,.82)", esc(p.label || ""));
      el.append(ring, num, label);
      return {
        el,
        update(l, d) {
          const qin = prog(l, 0, 0.45);
          el.style.opacity = String(clamp(qin * 3));
          const len = Math.min(1.6, Math.max(0.6, d * 0.45));
          const c = outCubic(prog(l, 0.12, len));
          num.textContent = fmt(from + (to - from) * c, dec, p.prefix, p.suffix);
          const done = l - (0.12 + len);
          const bump = done > 0 ? 0.07 * Math.exp(-7 * done) * Math.cos(done * 14) : 0;
          num.style.transform = `scale(${0.6 + 0.4 * outBack(qin) + bump})`;
          arc.setAttribute("stroke-dashoffset", String(2 * Math.PI * 340 * (1 - c)));
          label.style.opacity = String(prog(l, 0.2, 0.3));
          el.style.transform = `translateY(${Math.sin(l * 1.4) * 6}px)`;
        },
      };
    },

    bars(p) {
      const items = (p.items || []).slice(0, 5);
      const n = items.length;
      const max = Math.max(...items.map((i) => Number(i.value)), 0.0001);
      const dec = decs(items.map((i) => i.value), p.prefix, p.unit);
      const bw = Math.min(170, Math.floor(700 / n));
      const gap = (860 - bw * n) / (n + 1);
      const el = h("div", "width:900px;height:860px;position:relative");
      if (p.title) el.appendChild(h("div", "position:absolute;left:0;right:0;top:0;text-align:center;font:800 52px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:#fff", esc(p.title)));
      const base = 700;
      el.appendChild(h("div", `position:absolute;left:20px;right:20px;top:${base}px;height:4px;background:rgba(255,255,255,.5);border-radius:2px`));
      const rows = items.map((it, k) => {
        const hiK = p.highlight != null ? (typeof p.highlight === "number" ? p.highlight === k : String(p.highlight).toLowerCase() === String(it.name).toLowerCase()) : k === n - 1;
        const x = 20 + gap + k * (bw + gap);
        const bar = h("div", `position:absolute;left:${x}px;width:${bw}px;bottom:${860 - base}px;height:0;border-radius:18px 18px 4px 4px;background:${hiK ? LIME : "rgba(255,255,255,.3)"};${hiK ? "box-shadow:0 0 40px rgba(163,230,53,.4)" : ""}`);
        const val = h("div", `position:absolute;left:${x - 40}px;width:${bw + 80}px;text-align:center;font:900 ${hiK ? 58 : 48}px/1 Montserrat,sans-serif;color:${hiK ? LIME : "#fff"};font-variant-numeric:tabular-nums`);
        const name = h("div", `position:absolute;left:${x - 40}px;width:${bw + 80}px;top:${base + 22}px;text-align:center;font:800 ${n > 3 ? 32 : 38}px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.85)`, esc(it.name));
        el.append(bar, val, name);
        return { bar, val, name, v: Number(it.value), k };
      });
      const top = p.title ? 110 : 40;
      return {
        el,
        update(l) {
          el.style.opacity = String(clamp(prog(l, 0, 0.2) * 1.5));
          for (const r of rows) {
            const q = outCubic(prog(l, 0.1 + r.k * 0.12, 0.7));
            const hpx = (r.v / max) * (base - top - 90) * q;
            r.bar.style.height = `${hpx}px`;
            r.val.style.top = `${base - hpx - 70}px`;
            r.val.textContent = fmt(r.v * q, dec, p.prefix, p.unit);
            r.val.style.opacity = String(clamp(q * 4));
            r.name.style.opacity = String(prog(l, 0.05 + r.k * 0.12, 0.25));
          }
        },
      };
    },

    line(p) {
      const pts = (p.points || []).slice(0, 8);
      const vals = pts.map((x) => Number(x.value));
      const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.12 || 1;
      const dec = decs(pts.map((x) => x.value), p.prefix, p.unit);
      const el = h("div", "width:900px;height:820px;position:relative");
      if (p.title) el.appendChild(h("div", "position:absolute;left:0;right:0;top:0;text-align:center;font:800 52px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:#fff", esc(p.title)));
      const svg = s("svg", { width: 900, height: 820, viewBox: "0 0 900 820", style: "position:absolute;left:0;top:0;overflow:visible" });
      const X = (k) => 70 + (k * 760) / Math.max(1, pts.length - 1);
      const Y = (v) => 690 - ((v - lo) / (hi - lo)) * 520;
      const d = pts.map((x, k) => `${k ? "L" : "M"}${X(k).toFixed(1)} ${Y(vals[k]).toFixed(1)}`).join(" ");
      const defs = s("defs", {});
      const grad = s("linearGradient", { id: "mkfill", x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.append(s("stop", { offset: 0, "stop-color": LIME, "stop-opacity": 0.45 }), s("stop", { offset: 1, "stop-color": LIME, "stop-opacity": 0 }));
      defs.appendChild(grad);
      svg.appendChild(defs);
      svg.appendChild(s("line", { x1: 40, x2: 860, y1: 690, y2: 690, stroke: "rgba(255,255,255,.45)", "stroke-width": 4 }));
      const area = s("path", { d: `${d} L${X(pts.length - 1)} 690 L${X(0)} 690 Z`, fill: "url(#mkfill)", opacity: 0 });
      const path = s("path", { d, fill: "none", stroke: LIME, "stroke-width": 12, "stroke-linecap": "round", "stroke-linejoin": "round" });
      svg.append(area, path);
      const dots = pts.map((x, k) => {
        const c = s("circle", { cx: X(k), cy: Y(vals[k]), r: 0, fill: k === pts.length - 1 ? LIME : "#fff" });
        svg.appendChild(c);
        return c;
      });
      el.appendChild(svg);
      const labels = pts.map((x, k) => {
        const t = h("div", `position:absolute;top:712px;left:${X(k) - 90}px;width:180px;text-align:center;font:800 38px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.85)`, esc(x.label));
        el.appendChild(t);
        return t;
      });
      const last = h("div", `position:absolute;font:900 76px/1 Montserrat,sans-serif;color:${LIME};text-shadow:0 0 30px rgba(163,230,53,.4);white-space:nowrap`);
      el.appendChild(last);
      let total = 0;
      return {
        el,
        update(l, dur) {
          if (!total) total = path.getTotalLength() || 1;
          el.style.opacity = String(clamp(prog(l, 0, 0.2) * 1.5));
          const len = Math.min(1.4, Math.max(0.6, dur * 0.45));
          const q = inOutCubic(prog(l, 0.1, len));
          path.setAttribute("stroke-dasharray", String(total));
          path.setAttribute("stroke-dashoffset", String(total * (1 - q)));
          area.setAttribute("opacity", String(q));
          dots.forEach((c, k) => {
            const at = pts.length > 1 ? k / (pts.length - 1) : 1;
            const pop = prog(q, at - 0.001, 0.08);
            c.setAttribute("r", String((k === pts.length - 1 ? 20 : 12) * outBack(clamp(pop))));
          });
          labels.forEach((t, k) => (t.style.opacity = String(prog(l, 0.1 + (k / Math.max(1, pts.length - 1)) * len, 0.2))));
          const lx = X(pts.length - 1), ly = Y(vals[pts.length - 1]);
          last.textContent = fmt(vals[pts.length - 1] * q, dec, p.prefix, p.unit);
          last.style.left = `${Math.min(lx - 120, 900 - last.offsetWidth)}px`;
          last.style.top = `${ly - 110}px`;
          last.style.opacity = String(prog(l, 0.1 + len * 0.8, 0.25));
        },
      };
    },

    compare(p) {
      const el = h("div", "width:960px;height:640px;position:relative");
      const sides = ["left", "right"].map((side, k) => {
        const it = p[side] || {};
        const win = p.highlight === side;
        const card = h("div", `position:absolute;top:40px;${side}:0;width:420px;height:560px;border-radius:32px;background:${win ? "rgba(163,230,53,.12)" : "rgba(255,255,255,.07)"};border:6px solid ${win ? LIME : "rgba(255,255,255,.25)"};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;text-align:center`);
        const dec = decs([it.value], p.prefix ?? it.prefix, p.unit ?? it.unit);
        const raw = it.value != null && it.value !== "" && Number.isFinite(Number(it.value));
        const vlen = Math.max(1, String(it.value ?? "").length);
        const val = h("div", `font:900 ${Math.min(116, Math.floor(350 / (0.68 * vlen)))}px/1 Montserrat,sans-serif;white-space:nowrap;color:${win ? LIME : "#fff"};font-variant-numeric:tabular-nums`);
        const name = h("div", "margin-top:30px;font:800 44px/1.12 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.88)", esc(it.name));
        card.append(val, name);
        el.appendChild(card);
        return { card, val, it, dec, raw, k, side };
      });
      const vs = h("div", "position:absolute;left:50%;top:320px;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;background:#0f172a;border:6px solid #fff;display:flex;align-items:center;justify-content:center;font:900 54px Montserrat,sans-serif;color:#fff", "VS");
      el.appendChild(vs);
      return {
        el,
        update(l) {
          for (const x of sides) {
            const q = prog(l, x.k * 0.12, 0.5);
            x.card.style.opacity = String(clamp(q * 3));
            x.card.style.transform = `translateX(${(1 - outBack(q)) * (x.side === "left" ? -260 : 260)}px)`;
            const c = outCubic(prog(l, 0.2 + x.k * 0.12, 0.8));
            x.val.textContent = x.raw ? fmt(Number(x.it.value) * c, x.dec, p.prefix ?? x.it.prefix, p.unit ?? x.it.unit) : String(x.it.value ?? "");
          }
          const v = prog(l, 0.35, 0.35);
          vs.style.transform = `scale(${outBack(v)}) rotate(${(1 - v) * -40}deg)`;
        },
      };
    },

    quote(p) {
      const el = h("div", "width:900px;position:relative;text-align:left;padding-top:120px");
      const mark = h("div", `position:absolute;left:-10px;top:-60px;font:900 300px/1 Georgia,serif;color:${LIME}`, "“");
      const words = String(p.text || "").split(/\s+/).filter(Boolean);
      const size = String(p.text || "").length > 90 ? 64 : 78;
      const body = h("div", `font:800 ${size}px/1.16 Montserrat,sans-serif;color:#fff`);
      const spans = words.map((w) => {
        const sp = h("span", "display:inline-block;margin-right:.25em", esc(w));
        body.appendChild(sp);
        return sp;
      });
      const who = h("div", `margin-top:34px;font:800 38px Montserrat,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${LIME}`, esc(p.who ? `— ${p.who}` : ""));
      el.append(mark, body, who);
      return {
        el,
        update(l, d) {
          const m = prog(l, 0, 0.4);
          mark.style.transform = `scale(${outBack(m)})`;
          mark.style.opacity = String(clamp(m * 3));
          const len = Math.min(1.0, Math.max(0.4, d * 0.35));
          spans.forEach((sp, k) => {
            const q = prog(l, 0.15 + (k / Math.max(1, spans.length)) * len, 0.18);
            sp.style.opacity = String(q);
            sp.style.transform = `translateY(${(1 - outCubic(q)) * 24}px)`;
          });
          who.style.opacity = String(prog(l, 0.2 + len, 0.3));
        },
      };
    },

    list(p) {
      const items = (p.items || []).slice(0, 4);
      const el = h("div", "width:900px;text-align:left");
      if (p.title) el.appendChild(h("div", "font:800 54px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:#fff;margin-bottom:36px", esc(p.title)));
      const rows = items.map((t, k) => {
        const row = h("div", "display:flex;align-items:center;gap:30px;margin:0 0 30px;padding:26px 30px;border-radius:24px;background:rgba(255,255,255,.08)");
        const tick = h("div", `flex:none;width:76px;height:76px;border-radius:50%;background:${LIME};display:flex;align-items:center;justify-content:center`, `<svg width="46" height="46" viewBox="0 0 100 100"><path d="${ICONS.check}" fill="none" stroke="#0f172a" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
        const text = h("div", "font:800 50px/1.12 Montserrat,sans-serif;color:#fff", esc(t));
        row.append(tick, text);
        el.appendChild(row);
        return { row, tick, k };
      });
      return {
        el,
        update(l, d) {
          const step = Math.min(0.35, Math.max(0.15, (d * 0.5) / Math.max(1, rows.length)));
          for (const r of rows) {
            const q = prog(l, 0.05 + r.k * step, 0.4);
            r.row.style.opacity = String(clamp(q * 3));
            r.row.style.transform = `translateX(${(1 - outBack(q)) * -220}px)`;
            r.tick.style.transform = `scale(${outBack(prog(l, 0.2 + r.k * step, 0.3))})`;
          }
        },
      };
    },

    icon(p) {
      const path = ICONS[p.name] || ICONS.question;
      const el = h("div", "width:900px;height:860px;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center");
      // A tilted lime tile, not a ring (Thomas, 2026-11-20: too many green circles).
      const disc = h("div", `position:relative;width:480px;height:480px;border-radius:110px;background:linear-gradient(145deg,#d9f99d,${LIME} 55%,#65a30d);box-shadow:0 30px 70px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center`);
      const svg = s("svg", { width: 300, height: 300, viewBox: "0 0 100 100" });
      const ph = s("path", { d: path, fill: "none", stroke: "#0f172a", "stroke-width": 7, "stroke-linecap": "round", "stroke-linejoin": "round", pathLength: 1, "stroke-dasharray": 1, "stroke-dashoffset": 1 });
      svg.appendChild(ph);
      disc.appendChild(svg);
      const rings = [0, 1].map(() => {
        const r = h("div", `position:absolute;left:50%;top:50%;width:480px;height:480px;margin:-240px 0 0 -240px;border-radius:110px;border:6px solid ${LIME};opacity:0`);
        disc.appendChild(r);
        return r;
      });
      const label = h("div", "margin-top:56px;max-width:880px;text-align:center;font:900 64px/1.08 Montserrat,sans-serif;text-transform:uppercase;color:#fff", esc(p.label || ""));
      el.append(disc, label);
      return {
        el,
        update(l) {
          const q = prog(l, 0, 0.5);
          disc.style.transform = `scale(${outBack(q)}) translateY(${Math.sin(l * 1.8) * 8}px) rotate(${-8 + (1 - q) * 30}deg)`;
          disc.style.opacity = String(clamp(q * 3));
          ph.setAttribute("stroke-dashoffset", String(1 - inOutCubic(prog(l, 0.15, 0.6))));
          rings.forEach((r, k) => {
            const ph2 = ((l - 0.4 - k * 0.6) % 1.2 + 1.2) % 1.2 / 1.2;
            const on = l > 0.4 + k * 0.6;
            r.style.opacity = on ? String(0.6 * (1 - ph2)) : "0";
            r.style.transform = `scale(${1 + ph2 * 0.45})`;
          });
          label.style.opacity = String(prog(l, 0.25, 0.3));
          label.style.transform = `translateY(${(1 - outCubic(prog(l, 0.25, 0.4))) * 40}px)`;
        },
      };
    },

    timeline(p) {
      const items = (p.items || []).slice(0, 4);
      const n = items.length;
      const hiK = typeof p.highlight === "number" ? p.highlight : n - 1;
      const el = h("div", "width:900px;height:760px;position:relative");
      if (p.title) el.appendChild(h("div", "position:absolute;left:0;right:0;top:0;text-align:center;font:800 52px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:#fff", esc(p.title)));
      const y = 420;
      const x0 = n > 3 ? 120 : 150, span = 900 - 2 * x0;
      const track = h("div", `position:absolute;left:${x0}px;top:${y - 5}px;height:10px;width:0;background:rgba(255,255,255,.6);border-radius:5px`);
      el.appendChild(track);
      const X = (k) => x0 + (n > 1 ? (k * span) / (n - 1) : span / 2);
      const bw = n > 3 ? 230 : 290;
      const pts = items.map((it, k) => {
        const hi = k === hiK;
        const dot = h("div", `position:absolute;left:${X(k) - 28}px;top:${y - 28}px;width:56px;height:56px;border-radius:50%;background:${hi ? LIME : "#fff"};border:8px solid #0f172a`);
        const above = k % 2 === 0;
        const box = h("div", `position:absolute;left:${clamp(X(k) - bw / 2, 0, 900 - bw)}px;width:${bw}px;${above ? `bottom:${760 - y + 60}px` : `top:${y + 60}px`};text-align:center`);
        const dlen = Math.max(1, String(it.date ?? "").length);
        box.appendChild(h("div", `font:900 ${Math.min(hi ? 72 : 58, Math.floor(bw / (0.7 * dlen)))}px/1 Montserrat,sans-serif;white-space:nowrap;color:${hi ? LIME : "#fff"}`, esc(it.date)));
        box.appendChild(h("div", `margin-top:14px;font:800 ${hi ? 44 : 38}px/1.1 Montserrat,sans-serif;text-transform:uppercase;overflow-wrap:anywhere;color:rgba(255,255,255,.88)`, esc(it.label)));
        el.append(dot, box);
        return { dot, box, k, hi, above };
      });
      return {
        el,
        update(l, d) {
          const len = Math.min(1.2, Math.max(0.5, d * 0.4));
          const q = inOutCubic(prog(l, 0.05, len));
          track.style.width = `${q * span}px`;
          for (const x of pts) {
            const at = n > 1 ? x.k / (n - 1) : 0;
            const pop = prog(l, 0.05 + at * len, 0.3);
            const pulse = x.hi && pop >= 1 ? 1 + 0.12 * Math.max(0, Math.sin((l - 0.05 - at * len - 0.3) * 5)) : 1;
            x.dot.style.transform = `scale(${outBack(pop) * pulse})`;
            x.box.style.opacity = String(clamp(pop * 2));
            x.box.style.transform = `translateY(${(1 - outCubic(pop)) * (x.above ? 30 : -30)}px)`;
          }
        },
      };
    },
    // ---- Added 2026-11-20 (Thomas: "why is there green circles for nearly every slide").
    // Each piece below has its own shape and colour, so a Reel that uses every
    // kind once never shows the same picture twice.

    waffle(p) {
      const pct = clamp(Number(p.percent), 0, 100);
      const lit = Math.round(pct);
      const dec = decs([p.percent]);
      const el = h("div", "width:900px;height:860px;position:relative;display:flex;flex-direction:column;align-items:center");
      const num = h("div", `font:900 140px/1 Montserrat,sans-serif;color:#fff;letter-spacing:-.03em;font-variant-numeric:tabular-nums`);
      const grid = h("div", "margin-top:26px;display:grid;grid-template-columns:repeat(10,52px);gap:9px");
      const cells = Array.from({ length: 100 }, (_, k) => {
        const c = h("div", "width:52px;height:52px;border-radius:12px;background:rgba(255,255,255,.14)");
        grid.appendChild(c);
        return { c, row: Math.floor(k / 10), col: k % 10, k };
      });
      const label = h("div", "margin-top:28px;max-width:880px;text-align:center;font:800 48px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.85)", esc(p.label || ""));
      el.append(num, grid, label);
      return {
        el,
        update(l, d) {
          for (const x of cells) {
            const q = prog(l, (x.row + x.col) * 0.02, 0.25);
            x.c.style.transform = `scale(${outBack(q)})`;
          }
          const len = Math.min(1.4, Math.max(0.5, d * 0.45));
          const c = outCubic(prog(l, 0.35, len));
          const on = Math.round(lit * c);
          for (const x of cells) {
            const isOn = x.k < on;
            x.c.style.background = isOn ? LIME : "rgba(255,255,255,.14)";
            x.c.style.boxShadow = isOn ? "0 0 18px rgba(163,230,53,.55)" : "none";
          }
          num.textContent = fmt(pct * c, dec, "", "%");
          num.style.opacity = String(prog(l, 0, 0.25));
          label.style.opacity = String(prog(l, 0.3, 0.3));
        },
      };
    },

    people(p) {
      const of = clamp(Math.round(Number(p.of)), 2, 20);
      const count = clamp(Math.round(Number(p.count)), 0, of);
      const per = of <= 5 ? of : of <= 10 ? 5 : of <= 15 ? 5 : 5;
      const rows = Math.ceil(of / per);
      const sz = rows > 2 ? 120 : 150;
      const el = h("div", "width:900px;position:relative;display:flex;flex-direction:column;align-items:center");
      const big = h("div", "font:900 120px/1 Montserrat,sans-serif;color:#fff;letter-spacing:-.02em;margin-bottom:30px", `<span style="color:${LIME}">${count}</span> IN ${of}`);
      const grid = h("div", `display:grid;grid-template-columns:repeat(${per},${sz}px);gap:22px 26px`);
      const figs = Array.from({ length: of }, (_, k) => {
        const f = h("div", `width:${sz}px;height:${sz}px`, `<svg width="${sz}" height="${sz}" viewBox="0 0 100 100"><circle cx="50" cy="26" r="17" fill="currentColor"/><path d="M18 96 C18 58 82 58 82 96 Z" fill="currentColor"/></svg>`);
        f.style.color = "rgba(255,255,255,.28)";
        grid.appendChild(f);
        return { f, k, hi: k < count };
      });
      const label = h("div", "margin-top:34px;max-width:880px;text-align:center;font:800 50px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.88)", esc(p.label || ""));
      el.append(big, grid, label);
      return {
        el,
        update(l, d) {
          big.style.opacity = String(prog(l, 0, 0.3));
          big.style.transform = `scale(${0.7 + 0.3 * outBack(prog(l, 0, 0.4))})`;
          const step = Math.min(0.06, (d * 0.3) / of);
          for (const x of figs) {
            const q = prog(l, 0.1 + x.k * step, 0.3);
            const turn = x.hi ? prog(l, 0.2 + of * step + x.k * 0.08, 0.2) : 0;
            x.f.style.transform = `translateY(${(1 - outBack(q)) * 60}px) scale(${1 + 0.18 * Math.sin(Math.PI * turn)})`;
            x.f.style.opacity = String(clamp(q * 3));
            x.f.style.color = turn > 0.5 ? LIME : "rgba(255,255,255,.28)";
            x.f.style.filter = turn > 0.5 ? "drop-shadow(0 0 16px rgba(163,230,53,.6))" : "none";
          }
          label.style.opacity = String(prog(l, 0.35, 0.3));
        },
      };
    },

    stack(p) {
      const to = Number(p.to);
      const dec = decs([p.to], p.prefix, p.suffix);
      const GOLD = "#facc15";
      const el = h("div", "width:900px;height:860px;position:relative");
      const num = h("div", `position:absolute;left:0;right:0;top:0;text-align:center;font:900 150px/1 Montserrat,sans-serif;color:${GOLD};letter-spacing:-.03em;text-shadow:0 0 40px rgba(250,204,21,.35);font-variant-numeric:tabular-nums`);
      const label = h("div", "position:absolute;left:0;right:0;top:170px;text-align:center;font:800 46px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.85)", esc(p.label || ""));
      el.append(num, label);
      const heights = [7, 11, 9, 5];
      const coins = [];
      heights.forEach((n, col) => {
        for (let k = 0; k < n; k++) {
          const c = h("div", `position:absolute;left:${120 + col * 170}px;top:${790 - k * 40}px;width:150px;height:52px;border-radius:50%;background:linear-gradient(180deg,#fde68a,${GOLD} 45%,#a16207);border:4px solid #854d0e;box-shadow:0 6px 0 #713f12`);
          el.appendChild(c);
          coins.push({ c, order: k * heights.length + col, top: 790 - k * 40 });
        }
      });
      coins.sort((a, b) => a.order - b.order);
      return {
        el,
        update(l, d) {
          const len = Math.min(1.5, Math.max(0.6, d * 0.5));
          coins.forEach((x, i) => {
            const at = 0.05 + (i / coins.length) * len;
            const q = prog(l, at, 0.22);
            const fall = (1 - q) * (1 - q);
            x.c.style.transform = `translateY(${-700 * fall}px)`;
            x.c.style.opacity = q > 0 ? "1" : "0";
          });
          const c = outCubic(prog(l, 0.05, len + 0.2));
          num.textContent = fmt(to * c, dec, p.prefix, p.suffix);
          const done = l - (0.25 + len);
          num.style.transform = `scale(${1 + (done > 0 ? 0.08 * Math.exp(-7 * done) * Math.cos(done * 14) : 0)})`;
          label.style.opacity = String(prog(l, 0.2, 0.3));
        },
      };
    },

    flow(p) {
      const el = h("div", "width:900px;height:860px;position:relative");
      const card = (txt, top, hi) => h("div", `position:absolute;left:90px;width:720px;top:${top}px;height:170px;border-radius:85px;background:${hi ? LIME : "rgba(255,255,255,.1)"};border:6px solid ${hi ? LIME : "rgba(255,255,255,.4)"};display:flex;align-items:center;justify-content:center;text-align:center;font:900 56px/1.05 Montserrat,sans-serif;text-transform:uppercase;color:${hi ? "#0f172a" : "#fff"};padding:0 40px`, esc(txt));
      const a = card(p.from, 0, false), b = card(p.to, 690, true);
      const pipe = h("div", "position:absolute;left:410px;top:170px;width:80px;height:520px;background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.12),rgba(255,255,255,.04));overflow:hidden");
      const dots = Array.from({ length: 9 }, () => {
        const d = h("div", `position:absolute;left:16px;width:48px;height:48px;border-radius:50%;background:${LIME};box-shadow:0 0 20px rgba(163,230,53,.7)`);
        pipe.appendChild(d);
        return d;
      });
      const head = h("div", `position:absolute;left:392px;top:618px;width:0;height:0;border-left:58px solid transparent;border-right:58px solid transparent;border-top:70px solid ${LIME}`);
      const tag = p.value ? h("div", `position:absolute;left:520px;top:340px;padding:14px 30px;border-radius:22px;background:#0f172a;border:5px solid ${LIME};font:900 74px/1 Montserrat,sans-serif;color:${LIME};white-space:nowrap`, esc(p.value)) : null;
      el.append(pipe, head, a, b);
      if (tag) el.appendChild(tag);
      return {
        el,
        update(l) {
          const qa = prog(l, 0, 0.4), qb = prog(l, 0.35, 0.4);
          a.style.opacity = String(clamp(qa * 3));
          a.style.transform = `translateY(${(1 - outBack(qa)) * -120}px)`;
          b.style.opacity = String(clamp(qb * 3));
          b.style.transform = `scale(${0.6 + 0.4 * outBack(qb)})`;
          const qp = inOutCubic(prog(l, 0.15, 0.4));
          pipe.style.clipPath = `inset(0 0 ${(1 - qp) * 100}% 0)`;
          head.style.opacity = String(prog(l, 0.45, 0.15));
          dots.forEach((d, k) => {
            const y = ((l * 420 + k * 64) % 576) - 56;
            d.style.transform = `translateY(${y}px)`;
            d.style.opacity = l > 0.3 ? "1" : "0";
          });
          if (tag) {
            const qt = prog(l, 0.5, 0.35);
            tag.style.opacity = String(clamp(qt * 3));
            tag.style.transform = `rotate(${-6 + (1 - outBack(qt)) * 20}deg) scale(${outBack(qt)})`;
          }
        },
      };
    },

    split(p) {
      const parts = (p.parts || []).slice(0, 4);
      const total = parts.reduce((a, x) => a + Math.max(0, Number(x.value)), 0) || 1;
      const hiK = typeof p.highlight === "number" ? p.highlight : 0;
      const OTHER = ["#60a5fa", "#f472b6", "rgba(255,255,255,.45)"];
      const dec = decs(parts.map((x) => x.value), p.prefix, p.unit);
      const el = h("div", "width:900px;position:relative");
      if (p.title) el.appendChild(h("div", "text-align:center;font:800 54px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:#fff;margin-bottom:40px", esc(p.title)));
      const bar = h("div", "position:relative;width:900px;height:170px;border-radius:30px;overflow:hidden;background:rgba(255,255,255,.08);display:flex");
      el.appendChild(bar);
      const legend = h("div", "margin-top:46px;display:flex;flex-direction:column;gap:22px");
      el.appendChild(legend);
      const segs = parts.map((x, k) => {
        const col = k === hiK ? LIME : OTHER[(k > hiK ? k - 1 : k) % OTHER.length];
        const seg = h("div", `height:100%;width:0;background:${col};${k ? "border-left:6px solid #0b1020" : ""}`);
        bar.appendChild(seg);
        const row = h("div", "display:flex;align-items:center;gap:26px");
        row.appendChild(h("div", `flex:none;width:56px;height:56px;border-radius:14px;background:${col}`));
        const val = h("div", `flex:none;min-width:250px;font:900 ${k === hiK ? 76 : 60}px/1 Montserrat,sans-serif;color:${k === hiK ? LIME : "#fff"};font-variant-numeric:tabular-nums`);
        row.append(val, h("div", "font:800 44px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.85)", esc(x.name)));
        legend.appendChild(row);
        return { seg, row, val, v: Math.max(0, Number(x.value)), k };
      });
      return {
        el,
        update(l, d) {
          const len = Math.min(1.3, Math.max(0.5, d * 0.45));
          for (const x of segs) {
            const q = outCubic(prog(l, 0.1 + (x.k * len) / Math.max(1, segs.length), len / Math.max(1, segs.length) + 0.2));
            x.seg.style.width = `${(x.v / total) * 100 * q}%`;
            x.val.textContent = fmt(x.v * q, dec, p.prefix, p.unit);
            x.row.style.opacity = String(clamp(q * 3));
            x.row.style.transform = `translateX(${(1 - outCubic(q)) * 80}px)`;
          }
        },
      };
    },

    calendar(p) {
      const RED = "#ef4444";
      const el = h("div", "width:900px;height:860px;position:relative;perspective:1600px");
      const page = (front) => {
        const pg = h("div", `position:absolute;left:190px;top:40px;width:520px;height:600px;border-radius:34px;background:#f8fafc;box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden;transform-origin:50% 0;backface-visibility:hidden`);
        pg.appendChild(h("div", `height:150px;background:${RED};display:flex;align-items:center;justify-content:center;font:900 76px Montserrat,sans-serif;letter-spacing:.08em;color:#fff;text-transform:uppercase`, esc(p.month || "")));
        pg.appendChild(h("div", `height:450px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#0f172a`, front ? `<div style="font:900 ${String(p.day || "").length > 2 ? 170 : 260}px/1 Montserrat,sans-serif;letter-spacing:-.04em">${esc(p.day || "")}</div>${p.weekday ? `<div style="margin-top:10px;font:800 50px Montserrat,sans-serif;color:${RED};text-transform:uppercase">${esc(p.weekday)}</div>` : ""}` : `<div style="width:260px;height:30px;border-radius:15px;background:#e2e8f0"></div>`));
        return pg;
      };
      const final = page(true);
      const flips = [0, 1, 2].map(() => page(false));
      el.appendChild(final);
      flips.slice().reverse().forEach((f) => el.appendChild(f));
      const rings = h("div", "position:absolute;left:250px;top:20px;width:400px;display:flex;justify-content:space-between");
      for (let k = 0; k < 4; k++) rings.appendChild(h("div", "width:26px;height:60px;border-radius:13px;background:#334155;border:5px solid #94a3b8"));
      el.appendChild(rings);
      const label = h("div", "position:absolute;left:0;right:0;top:690px;text-align:center;font:900 60px/1.08 Montserrat,sans-serif;text-transform:uppercase;color:#fff", esc(p.label || ""));
      el.appendChild(label);
      return {
        el,
        update(l) {
          const q = prog(l, 0, 0.35);
          el.style.opacity = String(clamp(q * 3));
          final.style.transform = `translateY(${(1 - outBack(q)) * 80}px)`;
          flips.forEach((f, k) => {
            const fq = inOutCubic(prog(l, 0.2 + k * 0.16, 0.22));
            f.style.transform = `translateY(${(1 - outBack(q)) * 80}px) rotateX(${fq * 110}deg)`;
            f.style.opacity = fq > 0.95 ? "0" : "1";
          });
          const land = l - 0.7;
          final.style.transform += ` scale(${1 + (land > 0 ? 0.05 * Math.exp(-6 * land) * Math.cos(land * 14) : 0)})`;
          label.style.opacity = String(prog(l, 0.6, 0.3));
          label.style.transform = `translateY(${(1 - outCubic(prog(l, 0.6, 0.4))) * 30}px)`;
        },
      };
    },

    ticker(p) {
      const change = String(p.change || "");
      const down = /^\s*[-−–]/.test(change);
      const COL = down ? "#f87171" : "#4ade80";
      const el = h("div", "width:920px;height:700px;position:relative;border-radius:36px;background:linear-gradient(160deg,rgba(15,23,42,.92),rgba(2,6,23,.92));border:3px solid rgba(255,255,255,.18);box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden");
      const top = h("div", "position:absolute;left:50px;right:50px;top:44px;display:flex;justify-content:space-between;align-items:center");
      top.appendChild(h("div", "font:900 54px Montserrat,sans-serif;letter-spacing:.06em;color:#fff;text-transform:uppercase", esc(p.name || "")));
      const badge = h("div", `padding:10px 24px;border-radius:16px;background:${COL};font:900 46px Montserrat,sans-serif;color:#052e16`, `${down ? "▼" : "▲"} ${esc(change.replace(/^\s*[+\-−–]/, ""))}`);
      if (change) top.appendChild(badge);
      const val = h("div", "position:absolute;left:50px;top:140px;font:900 150px/1 Montserrat,sans-serif;color:#fff;letter-spacing:-.03em", esc(p.value || ""));
      const svg = s("svg", { width: 920, height: 300, viewBox: "0 0 920 300", style: "position:absolute;left:0;top:320px" });
      const N = 40;
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const ys = Array.from({ length: N }, (_, k) => {
        const trend = down ? k / (N - 1) : 1 - k / (N - 1);
        return 40 + trend * 200 + (rnd() - 0.5) * 70;
      });
      const d = ys.map((y, k) => `${k ? "L" : "M"}${(30 + (k * 860) / (N - 1)).toFixed(1)} ${y.toFixed(1)}`).join(" ");
      const path = s("path", { d, fill: "none", stroke: COL, "stroke-width": 9, "stroke-linejoin": "round", "stroke-linecap": "round" });
      svg.appendChild(path);
      const tape = h("div", `position:absolute;left:0;bottom:0;height:70px;width:3000px;display:flex;align-items:center;gap:60px;background:rgba(255,255,255,.06);font:800 36px Montserrat,sans-serif;color:${COL};white-space:nowrap`);
      for (let k = 0; k < 10; k++) tape.appendChild(h("span", "", `${esc(p.name || "")} ${down ? "▼" : "▲"} ${esc(change.replace(/^\s*[+\-−–]/, ""))}`));
      el.append(top, val, svg, tape);
      if (p.label) el.appendChild(h("div", "position:absolute;right:50px;top:200px;max-width:330px;text-align:right;font:800 40px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.7)", esc(p.label)));
      let total = 0;
      return {
        el,
        update(l, dur) {
          if (!total) total = path.getTotalLength() || 1;
          const q = prog(l, 0, 0.4);
          el.style.opacity = String(clamp(q * 3));
          el.style.transform = `translateY(${(1 - outBack(q)) * 140}px) rotate(${1.5 * (1 - q)}deg)`;
          const len = Math.min(1.4, Math.max(0.6, dur * 0.5));
          path.setAttribute("stroke-dasharray", String(total));
          path.setAttribute("stroke-dashoffset", String(total * (1 - inOutCubic(prog(l, 0.15, len)))));
          badge.style.transform = `scale(${outBack(prog(l, 0.3, 0.3))})`;
          val.style.opacity = String(prog(l, 0.1, 0.25));
          tape.style.transform = `translateX(${-((l * 160) % 600)}px)`;
        },
      };
    },

    meter(p) {
      const v = Number(p.value), of = Number(p.of);
      const frac = clamp(of > 0 ? v / of : 0);
      const dec = decs([p.value, p.of], p.prefix, p.unit);
      const el = h("div", "width:900px;height:860px;position:relative");
      const tube = h("div", "position:absolute;left:150px;top:30px;width:150px;height:640px;border-radius:75px;background:rgba(255,255,255,.08);border:6px solid rgba(255,255,255,.5);overflow:hidden");
      const fill = h("div", `position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(0deg,#16a34a,${LIME})`);
      const wave = h("div", "position:absolute;left:-20px;right:-20px;height:30px;border-radius:50%;background:rgba(255,255,255,.35)");
      tube.append(fill, wave);
      const bulb = h("div", `position:absolute;left:115px;top:640px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle at 40% 35%,${LIME},#16a34a);border:6px solid rgba(255,255,255,.5)`);
      const goal = h("div", `position:absolute;left:330px;top:0;font:800 46px/1.1 Montserrat,sans-serif;color:rgba(255,255,255,.7);text-transform:uppercase`, `GOAL ${esc(fmt(of, decs([p.of], p.prefix, p.unit), p.prefix, p.unit))}`);
      const ticks = h("div", "position:absolute;left:310px;top:36px;width:40px;height:628px;background:repeating-linear-gradient(180deg,rgba(255,255,255,.5) 0 4px,transparent 4px 62px)");
      const num = h("div", `position:absolute;left:380px;font:900 130px/1 Montserrat,sans-serif;color:${LIME};letter-spacing:-.03em;font-variant-numeric:tabular-nums;white-space:nowrap`);
      const label = h("div", "position:absolute;left:380px;width:520px;font:800 44px/1.1 Montserrat,sans-serif;text-transform:uppercase;color:rgba(255,255,255,.88)", esc(p.label || ""));
      el.append(ticks, tube, bulb, goal, num, label);
      return {
        el,
        update(l, d) {
          el.style.opacity = String(clamp(prog(l, 0, 0.2) * 3));
          const len = Math.min(1.5, Math.max(0.6, d * 0.5));
          const c = outCubic(prog(l, 0.15, len));
          const hpx = 628 * frac * c;
          fill.style.height = `${hpx}px`;
          wave.style.bottom = `${hpx - 15}px`;
          wave.style.transform = `translateX(${Math.sin(l * 6) * 14}px)`;
          const y = 30 + 640 - hpx;
          num.textContent = fmt(v * c, dec, p.prefix, p.unit);
          num.style.top = `${Math.min(560, y - 40)}px`;
          // Near the top the number takes the goal's place, so the goal fades out.
          goal.style.opacity = String(clamp((y - 40 - 70) / 60));
          label.style.top = `${Math.min(560, y - 40) + 140}px`;
          label.style.opacity = String(prog(l, 0.3, 0.3));
          bulb.style.transform = `scale(${outBack(prog(l, 0, 0.35))})`;
        },
      };
    },

    chat(p) {
      const msgs = (p.messages || []).slice(0, 3);
      const el = h("div", "width:640px;height:880px;position:relative;border-radius:70px;background:#0b0f19;border:14px solid #1f2937;box-shadow:0 40px 90px rgba(0,0,0,.6);overflow:hidden");
      el.appendChild(h("div", "position:absolute;left:220px;top:18px;width:200px;height:40px;border-radius:20px;background:#1f2937"));
      el.appendChild(h("div", "position:absolute;left:0;right:0;top:80px;text-align:center;font:800 34px Montserrat,sans-serif;color:rgba(255,255,255,.75)", esc(p.title || "Messages")));
      const rows = msgs.map((m, k) => {
        const mine = k % 2 === 1;
        const b = h("div", `position:absolute;${mine ? "right" : "left"}:34px;top:${170 + k * 220}px;max-width:470px;padding:26px 32px;border-radius:40px;${mine ? `border-bottom-right-radius:10px;background:${LIME};color:#0f172a` : "border-bottom-left-radius:10px;background:#334155;color:#fff"};font:800 42px/1.15 Montserrat,sans-serif`, esc(m));
        el.appendChild(b);
        return { b, k, mine };
      });
      const dots = h("div", `position:absolute;left:34px;top:${170 + rows.length * 220}px;padding:22px 30px;border-radius:40px;background:#334155;display:flex;gap:12px`);
      const ds = [0, 1, 2].map(() => {
        const d = h("div", "width:20px;height:20px;border-radius:50%;background:#cbd5e1");
        dots.appendChild(d);
        return d;
      });
      if (rows.length < 3) el.appendChild(dots);
      return {
        el,
        update(l, d) {
          const q = prog(l, 0, 0.35);
          el.style.opacity = String(clamp(q * 3));
          el.style.transform = `translateY(${(1 - outBack(q)) * 200}px) rotate(${-2 + Math.sin(l * 1.3) * 0.6}deg)`;
          const step = Math.min(0.6, Math.max(0.3, (d * 0.6) / Math.max(1, rows.length)));
          for (const r of rows) {
            const qb = prog(l, 0.25 + r.k * step, 0.3);
            r.b.style.opacity = String(clamp(qb * 3));
            r.b.style.transform = `scale(${outBack(qb)})`;
            r.b.style.transformOrigin = r.mine ? "100% 100%" : "0 100%";
          }
          ds.forEach((x, k) => (x.style.transform = `translateY(${Math.sin(l * 9 - k) * 6}px)`));
          dots.style.opacity = String(prog(l, 0.25 + rows.length * step, 0.2));
        },
      };
    },

    stamp(p) {
      const RED = String(p.color || "") === "green" ? "#22c55e" : "#ef4444";
      const el = h("div", "width:900px;height:760px;position:relative");
      const paper = h("div", "position:absolute;left:110px;top:20px;width:680px;height:700px;border-radius:20px;background:#f1f5f9;box-shadow:0 30px 80px rgba(0,0,0,.5);transform:rotate(-3deg);overflow:hidden");
      for (let k = 0; k < 9; k++) paper.appendChild(h("div", `position:absolute;left:60px;top:${80 + k * 66}px;width:${k % 3 === 2 ? 340 : 540}px;height:20px;border-radius:10px;background:#cbd5e1`));
      if (p.title) paper.appendChild(h("div", "position:absolute;left:60px;top:18px;font:900 40px Montserrat,sans-serif;color:#334155;text-transform:uppercase", esc(p.title)));
      const st = h("div", `position:absolute;left:50%;top:50%;padding:24px 46px;border:14px solid ${RED};border-radius:26px;font:900 ${String(p.text || "").length > 8 ? 96 : 130}px/1 Montserrat,sans-serif;letter-spacing:.04em;color:${RED};text-transform:uppercase;white-space:nowrap;mix-blend-mode:multiply`, esc(p.text || ""));
      el.append(paper, st);
      return {
        el,
        update(l) {
          const qp = prog(l, 0, 0.3);
          paper.style.opacity = String(clamp(qp * 3));
          paper.style.transform = `rotate(-3deg) translateY(${(1 - outCubic(qp)) * 80}px)`;
          const qs = prog(l, 0.3, 0.16);
          const after = l - 0.46;
          const shake = after > 0 ? Math.exp(-10 * after) * Math.sin(after * 60) * 10 : 0;
          st.style.opacity = qs > 0 ? "1" : "0";
          st.style.transform = `translate(-50%,-50%) rotate(-12deg) scale(${3 - 2 * outCubic(qs)})`;
          el.style.transform = `translate(${shake}px,${shake * 0.6}px)`;
        },
      };
    },

  };

  /** The moving background: a deep gradient, two slow light blobs, a drifting grid and rising specks. */
  function background(theme) {
    const c = THEMES[theme] || THEMES.navy;
    const el = h("div", `position:absolute;inset:-60px;background:linear-gradient(170deg,${c[0]},${c[1]})`);
    const blobs = [c[2], c[3]].map((col) => {
      const b = h("div", `position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,${col} 0%,transparent 65%);opacity:.55`);
      el.appendChild(b);
      return b;
    });
    const grid = h("div", "position:absolute;inset:-120px;background-image:linear-gradient(rgba(255,255,255,.045) 2px,transparent 2px),linear-gradient(90deg,rgba(255,255,255,.045) 2px,transparent 2px);background-size:120px 120px");
    el.appendChild(grid);
    const specks = Array.from({ length: 22 }, (_, k) => {
      const sp = h("div", `position:absolute;width:${4 + (k % 3) * 3}px;height:${4 + (k % 3) * 3}px;border-radius:50%;background:#fff;opacity:${0.08 + (k % 4) * 0.04}`);
      el.appendChild(sp);
      return { sp, x: (k * 397) % 1180, y: (k * 773) % 2040, v: 30 + (k % 5) * 14 };
    });
    return {
      el,
      update(t) {
        blobs[0].style.transform = `translate(${-200 + Math.sin(t * 0.35) * 160}px,${200 + Math.cos(t * 0.27) * 140}px)`;
        blobs[1].style.transform = `translate(${400 + Math.cos(t * 0.3) * 180}px,${1100 + Math.sin(t * 0.22) * 160}px)`;
        grid.style.transform = `translate(${(t * 14) % 120}px,${(t * 22) % 120}px)`;
        for (const x of specks) {
          const yy = (((x.y - t * x.v) % 2040) + 2040) % 2040;
          x.sp.style.transform = `translate(${x.x + Math.sin(t + x.y) * 12}px,${yy}px)`;
        }
      },
    };
  }

  /** Where pieces sit: one in the middle of the picture area, two stacked. */
  const SLOTS = { 1: [{ cy: 770, scale: 1 }], 2: [{ cy: 560, scale: 0.72 }, { cy: 1040, scale: 0.72 }] };

  /**
   * One background for the whole Reel (Thomas, 2026-11-20: the shots should
   * flow into each other, not each sit on its own copy of the background).
   * The camera flies over it: the grid and specks move with the camera, the
   * light blobs drift behind at a slower parallax, and its colours blend from
   * one shot's mood to the next.
   */
  function world() {
    const el = h("div", "position:absolute;inset:0;overflow:hidden");
    const blobs = [0, 1].map(() => {
      const b = h("div", "position:absolute;width:1000px;height:1000px;border-radius:50%;opacity:.55;left:0;top:0");
      el.appendChild(b);
      return b;
    });
    const grid = h("div", "position:absolute;inset:-480px");
    el.appendChild(grid);
    const specks = Array.from({ length: 34 }, (_, k) => {
      const sp = h("div", `position:absolute;left:0;top:0;width:${4 + (k % 3) * 3}px;height:${4 + (k % 3) * 3}px;border-radius:50%;background:#fff;opacity:${0.08 + (k % 4) * 0.04}`);
      el.appendChild(sp);
      return { sp, x: (k * 397) % 1600, y: (k * 773) % 2600, depth: 0.5 + (k % 4) * 0.25, v: 18 + (k % 5) * 9 };
    });
    const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const mix = (a, b, m) => {
      const x = hex(a), y = hex(b);
      return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * m)).join(",")})`;
    };
    const wrap = (v, n) => ((v % n) + n) % n;
    return {
      el,
      update(t, cam, a, b, m) {
        const A = THEMES[a] || THEMES.navy, B = THEMES[b] || A;
        const c = [0, 1, 2, 3].map((i) => mix(A[i], B[i], m || 0));
        el.style.background = `linear-gradient(170deg,${c[0]},${c[1]})`;
        const scale = 1 / cam.z;
        const sx = cam.x * scale, sy = cam.y * scale;
        blobs[0].style.background = `radial-gradient(circle,${c[2]} 0%,transparent 65%)`;
        blobs[1].style.background = `radial-gradient(circle,${c[3]} 0%,transparent 65%)`;
        blobs[0].style.transform = `translate(${wrap(-240 - sx * 0.25 + Math.sin(t * 0.35) * 160, 1800) - 600}px,${wrap(160 - sy * 0.25 + Math.cos(t * 0.27) * 140, 2600) - 600}px)`;
        blobs[1].style.transform = `translate(${wrap(500 - sx * 0.25 + Math.cos(t * 0.3) * 180, 1800) - 600}px,${wrap(1200 - sy * 0.25 + Math.sin(t * 0.22) * 160, 2600) - 600}px)`;
        // An endless zoom: the grid size cycles through one doubling.
        const lvl = Math.log2(scale);
        const size = 120 * Math.pow(2, lvl - Math.floor(lvl));
        grid.style.backgroundImage = "linear-gradient(rgba(255,255,255,.05) 2px,transparent 2px),linear-gradient(90deg,rgba(255,255,255,.05) 2px,transparent 2px)";
        grid.style.backgroundSize = `${size}px ${size}px`;
        grid.style.backgroundPosition = `${wrap(540 - sx + t * 14, size)}px ${wrap(960 - sy + t * 22, size)}px`;
        for (const x of specks) {
          x.sp.style.transform = `translate(${wrap(x.x - sx * x.depth + Math.sin(t + x.y) * 12, 1600) - 260}px,${wrap(x.y - sy * x.depth - t * x.v, 2600) - 340}px)`;
        }
      },
    };
  }

  function mount(spec, root, opts) {
    const bg = background(spec.bg);
    if (!opts || opts.bg !== false) root.appendChild(bg.el);
    const pieces = (spec.pieces || []).slice(0, 2);
    const slots = SLOTS[pieces.length] || SLOTS[1];
    const live = pieces.map((p, k) => {
      const make = PIECES[p.kind];
      if (!make) return null;
      const slot = slots[k];
      const holder = h("div", `position:absolute;left:${W / 2}px;top:${slot.cy}px;width:0;height:0`);
      const inner = h("div", `position:absolute;left:0;top:0;width:max-content;transform:translate(-50%,-50%) scale(${slot.scale})`);
      const made = make(p);
      inner.appendChild(made.el);
      holder.appendChild(inner);
      root.appendChild(holder);
      return { made, delay: k * 0.25 };
    }).filter(Boolean);
    return {
      update(local, dur, t) {
        bg.update(t);
        for (const x of live) x.made.update(Math.max(0, local - x.delay), Math.max(0.5, dur - x.delay));
      },
    };
  }

  window.MK = { mount, world, ICONS: Object.keys(ICONS), KINDS: Object.keys(PIECES), THEMES: Object.keys(THEMES) };
})();
