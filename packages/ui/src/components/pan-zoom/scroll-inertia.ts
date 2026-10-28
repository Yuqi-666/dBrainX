// SPDX-License-Identifier: AGPL-3.0-only

/** Frame-rate independent decay: velocity is CSS px/ms, never px/frame. */
export function inertiaStep(velocity: number, elapsed: number) {
  const dt = Math.min(32, Math.max(0, elapsed));
  const friction = 0.006;
  const decay = Math.exp(-friction * dt);
  return {
    delta: (velocity * (1 - decay)) / friction,
    velocity: velocity * decay,
  };
}

/** Manual document touch scrolling with interruptible, bounded momentum. */
export function createScrollInertia(element: HTMLElement) {
  let frame = 0;
  let last = 0;
  let vx = 0;
  let vy = 0;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    vx = vy = 0;
  };
  const sample = (dx: number, dy: number, time: number) => {
    const dt = time - last;
    if (dt > 0 && dt < 80) {
      vx = 0.35 * vx + (0.65 * dx) / dt;
      vy = 0.35 * vy + (0.65 * dy) / dt;
    } else vx = vy = 0;
    last = time;
  };
  const start = (time: number) => {
    if (
      time - last > 80 ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      stop();
      return;
    }
    last = performance.now();
    const tick = (now: number) => {
      const x = inertiaStep(vx, now - last);
      const y = inertiaStep(vy, now - last);
      last = now;
      const beforeX = element.scrollLeft;
      const beforeY = element.scrollTop;
      element.scrollLeft += x.delta;
      element.scrollTop += y.delta;
      vx = element.scrollLeft === beforeX ? 0 : x.velocity;
      vy = element.scrollTop === beforeY ? 0 : y.velocity;
      if (Math.hypot(vx, vy) > 0.02) frame = requestAnimationFrame(tick);
      else stop();
    };
    if (Math.hypot(vx, vy) > 0.02) frame = requestAnimationFrame(tick);
  };
  return { stop, sample, start };
}
