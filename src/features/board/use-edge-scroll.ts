import { useEffect, type RefObject } from "react";

/** How far in from either edge the strip starts to drift, in pixels. */
const EDGE = 64;
/** The drift per frame with the pointer right at the edge, in pixels. */
const MAX_STEP = 14;

export type EdgeScrollOptions = {
  /** Off while a card is being carried: dnd-kit scrolls for that itself. */
  readonly enabled: boolean;
};

/**
 * Hover-to-scroll for a strip wider than its frame. Rest the pointer near the
 * left or right edge and the strip drifts that way, faster the closer to the
 * edge, until the pointer moves away or the strip runs out.
 *
 * Only where hovering is a thing. On a phone or a tablet there is no pointer
 * to rest at an edge — a finger already scrolls by dragging — so the feature
 * does not exist there at all: no listeners, no edge fades (the CSS gates on
 * the same media query). A tablet with a trackpad counts as hovering. Off
 * under `prefers-reduced-motion` too, where content that moves on its own is
 * exactly what the person asked not to have; the scrollbar and shift+wheel
 * still work.
 *
 * The frame carries `data-scroll-left` and `data-scroll-right` while there is
 * more to see in that direction. The edge fades read those.
 */

/** The same query the edge fades use. */
export const HOVER_MEDIA = "(hover: hover) and (pointer: fine)";
export function useEdgeScroll(
  scroller: RefObject<HTMLElement | null>,
  frame: RefObject<HTMLElement | null>,
  { enabled }: EdgeScrollOptions,
): void {
  useEffect(() => {
    const strip = scroller.current;
    const box = frame.current;
    if (!strip || !box) return;

    const hovering = window.matchMedia(HOVER_MEDIA);
    if (!hovering.matches) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let direction: -1 | 0 | 1 = 0;
    let strength = 0;
    let raf = 0;

    const mark = () => {
      const hidden = strip.scrollWidth - strip.clientWidth;
      box.setAttribute("data-scroll-left", strip.scrollLeft > 1 ? "true" : "false");
      box.setAttribute(
        "data-scroll-right",
        hidden - strip.scrollLeft > 1 ? "true" : "false",
      );
    };

    const step = () => {
      raf = 0;
      if (direction === 0) return;

      strip.scrollLeft += direction * strength * MAX_STEP;

      const atStart = strip.scrollLeft <= 0;
      const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
      if ((direction < 0 && atStart) || (direction > 0 && atEnd)) {
        direction = 0;
        return;
      }
      raf = requestAnimationFrame(step);
    };

    const stop = () => {
      direction = 0;
    };

    const onMove = (event: PointerEvent) => {
      if (
        !enabled ||
        event.pointerType !== "mouse" ||
        reduced.matches ||
        !hovering.matches
      ) {
        return stop();
      }
      if (strip.scrollWidth <= strip.clientWidth) return stop();

      const rect = strip.getBoundingClientRect();
      const fromLeft = event.clientX - rect.left;
      const fromRight = rect.right - event.clientX;

      if (fromLeft < EDGE) {
        direction = -1;
        strength = Math.min(1, Math.max(0, 1 - fromLeft / EDGE));
      } else if (fromRight < EDGE) {
        direction = 1;
        strength = Math.min(1, Math.max(0, 1 - fromRight / EDGE));
      } else {
        return stop();
      }

      if (!raf) raf = requestAnimationFrame(step);
    };

    mark();
    strip.addEventListener("pointermove", onMove);
    strip.addEventListener("pointerleave", stop);
    strip.addEventListener("scroll", mark, { passive: true });
    const observer = new ResizeObserver(mark);
    observer.observe(strip);

    return () => {
      stop();
      if (raf) cancelAnimationFrame(raf);
      strip.removeEventListener("pointermove", onMove);
      strip.removeEventListener("pointerleave", stop);
      strip.removeEventListener("scroll", mark);
      observer.disconnect();
    };
  }, [scroller, frame, enabled]);
}
