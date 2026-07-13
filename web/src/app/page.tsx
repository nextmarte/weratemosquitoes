"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import DnaHelix from "./DnaHelix";
import { ShieldCheck, ArrowRight, Crosshair, ShieldQuestion, Repeat } from "lucide-react";

const C = {
  accent: "#4a90e8", aqua: "#19a06e", warning: "#f5b431", good: "#17b317", critical: "#e0524f",
  ink: "#f5f5f2", ink2: "#b9b8b0", muted: "#86847c", ring: "#ffffff17", grid: "#262624",
};

function Reveal({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (el.getBoundingClientRect().top < window.innerHeight) { setV(true); return; } // already in view
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setV(true); io.disconnect(); } }, { threshold: 0.14 });
    io.observe(el);
    const t = setTimeout(() => setV(true), 2500); // safety: never leave content hidden
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);
  return <div ref={ref} className={className} style={{ opacity: v ? 1 : 0, transform: v ? "none" : "translateY(16px)", transition: "opacity .6s ease, transform .6s ease", ...style }}>{children}</div>;
}

function VirusIcon({ size = 42, color = C.critical }: { size?: number; color?: string }) {
  const spikes = Array.from({ length: 10 }, (_, i) => (i * Math.PI * 2) / 10);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      {spikes.map((a, i) => {
        const x1 = 50 + Math.cos(a) * 30, y1 = 50 + Math.sin(a) * 30;
        const x2 = 50 + Math.cos(a) * 44, y2 = 50 + Math.sin(a) * 44;
        return <g key={i}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="3" strokeLinecap="round" /><circle cx={x2} cy={y2} r="4" fill={color} /></g>;
      })}
      <circle cx="50" cy="50" r="30" fill={`${color}22`} stroke={color} strokeWidth="3" />
      <circle cx="43" cy="45" r="4.5" fill={color} opacity="0.7" /><circle cx="58" cy="54" r="5.5" fill={color} opacity="0.7" /><circle cx="52" cy="40" r="3.5" fill={color} opacity="0.7" />
    </svg>
  );
}
function TargetIcon({ size = 42, color = C.accent }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="34" stroke={color} strokeWidth="3" opacity="0.5" />
      <circle cx="50" cy="50" r="22" stroke={color} strokeWidth="3" opacity="0.8" />
      <circle cx="50" cy="50" r="7" fill={color} />
      {[0, 90, 180, 270].map((d) => { const a = (d * Math.PI) / 180; return <line key={d} x1={50 + Math.cos(a) * 30} y1={50 + Math.sin(a) * 30} x2={50 + Math.cos(a) * 46} y2={50 + Math.sin(a) * 46} stroke={color} strokeWidth="3" strokeLinecap="round" />; })}
    </svg>
  );
}

const STEPS = [
  { icon: <VirusIcon />, n: "01", title: "The virus hijacks your cells", body: "A virus can't reproduce on its own. To copy itself, it grabs onto dozens of your own human proteins — the machinery it can't live without." },
  { icon: <TargetIcon />, n: "02", title: "Aquiles finds the weak point", body: "Claude reads the world's evidence — drug databases and millions of papers — and ranks which of those human proteins are both essential to the virus and hittable by a drug: the virus's Achilles heel." },
  { icon: <ShieldCheck size={42} color={C.good} strokeWidth={2} />, n: "03", title: "An independent AI checks everything", body: "The twist: a separate verifier re-checks every single claim against the original source data — catching the mistakes a self-checking AI would confidently keep." },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* nav */}
      <nav className="sticky top-0 z-20 backdrop-blur-md" style={{ background: "#0b0b0acc", borderBottom: `1px solid ${C.grid}` }}>
        <div className="mx-auto max-w-6xl px-5 h-14 flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: "#4a90e820", border: "1px solid #4a90e855" }}><ShieldCheck size={16} color={C.accent} /></span>
          <span className="display text-lg font-extrabold">Aquiles</span>
          <Link href="/app" className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold" style={{ background: C.accent, color: "#fff" }}>
            Launch app <ArrowRight size={15} />
          </Link>
        </div>
      </nav>

      {/* hero */}
      <header className="mx-auto max-w-6xl px-5 pt-14 pb-20 grid lg:grid-cols-[1.15fr_0.85fr] gap-8 items-center">
        <div>
          <div className="mono text-[11px] px-2.5 py-1 rounded-md inline-block mb-5" style={{ color: C.ink2, background: "#ffffff0d" }}>
            Built with Claude · Life Sciences
          </div>
          <h1 className="display text-[clamp(34px,6vw,60px)] font-extrabold leading-[1.02]" style={{ textWrap: "balance" } as React.CSSProperties}>
            Every virus has an <span style={{ color: C.accent }}>Achilles heel.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed" style={{ color: C.ink2 }}>
            Dengue and Zika have no cure — they survive by hijacking your own cells. <b style={{ color: "#fff" }}>Aquiles</b> finds
            the human machinery the virus can’t live without, and an <b style={{ color: "#fff" }}>independent AI verifies every
            piece of evidence</b> before it reaches a scientist.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/app" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-semibold" style={{ background: C.accent, color: "#fff" }}>
              Launch Aquiles <ArrowRight size={17} />
            </Link>
            <a href="#how" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-medium" style={{ color: C.ink2, border: `1px solid ${C.ring}` }}>
              See how it works
            </a>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-7 gap-y-3">
            {[["No approved antiviral", "for any Aedes-borne arbovirus"], ["6M+ cases", "dengue · Brazil · 2024"], ["61% caught", "of AI claims, by the verifier"]].map(([a, b]) => (
              <div key={a}><div className="display text-xl font-extrabold" style={{ color: C.warning }}>{a}</div><div className="text-[11.5px]" style={{ color: C.muted }}>{b}</div></div>
            ))}
          </div>
        </div>
        <div className="relative h-[380px] lg:h-[460px] card overflow-hidden" style={{ background: "radial-gradient(120% 80% at 50% 0%, #14202f 0%, #0f0f0e 70%)" }}>
          <DnaHelix className="absolute inset-0 h-full w-full" />
          <div className="absolute bottom-3 left-0 right-0 text-center text-[11px] mono" style={{ color: C.muted }}>
            the target is written in the host’s own biology
          </div>
        </div>
      </header>

      {/* how it works */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-14 border-t" style={{ borderColor: C.grid }}>
        <Reveal><h2 className="display text-[28px] font-extrabold mb-2">How it works</h2>
          <p className="text-[14px] mb-9 max-w-2xl" style={{ color: C.muted }}>No bioinformatics required. Ask a question in plain language; Claude does the reasoning and the checking.</p></Reveal>
        <div className="grid md:grid-cols-3 gap-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} className="card p-6 flex flex-col gap-3">
              <div className="flex items-center justify-between">{s.icon}<span className="display text-2xl font-extrabold" style={{ color: "#ffffff18" }}>{s.n}</span></div>
              <h3 className="display text-[18px] font-bold">{s.title}</h3>
              <p className="text-[13.5px] leading-relaxed" style={{ color: C.ink2 }}>{s.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* the twist */}
      <section className="mx-auto max-w-6xl px-5 py-14 border-t" style={{ borderColor: C.grid }}>
        <div className="grid lg:grid-cols-2 gap-8 items-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 mono text-[11px] px-2.5 py-1 rounded-md mb-4" style={{ color: C.warning, background: "#f5b43115" }}><ShieldQuestion size={13} /> the differentiator</div>
            <h2 className="display text-[28px] font-extrabold mb-3" style={{ textWrap: "balance" } as React.CSSProperties}>The AI doesn’t get to grade its own homework.</h2>
            <p className="text-[14.5px] leading-relaxed mb-3" style={{ color: C.ink2 }}>
              The biggest problem with AI in science is that it checks itself — the reviewer is the same model, with the same
              blind spots. Aquiles is different: a separate verifier re-reads every claim and confirms it against the{" "}
              <b style={{ color: "#fff" }}>raw database record</b>, in isolation.
            </p>
            <p className="text-[14.5px] leading-relaxed" style={{ color: C.ink2 }}>
              Across the current target set, the independent verifier <b style={{ color: C.warning }}>caught more than half</b> of
              the AI’s own claims as unsupported — mistakes a self-checking system would have delivered as fact.
            </p>
          </Reveal>
          <Reveal className="card p-6">
            <div className="text-[12px] mb-3" style={{ color: C.muted }}>every claim → one of:</div>
            <div className="flex flex-col gap-2.5">
              {[["Confirmed", C.good, "the raw record supports it"], ["Corrected", C.warning, "the record says something different"], ["Rejected", C.critical, "no support in the source"]].map(([l, col, d]) => (
                <div key={l} className="flex items-center gap-3 rounded-lg p-3" style={{ background: "#ffffff06", border: `1px solid ${col}33` }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: col as string }} />
                  <span className="font-semibold text-[13.5px]" style={{ color: col as string }}>{l}</span>
                  <span className="text-[12.5px]" style={{ color: C.muted }}>{d}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* why it can't escape */}
      <section className="mx-auto max-w-6xl px-5 py-14 border-t" style={{ borderColor: C.grid }}>
        <Reveal className="card p-8 flex flex-col md:flex-row items-start gap-6" style={{ background: "radial-gradient(120% 120% at 100% 0%, #15251c 0%, #0f0f0e 70%)" }}>
          <div className="grid h-12 w-12 place-items-center rounded-xl shrink-0" style={{ background: "#19a06e22", border: "1px solid #19a06e55" }}><Repeat size={24} color={C.aqua} /></div>
          <div>
            <h2 className="display text-[24px] font-extrabold mb-2">Why the virus can’t just mutate around it</h2>
            <p className="text-[14.5px] leading-relaxed max-w-3xl" style={{ color: C.ink2 }}>
              Most antivirals attack the virus directly — so it evolves resistance fast. Aquiles targets the <b style={{ color: "#fff" }}>human</b> proteins
              instead. The virus can’t rewrite your DNA, so a host-directed drug is far harder to escape — a more durable
              weapon against fast-mutating arboviruses, and potentially one that works across dengue, Zika and chikungunya at once.
            </p>
          </div>
        </Reveal>
      </section>

      {/* final CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-24 pt-6">
        <Reveal className="card p-10 text-center" style={{ background: "radial-gradient(120% 120% at 50% 0%, #14202f 0%, #0f0f0e 75%)" }}>
          <h2 className="display text-[30px] font-extrabold mb-2" style={{ textWrap: "balance" } as React.CSSProperties}>Ask the agent. Trust the evidence.</h2>
          <p className="text-[14px] mb-6 max-w-lg mx-auto" style={{ color: C.ink2 }}>See Claude reason over real biomedical data — with every claim independently verified in front of you.</p>
          <Link href="/app" className="inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-semibold" style={{ background: C.accent, color: "#fff" }}>
            Launch Aquiles <ArrowRight size={18} />
          </Link>
        </Reveal>
        <div className="mt-8 text-center text-[11px]" style={{ color: C.muted }}>
          Evidence: Open Targets · DGIdb · Europe PMC. Human-in-the-loop; not a diagnosis or treatment recommendation. Built with Claude.
        </div>
      </section>
    </div>
  );
}
