import * as cheerio from "cheerio";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const URL = "https://www.isrotel.co.il/deals/special-sale/main/";
const HOTEL_CODE = "RB";
const HOTEL_LABEL = "רויאל ביץ' אילת";
const TARGET_MONTH = 5;
const TARGET_YEAR = 2026;
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

function hashStr(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function dateRangeOverlapsTarget(startStr, endStr) {
  if (!startStr) return false;
  const start = new Date(startStr);
  const end = endStr ? new Date(endStr) : start;
  const monthStart = new Date(Date.UTC(TARGET_YEAR, TARGET_MONTH - 1, 1));
  const monthEnd = new Date(Date.UTC(TARGET_YEAR, TARGET_MONTH, 0, 23, 59, 59));
  return start <= monthEnd && end >= monthStart;
}

function findDeals(html) {
  const $ = cheerio.load(html);
  const deals = [];

  $(`article.card--deal[data-hotel="${HOTEL_CODE}"]`).each((_, el) => {
    const $el = $(el);
    const saleId = $el.attr("data-saleid") || "";
    const title = $el.find(".card__title").text().replace(/\s+/g, " ").trim();
    const description = $el.find(".card__description").text().replace(/\s+/g, " ").trim();
    const price = $el.find(".ux-ui-price").first().text().trim();
    const priceNote = $el.find(".card__price-info-note").text().replace(/\s+/g, " ").trim();

    let startDate = null, endDate = null;
    const scriptText = $el.next("script.sale-script").text() || $el.find("script.sale-script").text();
    const startMatch = scriptText.match(/"SaleStartDateStr":"(\d{4}-\d{2}-\d{2})"/);
    const endMatch = scriptText.match(/"SaleEndDateStr":"(\d{4}-\d{2}-\d{2})"/);
    if (startMatch) startDate = startMatch[1];
    if (endMatch) endDate = endMatch[1];

    const matchesMonth = dateRangeOverlapsTarget(startDate, endDate)
      || /\b\d{1,2}([-/]\d{1,2})?\/0?5\/\d{2,4}/.test(description);

    if (!matchesMonth) return;

    deals.push({ saleId, title, description, price, priceNote, startDate, endDate });
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

  console.log(`Found ${deals.length} matching ${HOTEL_LABEL} deals for ${TARGET_MONTH}/${TARGET_YEAR}`);

  const state = loadState();
  const seen = new Set(state.seen);
  const newDeals = [];

  for (const d of deals) {
    const key = hashStr(`${d.saleId}|${d.title}|${d.description}|${d.price}`);
    if (!seen.has(key)) {
      newDeals.push({ key, deal: d });
      seen.add(key);
    }
  }

  if (newDeals.length === 0) {
    console.log("No new deals");
    return;
  }

  for (const { key, deal } of newDeals) {
    const lines = [
      `🏨 <b>דיל חדש - ${HOTEL_LABEL}</b>`,
      "",
      `<b>${deal.title}</b>`,
      deal.description,
      "",
      deal.price ? `💰 ${deal.price} ₪ ${deal.priceNote}` : "",
      deal.startDate ? `📅 ${deal.startDate} → ${deal.endDate || ""}` : "",
      "",
      `<a href="${URL}">לעמוד הדילים</a>`,
    ].filter(Boolean);
    await sendTelegram(lines.join("\n"));
    console.log(`Notified: ${key}`);
  }

  state.seen = Array.from(seen).slice(-500);
  saveState(state);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
