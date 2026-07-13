"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { ShieldCheck, FlaskConical, Crosshair, ExternalLink, Search, Loader2 } from "lucide-react";

/* ---------- types ---------- */
interface Citation { source: string; ref: string; url?: string; snippet?: string }
interface VerifiedClaim {
  field: string; statement: string; asserted_value: string; basis: string;
  verdict: string; corrected_value?: string; rationale: string; citations?: Citation[];
}
interface VerifierStats {
  proposed: number; confirmed: number; corrected: number; unsupported: number; unassessed: number;
}
interface Dossier {
  gene: string; source?: string; host_factor_role?: string; summary?: string;
  mechanistic_hypothesis?: string; why_prior_failed?: string; recommendation: string;
  recommendation_rationale?: string; validation_experiment?: string;
  druggability_score: number; evidence_strength: number; confidence: number;
  n_known_drugs: number; known_drugs?: string[]; tractability?: string;
  verified_claims?: VerifiedClaim[]; verifier_stats: VerifierStats; citations?: Citation[];
  error?: string;
}
interface Payload {
  n_targets: number; generated_seconds: number;
  verifier: { claims_proposed: number; claims_caught: number; caught_pct: number };
  dossiers: Dossier[];
}

/* ---------- palette (validated dark steps) ---------- */
const HEX = {
  good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b", muted: "#898781",
  blue: "#3987e5", aqua: "#199e70", ink2: "#c3c2b7", grid: "#2c2c2a", baseline: "#383835",
};
const REC: Record<string, { label: string; color: string }> = {
  go: { label: "GO", color: HEX.good },
  watch: { label: "WATCH", color: HEX.warning },
  "no-go": { label: "NO-GO", color: HEX.critical },
  "insufficient-evidence": { label: "INSUFFICIENT", color: HEX.muted },
};
const VERD: Record<string, { label: string; color: string }> = {
  confirmed: { label: "confirmed", color: HEX.good },
  corrected: { label: "corrected", color: HEX.warning },
  unsupported: { label: "unsupported", color: HEX.critical },
  unassessed: { label: "unassessed", color: HEX.muted },
};
const rec = (r: string) => REC[r] ?? REC["insufficient-evidence"];

/* ---------- small components ---------- */
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}55` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function MiniBar({ v, color }: { v: number; color: string }) {
  return (
    <div className="h-1.5 w-16 rounded-full" style={{ background: "#ffffff12" }}>
      <div className="h-full rounded-full" style={{ width: `${Math.round(v * 100)}%`, background: color }} />
    </div>
  );
}

function Kpi({ icon, value, label, sub, color }: { icon: React.ReactNode; value: string; label: string; sub?: string; color?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[12px]" style={{ color: HEX.muted }}>{icon}{label}</div>
      <div className="text-3xl font-semibold tabnum" style={{ color: color ?? "#fff" }}>{value}</div>
      {sub && <div className="text-[12px] leading-snug" style={{ color: HEX.ink2 }}>{sub}</div>}
    </div>
  );
}

/* ---------- page ---------- */
export default function Page() {
  const [data, setData] = useState<Payload | null>(null);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [gene, setGene] = useState("");
  const [assessing, setAssessing] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/dossiers.json").then((r) => r.json()).then((d: Payload) => {
      setData(d); setDossiers(d.dossiers); setSel(d.dossiers[0]?.gene ?? null);
    }).catch(() => setErr("could not load dossiers.json"));
  }, []);

  const agg = useMemo(() => {
    const a = { proposed: 0, confirmed: 0, corrected: 0, unsupported: 0, unassessed: 0 };
    for (const d of dossiers) {
      const s = d.verifier_stats;
      a.proposed += s.proposed; a.confirmed += s.confirmed; a.corrected += s.corrected;
      a.unsupported += s.unsupported; a.unassessed += s.unassessed;
    }
    return a;
  }, [dossiers]);
  const caught = agg.corrected + agg.unsupported;
  const caughtPct = agg.proposed ? Math.round((100 * caught) / agg.proposed) : 0;
  const goCount = dossiers.filter((d) => d.recommendation === "go" || d.recommendation === "watch").length;

  const selected = dossiers.find((d) => d.gene === sel) ?? null;

  const groups = useMemo(() => {
    const m: Record<string, Dossier[]> = {};
    for (const d of dossiers) (m[d.recommendation] ??= []).push(d);
    return m;
  }, [dossiers]);

  async function assess() {
    const g = gene.trim().toUpperCase();
    if (!g || assessing) return;
    setAssessing(true); setErr("");
    try {
      const r = await fetch("/api/assess", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene: g }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      const nd: Dossier = j.dossier;
      setDossiers((prev) => [nd, ...prev.filter((d) => d.gene !== nd.gene)]);
      setSel(nd.gene); setGene("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAssessing(false);
    }
  }

  if (!data) {
    return <div className="min-h-screen grid place-items-center text-sm" style={{ color: HEX.muted }}>{err || "loading…"}</div>;
  }

  return (
    <main className="mx-auto max-w-[1240px] px-5 py-8">
      <header className="mb-7">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: "#3987e51f", border: "1px solid #3987e555" }}>
            <ShieldCheck size={20} color={HEX.blue} />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Aquiles</h1>
          <span className="mono text-[11px] px-2 py-0.5 rounded-md" style={{ color: HEX.ink2, background: "#ffffff0d" }}>
            arbovirus host-directed antiviral target triage
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed" style={{ color: HEX.ink2 }}>
          Aedes-borne arboviruses have <b style={{ color: "#fff" }}>no approved antiviral</b>. Aquiles ranks candidate
          human host-factor targets — and every specialist claim is checked by an{" "}
          <b style={{ color: "#fff" }}>independent verifier</b> against the raw database record, not by the same model
          reviewing itself.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi icon={<Crosshair size={14} />} label="targets triaged" value={String(data.n_targets)}
          sub="Krogan Dengue/Zika interactome + CRISPR screens" />
        <Kpi icon={<ShieldCheck size={14} />} label="claims caught by the verifier" value={`${caught}/${agg.proposed}`}
          sub={`${caughtPct}% of specialist claims were unsupported or corrected vs. the raw record`} color={HEX.warning} />
        <Kpi icon={<FlaskConical size={14} />} label="pursue-worthy (go / watch)" value={String(goCount)}
          sub="ranked by druggability × verified evidence" color={HEX.good} />
        <Kpi icon={<Loader2 size={14} />} label="pipeline runtime" value={`${data.generated_seconds}s`}
          sub="specialist (Haiku) → independent verifier (Sonnet) → synthesis" />
      </section>

      <section className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-[12px] font-medium" style={{ color: HEX.ink2 }}>
            Independent-verifier impact <span style={{ color: HEX.muted }}>· every claim checked against the raw DB record in an isolated context</span>
          </div>
          <div className="text-[12px]" style={{ color: HEX.muted }}>
            <span className="font-semibold" style={{ color: HEX.warning }}>{caughtPct}%</span> caught
          </div>
        </div>
        <div className="flex h-6 w-full overflow-hidden rounded-md" style={{ gap: 2 }}>
          {(["confirmed", "corrected", "unsupported", "unassessed"] as const).map((k) => {
            const val = agg[k]; const total = agg.proposed + agg.unassessed;
            if (!val || !total) return null;
            return (
              <div key={k} className="grid place-items-center text-[11px] font-semibold text-black/80"
                style={{ width: `${(100 * val) / total}%`, background: VERD[k].color, minWidth: 22 }}
                title={`${k}: ${val}`}>{val}</div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: HEX.muted }}>
          {(["confirmed", "corrected", "unsupported", "unassessed"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: VERD[k].color }} />{k} · {agg[k]}
            </span>
          ))}
          <span className="ml-auto italic">verifier OFF would keep all {agg.proposed}; verifier ON kept {agg.confirmed}.</span>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-4">
        <div className="flex flex-col gap-4">
          <section className="card p-4">
            <div className="text-[12px] font-medium mb-1" style={{ color: HEX.ink2 }}>Target landscape</div>
            <div className="text-[11px] mb-2" style={{ color: HEX.muted }}>
              druggability × verified evidence · bubble = known drugs · color = recommendation · click a target
            </div>
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
                  <CartesianGrid stroke={HEX.grid} />
                  <XAxis type="number" dataKey="druggability_score" name="druggability" domain={[0, 1]}
                    tick={{ fill: HEX.muted, fontSize: 11 }} stroke={HEX.baseline}
                    label={{ value: "druggability →", position: "insideBottom", offset: -12, fill: HEX.muted, fontSize: 11 }} />
                  <YAxis type="number" dataKey="evidence_strength" name="evidence" domain={[0, 1]}
                    tick={{ fill: HEX.muted, fontSize: 11 }} stroke={HEX.baseline}
                    label={{ value: "verified evidence →", angle: -90, position: "insideLeft", fill: HEX.muted, fontSize: 11 }} />
                  <ZAxis type="number" dataKey="n_known_drugs" range={[70, 430]} name="known drugs" />
                  <Tooltip cursor={{ strokeDasharray: "3 3", stroke: HEX.baseline }} content={<Tip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: HEX.muted }} />
                  {Object.entries(groups).map(([r, ds]) => (
                    <Scatter key={r} name={rec(r).label} data={ds} fill={rec(r).color}
                      fillOpacity={0.85} stroke={rec(r).color} isAnimationActive={false}
                      onClick={(d: unknown) => { const g = (d as { gene?: string })?.gene; if (g) setSel(g); }}
                      style={{ cursor: "pointer" }} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="px-4 pt-3 pb-2 text-[12px] font-medium" style={{ color: HEX.ink2 }}>Ranked targets</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left" style={{ color: HEX.muted }}>
                    <th className="px-4 py-2 font-medium">gene</th>
                    <th className="px-2 py-2 font-medium">recommendation</th>
                    <th className="px-2 py-2 font-medium">druggability</th>
                    <th className="px-2 py-2 font-medium">evidence</th>
                    <th className="px-2 py-2 font-medium">verifier</th>
                  </tr>
                </thead>
                <tbody>
                  {dossiers.map((d) => {
                    const active = d.gene === sel;
                    const c = d.verifier_stats.corrected + d.verifier_stats.unsupported;
                    return (
                      <tr key={d.gene} onClick={() => setSel(d.gene)}
                        className="cursor-pointer border-t transition-colors hover:bg-white/5"
                        style={{ borderColor: HEX.grid, background: active ? "#3987e514" : undefined }}>
                        <td className="px-4 py-2 mono font-semibold">{d.gene}</td>
                        <td className="px-2 py-2"><Badge {...rec(d.recommendation)} /></td>
                        <td className="px-2 py-2"><div className="flex items-center gap-2"><MiniBar v={d.druggability_score} color={HEX.blue} /><span className="tabnum" style={{ color: HEX.ink2 }}>{d.druggability_score.toFixed(2)}</span></div></td>
                        <td className="px-2 py-2"><div className="flex items-center gap-2"><MiniBar v={d.evidence_strength} color={HEX.aqua} /><span className="tabnum" style={{ color: HEX.ink2 }}>{d.evidence_strength.toFixed(2)}</span></div></td>
                        <td className="px-2 py-2 tabnum" style={{ color: c ? HEX.warning : HEX.muted }} title="claims caught / assessed">{c}/{d.verifier_stats.proposed}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="card p-3">
            <div className="flex items-center gap-2">
              <Search size={15} color={HEX.muted} />
              <input value={gene} onChange={(e) => setGene(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && assess()}
                placeholder="assess a new host gene (live) — e.g. RACK1"
                className="flex-1 bg-transparent text-[13px] outline-none"
                style={{ color: "#fff" }} />
              <button onClick={assess} disabled={assessing}
                className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
                style={{ background: HEX.blue, color: "#fff" }}>
                {assessing ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />running</span> : "assess"}
              </button>
            </div>
            {err && <div className="mt-2 text-[11px]" style={{ color: HEX.critical }}>{err}</div>}
          </section>

          {selected && <DossierView d={selected} />}
        </div>
      </div>

      <footer className="mt-8 text-[11px] leading-relaxed" style={{ color: HEX.muted }}>
        Evidence from Open Targets · DGIdb · Europe PMC. Human-in-the-loop; not a diagnosis or a treatment
        recommendation. Claims marked <i>unassessed</i> were excluded from the metric. Built with Claude.
      </footer>
    </main>
  );
}

function Tip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Dossier }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-[11.5px]" style={{ background: "#111", borderColor: HEX.baseline }}>
      <div className="mono font-semibold">{d.gene}</div>
      <div style={{ color: HEX.ink2 }}>druggability {d.druggability_score.toFixed(2)} · evidence {d.evidence_strength.toFixed(2)}</div>
      <div style={{ color: HEX.muted }}>{d.n_known_drugs} known drugs · {rec(d.recommendation).label}</div>
    </div>
  );
}

function DossierView({ d }: { d: Dossier }) {
  const claims = d.verified_claims ?? [];
  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold mono">{d.gene}</h2>
            <Badge {...rec(d.recommendation)} />
          </div>
          {d.source && <div className="text-[11px] mt-0.5" style={{ color: HEX.muted }}>{d.source}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px]" style={{ color: HEX.muted }}>confidence</div>
          <div className="text-2xl font-semibold tabnum" style={{ color: HEX.blue }}>{d.confidence.toFixed(2)}</div>
        </div>
      </div>

      {d.summary && <p className="text-[13px] leading-relaxed" style={{ color: HEX.ink2 }}>{d.summary}</p>}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="druggability" v={d.druggability_score} note={d.tractability} color={HEX.blue} />
        <Stat label="evidence" v={d.evidence_strength} color={HEX.good} />
        <div className="rounded-lg p-2" style={{ background: "#ffffff08" }}>
          <div className="text-[11px]" style={{ color: HEX.muted }}>known drugs</div>
          <div className="text-lg font-semibold tabnum">{d.n_known_drugs}</div>
        </div>
      </div>

      {d.mechanistic_hypothesis && <Field title="Mechanistic hypothesis" body={d.mechanistic_hypothesis} />}
      {d.why_prior_failed && <Field title="Why prior antiviral trials failed" body={d.why_prior_failed} accent={HEX.serious} />}
      {d.validation_experiment && <Field title="Suggested validation" body={d.validation_experiment} />}
      {d.recommendation_rationale && <Field title="Recommendation rationale" body={d.recommendation_rationale} />}

      <div>
        <div className="text-[12px] font-medium mb-1.5" style={{ color: HEX.ink2 }}>
          Verified claims <span style={{ color: HEX.muted }}>· specialist claim → independent verdict against the raw record</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {claims.map((c, i) => <ClaimRow key={i} c={c} />)}
        </div>
      </div>

      {!!d.citations?.length && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {d.citations!.map((c, i) => (
            <a key={i} href={c.url || "#"} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] hover:bg-white/10"
              style={{ background: "#ffffff0d", color: HEX.ink2 }}>
              <ExternalLink size={11} />{c.source}: {c.ref}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, v, note, color }: { label: string; v: number; note?: string; color: string }) {
  return (
    <div className="rounded-lg p-2" style={{ background: "#ffffff08" }}>
      <div className="text-[11px]" style={{ color: HEX.muted }}>{label}</div>
      <div className="text-lg font-semibold tabnum" style={{ color }}>{v.toFixed(2)}</div>
      {note && <div className="text-[9.5px] leading-tight" style={{ color: HEX.muted }}>{note}</div>}
    </div>
  );
}

function Field({ title, body, accent }: { title: string; body: string; accent?: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: "#ffffff06", borderLeft: `2px solid ${accent ?? HEX.blue}` }}>
      <div className="text-[11px] font-medium mb-0.5" style={{ color: accent ?? HEX.ink2 }}>{title}</div>
      <div className="text-[12.5px] leading-relaxed" style={{ color: HEX.ink2 }}>{body}</div>
    </div>
  );
}

function ClaimRow({ c }: { c: VerifiedClaim }) {
  const v = VERD[c.verdict] ?? VERD.unassessed;
  return (
    <div className="rounded-lg p-2" style={{ background: "#ffffff06", border: `1px solid ${v.color}22` }}>
      <div className="flex items-start gap-2">
        <Badge label={v.label} color={v.color} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px]" style={{ color: "#fff" }}>
            <span className="mono text-[10px] px-1 py-0.5 rounded" style={{ background: "#ffffff0d", color: HEX.muted }}>{c.field}</span>{" "}
            {c.statement}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: HEX.muted }}>
            asserted <span style={{ color: HEX.ink2 }}>“{c.asserted_value}”</span>
            {c.corrected_value ? <> → corrected <span style={{ color: HEX.warning }}>“{c.corrected_value}”</span></> : null}
            {c.basis ? <> · basis: {c.basis}</> : null}
          </div>
          {c.rationale && <div className="mt-1 text-[11px] italic" style={{ color: v.color }}>{c.rationale}</div>}
        </div>
      </div>
    </div>
  );
}
