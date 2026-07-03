#!/usr/bin/env node
// merge.mjs — B站模拟经营游戏雷达 数据合并脚本
// 用法: node scripts/merge.mjs --append _week.json
//
// 职责:
//   1. 读取并校验一周的 _week.json（结构 + 必填字段 + id 唯一）
//   2. 追加到权威数据源 data.json（weeks[] + games[]）
//   3. 把 data.json 机械回填进 index.html 的 DATA:START ~ DATA:END 区块
//   4. 自包含校验（回填后的 index.html 能被再次解析出相同数据）
//   5. 同步 index.html 内的静态“共 N 周”汇总文案
// 失败即以非 0 退出，且不写坏已有文件（先在内存里构建，全部通过后再落盘）。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DATA_PATH = join(REPO_ROOT, "data.json");
const HTML_PATH = join(REPO_ROOT, "index.html");
const START = "/*DATA:START*/";
const END = "/*DATA:END*/";

function fail(msg) {
  console.error("[merge] 失败: " + msg);
  process.exit(1);
}
function ok(msg) {
  console.log("[merge] " + msg);
}

// ---- 参数 ----
const args = process.argv.slice(2);
const appendIdx = args.indexOf("--append");
if (appendIdx === -1 || !args[appendIdx + 1]) {
  fail("缺少 --append <week.json> 参数");
}
const weekFile = join(REPO_ROOT, args[appendIdx + 1]);
if (!existsSync(weekFile)) fail("找不到周数据文件: " + weekFile);

// ---- 读取周数据 ----
let week;
try {
  week = JSON.parse(readFileSync(weekFile, "utf8"));
} catch (e) {
  fail("周数据 JSON 解析失败: " + e.message);
}

// ---- 校验周数据 ----
function req(obj, key, ctx) {
  if (obj[key] === undefined || obj[key] === null || obj[key] === "") {
    fail(`字段缺失: ${ctx}.${key}`);
  }
}
req(week, "generated", "week");
req(week, "week", "week");
if (!/^\d{4}-W\d{2}$/.test(week.week)) fail(`week 格式应为 YYYY-Www，实际: ${week.week}`);
req(week, "scan", "week");
if (!Array.isArray(week.games)) fail("week.games 必须是数组");

const allowedScope = new Set(["core", "adjacent"]);
const allowedConf = new Set(["high", "medium", "low"]);
const allowedTrend = new Set(["rising", "stable", "burst", "decaying"]);

for (const g of week.games) {
  const ctx = `games[id=${g.id || "?"}]`;
  req(g, "id", ctx);
  req(g, "name", ctx);
  req(g, "scope", ctx);
  if (!allowedScope.has(g.scope)) fail(`${ctx}.scope 非法: ${g.scope}`);
  req(g, "confidence", ctx);
  if (!allowedConf.has(g.confidence)) fail(`${ctx}.confidence 非法: ${g.confidence}`);
  if (g.trend && !allowedTrend.has(g.trend)) fail(`${ctx}.trend 非法: ${g.trend}`);
  if (!g.scanDate) g.scanDate = week.generated;
  if (!g.week) g.week = week.week;
  g.design = Array.isArray(g.design) ? g.design : [];
  g.market = Array.isArray(g.market) ? g.market : [];
  g.videos = Array.isArray(g.videos) ? g.videos : [];
}

// ---- 读取/初始化 data.json ----
let data = { weeks: [], games: [] };
if (existsSync(DATA_PATH)) {
  try {
    data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  } catch (e) {
    fail("data.json 解析失败: " + e.message);
  }
}
if (!Array.isArray(data.weeks)) data.weeks = [];
if (!Array.isArray(data.games)) data.games = [];

// ---- 追加 ----
const weekMeta = {
  week: week.week,
  generated: week.generated,
  scan: week.scan,
  count: week.games.length,
};
// 若同周已存在则替换（重跑同一周时覆盖，避免脏数据）。
// 必须先移除同周旧条目，再做 id 唯一校验，否则重跑会误报 id 重复。
const wi = data.weeks.findIndex((w) => w.week === week.week);
if (wi >= 0) {
  ok(`检测到同周 ${week.week} 已存在，覆盖该周元信息与其游戏条目`);
  data.weeks[wi] = weekMeta;
  data.games = data.games.filter((g) => g.week !== week.week);
} else {
  data.weeks.push(weekMeta);
}

// id 全局唯一校验（跨周不合并；同周重跑已在上面清理旧条目）
const existingIds = new Set(data.games.map((g) => g.id));
const batchIds = new Set();
for (const g of week.games) {
  if (existingIds.has(g.id)) fail(`游戏 id 与其它周重复（跨周不合并请用不同 id）: ${g.id}`);
  if (batchIds.has(g.id)) fail(`本周内游戏 id 重复: ${g.id}`);
  batchIds.add(g.id);
}
data.weeks.sort((a, b) => (a.week < b.week ? 1 : -1)); // 新周在前
data.games.push(...week.games);
data.games.sort((a, b) => (a.week < b.week ? 1 : -1));

// ---- 落盘 data.json ----
const dataStr = JSON.stringify(data, null, 2);

// ---- 回填 index.html ----
if (!existsSync(HTML_PATH)) fail("找不到 index.html，请先初始化脚手架");
let html = readFileSync(HTML_PATH, "utf8");
const s = html.indexOf(START);
const e = html.indexOf(END);
if (s === -1 || e === -1 || e < s) fail("index.html 缺少 DATA:START/DATA:END 标记");

const inlineJson = JSON.stringify(data);
const block = `${START}\nconst DATA = ${inlineJson};\n${END}`;
html = html.slice(0, s) + block + html.slice(e + END.length);

// 同步静态汇总文案（形如 <span id="week-count">N</span> 周 / 共扫描 N 周）
const weekCount = data.weeks.length;
const gameCount = data.games.length;
html = html.replace(/(<span id="week-count">)[^<]*(<\/span>)/g, `$1${weekCount}$2`);
html = html.replace(/(<span id="game-count">)[^<]*(<\/span>)/g, `$1${gameCount}$2`);

// ---- 自包含校验：从回填后的 html 重新解析 ----
const s2 = html.indexOf(START);
const e2 = html.indexOf(END);
const reBlock = html.slice(s2 + START.length, e2).trim();
const m = reBlock.match(/const DATA\s*=\s*([\s\S]*);$/);
if (!m) fail("自包含校验失败: 无法从 index.html 重新解析 DATA");
let parsed;
try {
  parsed = JSON.parse(m[1]);
} catch (err) {
  fail("自包含校验失败: 回填的 DATA 不是合法 JSON: " + err.message);
}
if (parsed.weeks.length !== weekCount || parsed.games.length !== gameCount) {
  fail("自包含校验失败: 回填后条目数量不一致");
}

// ---- 全部通过后统一落盘 ----
writeFileSync(DATA_PATH, dataStr + "\n", "utf8");
writeFileSync(HTML_PATH, html, "utf8");

ok(`合并成功: 本周 ${week.week} 新增 ${week.games.length} 个游戏条目`);
ok(`当前累计: ${weekCount} 周 / ${gameCount} 个游戏条目`);
ok("data.json 与 index.html 已更新，自包含校验通过");
