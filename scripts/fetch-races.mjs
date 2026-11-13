// =============================================================
// 賽事行事曆更新程式
// 由 GitHub Actions 每週一執行：抓三個公開賽事網站 → 整理 → 去除重複 → 寫入 data/races.json
//
// 規則：
//   1. 每次執行前先讀 robots.txt，不允許的網站或路徑直接跳過
//   2. 每個網站只抓一頁列表，間隔 3 秒，使用可辨識的 User-Agent
//   3. 只存「事實資訊」（名稱、日期、地點、距離、報名狀態）與原網站連結，不轉載圖片與內文
//   4. 某個來源這次抓不到時，沿用上一次的資料，避免網站改版時整批消失
// =============================================================
import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UA = "FitnessRecordRaceBot/1.0 (+https://github.com/daniellllin/Fitness-Record)";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "races.json");

export const SOURCES = [
  { key: "ctrun",     name: "全統運動報名網",   url: "https://www.ctrun.com.tw/" },
  { key: "sportsnet", name: "中華民國路跑協會", url: "https://www.sportsnet.org.tw/schedule.php" },
  { key: "biji",      name: "運動筆記",         url: "https://running.biji.co/?q=competition" },
];
// 同一場比賽出現在多個來源時，名稱與報名狀態以排前面的為準（報名平台的資訊最直接）
const PRIORITY = ["ctrun", "sportsnet", "biji"];

/* ---------------- 地區 ---------------- */
const CITY_REGION = {
  "臺北市":"北部","新北市":"北部","基隆市":"北部","桃園市":"北部","新竹市":"北部","新竹縣":"北部","宜蘭縣":"北部",
  "苗栗縣":"中部","臺中市":"中部","彰化縣":"中部","南投縣":"中部","雲林縣":"中部",
  "嘉義市":"南部","嘉義縣":"南部","臺南市":"南部","高雄市":"南部","屏東縣":"南部",
  "花蓮縣":"東部","臺東縣":"東部","澎湖縣":"離島","金門縣":"離島","連江縣":"離島"
};
const CITY_SHORT = [ // 沒寫「市／縣」時的簡稱
  ["臺北","臺北市"],["新北","新北市"],["基隆","基隆市"],["桃園","桃園市"],["新竹","新竹市"],["宜蘭","宜蘭縣"],
  ["苗栗","苗栗縣"],["臺中","臺中市"],["彰化","彰化縣"],["南投","南投縣"],["雲林","雲林縣"],["嘉義","嘉義市"],
  ["臺南","臺南市"],["高雄","高雄市"],["屏東","屏東縣"],["花蓮","花蓮縣"],["臺東","臺東縣"],["澎湖","澎湖縣"],
  ["金門","金門縣"],["馬祖","連江縣"],["連江","連江縣"]
];
const LANDMARK = [ // 常見會場 → 縣市
  [/總統府|凱達格蘭|大佳河濱|臺北市政府|臺北101|陽明山|南港|大稻埕|美堤|臺北體育園區|信義區|內湖/,"臺北市"],
  [/大都會公園|微風運河|板橋|三重|蘆洲|淡水|八里|新店|林口|汐止|五股/,"新北市"],
  [/衛武營|夢時代|蓮池潭|鳳山|橋頭|岡山區|旗津|大樹區/,"高雄市"],
  [/日月潭|溪頭|埔里|清境/,"南投縣"],
  [/鹿耳門|安平|七股|觀夕平台|柳營|尖山埤/,"臺南市"],
  [/中央球場|水湳|大甲|后里|清水/,"臺中市"],
  [/龍岡|石門水庫|大溪/,"桃園市"],
  [/冬山河|羅東|礁溪/,"宜蘭縣"],
  [/太魯閣|七星潭/,"花蓮縣"],
  [/活水湖|池上|鹿野/,"臺東縣"]
];
export function findCity(text) {
  const t = String(text || "").replace(/台/g, "臺");
  for (const c of Object.keys(CITY_REGION)) if (t.includes(c)) return c;
  for (const [s, c] of CITY_SHORT) if (t.includes(s)) return c;
  for (const [re, c] of LANDMARK) if (re.test(t)) return c;
  const m = t.match(/([一-龥]{1,3}[縣市])/);            // 海外，例如 福岡市、千葉縣
  return m ? m[1] : "";
}
export function regionOf(city) { return city ? (CITY_REGION[city] || "海外") : ""; }

/* ---------------- 欄位解析 ---------------- */
export const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// 只有月日時推年份：今年的日期已過 30 天以上就當作明年
export function inferYear(m, d, today) {
  const t = new Date(today + "T00:00:00Z");
  let y = t.getUTCFullYear();
  const cand = new Date(Date.UTC(y, m - 1, d));
  if (cand < new Date(t.getTime() - 30 * 864e5)) y += 1;
  return y;
}
export function parseDate(text, today) {
  const s = String(text || "");
  let m = s.match(/(20\d{2})\s*[.\/\-年]\s*(\d{1,2})\s*[.\/\-月]\s*(\d{1,2})/);
  if (m && validDate(+m[1], +m[2], +m[3])) return m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);
  m = s.match(/(?<!\d)(\d{1,2})\s*[-\/]\s*(\d{1,2})(?:\s*[~～\-]\s*\d{1,2})?\s*[（(]\s*(?:週|星期)?\s*[日一二三四五六]/);
  if (m && validDate(2000, +m[1], +m[2])) {
    const y = inferYear(+m[1], +m[2], today);
    return y + "-" + pad(m[1]) + "-" + pad(m[2]);
  }
  return "";
}
export function parseDist(text) {
  const out = new Map();
  const re = /(\d+(?:\.\d+)?)\s*(?:km|k|公里)(?![a-z])/gi;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const v = parseFloat(m[1]);
    if (v > 0 && v <= 500) out.set(String(v), v);
  }
  const s = String(text || "");
  if (/全馬/.test(s)) out.set("42.195", 42.195);
  if (/半馬/.test(s)) out.set("21.0975", 21.0975);
  return [...out.values()].sort((a, b) => b - a).map(v => v + "K");
}
export function parseStatus(text) {
  const s = String(text || "");
  if (/已額滿|名額已滿|額滿/.test(s)) return "full";
  if (/已截止|報名截止|截止報名|停止報名/.test(s)) return "closed";
  if (/報名時間未定|尚未開放|即將開放|未開放/.test(s)) return "tbd";
  if (/早鳥|我要報名|報名中|開放報名|立即報名|熱烈報名/.test(s)) return "open";
  return "";
}
function parseDeadline(text, today) {
  const s = String(text || "");
  const m = s.match(/(?:截止|報名至|報名到)\s*[:：]?\s*(?:(20\d{2})[.\/\-])?(\d{1,2})[.\/\-](\d{1,2})/) ||
            s.match(/(?:(20\d{2})[.\/\-])?(\d{1,2})[.\/\-](\d{1,2})\s*(?:截止)/);
  if (!m || !validDate(2000, +m[2], +m[3])) return "";
  const y = m[1] ? +m[1] : inferYear(+m[2], +m[3], today);
  return y + "-" + pad(m[2]) + "-" + pad(m[3]);
}
export function inferType(name) {
  const s = String(name || "");
  if (/hyrox/i.test(s)) return "健身・HYROX";
  if (/三鐵|鐵人三項|triathlon/i.test(s)) return "鐵人三項";
  if (/二鐵|鐵人兩項|鐵人二項|duathlon|跑騎跑/i.test(s)) return "鐵人兩項";
  if (/越野|trail|山徑|sky\s*(?:run|hunter|race)|登山賽/i.test(s)) return "越野跑";
  if (/單車|自行車|腳踏車|bike|cycling|gran\s*fondo|騎/i.test(s)) return "自行車";
  if (/泳渡|游泳|swim|公開水域/i.test(s)) return "游泳";
  if (/馬拉松|路跑|run|跑|半馬|全馬|接力|健走|marathon/i.test(s)) return "路跑";
  return "其他";
}

/* 取出元素的文字，區塊元素之間保留換行 */
const BLOCK = new Set(["div","p","li","tr","td","th","h1","h2","h3","h4","h5","h6","br","section","article","ul","ol","table","dd","dt","header","footer"]);
function blockText($, node) {
  let out = "";
  const walk = n => {
    if (n.type === "text") { out += n.data; return; }
    if (n.type !== "tag") return;
    const tag = n.name.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") return;
    if (tag === "img" && n.attribs && n.attribs.alt) out += " " + n.attribs.alt + " ";
    (n.children || []).forEach(walk);
    if (BLOCK.has(tag)) out += "\n";
  };
  walk(node);
  return out.split("\n").map(norm).filter(Boolean).join("\n");
}

/* 以「詳細頁連結」為錨點找出每一場比賽的區塊：往上找到只包含這一場的最大容器
   不依賴網站的 CSS class，網站小改版也比較不會壞 */
function cardsByLink($, linkSel, idOf) {
  const groups = new Map();
  $(linkSel).each((_, a) => {
    const id = idOf($(a).attr("href") || ""); if (!id) return;
    let node = $(a);
    for (;;) {
      const p = node.parent();
      if (!p.length || p.is("body") || p.is("html")) break;
      const ids = new Set();
      p.find(linkSel).each((_, x) => { const i = idOf($(x).attr("href") || ""); if (i) ids.add(i); });
      if (ids.size > 1) break;
      node = p;
    }
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ card: node, a: $(a) });
  });
  return groups;
}
const JUNK = /^(加入行事曆|填寫參賽紀錄|我要報名|立即報名|早鳥報名|報名|詳情|詳細資訊|more|更多|活動照片|成績查詢|報名截止|已額滿|活動簡章|線上報名|查看|ad|熱門)$/i;
function bestName($, items) {
  const cands = [];
  items.forEach(({ a }) => {
    const t = norm(a.text()) || norm(a.find("img").attr("alt")) || norm(a.attr("title"));
    if (t && !JUNK.test(t) && t.length >= 4) cands.push(t);
  });
  cands.sort((x, y) => y.length - x.length);
  return cands[0] || "";
}

/* ---------------- 運動筆記 ---------------- */
export function parseBiji(html, today, base = "https://running.biji.co/") {
  const $ = cheerio.load(html);
  const idOf = h => { const m = h.match(/act=info[^"']*?cid=(\d+)|cid=(\d+)[^"']*?act=info/); return m ? (m[1] || m[2]) : ""; };
  // 依文件順序記錄日期標題（例如「11-07 (週六)」），卡片沒寫日期時往前找最近的標題
  const order = new Map(); const headers = [];
  let i = 0;
  $("body *").each((_, el) => {
    order.set(el, i++);
    const own = norm($(el).contents().filter((_, c) => c.type === "text").text());
    const m = own.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s*[（(]\s*(?:週|星期)/);
    if (m) headers.push({ idx: order.get(el), m: +m[1], d: +m[2] });
  });
  const out = [];
  cardsByLink($, 'a[href*="cid="]', idOf).forEach((items, cid) => {
    const card = items.reduce((a, b) => (blockText($, b.card[0]).length > blockText($, a.card[0]).length ? b : a)).card;
    const text = blockText($, card[0]);
    const name = bestName($, items) || text.split("\n").find(l => l.length >= 4 && !JUNK.test(l) && !/^\d/.test(l)) || "";
    let date = parseDate(text, today);
    if (!date) {
      const idx = order.get(card[0]);
      let h = null; for (const x of headers) { if (x.idx <= idx) h = x; else break; }
      if (h && validDate(2000, h.m, h.d)) date = inferYear(h.m, h.d, today) + "-" + pad(h.m) + "-" + pad(h.d);
    }
    if (!name || !date) return;
    const city = findCity(text.replace(name, "")) || findCity(name);
    const status = parseStatus(text);
    out.push({
      src: "biji", sid: cid, name, date, city, place: "",
      dist: parseDist(text), status, deadline: status === "open" || !status ? parseDeadline(text, today) : "",
      url: new URL(`index.php?q=competition&act=info&cid=${cid}`, base).href
    });
  });
  return out;
}

/* ---------------- 全統運動報名網 ---------------- */
export function parseCtrun(html, today, base = "https://www.ctrun.com.tw/") {
  const $ = cheerio.load(html);
  const idOf = h => { const m = h.match(/EventMain_ID=(\d+)/i); return m ? m[1] : ""; };
  const out = [];
  cardsByLink($, 'a[href*="EventMain_ID="], a[href*="eventmain_id="]', idOf).forEach((items, id) => {
    // 同一場會出現在卡片與表格兩處：各自解析後取資訊最多的那份
    let best = null;
    const seen = new Set();
    items.forEach(({ card }) => {
      if (seen.has(card[0])) return; seen.add(card[0]);
      const text = blockText($, card[0]);
      const date = parseDate(text, today);
      const lines = text.split("\n");
      const place = lines.find(l => /(市|縣|區|鄉|鎮|公園|廣場|中心|球場|大道|園區|停車場|渡假村|河濱|水庫|森林)/.test(l)
        && !/\d{4}-\d{2}-\d{2}/.test(l) && l.length <= 40 && !/報名/.test(l)) || "";
      const r = { text, date, place, dist: parseDist(text), status: parseStatus(text) };
      const score = (r.date ? 4 : 0) + (r.place ? 2 : 0) + r.dist.length + (r.status ? 1 : 0);
      if (!best || score > best.score) best = Object.assign(r, { score });
    });
    const name = bestName($, items);
    if (!best || !name || !best.date) return;
    out.push({
      src: "ctrun", sid: id, name, date: best.date, city: findCity(best.place) || findCity(name) || findCity(best.text.replace(name, "")),
      place: best.place, dist: best.dist, status: best.status, deadline: "",
      url: new URL(`Activity?EventMain_ID=${id}`, base).href
    });
  });
  return out;
}

/* ---------------- 中華民國路跑協會（行事曆表格） ---------------- */
export function parseSportsnet(html, today, base = "https://www.sportsnet.org.tw/schedule.php") {
  const $ = cheerio.load(html);
  const out = [];
  $("table").each((_, t) => {
    let map = null;
    $(t).find("tr").each((_, tr) => {
      const cells = $(tr).children("th,td");
      const texts = cells.map((_, c) => norm($(c).text())).get();
      if (!map) {
        const di = texts.findIndex(x => /^日\s*期$/.test(x)), ni = texts.findIndex(x => /名\s*稱/.test(x));
        if (di >= 0 && ni >= 0) map = { date: di, name: ni,
          place: texts.findIndex(x => /地\s*點/.test(x)), items: texts.findIndex(x => /項\s*目/.test(x)) };
        return;
      }
      // 有些列會少一格（例如沒有晶片圖示），從右邊對齊欄位
      const shift = texts.length < Math.max(map.date, map.name, map.place, map.items) + 1
        ? Math.max(map.date, map.name, map.place, map.items) + 1 - texts.length : 0;
      const col = k => (map[k] >= 0 ? cells.eq(map[k] - shift) : null);
      const dateTxt = col("date") ? norm(col("date").text()) : "";
      const md = dateTxt.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
      if (!md || !validDate(2000, +md[1], +md[2])) return;
      const nameCell = col("name"); if (!nameCell) return;
      const name = norm(nameCell.text()); if (!name || name.length < 4) return;
      const href = nameCell.find("a").first().attr("href") || "";
      const y = inferYear(+md[1], +md[2], today);
      const place = col("place") ? norm(col("place").text()) : "";
      const items = col("items") ? norm(col("items").text()) : "";
      let url = "";
      try { url = href ? new URL(href, base).href : ""; } catch (e) {}
      out.push({
        src: "sportsnet", sid: y + pad(md[1]) + pad(md[2]) + "-" + name.slice(0, 12), name,
        date: y + "-" + pad(md[1]) + "-" + pad(md[2]), city: findCity(place + " " + name), place,
        dist: parseDist(items), status: "", deadline: "", url: url || base
      });
    });
  });
  return out;
}

/* ---------------- 去除重複 ---------------- */
export function normName(s) {
  return String(s || "").normalize("NFKC").toLowerCase()
    .replace(/台/g, "臺")
    .replace(/20\d{2}|\d{3}年度?|第[\d一二三四五六七八九十百]+屆|年度/g, "")
    .replace(/[\s\-_.,:;!?'"()（）《》〈〉「」『』【】\[\]・·\/|&+×~～—–]/g, "");
}
function bigrams(s) { const b = new Set(); for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2)); return b; }
export function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return a === b ? 1 : 0;
  let n = 0; A.forEach(x => { if (B.has(x)) n++; });
  return 2 * n / (A.size + B.size);
}
export function sameRace(a, b) {
  if (a.date !== b.date) return false;
  const x = normName(a.name), y = normName(b.name);
  if (!x || !y) return false;
  const bothCity = a.city && b.city;
  if (x === y) return true;
  if ((x.includes(y) || y.includes(x)) && Math.min(x.length, y.length) >= 4) return !bothCity || a.city === b.city;
  const d = dice(x, y);
  if (d >= 0.7) return !bothCity || a.city === b.city;
  if (d >= 0.45 && bothCity && a.city === b.city) return true;
  return false;
}
function hashId(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export function mergeRaces(list, prevById = {}, runDate) {
  const clusters = [];
  const rank = r => PRIORITY.indexOf(r.src);
  list.slice().sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b)).forEach(r => {
    const c = clusters.find(c => c.date === r.date && c.items.some(x => sameRace(x, r)));
    if (c) c.items.push(r); else clusters.push({ date: r.date, items: [r] });
  });
  return clusters.map(c => {
    const items = c.items.slice().sort((a, b) => rank(a) - rank(b));
    const head = items[0];
    const pick = k => (items.find(x => x[k] && (!Array.isArray(x[k]) || x[k].length)) || {})[k] || "";
    const dist = [...new Set(items.flatMap(x => x.dist))].sort((a, b) => parseFloat(b) - parseFloat(a));
    const city = pick("city");
    const id = "r" + hashId(c.date + "|" + normName(head.name));
    const prev = prevById[id];
    const sources = [];
    items.forEach(x => { if (!sources.some(s => s.key === x.src)) sources.push({ key: x.src, url: x.url, name: x.name }); });
    return {
      id, name: head.name, date: c.date, city, region: regionOf(city), place: pick("place"),
      dist, type: inferType(items.map(x => x.name).join(" ")),
      status: pick("status"), deadline: pick("deadline"),
      sources, firstSeen: prev ? prev.firstSeen : runDate
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/* ---------------- robots.txt ---------------- */
export function parseRobots(txt, agent = "fitnessrecordracebot") {
  const groups = []; let cur = null, lastWasUA = false;
  String(txt || "").split(/\r?\n/).forEach(line => {
    const l = line.replace(/#.*/, "").trim(); if (!l) return;
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) return;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || !lastWasUA) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasUA = true;
    } else {
      lastWasUA = false;
      if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v });
    }
  });
  const g = groups.find(g => g.agents.some(a => a !== "*" && agent.includes(a))) || groups.find(g => g.agents.includes("*"));
  return g ? g.rules : [];
}
export function robotsAllows(rules, pathAndQuery) {
  let best = null;
  rules.forEach(r => {
    if (!r.path) return;                                      // 「Disallow:」空白 = 全部允許
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(pathAndQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)))
      best = r;
  });
  return !best || best.allow;
}

/* ---------------- 抓取 ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9" }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const head = buf.subarray(0, 4096).toString("latin1");
  const cs = ((r.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  return new TextDecoder(/big5/i.test(cs) ? "big5" : "utf-8").decode(buf);
}
async function robotsOk(url) {
  const u = new URL(url);
  let res;
  try {
    res = await fetch(u.origin + "/robots.txt", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  } catch (e) { return { ok: false, why: "robots.txt 無法連線" }; }
  if (res.status >= 500) return { ok: false, why: "robots.txt 回應 " + res.status };
  if (!res.ok) return { ok: true };                           // 404 等：視為沒有限制
  const rules = parseRobots(await res.text());
  return robotsAllows(rules, u.pathname + u.search) ? { ok: true } : { ok: false, why: "robots.txt 不允許" };
}

export async function main() {
  const now = new Date();
  const today = new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);   // 台北日期
  let prev = { races: [], meta: { sources: {} } };
  try { prev = JSON.parse(await fs.readFile(OUT, "utf8")); } catch (e) {}
  const prevById = Object.fromEntries((prev.races || []).map(r => [r.id, r]));

  const all = [], meta = {};
  for (const s of SOURCES) {
    const m = meta[s.key] = { name: s.name, url: s.url, ok: false, count: 0 };
    try {
      const rb = await robotsOk(s.url);
      if (!rb.ok) throw new Error(rb.why);
      const html = await fetchText(s.url);
      const parse = { biji: parseBiji, ctrun: parseCtrun, sportsnet: parseSportsnet }[s.key];
      const rows = parse(html, today).filter(r => r.date >= today);
      m.count = rows.length; m.ok = rows.length > 0;
      m.sample = rows.slice(0, 2).map(r => ({ name: r.name, date: r.date, city: r.city, dist: r.dist, status: r.status }));
      if (!rows.length) throw new Error("頁面讀到了，但沒有解析出任何賽事（網站可能改版）");
      all.push(...rows);
    } catch (e) {
      m.error = String(e.message || e);
      // 沿用上次這個來源的資料，避免網站暫時故障就整批消失
      const keep = (prev.races || []).filter(r => r.date >= today && (r.sources || []).some(x => x.key === s.key));
      if (keep.length) {
        m.stale = true; m.count = keep.length;
        keep.forEach(r => r.sources.filter(x => x.key === s.key).forEach(x =>
          all.push({ src: s.key, sid: x.url, name: x.name || r.name, date: r.date, city: r.city, place: r.place,
                     dist: r.dist, status: r.status, deadline: r.deadline, url: x.url })));
      }
      console.warn(`[${s.key}] ${m.error}${m.stale ? "（沿用上次 " + keep.length + " 筆）" : ""}`);
    }
    await sleep(3000);
  }
  const until = new Date(Date.parse(today) + 400 * 864e5).toISOString().slice(0, 10);
  const races = mergeRaces(all.filter(r => r.date >= today && r.date <= until), prevById, today);
  const out = {
    updated: now.toISOString(),
    note: "資料整理自公開賽事行事曆網站，以主辦單位公告為準。",
    meta: { sources: meta, total: races.length, newCount: races.filter(r => r.firstSeen === today).length,
            merged: all.length - races.length },
    races
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(`完成：${races.length} 場（原始 ${all.length} 筆，合併重複 ${all.length - races.length} 筆，新增 ${out.meta.newCount} 場）`);
  Object.entries(meta).forEach(([k, m]) => console.log(`  ${m.name}：${m.ok ? "✓" : "✗"} ${m.count} 筆${m.error ? "，" + m.error : ""}`));
  if (!Object.values(meta).some(m => m.ok || m.stale)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
