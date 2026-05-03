import * as cheerio from "cheerio";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const URL = "https://www.isrotel.co.il/deals/special-sale/main/";
const HOTEL_KEYWORDS = ["רויאל ביץ", "רויאל ביץ׳", "רויאל ביץ'", "Royal Beach"];
const TARGET_MONTH = "מאי";
const STATE_FILE = "state.json";

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

function loadState() {
  if (!existsSync(STATE_FILE)) return { seen: [] };
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); }
  catch { return { seen: [] }; }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) throw new Error(`Telegram error ${res.status}: ${await res.text()}`);
}

function hashDeal(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function findDeals(html) {
  const $ = cheerio.load(html);
  const deals = [];
  const seenBlocks = new Set();

  $("body *").each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 5) return;
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text.length < 20 || text.length > 600) return;
    if (!HOTEL_KEYWORDS.some(k => text.includes(k))) return;
    if (!text.includes(TARGET_MONTH)) return;
    if (seenBlocks.has(text)) return;
    seenBlocks.add(text);
    deals.push(text);
  });

  return deals;
}

(async () => {
  const res = await fetch(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "he,en;q=0.9",
    },
  });
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status}`);
    process.exit(1);
  }
  const html = await res.text();
  const deals = findDeals(html);

  console.log(`Found ${deals.length} matching deals`);

  const state = loadState();
  const seen = new Set(state.seen);
  const newDeals = [];

  for (const d of deals) {
    const h = hashDeal(d);
    if (!seen.has(h)) {
      newDeals.push({ hash: h, text: d });
      seen.add(h);
    }
  }

  if (newDeals.length === 0) {
    console.log("No new deals");
    return;
  }

  for (const d of newDeals) {
    const msg = `🏨 <b>דיל חדש ברויאל ביץ' אילת (מאי)</b>\n\n${d.text}\n\n<a href="${URL}">לעמוד הדילים</a>`;
    await sendTelegram(msg);
    console.log(`Notified: ${d.hash}`);
  }

  state.seen = Array.from(seen).slice(-500);
  saveState(state);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
