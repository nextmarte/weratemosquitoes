// Server-side proxy to the Gradio backend's auto-generated REST endpoint.
// Runs server-side so there is no CORS and the backend URL stays off the client.
import { NextResponse } from "next/server";

const GRADIO = process.env.GRADIO_URL || "http://localhost:7860";

export async function POST(req: Request) {
  let gene = "";
  try {
    gene = (await req.json()).gene?.toString().trim().toUpperCase() || "";
  } catch {
    /* ignore */
  }
  if (!gene) return NextResponse.json({ error: "gene required" }, { status: 400 });

  try {
    // Gradio 2-step call: POST -> event_id, then GET SSE -> result
    const post = await fetch(`${GRADIO}/gradio_api/call/assess_target`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [gene] }),
    });
    if (!post.ok) throw new Error(`backend POST ${post.status}`);
    const { event_id } = await post.json();

    const stream = await fetch(`${GRADIO}/gradio_api/call/assess_target/${event_id}`);
    const text = await stream.text();

    // parse the last `data:` payload (the completed event)
    let payload: unknown = null;
    for (const block of text.split("\n\n")) {
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        try {
          payload = JSON.parse(dataLine.slice(5).trim());
        } catch {
          /* keep previous */
        }
      }
    }
    const dossier = Array.isArray(payload) ? payload[0] : payload;
    if (!dossier) throw new Error("no dossier returned");
    return NextResponse.json({ dossier });
  } catch (e) {
    return NextResponse.json(
      { error: `live assessment unavailable (${(e as Error).message}). Is the Gradio backend running?` },
      { status: 502 },
    );
  }
}
