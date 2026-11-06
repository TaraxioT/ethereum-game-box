/* Original procedural artwork: identity disc and market duel.
   Game cards animate only on hover or focus; there is no central globe.
   Scenes rest for reduced motion, an open modal, or a hidden tab. */
(() => {
  'use strict';
  const scenes = [];
  const TAU = Math.PI * 2;
  let handle = 0, last = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function enabled() {
    return !reduced.matches && !document.hidden && !document.body.classList.contains('modal-open');
  }
  function active(s) { return s.visible && s.width > 0 && s.height > 0 && s.hovered; }
  function stop() { if (handle) cancelAnimationFrame(handle); handle = 0; last = 0; }
  function tick(now) {
    handle = 0;
    if (!enabled() || !scenes.some(active)) { last = 0; return; }
    // Thirty frames is enough for atmospheric art; idle game cards do no work.
    if (last && now - last < 1000 / 30) { handle = requestAnimationFrame(tick); return; }
    const delta = last ? Math.min((now - last) / 1000, .06) : 0; last = now;
    for (const s of scenes) if (active(s)) { s.time += delta; s.draw(s); }
    handle = requestAnimationFrame(tick);
  }
  function start() {
    if (!handle && enabled() && scenes.some(active)) { last = 0; handle = requestAnimationFrame(tick); }
  }
  function refresh() {
    if (!enabled()) { stop(); return; }
    for (const s of scenes) if (s.visible && s.width > 0 && s.height > 0) s.draw(s);
    start();
  }
  function makeScene(id, draw) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scene = { canvas, ctx, width: 0, height: 0, visible: true, hovered: false, time: 0, draw };
    const resize = () => {
      // Entrance/hover transforms change the visual rect without resizing the
      // layout box. Use layout dimensions so the orb stays sharp after opening.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      scene.width = Math.max(0, canvas.clientWidth);
      scene.height = Math.max(0, canvas.clientHeight);
      canvas.width = Math.max(1, Math.round(scene.width * ratio));
      canvas.height = Math.max(1, Math.round(scene.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (scene.width > 0 && scene.height > 0) draw(scene);
      start();
    };
    const host = canvas.closest('.tile') || canvas.parentElement;
    if (host) {
      host.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') { scene.hovered = true; start(); } });
      host.addEventListener('pointerleave', () => { scene.hovered = false; });
      host.addEventListener('focusin', () => { scene.hovered = true; start(); });
      host.addEventListener('focusout', e => { if (!host.contains(e.relatedTarget)) scene.hovered = false; });
    }
    scenes.push(scene);
    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(entries => {
      scene.visible = entries[0].isIntersecting;
      if (scene.visible) { if (scene.width && scene.height) draw(scene); start(); }
    }).observe(canvas);
    resize();
  }
  function line(ctx, points, color, width = 1, glow = 0) {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.shadowColor = color; ctx.shadowBlur = glow; ctx.stroke(); ctx.shadowBlur = 0;
  }
  makeScene('disc-canvas', s => {
    const { ctx: c, width: w, height: h, time: t } = s;
    c.clearRect(0, 0, w, h);

    const cx = w * .75, cy = h * .47, radius = Math.min(w * .255, h * .35);
    const aura = c.createRadialGradient(cx, cy, 5, cx, cy, radius * 1.9);
    aura.addColorStop(0, '#34718333'); aura.addColorStop(.52, '#17516622'); aura.addColorStop(1, '#0b1d2800');
    c.fillStyle = aura; c.fillRect(0, 0, w, h);
    const horizon = h * .66;
    for (let i = -9; i <= 9; i++) line(c, [[cx + i * 17, horizon], [cx + i * 95, h]], '#25445277', .65);
    for (let i = 0; i < 10; i++) { const v = ((i + t * .24) % 10) / 10; const y = horizon + v * v * (h - horizon); line(c, [[0, y], [w, y]], '#2b576455', .65); }
    const rotation = -.41;
    const project = (a, r, z = 0) => {
      const x = Math.cos(a) * r, y = Math.sin(a) * r * .68;
      return [cx + x * Math.cos(rotation) - y * Math.sin(rotation), cy + x * Math.sin(rotation) + y * Math.cos(rotation) + z];
    };
    const ring = (r, color, width, start = 0, end = TAU, glow = 0, z = 0) => {
      const p = []; for (let a = start; a <= end + .02; a += .02) p.push(project(a, r, z));
      line(c, p, color, width, glow);
    };
    // A dark, oblique metal disc with an illuminated edge and recessed centre.
    const shell = []; for (let a = 0; a < TAU; a += .02) shell.push(project(a, radius, 7));
    c.beginPath(); shell.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath(); c.fillStyle = '#0b202d'; c.fill();
    ring(radius, '#233f4f', 11, 0, TAU, 0, 7);
    ring(radius, '#8bf5fb', 2, 0, TAU, 17);
    ring(radius * .969, '#467b8b', 4);
    ring(radius * .91, '#173240', 11);
    ring(radius * .845, '#639baa', 1);
    ring(radius * .79, '#233c4c', 14);
    ring(radius * .72, '#91f7fb', 3, 0, TAU, 13);
    ring(radius * .69, '#275564', 2);
    // The open centre remains dark, giving the ring a physical silhouette.
    c.beginPath(); for (let a = 0; a < TAU + .02; a += .02) { const p = project(a, radius * .65); a === 0 ? c.moveTo(...p) : c.lineTo(...p); } c.fillStyle = '#08131d'; c.fill();
    ring(radius * .66, '#70c3d3', 1, .2, TAU, 3);
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * TAU + t * .08;
      line(c, [project(a, radius * .86), project(a, radius * (i % 6 ? .9 : .94))], i % 6 ? '#426773' : '#a5f9ff', i % 6 ? .8 : 1.4);
    }
    for (let i = 0; i < 3; i++) {
      const a = t * .3 + i * TAU / 3;
      ring(radius * .91, '#b6fcff', 3, a, a + .42, 11);
      ring(radius * .74, '#8ceef7', 1, -a, -a + .12, 7);
    }
    const crossX = cx + radius * 1.1, crossY = cy - radius * .68;
    line(c, [[crossX - 5, crossY], [crossX + 5, crossY]], '#6395a3', .8);
    line(c, [[crossX, crossY - 5], [crossX, crossY + 5]], '#6395a3', .8);
    // Two light trails retain the film's cyan/orange rivalry.
    for (let i = 0; i < 2; i++) {
      const f = (t * .09 + i * .5) % 1, x = w * .34 + f * w * .67, y = h * (.82 + i * .09);
      const trail = c.createLinearGradient(x - 95, y, x, y);
      trail.addColorStop(0, i ? '#ffac7200' : '#7ae9ef00'); trail.addColorStop(1, i ? '#ffb477' : '#a1f8ff');
      line(c, [[x - 95, y], [x, y]], trail, 1.7, 0);
      c.fillStyle = i ? '#ffcc99' : '#d6ffff'; c.shadowColor = i ? '#ffac72' : '#7ae9ef'; c.shadowBlur = 12; c.fillRect(x, y - 1.5, 5, 3); c.shadowBlur = 0;
    }

  });
  makeScene('stock-canvas', s => {
    const { ctx: c, width: w, height: h, time: t } = s;
    c.clearRect(0, 0, w, h);
    const glow = c.createRadialGradient(w * .85, h * .6, 0, w * .85, h * .6, w * .6);
    glow.addColorStop(0, '#9c582722'); glow.addColorStop(1, '#11171b00'); c.fillStyle = glow; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) line(c, [[w * .4, h * .22 + i * 31], [w, h * .22 + i * 31]], '#80563222', .8);
    const bars = [.3,.49,.4,.7,.57,.8,.66,.95,.75,.9];
    bars.forEach((v, i) => {
      const x = w * .5 + i * w * .053, y = h * .84 - v * h * .55 + Math.sin(t * .55 + i) * 3;
      const positive = i % 3 !== 1, color = positive ? '#dcaa77' : '#567a83';
      line(c, [[x, y - 19], [x, y + 36]], color, .8);
      c.strokeStyle = color; c.lineWidth = 1; c.fillStyle = positive ? '#61452b88' : '#29404a';
      c.fillRect(x - 5, y, 10, 20); c.strokeRect(x - 5, y, 10, 20);
    });
    const path = [[w * .42,h * .8],[w * .52,h * .7],[w * .64,h * .74],[w * .7,h * .48],[w * .81,h * .53],[w * .91,h * .3],[w * 1.05,h * .35]];
    line(c, path, '#ffac7277', 1.5, 5);
  });
  document.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh);
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  let modalOpen = document.body.classList.contains('modal-open');
  new MutationObserver(() => {
    const next = document.body.classList.contains('modal-open');
    if (next !== modalOpen) { modalOpen = next; refresh(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  start();
})();
