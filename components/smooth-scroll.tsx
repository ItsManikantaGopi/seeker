"use client";

import { useEffect } from "react";

/**
 * Cinematic scroll: wheel input is eased toward its target with a rAF lerp
 * instead of landing in native steps. Everything else stays native — touch,
 * keyboard, scrollbar drags, and nested scrollers (the sidebar nav, .scroll-x
 * tables) are left alone, and prefers-reduced-motion disables the controller.
 */
export function SmoothScroll() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    let teardown: (() => void) | null = null;

    const setup = () => {
      let target = window.scrollY;
      let current = target;
      let raf = 0;
      let running = false;

      const maxScroll = () => Math.max(0, root.scrollHeight - window.innerHeight);

      const stop = () => {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      };

      const tick = () => {
        current += (target - current) * 0.09;
        if (Math.abs(target - current) < 0.5) {
          current = target;
          window.scrollTo(0, current);
          stop();
          return;
        }
        window.scrollTo(0, current);
        raf = requestAnimationFrame(tick);
      };

      const start = () => {
        if (running) return;
        running = true;
        raf = requestAnimationFrame(tick);
      };

      // A scroll we did not cause (keyboard, scrollbar drag, route change)
      // resyncs the lerp state instead of fighting it.
      const onScroll = () => {
        if (running && Math.abs(window.scrollY - current) > 1) stop();
        if (!running) {
          target = window.scrollY;
          current = target;
        }
      };

      // Wheel events over an element that can still consume them (sidebar,
      // horizontally scrollable tables) keep native scrolling.
      const scrollableAncestor = (from: EventTarget | null, dx: number, dy: number): Element | null => {
        // Include <body> in the walk — wheel events can target it directly,
        // and stopping before it would miss body-level scroll containers.
        let el = from instanceof Element ? from : null;
        while (el && el !== root) {
          const style = window.getComputedStyle(el);
          const overY = style.overflowY;
          const overX = style.overflowX;
          if (dy !== 0 && (overY === "auto" || overY === "scroll")) {
            const atStart = el.scrollTop <= 0 && dy < 0;
            const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1 && dy > 0;
            if (!atStart && !atEnd) return el;
          }
          if (dx !== 0 && (overX === "auto" || overX === "scroll")) {
            const atStart = el.scrollLeft <= 0 && dx < 0;
            const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && dx > 0;
            if (!atStart && !atEnd) return el;
          }
          el = el.parentElement;
        }
        return null;
      };

      const onWheel = (e: WheelEvent) => {
        if (e.ctrlKey) return; // pinch-zoom, never hijack
        const dx = e.deltaX;
        const dy = e.deltaY;
        if (scrollableAncestor(e.target, dx, dy)) return;
        e.preventDefault();
        // Normalize line/page delta modes to pixels.
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
        target = Math.min(maxScroll(), Math.max(0, target + (dy + dx) * scale));
        start();
      };

      // The CSS smooth easing would double-ease every per-frame scrollTo.
      root.setAttribute("data-smooth-scroll", "js");
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("wheel", onWheel, { passive: false });

      return () => {
        stop();
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("wheel", onWheel);
        root.removeAttribute("data-smooth-scroll");
      };
    };

    const sync = () => {
      if (media.matches) {
        teardown?.();
        teardown = null;
      } else if (!teardown) {
        teardown = setup();
      }
    };

    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      teardown?.();
    };
  }, []);

  return null;
}
