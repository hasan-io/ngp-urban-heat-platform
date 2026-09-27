import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mounts its children only when the container scrolls near the viewport.
 * Used by the Explore page to defer the cost of raster canvases and charts
 * that are far below the fold — this eliminates the multi-second block that
 * otherwise triggers the browser's "Page Unresponsive" dialog on first paint.
 */
export default function LazyMount({
  children,
  rootMargin = "400px",
  placeholderHeight = 420,
}: {
  children: ReactNode;
  rootMargin?: string;
  placeholderHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !ref.current) return;
    const el = ref.current;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : placeholderHeight }}>
      {visible ? children : null}
    </div>
  );
}