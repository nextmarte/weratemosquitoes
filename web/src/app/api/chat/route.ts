// Agentic chat: Claude (Opus 4.8) plans and calls the Aquiles pipeline tools live, streaming its
// reasoning + tool calls to the client. Tools execute against the Gradio backend (which runs the
// specialist -> independent verifier -> synthesis pipeline). This is where Claude's role is visible.
import Anthropic from "@anthropic-ai/sdk";

const GRADIO = process.env.GRADIO_URL || "http://localhost:7860";
const MODEL = "claude-haiku-4-5"; // refusal-resistant for antiviral-target content; fast for chat

const SYSTEM =
  "You are Aquiles, a research assistant for host-directed antiviral drug discovery. You help " +
  "scientists prioritize HUMAN host-factor proteins as candidate therapeutic drug targets against " +
  "mosquito-borne flaviviruses (dengue, Zika), for which no antiviral is approved. You reason over " +
  "public database evidence (Open Targets, DGIdb, Europe PMC) using your tools; every underlying " +
  "claim is independently verified against the raw database record. Be concise and specific. Lead " +
  "with the answer, cite the evidence and the verifier's verdicts (confirmed/corrected/unsupported), " +
  "state confidence and uncertainty plainly, and never frame anything as clinical advice. Use " +
  "prioritize_targets for ranking questions, assess_target for one specific gene, list_candidates to " +
  "see the curated set. Keep replies to a few short paragraphs.";

const tools: Anthropic.Tool[] = [
  {
    name: "list_candidates",
    description: "List the curated arbovirus host-factor genes available to assess (from the Krogan Dengue/Zika interactome and CRISPR screens).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "prioritize_targets",
    description: "Return the ranked, independently-verified target dossiers for the whole curated set (fast; precomputed). Use for 'which targets should I prioritize / are most druggable' questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "assess_target",
    description: "Run the full live pipeline (specialist -> independent verifier -> synthesis) on ONE gene and return its auditable dossier. Use for a specific gene, including genes not in the curated set.",
    input_schema: {
      type: "object",
      properties: { gene: { type: "string", description: "Human gene symbol, e.g. STT3A, VCP, AXL." } },
      required: ["gene"],
    },
  },
];

// Gradio auto-REST 2-step call -> returns the first result element
async function gradio(apiName: string, data: unknown[]): Promise<unknown> {
  const post = await fetch(`${GRADIO}/gradio_api/call/${apiName}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!post.ok) throw new Error(`backend ${apiName} POST ${post.status}`);
  const { event_id } = await post.json();
  const text = await (await fetch(`${GRADIO}/gradio_api/call/${apiName}/${event_id}`)).text();
  let payload: unknown = null;
  for (const block of text.split("\n\n")) {
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (line) { try { payload = JSON.parse(line.slice(5).trim()); } catch { /* keep */ } }
  }
  return Array.isArray(payload) ? payload[0] : payload;
}

type Repurpose = { has_candidate: boolean; drug: string; approved_for: string; why_it_might_succeed: string };
type Dossier = Record<string, unknown> & {
  gene: string; recommendation: string; druggability_score: number; evidence_strength: number;
  confidence: number; verifier_stats: { proposed: number; corrected: number; unsupported: number };
  repurposing?: Repurpose | null;
};

// execute a tool; return { forClaude: compact string, dossiers: full for the UI }
async function execTool(name: string, input: Record<string, unknown>) {
  if (name === "list_candidates") {
    const list = (await gradio("list_candidates", [])) as Array<{ gene: string; role: string }>;
    return { forClaude: list.map((g) => `${g.gene}: ${g.role}`).join("\n"), dossiers: [] as Dossier[] };
  }
  if (name === "prioritize_targets") {
    const res = (await gradio("prioritize_targets", [])) as { dossiers: Dossier[] };
    const ds = res.dossiers || [];
    const compact = ds.slice(0, 10).map((d) =>
      `${d.gene}: ${d.recommendation}, druggability ${d.druggability_score.toFixed(2)}, evidence ${d.evidence_strength.toFixed(2)}, verifier caught ${d.verifier_stats.corrected + d.verifier_stats.unsupported}/${d.verifier_stats.proposed}${d.repurposing?.has_candidate ? `, repurposing candidate ${d.repurposing.drug}` : ""}`
    ).join("\n");
    return { forClaude: `Ranked targets (top 10):\n${compact}`, dossiers: ds };
  }
  if (name === "assess_target") {
    const gene = String(input.gene || "").toUpperCase();
    const d = (await gradio("assess_target", [gene])) as Dossier & {
      summary?: string; why_prior_failed?: string; verified_claims?: Array<{ field: string; verdict: string; asserted_value: string; rationale: string }>;
    };
    const claims = (d.verified_claims || []).map((c) => `- [${c.verdict}] ${c.field}: "${c.asserted_value}" — ${c.rationale}`).join("\n");
    const rp = d.repurposing?.has_candidate
      ? `\nRepurposing candidate: ${d.repurposing.drug} (currently for ${d.repurposing.approved_for}) — why it might succeed: ${d.repurposing.why_it_might_succeed}`
      : "";
    const forClaude =
      `${d.gene} — recommendation ${d.recommendation}, confidence ${d.confidence.toFixed(2)}, ` +
      `druggability ${d.druggability_score.toFixed(2)}, evidence ${d.evidence_strength.toFixed(2)}.\n` +
      `Summary: ${d.summary || ""}\nWhy prior trials failed: ${d.why_prior_failed || "n/a"}${rp}\n` +
      `Independently verified claims:\n${claims}`;
    return { forClaude, dossiers: [d] };
  }
  return { forClaude: `unknown tool ${name}`, dossiers: [] as Dossier[] };
}

export async function POST(req: Request) {
  const body = await req.json();
  const clientMessages: Anthropic.MessageParam[] = body.messages || [];
  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
      const messages: Anthropic.MessageParam[] = [...clientMessages];
      try {
        for (let turn = 0; turn < 6; turn++) {
          const s = client.messages.stream({
            model: MODEL, max_tokens: 1600, system: SYSTEM, tools, messages,
          });
          s.on("text", (t) => send({ type: "text", text: t }));
          const final = await s.finalMessage();
          messages.push({ role: "assistant", content: final.content });

          if (final.stop_reason === "refusal") {
            send({ type: "notice", text: "The model declined this request (safety classifier). Try rephrasing toward a specific gene or target list." });
            break;
          }
          const toolUses = final.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
          if (final.stop_reason !== "tool_use" || toolUses.length === 0) break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool_use", name: tu.name, input: tu.input });
            try {
              const out = await execTool(tu.name, (tu.input || {}) as Record<string, unknown>);
              send({ type: "tool_result", name: tu.name, dossiers: out.dossiers });
              results.push({ type: "tool_result", tool_use_id: tu.id, content: out.forClaude });
            } catch (e) {
              send({ type: "tool_result", name: tu.name, dossiers: [] });
              results.push({ type: "tool_result", tool_use_id: tu.id, content: `error: ${(e as Error).message}`, is_error: true });
            }
          }
          messages.push({ role: "user", content: results });
        }
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
