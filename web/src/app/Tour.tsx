"use client";

// Guided voice tour: spotlights each part of the app, shows a caption, and plays a female
// English narration clip (Qwen3-TTS, generated on Modal -> /gen/tour/<id>.wav). Auto-advances
// when a clip ends; falls back to manual Next if the audio isn't there yet. onStep lets the
// host prime the UI for a step (e.g. open a dossier before narrating it).
import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, ArrowRight, ArrowLeft, X, RotateCcw, Sparkles } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const C = { accent: "#4a90e8", aqua: "#19a06e", ink: "#f5f5f2", ink2: "#b9b8b0", muted: "#86847c", ring: "#ffffff22" };

export interface TourStep {
  id: string;
  target: string | null; // data-tour="..." value; null => centered, full-screen dim
  title: string;
  caption: string;
}

export const TOUR: TourStep[] = [
  { id: "t1_welcome", target: null, title: "Welcome to Aquiles",
    caption: "Dengue and Zika have no antiviral. Aquiles hunts the human proteins the virus can't live without — and proves every piece of evidence before you trust it. Here's a 60-second tour." },
  { id: "t2_chat", target: "chat", title: "Ask the agent",
    caption: "Ask in plain English — e.g. “which targets are most druggable?” Claude plans the work, runs the analysis pipeline, and answers with citations." },
  { id: "t3_verifier", target: "verifier", title: "The independent verifier",
    caption: "A second, independent AI re-checks every claim against the raw database record. Green = confirmed, amber = corrected, red = unsupported. A model grading its own work keeps all of them." },
  { id: "t4_landscape", target: "landscape", title: "The target landscape",
    caption: "Every bubble is a candidate: right = more druggable, up = stronger evidence, bigger = more known drugs. The top-right corner is the sweet spot. Click a bubble to open its dossier." },
  { id: "t5_dossier", target: "dossier", title: "The dossier",
    caption: "A go / watch / no-go call, plus every claim behind it and the verifier's verdict. Corrected claims show what was wrong — and where a drug already hits the target, you get a repurposing hypothesis." },
  { id: "t6_wrap", target: null, title: "Your turn",
    caption: "Not an AI that sounds confident — one that's independently checked. Your best leads sit in the top-right: high druggability with strong, verified evidence. Now ask the agent anything." },
];

interface Rect { top: number; left: number; width: number; height: number }

export default function Tour({ open, onClose, onStep }: {
  open: boolean; onClose: () => void; onStep?: (id: string) => void;
}) {
  const [i, setI] = useState(0);
  const [voice, setVoice] = useState(true);
  const [needGesture, setNeedGesture] = useState(false); // autoplay blocked (e.g. arrived via ?tour=1)
  const [rect, setRect] = useState<Rect | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const step = TOUR[i];
  const last = i === TOUR.length - 1;

  // reset to first step whenever the tour is (re)opened
  useEffect(() => { if (open) setI(0); }, [open]);

  // let the host prime the UI (e.g. select a dossier) for this step
  useEffect(() => { if (open) onStep?.(step.id); }, [open, step.id, onStep]);

  // measure + track the highlighted element
  const measure = useCallback(() => {
    if (!step.target) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    const pad = 8;
    setRect({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  }, [step.target]);

  useEffect(() => {
    if (!open) return;
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    measure();
    const t1 = setTimeout(measure, 260);
    const t2 = setTimeout(measure, 520); // after smooth-scroll settles
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, step.target, measure]);

  const go = useCallback((n: number) => {
    const next = Math.min(Math.max(n, 0), TOUR.length - 1);
    setI(next);
  }, []);
  const finish = useCallback(() => { audioRef.current?.pause(); onClose(); }, [onClose]);

  // narration: play this step's clip; auto-advance on end. Robust if the file isn't there.
  useEffect(() => {
    if (!open) return;
    const a = audioRef.current; if (!a) return;
    a.pause();
    if (!voice) return;
    a.src = `${BASE}/gen/tour/${step.id}.wav`;
    a.currentTime = 0;
    const onEnded = () => { if (!last) go(i + 1); };
    a.addEventListener("ended", onEnded);
    a.play().then(() => setNeedGesture(false)).catch(() => setNeedGesture(true));
    return () => { a.removeEventListener("ended", onEnded); };
  }, [open, step.id, voice, i, last, go]);

  // if the browser blocked autoplay (arrived via ?tour=1), start on the first user gesture
  useEffect(() => {
    if (!open || !needGesture || !voice) return;
    const start = () => { audioRef.current?.play().then(() => setNeedGesture(false)).catch(() => {}); };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => { window.removeEventListener("pointerdown", start); window.removeEventListener("keydown", start); };
  }, [open, needGesture, voice, step.id]);

  // keyboard: →/Enter next, ← prev, Esc close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); last ? finish() : go(i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
      else if (e.key === "Escape") { finish(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i, last]);

  const replay = () => { const a = audioRef.current; if (a) { a.currentTime = 0; a.play().catch(() => {}); } };

  if (!open) return null;

  // caption card placement: below the target if room, else above; centered when no target
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const CARD_W = Math.min(384, vw - 32);
  let cardStyle: React.CSSProperties;
  if (!rect) {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: CARD_W };
  } else {
    const below = rect.top + rect.height + 14;
    const roomBelow = vh - below > 210;
    const top = roomBelow ? below : Math.max(14, rect.top - 210 - 4);
    let left = rect.left + rect.width / 2 - CARD_W / 2;
    left = Math.min(Math.max(12, left), vw - CARD_W - 12);
    cardStyle = { top, left, width: CARD_W };
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Guided tour">
      <audio ref={audioRef} preload="auto" />
      {/* backdrop: dims the page; a click just arms narration (advance is via Next, to avoid skips) */}
      <div className="absolute inset-0" style={{ background: rect ? "transparent" : "rgba(7,7,6,0.74)", backdropFilter: rect ? undefined : "blur(2px)" }} />

      {/* spotlight cutout via a huge box-shadow ring */}
      {rect && (
        <div className="pointer-events-none absolute rounded-xl" style={{
          top: rect.top, left: rect.left, width: rect.width, height: rect.height,
          boxShadow: "0 0 0 9999px rgba(7,7,6,0.74)", outline: `2px solid ${C.accent}`, outlineOffset: 2,
          transition: "top .3s ease, left .3s ease, width .3s ease, height .3s ease", borderRadius: 14,
        }} />
      )}

      {/* caption card */}
      <div className="absolute rounded-2xl p-4 shadow-2xl" style={{
        ...cardStyle, background: "#111110", border: `1px solid ${C.ring}`,
        transition: "top .3s ease, left .3s ease",
      }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="grid h-6 w-6 place-items-center rounded-md" style={{ background: "#4a90e820", border: "1px solid #4a90e855" }}>
            <Sparkles size={13} color={C.accent} />
          </span>
          <span className="text-[13.5px] font-bold" style={{ color: C.ink }}>{step.title}</span>
          <span className="mono text-[10px] ml-auto" style={{ color: C.muted }}>{i + 1} / {TOUR.length}</span>
        </div>
        <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: C.ink2 }}>{step.caption}</p>

        {needGesture && voice && (
          <div className="mb-3 inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md animate-pulse" style={{ background: "#19a06e18", color: C.aqua, border: "1px solid #19a06e44" }}>
            <Volume2 size={12} /> tap anywhere to start the narration
          </div>
        )}

        {/* progress dots */}
        <div className="flex items-center gap-1.5 mb-3">
          {TOUR.map((s, k) => (
            <button key={s.id} aria-label={`step ${k + 1}`} onClick={() => go(k)}
              className="h-1.5 rounded-full transition-all" style={{ width: k === i ? 18 : 6, background: k === i ? C.accent : "#ffffff2a" }} />
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => setVoice((v) => !v)} title={voice ? "Mute narration" : "Unmute narration"}
            className="grid h-8 w-8 place-items-center rounded-lg" style={{ border: `1px solid ${C.ring}`, color: voice ? C.aqua : C.muted }}>
            {voice ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <button onClick={replay} title="Replay narration"
            className="grid h-8 w-8 place-items-center rounded-lg" style={{ border: `1px solid ${C.ring}`, color: C.ink2 }}>
            <RotateCcw size={14} />
          </button>
          <button onClick={finish} className="text-[12px] px-2 py-1.5 rounded-lg ml-1" style={{ color: C.muted }}>Skip</button>
          <div className="ml-auto flex items-center gap-1.5">
            {i > 0 && (
              <button onClick={() => go(i - 1)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ border: `1px solid ${C.ring}`, color: C.ink2 }}>
                <ArrowLeft size={15} />
              </button>
            )}
            <button onClick={() => (last ? finish() : go(i + 1))}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold" style={{ background: C.accent, color: "#fff" }}>
              {last ? "Done" : "Next"} {!last && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* top-right close */}
      <button onClick={finish} aria-label="Close tour" className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-lg"
        style={{ background: "#111110", border: `1px solid ${C.ring}`, color: C.ink2 }}>
        <X size={16} />
      </button>
    </div>
  );
}
