import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 1) Your taste profile (plain text/JSON the model can read)
const TASTE = {
  i_like: [
    "real estate operations",
    "WhatsApp automation/bots",
    "LatAm real estate pricing & showings",
    "low-cost infrastructure"
  ],
  i_dislike: ["generic motivation", "vague inspiration", "off-topic jokes"],
  strong_signals: ["price drop", "showing", "integration", "API", "demo", "contract", "compliance"],
  how_to_decide: "Prefer messages that are recent, specific, and actionable. If two are similar, pick the clearer one."
};

// 2) Example messages you want curated (replace with your real data)
const MESSAGES = [
  { id: "m1", text: "Price drop: 2BR in El Poblado now $230k. Open house Sat 3pm.", ts: "2025-09-12T18:30:00Z", author: "Luis" },
  { id: "m2", text: "Motivation thread: hustle harder!", ts: "2025-09-12T08:00:00Z", author: "Random" },
  { id: "m3", text: "New integration: Baileys + Google Sheets demo Tuesday. API notes inside.", ts: "2025-09-10T16:00:00Z", author: "Ana" },
  { id: "m4", text: "Anyone can show the unit at 5pm today? Need keys from office.", ts: "2025-09-12T14:10:00Z", author: "Maria" }
];

// 3) Ask the model to pick the best N and explain why (JSON output)
async function curate(messages, taste, topK = 3) {
  // Keep messages short so the prompt stays small
  const trimmed = messages.map(m => ({
    id: m.id,
    ts: m.ts,
    author: m.author,
    text: (m.text || "").slice(0, 500)
  }));

  const system = `
You rank short messages for a user. Read the user's taste and the messages.
Decide which ${topK} are most relevant. Be strict: avoid generic or off-topic items.
Prefer recent, specific, actionable content.
Return JSON ONLY with: { items: [{id, include, relevance, category, reason}] }.
- relevance: number 0..1
- category: short label (e.g., "pricing", "showing", "integration", "other")
- include: true for exactly the top ${topK}, false for the rest
`;

  const user = `TASTE:\n${JSON.stringify(taste, null, 2)}\n\nMESSAGES:\n` +
    trimmed.map(m => `- id:${m.id} | ts:${m.ts} | author:${m.author} | text:${m.text}`).join("\n");

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    response_format: { type: "json_object" } // ask for strict JSON
  });

  const json = JSON.parse(resp.choices[0].message.content);
  return json.items;
}

(async () => {
  const curated = await curate(MESSAGES, TASTE, 3);
  console.log("Curated list:");
  for (const it of curated.filter(x => x.include)) {
    const m = MESSAGES.find(mm => mm.id === it.id);
    console.log(`- ${m?.text}  [${it.category}]  relevance=${it.relevance.toFixed(2)}  → ${it.reason}`);
  }
})();