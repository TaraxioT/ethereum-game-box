/* Gamebox motion: one interruptible track per dialog, with no network dependency. */
(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tracks = new Set();
  const dialogs = new WeakMap();
  const reveals = new WeakMap();
  const changedProperties = ['transform', 'transform-origin', 'opacity', 'visibility', 'will-change'];
  let enabled = true;
  let sequence = 0;
  let entrance = null;

  const engine = () => window.gsap;
  const canAnimate = () => enabled && !reduced.matches && Boolean(engine());
  const elements = value => {
    if (!value) return [];
    if (typeof value === 'string') return [...document.querySelectorAll(value)];
    return value.nodeType === 1 ? [value] : [...value].filter(element => element?.nodeType === 1);
  };

  function focusTarget(value) {
    if (typeof value === 'function') value();
    else value?.focus?.({ preventScroll: true });
  }

  // Restore authored inline styles rather than leaving animation transforms behind.
  // The GSAP cache is invalidated as well, so a reopened shell starts from CSS.
  function track(dialog) {
    if (dialog) dialogs.get(dialog)?.cancel();
    const saved = new Map();
    const operation = {
      token: ++sequence,
      animation: null,
      settle: null,
      current: () => tracks.has(operation) && (!dialog || dialogs.get(dialog) === operation),
      remember(targets) {
        for (const target of elements(targets)) {
          if (saved.has(target)) continue;
          const properties = [...changedProperties, ...(target === dialog ? ['--scrim-opacity'] : [])];
          saved.set(target, properties.map(property => [property, target.style.getPropertyValue(property), target.style.getPropertyPriority(property)]));
        }
      },
      cancel() { retire(); },
      finish() {
        if (!operation.current()) return;
        const settle = operation.settle;
        retire();
        settle?.();
      }
    };

    function retire() {
      if (!tracks.has(operation)) return;
      tracks.delete(operation);
      if (dialog && dialogs.get(dialog) === operation) dialogs.delete(dialog);
      operation.animation?.kill();
      for (const [target, properties] of saved) {
        for (const [property, value, priority] of properties) {
          if (value) target.style.setProperty(property, value, priority);
          else target.style.removeProperty(property);
        }
        if (target._gsap) target._gsap.uncache = 1;
      }
    }

    tracks.add(operation);
    if (dialog) dialogs.set(dialog, operation);
    return operation;
  }

  function settleAll() {
    // Finish from a snapshot: a finish callback can safely start a new operation.
    for (const operation of [...tracks]) operation.finish();
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!canAnimate()) settleAll();
  }

  function intro() {
    entrance?.cancel();
    const header = elements('.header');
    const heading = elements('.page-heading');
    const tiles = elements('.stage > .tile');
    if (!canAnimate()) return null;

    const operation = track();
    entrance = operation;
    operation.remember([...header, ...heading, ...tiles]);
    const tl = engine().timeline({ defaults: { ease: 'power3.out' }, onComplete: () => operation.finish() });
    operation.animation = tl;
    // Opacity preserves hit testing: the opening never gates interaction.
    if (header.length) tl.from(header, { opacity: 0, y: -12, duration: .42 }, 0);
    if (heading.length) tl.from(heading, { opacity: 0, y: 18, duration: .5 }, .06);
    if (tiles.length) tl.from(tiles, { opacity: .02, y: 28, scale: .965, duration: .6, stagger: { amount: Math.min(.32, Math.max(0, tiles.length - 1) * .045) } }, .1);
    const logo = elements('.hero-logo');
    operation.remember(logo);
    if (logo.length) tl.from(logo, { opacity: 0, scale: .92, duration: .45 }, .24);
    return operation;
  }

  function open(dialog, options = {}) {
    if (!dialog) return null;
    const operation = track(dialog);
    let focused = false;
    const focus = () => {
      if (focused) return;
      focused = true;
      focusTarget(options.focus);
    };
    operation.settle = focus;
    if (!canAnimate()) { operation.finish(); return null; }

    // Read both rectangles before applying any styles. The shell's origin is a
    // subtle spatial cue; text is never stretched from the source card bounds.
    const source = options.trigger?.closest?.('.tile') || options.trigger;
    const sourceRect = source?.isConnected ? source.getBoundingClientRect() : null;
    const destination = dialog.getBoundingClientRect();
    const offsetX = sourceRect ? Math.max(-36, Math.min(36, (sourceRect.left + sourceRect.width / 2 - destination.left - destination.width / 2) * .12)) : 0;
    const offsetY = sourceRect ? Math.max(-12, Math.min(28, (sourceRect.top + sourceRect.height / 2 - destination.top - destination.height / 2) * .08)) : 24;
    const content = dialog.querySelector('#detail-content') || dialog.querySelector('.search-results');
    const children = content ? [...content.children] : [];
    operation.remember([dialog, ...children]);

    // Set focus while all elements still have their authored visibility. The
    // caller has already called showModal(), so native focus containment applies.
    focus();
    const tl = engine().timeline({ onComplete: () => operation.finish() });
    operation.animation = tl;
    tl.fromTo(dialog, { x: offsetX, y: offsetY, scale: .965, opacity: .06, '--scrim-opacity': 0 }, { x: 0, y: 0, scale: 1, opacity: 1, '--scrim-opacity': 1, duration: .42, ease: 'power3.out' }, 0);
    if (children.length) tl.from(children, { y: 10, opacity: 0, duration: .24, stagger: { amount: .1 }, ease: 'power2.out' }, .08);
    return operation;
  }

  function swap(dialog, renderCallback, focusCallback) {
    if (!dialog) { renderCallback?.(); focusTarget(focusCallback); return null; }
    const operation = track(dialog);
    const content = dialog.querySelector('#detail-content') || dialog.querySelector('.search-results') || dialog;
    let rendered = false;
    let focused = false;
    const render = () => {
      if (rendered) return;
      rendered = true;
      renderCallback?.();
    };
    const focus = () => {
      if (focused) return;
      focused = true;
      focusTarget(focusCallback);
    };
    // Settling during the exit phase still renders the requested entity once.
    operation.settle = () => { render(); focus(); };
    if (!canAnimate()) { operation.finish(); return null; }

    operation.remember(content);
    operation.animation = engine().to(content, {
      opacity: 0, y: -8, duration: .11, ease: 'power2.in',
      onComplete() {
        if (!operation.current()) return;
        render();
        // A render callback may itself navigate; a superseded track never runs.
        if (!operation.current()) return;
        const children = [...content.children];
        operation.remember(children);
        engine().set(content, { opacity: 1, y: 0 });
        focus();
        if (!operation.current()) return;
        if (!canAnimate() || !children.length) { operation.finish(); return; }
        operation.animation = engine().from(children, {
          opacity: 0, y: 12, duration: .22, ease: 'power2.out',
          stagger: { amount: Math.min(.08, children.length * .012) },
          onComplete: () => operation.finish()
        });
      }
    });
    return operation;
  }

  function close(dialog, finishCallback) {
    if (!dialog) { finishCallback?.(); return null; }
    const operation = track(dialog);
    let finished = false;
    operation.settle = () => {
      if (finished) return;
      finished = true;
      finishCallback?.();
    };
    if (!canAnimate() || !dialog.open) { operation.finish(); return null; }

    operation.remember(dialog);
    operation.animation = engine().to(dialog, {
      y: 12, scale: .98, opacity: 0, '--scrim-opacity': 0,
      duration: .18, ease: 'power2.in',
      onComplete: () => operation.finish()
    });
    return operation;
  }

  function reveal(targets) {
    const items = elements(targets);
    // Re-rendered rank/box lists can interrupt their previous reveal safely.
    for (const previous of new Set(items.map(item => reveals.get(item)).filter(Boolean))) previous.cancel();
    if (!items.length || !canAnimate()) return null;
    const operation = track();
    for (const item of items) reveals.set(item, operation);
    operation.remember(items);
    operation.animation = engine().from(items, {
      opacity: 0, y: 9, duration: .26, ease: 'power2.out',
      stagger: { amount: Math.min(.12, Math.max(0, items.length - 1) * .025) },
      onComplete: () => operation.finish()
    });
    return operation;
  }

  // System changes take effect during a transition, without a reload or a
  // half-hidden shell. Turning motion back on affects future interactions only.
  reduced.addEventListener('change', () => { if (reduced.matches) settleAll(); });
  window.GameboxMotion = Object.freeze({ setEnabled, intro, open, swap, close, reveal });
})();
