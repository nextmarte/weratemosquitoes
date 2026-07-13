"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { ShieldCheck, Crosshair, ExternalLink, ArrowUp, Check, Sparkles, ArrowLeft, Loader2, Repeat } from "lucide-react";

/* ---------- types ---------- */
interface Citation { source: string; ref: string; url?: string; snippet?: string }
interface VerifiedClaim {
  field: string; statement: string; asserted_value: string; basis: string;
  verdict: string; corrected_value?: string; rationale: string; citations?: Citation[];
}
interface VerifierStats { proposed: number; confirmed: number; corrected: number; unsupported: number; unassessed: number }
interface Repurpose { has_candidate: boolean; drug: string; approved_for: string; mechanism: string; rationale: string; why_it_might_succeed: string; confidence: string; caveats: string }
interface Dossier {
  gene: string; source?: string; host_factor_role?: string; summary?: string;
  mechanistic_hypothesis?: string; why_prior_failed?: string; recommendation: string;
  recommendation_rationale?: string; validation_experiment?: string;
  druggability_score: number; evidence_strength: number; confidence: number;
  n_known_drugs: number; known_drugs?: string[]; tractability?: string;
  verified_claims?: VerifiedClaim[]; verifier_stats: VerifierStats; citations?: Citation[];
  repurposing?: Repurpose | null; error?: string;
}
interface Payload { n_targets: number; generated_seconds: number; verifier: { caught_pct: number }; dossiers: Dossier[] }
type ToolChip = { name: string; done: boolean; count: number };
type Msg = { role: "user" | "assistant"; text: string; tools: ToolChip[]; notice?: string };

/* ---------- palette ---------- */
const HEX = {
  accent: "#4a90e8", good: "#17b317", warning: "#f5b431", serious: "#ec835a", critical: "#e0524f",
  muted: "#86847c", ink2: "#b9b8b0", aqua: "#199e70", grid: "#262624", baseline: "#38383a",
  ring: "#ffffff17",
};
const REC: Record<string, { label: string; color: string }> = {
  go: { label: "GO", color: HEX.good }, watch: { label: "WATCH", color: HEX.warning },
  "no-go": { label: "NO-GO", color: HEX.critical }, "insufficient-evidence": { label: "INSUFFICIENT", color: HEX.muted },
};
const VERD: Record<string, { label: string; color: string }> = {
  confirmed: { label: "confirmed", color: HEX.good }, corrected: { label: "corrected", color: HEX.warning },
  unsupported: { label: "unsupported", color: HEX.critical }, unassessed: { label: "unassessed", color: HEX.muted },
};
const rec = (r: string) => REC[r] ?? REC["insufficient-evidence"];

/* ---------- atoms ---------- */
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
      style={{ color, background: `${color}1c`, border: `1px solid ${color}4d` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{label}
    </span>
  );
}
function MiniBar({ v, color }: { v: number; color: string }) {
  return (
    <div className="h-1.5 w-14 rounded-full" style={{ background: "#ffffff14" }}>
      <div className="h-full rounded-full" style={{ width: `${Math.round(v * 100)}%`, background: color }} />
    </div>
  );
}

const SUGGESTIONS = [
  "Which host factors are the most druggable? Cite the verifier.",
  "Assess STT3A as an antiviral target.",
  "Give me a go / no-go shortlist and explain the top one.",
  "Why did prior dengue antiviral trials fail?",
];

/* ---------- page ---------- */
export default function Dashboard() {
  const [data, setData] = useState<Payload | null>(null);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/dossiers.json").then((r) => r.json()).then((d: Payload) => {
      setData(d); setDossiers(d.dossiers); setSel(d.dossiers[0]?.gene ?? null);
    }).catch(() => {});
  }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  const agg = useMemo(() => {
    const a = { proposed: 0, confirmed: 0, corrected: 0, unsupported: 0, unassessed: 0 };
    for (const d of dossiers) { const s = d.verifier_stats; a.proposed += s.proposed; a.confirmed += s.confirmed; a.corrected += s.corrected; a.unsupported += s.unsupported; a.unassessed += s.unassessed; }
    return a;
  }, [dossiers]);
  const caught = agg.corrected + agg.unsupported;
  const caughtPct = agg.proposed ? Math.round((100 * caught) / agg.proposed) : 0;
  const goCount = dossiers.filter((d) => d.recommendation === "go" || d.recommendation === "watch").length;
  const selected = dossiers.find((d) => d.gene === sel) ?? null;
  const groups = useMemo(() => { const m: Record<string, Dossier[]> = {}; for (const d of dossiers) (m[d.recommendation] ??= []).push(d); return m; }, [dossiers]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setInput("");
    const history: Msg[] = [...msgs, { role: "user", text: q, tools: [] }];
    setMsgs([...history, { role: "assistant", text: "", tools: [] }]);
    setBusy(true);
    const update = (fn: (m: Msg) => void) => setMsgs((prev) => { const c = [...prev]; fn(c[c.length - 1]); return c; });
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.text })) }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const o = JSON.parse(line.slice(5).trim());
          if (o.type === "text") update((m) => { m.text += o.text; });
          else if (o.type === "tool_use") update((m) => { m.tools.push({ name: o.name, done: false, count: 0 }); });
          else if (o.type === "tool_result") {
            update((m) => { const t = [...m.tools].reverse().find((x) => x.name === o.name && !x.done); if (t) { t.done = true; t.count = (o.dossiers?.length) || 0; } });
            if (Array.isArray(o.dossiers) && o.dossiers.length) {
              setDossiers((prev) => { const map = new Map(prev.map((d) => [d.gene, d])); for (const nd of o.dossiers) map.set(nd.gene, nd); return [...map.values()].sort((a, b) => (0.5 * b.druggability_score + 0.3 * b.evidence_strength + 0.2 * b.confidence) - (0.5 * a.druggability_score + 0.3 * a.evidence_strength + 0.2 * a.confidence)); });
              if (o.dossiers.length === 1) setSel(o.dossiers[0].gene);
            }
          } else if (o.type === "notice") update((m) => { m.notice = o.text; });
          else if (o.type === "error") update((m) => { m.notice = "error: " + o.message; });
        }
      }
    } catch (e) { update((m) => { m.notice = "connection error: " + (e as Error).message; }); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-[1360px] px-4 py-5 lg:h-screen lg:flex lg:flex-col">
      {/* header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#4a90e820", border: "1px solid #4a90e855" }}>
            <ShieldCheck size={18} color={HEX.accent} />
          </span>
          <span className="display text-[22px] font-extrabold">Aquiles</span>
          <span className="mono text-[10.5px] px-2 py-0.5 rounded-md hidden sm:inline" style={{ color: HEX.ink2, background: "#ffffff0d" }}>
            verified antiviral target discovery
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap text-[11.5px]">
          <Chip icon={<Crosshair size={12} />} k="targets" v={String(data?.n_targets ?? dossiers.length)} />
          <Chip icon={<ShieldCheck size={12} />} k="verifier caught" v={`${caught}/${agg.proposed}`} accent={HEX.warning} big />
          <Chip icon={<Sparkles size={12} />} k="go / watch" v={String(goCount)} accent={HEX.good} />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)] gap-3 lg:flex-1 lg:min-h-0">
        {/* ── chat console ── */}
        <section className="card flex flex-col min-h-[520px] lg:min-h-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: HEX.grid }}>
            <span className="h-2 w-2 rounded-full" style={{ background: HEX.good }} />
            <span className="text-[12px] font-medium" style={{ color: HEX.ink2 }}>Aquiles agent</span>
            <span className="text-[11px]" style={{ color: HEX.muted }}>· Claude plans, calls the verified pipeline, answers</span>
          </div>

          <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
            {msgs.length === 0 && (
              <div className="m-auto text-center max-w-sm">
                <div className="display text-lg font-bold mb-1.5">Ask about antiviral targets.</div>
                <p className="text-[12.5px] leading-relaxed mb-4" style={{ color: HEX.muted }}>
                  Claude reasons over Open Targets, DGIdb and Europe PMC — and an independent verifier checks every
                  claim against the raw record before it reaches you.
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => ask(s)} className="text-left text-[12.5px] rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.06]"
                      style={{ background: "#ffffff05", border: `1px solid ${HEX.grid}`, color: HEX.ink2 }}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => <ChatBubble key={i} m={m} streaming={busy && i === msgs.length - 1} />)}
          </div>

          <div className="p-3 border-t" style={{ borderColor: HEX.grid }}>
            <div className="flex items-end gap-2 rounded-xl px-3 py-2" style={{ background: "#ffffff08", border: `1px solid ${HEX.ring}` }}>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
                placeholder="e.g. assess VCP, or: which targets are most druggable?"
                className="flex-1 bg-transparent resize-none outline-none text-[13px] leading-5 max-h-28" style={{ color: "#fff" }} />
              <button onClick={() => ask(input)} disabled={busy || !input.trim()}
                className="grid h-8 w-8 place-items-center rounded-lg shrink-0 disabled:opacity-40" style={{ background: HEX.accent }}>
                {busy ? <Loader2 size={15} className="animate-spin" color="#fff" /> : <ArrowUp size={16} color="#fff" />}
              </button>
            </div>
          </div>
        </section>

        {/* ── evidence panel ── */}
        <section className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto pr-0.5">
          {/* verifier strip */}
          <div className="card p-3.5 shrink-0">
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <div className="text-[12px] font-medium" style={{ color: HEX.ink2 }}>
                Independent-verifier impact <span style={{ color: HEX.muted }}>· each claim checked vs. the raw DB record, in isolation</span>
              </div>
              <div className="text-[11.5px]"><span className="font-semibold" style={{ color: HEX.warning }}>{caughtPct}%</span> <span style={{ color: HEX.muted }}>caught</span></div>
            </div>
            <div className="flex h-5 w-full overflow-hidden rounded-md" style={{ gap: 2 }}>
              {(["confirmed", "corrected", "unsupported", "unassessed"] as const).map((k) => {
                const val = agg[k]; const total = agg.proposed + agg.unassessed; if (!val || !total) return null;
                return <div key={k} className="grid place-items-center text-[10.5px] font-semibold text-black/80" style={{ width: `${(100 * val) / total}%`, background: VERD[k].color, minWidth: 20 }} title={`${k}: ${val}`}>{val}</div>;
              })}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[10.5px]" style={{ color: HEX.muted }}>
              {(["confirmed", "corrected", "unsupported", "unassessed"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: VERD[k].color }} />{k} · {agg[k]}</span>
              ))}
              <span className="ml-auto italic">a self-check keeps all {agg.proposed}; this kept {agg.confirmed}.</span>
            </div>
          </div>

          {/* landscape */}
          <div className="card p-3.5 shrink-0">
            <div className="text-[12px] font-medium mb-0.5" style={{ color: HEX.ink2 }}>Target landscape</div>
            <div className="text-[10.5px] mb-1" style={{ color: HEX.muted }}>druggability × verified evidence · bubble = known drugs · click a target</div>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
                  <CartesianGrid stroke={HEX.grid} />
                  <XAxis type="number" dataKey="druggability_score" domain={[0, 1]} tick={{ fill: HEX.muted, fontSize: 10 }} stroke={HEX.baseline} />
                  <YAxis type="number" dataKey="evidence_strength" domain={[0, 1]} tick={{ fill: HEX.muted, fontSize: 10 }} stroke={HEX.baseline} />
                  <ZAxis type="number" dataKey="n_known_drugs" range={[60, 380]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3", stroke: HEX.baseline }} content={<Tip />} />
                  <Legend wrapperStyle={{ fontSize: 10, color: HEX.muted }} />
                  {Object.entries(groups).map(([r, ds]) => (
                    <Scatter key={r} name={rec(r).label} data={ds} fill={rec(r).color} fillOpacity={0.85} stroke={rec(r).color} isAnimationActive={false}
                      onClick={(d: unknown) => { const g = (d as { gene?: string })?.gene; if (g) setSel(g); }} style={{ cursor: "pointer" }} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* selected dossier | table */}
          {selected ? <DossierView d={selected} onBack={() => setSel(null)} /> : <RankedTable dossiers={dossiers} onPick={setSel} />}
        </section>
      </div>
      <footer className="mt-2 text-[10.5px] shrink-0" style={{ color: HEX.muted }}>
        Evidence: Open Targets · DGIdb · Europe PMC (public). Human-in-the-loop; not a diagnosis or treatment recommendation. Built with Claude.
      </footer>
    </main>
  );
}

/* ---------- chat bubble ---------- */
function ChatBubble({ m, streaming }: { m: Msg; streaming: boolean }) {
  if (m.role === "user") {
    return <div className="self-end max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] fadein" style={{ background: HEX.accent, color: "#fff" }}>{m.text}</div>;
  }
  return (
    <div className="self-start max-w-[92%] fadein">
      {m.tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {m.tools.map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] mono" style={{ background: "#ffffff08", border: `1px solid ${HEX.grid}`, color: t.done ? HEX.aqua : HEX.muted }}>
              {t.done ? <Check size={12} /> : <Loader2 size={12} className="animate-spin" />}{t.name}{t.done && t.count ? ` · ${t.count}` : ""}
            </span>
          ))}
        </div>
      )}
      <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ background: "#ffffff07", border: `1px solid ${HEX.grid}`, color: HEX.ink2 }}>
        {renderMd(m.text)}
        {!m.text && streaming && m.tools.some((t) => !t.done) && (
          <span className="text-[12px] italic" style={{ color: HEX.muted }}>running the verified pipeline — this can take ~30s…</span>
        )}
        {streaming && <span className="caret" style={{ color: HEX.accent }}>▍</span>}
        {m.notice && <div className="mt-1.5 text-[11px]" style={{ color: HEX.serious }}>{m.notice}</div>}
      </div>
    </div>
  );
}
// tiny markdown: **bold** + line breaks
function renderMd(t: string) {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <b key={i} style={{ color: "#fff" }}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>);
}

function Chip({ icon, k, v, accent, big }: { icon: React.ReactNode; k: string; v: string; accent?: string; big?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1" style={{ background: "#ffffff08", border: `1px solid ${HEX.ring}` }}>
      <span style={{ color: HEX.muted }}>{icon}</span>
      <span style={{ color: HEX.muted }}>{k}</span>
      <span className={`tabnum font-semibold ${big ? "text-[14px]" : ""}`} style={{ color: accent ?? "#fff" }}>{v}</span>
    </span>
  );
}
function Tip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Dossier }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-[11.5px]" style={{ background: "#0f0f0e", borderColor: HEX.baseline }}>
      <div className="mono font-semibold">{d.gene}</div>
      <div style={{ color: HEX.ink2 }}>druggability {d.druggability_score.toFixed(2)} · evidence {d.evidence_strength.toFixed(2)}</div>
      <div style={{ color: HEX.muted }}>{d.n_known_drugs} known drugs · {rec(d.recommendation).label}</div>
    </div>
  );
}

function RankedTable({ dossiers, onPick }: { dossiers: Dossier[]; onPick: (g: string) => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-3 pb-2 text-[12px] font-medium" style={{ color: HEX.ink2 }}>Ranked targets <span style={{ color: HEX.muted }}>· click to inspect</span></div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="text-left" style={{ color: HEX.muted }}>
            <th className="px-4 py-1.5 font-medium">gene</th><th className="px-2 py-1.5 font-medium">rec</th>
            <th className="px-2 py-1.5 font-medium">drug</th><th className="px-2 py-1.5 font-medium">evidence</th><th className="px-2 py-1.5 font-medium">verifier</th>
          </tr></thead>
          <tbody>
            {dossiers.map((d) => {
              const c = d.verifier_stats.corrected + d.verifier_stats.unsupported;
              return (
                <tr key={d.gene} onClick={() => onPick(d.gene)} className="cursor-pointer border-t hover:bg-white/[0.04]" style={{ borderColor: HEX.grid }}>
                  <td className="px-4 py-1.5 mono font-semibold">{d.gene}</td>
                  <td className="px-2 py-1.5"><Badge {...rec(d.recommendation)} /></td>
                  <td className="px-2 py-1.5"><div className="flex items-center gap-2"><MiniBar v={d.druggability_score} color={HEX.accent} /><span className="tabnum" style={{ color: HEX.ink2 }}>{d.druggability_score.toFixed(2)}</span></div></td>
                  <td className="px-2 py-1.5"><div className="flex items-center gap-2"><MiniBar v={d.evidence_strength} color={HEX.aqua} /><span className="tabnum" style={{ color: HEX.ink2 }}>{d.evidence_strength.toFixed(2)}</span></div></td>
                  <td className="px-2 py-1.5 tabnum" style={{ color: c ? HEX.warning : HEX.muted }}>{c}/{d.verifier_stats.proposed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DossierView({ d, onBack }: { d: Dossier; onBack: () => void }) {
  const claims = d.verified_claims ?? [];
  return (
    <div className="card p-4 flex flex-col gap-3 fadein">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={onBack} className="inline-flex items-center gap-1 text-[11px] mb-1 hover:opacity-80" style={{ color: HEX.muted }}><ArrowLeft size={12} />all targets</button>
          <div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-bold mono">{d.gene}</h2><Badge {...rec(d.recommendation)} /></div>
          {d.source && <div className="text-[10.5px] mt-0.5" style={{ color: HEX.muted }}>{d.source}</div>}
        </div>
        <div className="text-right shrink-0"><div className="text-[10.5px]" style={{ color: HEX.muted }}>confidence</div><div className="display text-2xl font-extrabold tabnum" style={{ color: HEX.accent }}>{d.confidence.toFixed(2)}</div></div>
      </div>
      {d.summary && <p className="text-[12.5px] leading-relaxed" style={{ color: HEX.ink2 }}>{d.summary}</p>}
      {d.repurposing?.has_candidate && <RepurposingCard r={d.repurposing} />}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="druggability" v={d.druggability_score} note={d.tractability} color={HEX.accent} />
        <Stat label="evidence" v={d.evidence_strength} color={HEX.good} />
        <div className="rounded-lg p-2" style={{ background: "#ffffff08" }}><div className="text-[10.5px]" style={{ color: HEX.muted }}>known drugs</div><div className="text-lg font-semibold tabnum">{d.n_known_drugs}</div></div>
      </div>
      <VerifierMini stats={d.verifier_stats} />
      {d.mechanistic_hypothesis && <Field title="Mechanistic hypothesis" body={d.mechanistic_hypothesis} />}
      {d.why_prior_failed && <Field title="Why prior antiviral trials failed" body={d.why_prior_failed} accent={HEX.serious} />}
      {d.validation_experiment && <Field title="Suggested validation" body={d.validation_experiment} />}
      <div>
        <div className="text-[12px] font-medium mb-1.5" style={{ color: HEX.ink2 }}>Verified claims <span style={{ color: HEX.muted }}>· specialist claim → independent verdict vs. the raw record</span></div>
        <div className="flex flex-col gap-1.5">{claims.map((c, i) => <ClaimRow key={i} c={c} />)}</div>
      </div>
      {!!d.citations?.length && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {d.citations!.map((c, i) => (
            <a key={i} href={c.url || "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] hover:bg-white/10" style={{ background: "#ffffff0d", color: HEX.ink2 }}>
              <ExternalLink size={11} />{c.source}: {c.ref}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
function RepurposingCard({ r }: { r: Repurpose }) {
  const band = (r.confidence || "").split(/[ |]/)[0];
  const bc = band === "High" ? HEX.good : band === "Low" ? HEX.critical : HEX.warning;
  return (
    <div className="rounded-xl p-3.5" style={{ background: "linear-gradient(180deg,#12271e,#0f0f0e)", border: `1px solid ${HEX.aqua}55` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Repeat size={14} color={HEX.aqua} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: HEX.aqua }}>Repurposing opportunity</span>
        <span className="ml-auto text-[10.5px]" style={{ color: HEX.muted }}>confidence <b style={{ color: bc }}>{band || "—"}</b></span>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="mono text-[17px] font-bold">{r.drug}</span>
        {r.approved_for && <span className="text-[11.5px]" style={{ color: HEX.ink2 }}>currently for {r.approved_for}</span>}
      </div>
      {r.rationale && <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: HEX.ink2 }}>{r.rationale}</p>}
      {r.why_it_might_succeed && (
        <div className="mt-2 rounded-lg p-2" style={{ background: "#ffffff07" }}>
          <div className="text-[10px] font-medium mb-0.5" style={{ color: HEX.aqua }}>why it might succeed where past trials failed</div>
          <div className="text-[11.5px] leading-relaxed" style={{ color: HEX.ink2 }}>{r.why_it_might_succeed}</div>
        </div>
      )}
      {r.caveats && <div className="mt-1.5 text-[10.5px]" style={{ color: HEX.muted }}>caveats: {r.caveats}</div>}
    </div>
  );
}
function VerifierMini({ stats }: { stats: VerifierStats }) {
  const total = stats.proposed + stats.unassessed;
  const caught = stats.corrected + stats.unsupported;
  if (!total) return null;
  return (
    <div className="rounded-lg p-2.5" style={{ background: "#ffffff06" }}>
      <div className="flex items-center justify-between mb-1.5 text-[10.5px]" style={{ color: HEX.muted }}>
        <span>this target: independent verifier checked {stats.proposed} claims</span>
        <span><span className="font-semibold" style={{ color: HEX.warning }}>{caught}</span> caught</span>
      </div>
      <div className="flex h-3.5 w-full overflow-hidden rounded" style={{ gap: 2 }}>
        {(["confirmed", "corrected", "unsupported", "unassessed"] as const).map((k) =>
          stats[k] ? <div key={k} style={{ width: `${(100 * stats[k]) / total}%`, background: VERD[k].color, minWidth: 10 }} title={`${k}: ${stats[k]}`} /> : null)}
      </div>
    </div>
  );
}
function Stat({ label, v, note, color }: { label: string; v: number; note?: string; color: string }) {
  return (
    <div className="rounded-lg p-2" style={{ background: "#ffffff08" }}>
      <div className="text-[10.5px]" style={{ color: HEX.muted }}>{label}</div>
      <div className="text-lg font-semibold tabnum" style={{ color }}>{v.toFixed(2)}</div>
      {note && <div className="text-[9px] leading-tight" style={{ color: HEX.muted }}>{note}</div>}
    </div>
  );
}
function Field({ title, body, accent }: { title: string; body: string; accent?: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: "#ffffff06", borderLeft: `2px solid ${accent ?? HEX.accent}` }}>
      <div className="text-[10.5px] font-medium mb-0.5" style={{ color: accent ?? HEX.ink2 }}>{title}</div>
      <div className="text-[12px] leading-relaxed" style={{ color: HEX.ink2 }}>{body}</div>
    </div>
  );
}
function ClaimRow({ c }: { c: VerifiedClaim }) {
  const v = VERD[c.verdict] ?? VERD.unassessed;
  return (
    <div className="rounded-lg p-2" style={{ background: "#ffffff06", border: `1px solid ${v.color}26` }}>
      <div className="flex items-start gap-2">
        <Badge label={v.label} color={v.color} />
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px]" style={{ color: "#fff" }}><span className="mono text-[9.5px] px-1 py-0.5 rounded" style={{ background: "#ffffff0d", color: HEX.muted }}>{c.field}</span> {c.statement}</div>
          <div className="mt-1 text-[10.5px]" style={{ color: HEX.muted }}>
            asserted <span style={{ color: HEX.ink2 }}>“{c.asserted_value}”</span>
            {c.corrected_value ? <> → corrected <span style={{ color: HEX.warning }}>“{c.corrected_value}”</span></> : null}
          </div>
          {c.rationale && <div className="mt-1 text-[10.5px] italic" style={{ color: v.color }}>{c.rationale}</div>}
        </div>
      </div>
    </div>
  );
}
