// PR 自動檢查：依 REVIEW_RULES.md 的紅線檢查這次的改動，有一項不通過就讓 PR 檢查失敗
// 用法：BASE=origin/main node scripts/review-check.mjs   （ALLOW_PROD=1 時允許改正式版與 demo）
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "origin/main";
const sh = (c) => execSync(c, { encoding: "utf8", maxBuffer: 64 << 20 });
const show = (ref, path) => { try { return sh(`git show ${ref}:${path}`); } catch { return null; } };
const results = [];
const add = (ok, title, detail = "") => results.push({ ok, title, detail });

// 1. 環境隔離：正式版 index.html 與 demo/ 不能被改（PR 加上「正式版更新」標籤才允許）
const changed = sh(`git diff --name-only ${BASE}...HEAD`).split("\n").filter(Boolean);
const prodTouched = changed.filter((f) => f === "index.html" || f.startsWith("demo/"));
if (prodTouched.length && process.env.ALLOW_PROD !== "1")
  add(false, "正式版與 demo 沒有被改動", "這次改到：" + prodTouched.join("、") + "。如果確定要更新正式版，請在 PR 加上「正式版更新」標籤。");
else add(true, "正式版與 demo 沒有被改動", prodTouched.length ? "有改動，但 PR 已標示「正式版更新」" : "");

// 2. JS 語法：beta 與正式版的每段內嵌 script 都要能通過 node --check
const dir = mkdtempSync(join(tmpdir(), "rc-"));
for (const f of ["beta/index.html", "index.html"]) {
  const html = readFileSync(f, "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const bad = [];
  scripts.forEach((s, i) => {
    const p = join(dir, f.replace(/\W/g, "_") + i + ".js"); writeFileSync(p, s);
    try { sh(`node --check "${p}" 2>&1`); } catch (e) { bad.push(`第 ${i + 1} 段：` + String(e.stdout || e.message).split("\n").slice(0, 4).join(" ")); }
  });
  add(!bad.length, `${f} 的 JavaScript 語法正確（${scripts.length} 段）`, bad.join("\n"));
}

const beta = readFileSync("beta/index.html", "utf8");
const baseBeta = show(BASE, "beta/index.html") || "";

// 3. 資安紅線：前端不能存放 Sparky API 金鑰
const keyHits = beta.split("\n").map((l, i) => [i + 1, l])
  .filter(([, l]) => /\.apiKey\s*=[^=]|\bapiKey\s*:/.test(l) || /localStorage\.setItem\([^)]*(apiKey|api_key|secret)/i.test(l));
add(!keyHits.length, "沒有把 API 金鑰寫進前端或 localStorage", keyHits.map(([n, l]) => `第 ${n} 行：${l.trim().slice(0, 120)}`).join("\n"));

// 4. CSV 匯出保留防公式注入
add(/function csvCell\b/.test(beta) && beta.includes("/^[=+\\-@\\t\\r]/"), "CSV 匯出保留防公式注入（csvCell）");
if (!results.at(-1).ok) results.at(-1).detail = "找不到 csvCell 或它的 = + - @ 檢查";

// 5. 既有 CSS 變數（色票、文字層級）的名稱與預設值不能改，只能新增
const vars = (html) => {
  const m = new Map();
  for (const b of html.matchAll(/(:root[^{]*)\{([^{}]*)\}/g))
    for (const d of b[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) m.set(b[1].trim() + " " + d[1], d[2].trim());
  return m;
};
const vb = vars(baseBeta), vh = vars(beta), varBad = [];
for (const [k, v] of vb) { if (!vh.has(k)) varBad.push(`${k} 被刪除或改名`); else if (vh.get(k) !== v) varBad.push(`${k}：${v} → ${vh.get(k)}`); }
const added = [...vh.keys()].filter((k) => !vb.has(k));
add(!varBad.length, "既有 CSS 變數沒有被改名或改預設值", varBad.join("\n") + (added.length ? `\n（新增 ${added.length} 個變數：${added.map((k) => k.split(" ").pop()).join("、")}）` : ""));

// 6. beta 與正式版的旗標沒有搞混
const ver = (h) => (h.match(/const APP = \{ beta:(true|false), ver:"([^"]+)"/) || []).slice(1);
const [bFlag, bVer] = ver(beta), [pFlag] = ver(readFileSync("index.html", "utf8"));
add(bFlag === "true" && pFlag === "false", "beta 標示為測試版、正式版標示為正式版", bFlag === "true" && pFlag === "false" ? "" : `beta:${bFlag}／正式版:${pFlag}`);

// 7. 提醒：beta 有改動但版號沒升
const [, baseVer] = ver(baseBeta);
const warn = changed.includes("beta/index.html") && bVer === baseVer ? `beta 有改動，但版號還是 ${bVer}，建議升版號` : "";

const lines = ["## 依 REVIEW_RULES.md 自動檢查", "", ...results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.title}` + (r.detail ? "\n" + r.detail.split("\n").filter(Boolean).map((d) => "  - " + d).join("\n") : ""))];
if (warn) lines.push("", "⚠️ " + warn);
lines.push("", "版面（三種寬度 × 淺色／深色）仍需要用瀏覽器實測，這個檢查不會做。");
const out = lines.join("\n");
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + "\n");
process.exit(results.every((r) => r.ok) ? 0 : 1);
