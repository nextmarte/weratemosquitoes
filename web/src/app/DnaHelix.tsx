"use client";

import { useEffect, useRef } from "react";

// A rotating DNA double-helix rendered on canvas — the virus's target is written in this molecule.
export default function DnaHelix({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const amp = Math.min(w * 0.32, 150);
      const turns = 3.1;
      const n = 52;
      const s1: [number, number, number][] = [];
      const s2: [number, number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const p = i / n;
        const y = 16 + p * (h - 32);
        const a = p * Math.PI * 2 * turns + t;
        const depth = (Math.cos(a) + 1) / 2; // 0 back … 1 front
        s1.push([cx + Math.sin(a) * amp, y, depth]);
        s2.push([cx + Math.sin(a + Math.PI) * amp, y, 1 - depth]);
        if (i % 2 === 0) {
          const [x1, , d1] = s1[s1.length - 1];
          const [x2] = s2[s2.length - 1];
          ctx.strokeStyle = `rgba(74,144,232,${0.08 + d1 * 0.42})`;
          ctx.lineWidth = 0.75 + d1 * 1.4;
          ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        }
      }
      const ribbon = (pts: [number, number, number][], color: string) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = 1;
        for (const [x, y, d] of pts) {
          ctx.beginPath(); ctx.arc(x, y, 2 + d * 2.6, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.globalAlpha = 0.3 + d * 0.7; ctx.fill();
        }
        ctx.globalAlpha = 1;
      };
      ribbon(s1, "#4a90e8");
      ribbon(s2, "#19a06e");
      if (!reduced) { t += 0.011; raf = requestAnimationFrame(draw); }
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
