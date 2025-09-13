// rank.js
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- 1) Inputs ----
const MESSAGES = [
  { id: "m1", text: "Price drop: 2BR in El Poblado now $230k. Open house Sat 3pm.", ts: "2025-09-12T18:30:00Z", author: "Luis" },
  { id: "m2", text: "Motivation thread: hustle harder!", ts: "2025-09-12T08:00:00Z", author: "Random" },
  { id: "m3", text: "New integration: Baileys + Sheets demo Tuesday (API notes inside).", ts: "2025-09-10T16:00:00Z", author: "Ana" }
];

const TASTE = {
  interests: [
    "real estate operations automation",
    "WhatsApp bots and integrations",
    "LatAm real estate pricing and showings",
    "low-cost infrastructure"
  ],
  avoid: ["generic motivation", "vague inspiration"],
  signalKeywords: ["price drop","showing","integration","API","demo","contract","compliance"]
};

// ---- 2) Helpers ----
function cosine(a, b) {
  const na = norm(a), nb = norm(b);
  let dot = 0; for (let i=0;i<a.length;i++) dot += (a[i]/na) * (b[i]/nb);
  return dot;
}
function norm(v){ return Math.sqrt(v.reduce((s,x)=>s+x*x,0)) || 1; }

async function embedAll(texts) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",      // cheap & good
    input: texts
  });
  return res.data.map(d => d.embedding);
}

// ---- 3) Build a taste vector once ----
async function getTasteVector(profile) {
  const joined = [
    profile.interests.join("; "),
    // (optionally) examples of messages you loved could be appended here
  ].join("\n");
  return (await embedAll([joined]))[0];
}

// ---- 4) Cheap pre-score (similarity × freshness × keyword bonus) ----
function freshnessBoost(tsIso, halfLifeDays=7) {
  const now = Date.now(); const ts = new Date(tsIso).getTime();
  const days = Math.max(0, (now - ts)/(1000*60*60*24));
  return Math.exp(-Math.log(2) * days/halfLifeDays);
}
function keywordBonus(text, kws) {
  const t = text.toLowerCase();
  const hits = kws.reduce((n,k)=> n + (t.includes(k.toLowerCase())?1:0), 0);
  return 1 + Math.min(hits, 3)*0.1; // up to +30%
}

async function preScore(messages, tasteVec) {
  const embs = await embedAll(messages.map(m => m.text));
  return messages.map((m, i) => {
    const sim = cosine(embs[i], tasteVec);
    const kw = keywordBonus(m.text, TASTE.signalKeywords);
    const fr = freshnessBoost(m.ts);
    const score = (0.65*sim + 0.35*fr) * kw;
    return { ...m, score };
  }).sort((a,b)=>b.score-a.score);
}

// ---- 5) LLM re-rank top-N and return curated list ----
async function rerankWithLLM(seedItems, topK=5) {
  const system = `You re-rank items for a user.
User tastes: real-estate ops, WhatsApp automation, low-cost infra, LatAm pricing.
Avoid generic motivation. Prefer fresh, actionable, specific items (price changes, showings, integrations, API notes).
Return strict JSON with: items:[{id, include, relevance:0-1, category, reason}]. Include exactly top ${topK}.`;

  const user = "Items:\n" + seedItems
    .map(m => `- id:${m.id} | ts:${m.ts} | text:${m.text}`)
    .join("\n");

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    // ask the model to return valid JSON:
    response_format: { type: "json_object" }  // JSON mode in the API
  });

  const json = JSON.parse(resp.choices[0].message.content);
  return json.items;
}

// ---- 6) Glue it together ----
(async () => {
  const tasteVec = await getTasteVector(TASTE);
  const prescored = await preScore(MESSAGES, tasteVec);

  // send only the best 20 (or fewer) to the LLM
  const seed = prescored.slice(0, 20);
  const curated = await rerankWithLLM(seed, 5);

  console.log("Curated list:");
  for (const it of curated) {
    const m = MESSAGES.find(x=>x.id===it.id);
    console.log(`- ${m?.text}  [${it.category}] — ${it.reason}`);
  }
})();