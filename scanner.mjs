const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT = process.env.TG_CHAT;

const CHANNELS = [
  "abbacryptoguide",
];

const ROLE = /\b(ambassadors?|moderators?|community managers?|mod team|kols?)\b/i;
const SKIP = new Set(["intent", "share", "home", "i", "search", "hashtag", "explore", "x"]);

const strip = (h) =>
  h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
   .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

function roleOf(text) {
  const m = text.match(ROLE);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (w.startsWith("ambassador")) return "Ambassador";
  if (w.startsWith("moderator") || w === "mod team") return "Moderator";
  if (w.startsWith("community")) return "Community Manager";
  return "Other";
}

function handleOf(rawHtml) {
  const re = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/gi;
  let m;
  while ((m = re.exec(rawHtml))) {
    if (!SKIP.has(m[1].toLowerCase())) return m[1];
  }
  return "";
}

async function scanChannel(name) {
  const res = await fetch(`https://t.me/s/${name}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) { console.log(`skip ${name}: HTTP ${res.status}`); return []; }
  const html = await res.text();
  const out = [];
  for (const chunk of html.split("tgme_widget_message_wrap").slice(1)) {
    const post = (chunk.match(/data-post="([^"]+)"/) || [])[1];
    const when = (chunk.match(/datetime="([^"]+)"/) || [])[1];
    const body = (chunk.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    if (!post || !when || !body) continue;
    const text = strip(body);
    const role = roleOf(text);
    if (!role) continue;
    const t = new Date(when).getTime();
    if (Date.now() - t > 24 * 3600 * 1000) continue;
    const handle = handleOf(body);
    out.push({
      project: handle || name,
      handle,
      role,
      source: "telegram:" + name,
      source_url: `https://t.me/${post}`,
      posted_at: new Date(t).toISOString(),
    });
  }
  return out;
}

async function save(rows) {
  if (!rows.length) return console.log("nothing new");
  const res = await fetch(`${SB}/rest/v1/listings?on_conflict=source_url`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) return console.log(`save failed: ${res.status} ${await res.text()}`);
  const fresh = await res.json();
  console.log(`new: ${fresh.length}`);
  for (const r of fresh) await alert(r);
}

async function alert(r) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const text =
    `New ${r.role} call: ${r.project}\n` +
    (r.handle ? `X: https://x.com/${r.handle}\n` : "") +
    `Posted: ${r.posted_at}\n${r.source_url}`;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text }),
  });
}

const all = [];
for (const c of CHANNELS) {
  try { all.push(...(await scanChannel(c))); } catch (e) { console.log(`error ${c}: ${e.message}`); }
}
await save(all);
