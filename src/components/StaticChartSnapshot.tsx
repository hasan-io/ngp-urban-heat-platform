import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";

const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_PROPERTIES = [
  "font-family", "font-size", "font-style", "font-weight", "letter-spacing",
  "fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width",
  "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity",
  "text-anchor", "dominant-baseline", "shape-rendering",
] as const;

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** Inline computed styles so the cloned SVG is independent of the application DOM/CSS. */
function makeStandaloneSvg(source: SVGSVGElement, width: number, height: number) {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const sourceNodes = [source, ...Array.from(source.querySelectorAll<SVGElement>("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
  sourceNodes.forEach((node, i) => {
    const target = cloneNodes[i];
    if (!target) return;
    const style = getComputedStyle(node);
    for (const property of STYLE_PROPERTIES) {
      const value = style.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  });

  // A solid white backing prevents transparent charts from becoming dark in PDF viewers.
  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#ffffff");
  clone.insertBefore(background, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

async function svgToStaticImage(svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width < 40 || height < 40) throw new Error("Chart has not been laid out yet");

  const serialized = makeStandaloneSvg(svg, width, height);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    try {
      const image = new Image();
      image.decoding = "sync";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not rasterize chart SVG"));
        image.src = objectUrl;
      });
      const scale = 2; // high-resolution, while keeping report size manageable
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context unavailable");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/png", 1);
    } catch {
      // Static SVG image is a safe print fallback in browsers that block SVG→canvas.
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Renders an interactive Recharts figure long enough to capture its SVG, then replaces it
 * with a static PNG. Report printing therefore never depends on a responsive/animated SVG.
 */
export default function StaticChartSnapshot({ id, children, className, alt, onReady }: {
  id: string;
  children: ReactNode;
  className?: string;
  alt: string;
  onReady?: (id: string) => void;
}) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    const capture = async () => {
      try {
        await document.fonts?.ready;
        await nextFrame();
        await nextFrame();
        // Recharts uses responsive measurement; a short wait avoids capturing a 0×0 first pass.
        await new Promise((resolve) => setTimeout(resolve, 80));
        let svg: SVGSVGElement | null = null;
        for (let attempt = 0; attempt < 5 && !svg; attempt++) {
          svg = sourceRef.current?.querySelector<SVGSVGElement>("svg.recharts-surface") ?? null;
          if (!svg || svg.getBoundingClientRect().width < 40) {
            svg = null;
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
        }
        if (!svg) throw new Error(`Chart ${id} did not render`);
        const png = await svgToStaticImage(svg);
        if (!cancelled) {
          setImage(png);
          onReady?.(id);
        }
      } catch (error) {
        // Keep the rendered SVG visible in preview rather than creating a blank report area.
        console.error(`Static chart capture failed (${id})`, error);
      }
    };
    void capture();
    return () => { cancelled = true; };
  }, [id, onReady]);

  return (
    <div className={cn("relative overflow-hidden", className)} data-static-chart={id}>
      {image ? <img src={image} alt={alt} className="block h-full w-full object-contain" /> : (
        <>
          <div ref={sourceRef} className="h-full w-full">{children}</div>
          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded bg-white/90 px-1.5 py-1 text-[8px] text-slate-500 shadow-sm">
            <Loader2 className="h-2.5 w-2.5 animate-spin" /> preparing print figure
          </div>
        </>
      )}
    </div>
  );
}