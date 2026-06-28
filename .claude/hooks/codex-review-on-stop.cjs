#!/usr/bin/env node

// codex-review-on-stop: 每次 turn 结束(Stop)时,若当前目录有代码改动,
// 跑 codex review(--json)拿 ALLOW/BLOCK/ERROR 判决,写 MD 留痕,并据此放行或拦截。
//
// 放行制度:
//   - 非 git 目录 / 无未提交改动 / 没装 codex → 静默放行(不跑 CR)。
//   - 有改动 → 跑 `codex review --json --wait --scope working-tree`,按返回的 JSON 判:
//        codex.status≠0 或 stderr 含失败信号 → ERROR(放行,不误拦;含额度耗尽)。
//        codex.stdout 表示无问题(话术信号) → ALLOW(放行)。
//        其余(报告了问题)               → BLOCK(decision:block 拦住,反馈让 Claude 修)。
//   - 修复后下次 Stop 会重新 review;修对了即 ALLOW 放行(正常闭环,非死循环)。
//   - 绝不因自身异常卡住会话(任何错误都安静退出 0)。
//
// 注:codex `review` 子命令不透传结构化 verdict(approve/needs-attention),
//     仅在 codex.stdout 给自由文本,故 ALLOW/BLOCK 仍需对该字段做话术判断;
//     但调用成败、额度等已能靠 codex.status/stderr 结构化区分。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PLUGINS_DIR = path.join(os.homedir(), ".claude", "plugins");

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim() };
}

// 目录是否为 git 仓库。
function isRepo(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  const inRepo = git(dir, ["rev-parse", "--is-inside-work-tree"]);
  return inRepo.ok && inRepo.out === "true";
}

// cwd 是否为有「未提交改动」的 git 仓库。
function hasChanges(cwd) {
  if (!isRepo(cwd)) return false;
  const status = git(cwd, ["status", "--short", "--untracked-files=all"]);
  return status.ok && status.out.length > 0;
}

// 从 transcript 里抠出最近一条 /goal 的 condition 文本。
// transcript 是 jsonl,condition 以转义形态出现:condition: \"...\"
function readGoalText(transcriptPath) {
  if (!transcriptPath) return null;
  let raw = "";
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  // 取最后一次出现(最新的 goal 覆盖旧的)
  const re = /Stop hook is now active with condition: \\?"([^"\\]+)\\?"/g;
  let last = null;
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    last = m[1];
  }
  return last;
}

// 从 goal 文本解析出「真实存在且是 git 仓库」的工作目录;解析不到返回 null。
function resolveGoalDir(goalText) {
  if (!goalText) return null;
  const home = os.homedir();
  const cands = [];

  // 1) 「桌面」/「Desktop」后紧邻的项目名(中文常与英文紧贴,无空格)
  const desk = goalText.match(/(?:桌面|Desktop)\s*\/?\s*([A-Za-z0-9._-]+)/);
  if (desk) cands.push(path.join(home, "Desktop", desk[1]));

  // 2) 文本里的 ~ / 绝对路径
  for (const p of goalText.match(/(~|\/)[^\s"]+/g) || []) {
    cands.push(p.replace(/^~/, home));
  }

  // 3) 兜底:文本里出现的项目名 token,挂到桌面下试
  for (const tok of goalText.match(/[A-Za-z0-9][A-Za-z0-9._-]{2,}/g) || []) {
    cands.push(path.join(home, "Desktop", tok));
  }

  for (const c of cands) {
    if (isRepo(c)) return c;
  }
  return null;
}

// 决定本次 review 的目标目录。
// 优先级:会话 cwd 自己是 git 仓库 → 用它;否则从 /goal 文本解析(允许跨目录);都不行 → 回退 cwd。
function pickReviewDir(input, cwd) {
  if (isRepo(cwd)) return cwd;
  const dir = resolveGoalDir(readGoalText(input.transcript_path));
  return dir || cwd;
}

// 动态定位 codex companion:优先 marketplaces,回退 cache 最新版本。
function findCompanion() {
  const candidates = [
    path.join(PLUGINS_DIR, "marketplaces", "openai-codex", "plugins", "codex", "scripts", "codex-companion.mjs"),
  ];
  const cacheRoot = path.join(PLUGINS_DIR, "cache", "openai-codex", "codex");
  try {
    for (const v of fs.readdirSync(cacheRoot).sort().reverse()) {
      candidates.push(path.join(cacheRoot, v, "scripts", "codex-companion.mjs"));
    }
  } catch {
    /* no cache */
  }
  return candidates.find((c) => {
    try {
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });
}

// review 正文(codex.stdout)表示「无问题」的话术 → ALLOW。
const CLEAN_SIGNALS = [
  "did not find any",
  "did not identify any",
  "no discrete",
  "no actionable",
  "no issues",
  "no bugs",
  "no problems",
  "looks good",
  "lgtm",
  "没有发现",
  "未发现",
  "无明显问题",
];

// 跑 codex review --json,从结构化字段判 ALLOW/BLOCK/ERROR。
// 返回 { verdict: "ALLOW"|"BLOCK"|"ERROR", reason, raw }
function runReviewGate(companion, cwd) {
  const r = spawnSync(
    process.execPath,
    [companion, "review", "--json", "--wait", "--scope", "working-tree"],
    { cwd, encoding: "utf8", timeout: 15 * 60 * 1000 }
  );
  if (r.error?.code === "ETIMEDOUT") {
    return { verdict: "ERROR", reason: "codex review 超时(15 分钟)。", raw: "" };
  }

  // 解析 --json 输出;失败说明连脚本层都没正常返回 → ERROR。
  let payload;
  try {
    payload = JSON.parse(r.stdout || "");
  } catch {
    return {
      verdict: "ERROR",
      reason: "codex review 返回非 JSON,无法判定。",
      raw: `${r.stdout || ""}\n${r.stderr || ""}`.trim(),
    };
  }

  const codex = payload.codex || {};
  const stdout = String(codex.stdout || "").trim();
  const stderr = String(codex.stderr || "").trim();
  const raw = stdout || stderr || JSON.stringify(payload);

  // codex 内部调用失败(状态非 0 / 无正文)→ ERROR(放行,不误拦)。
  if (codex.status !== 0 || !stdout) {
    const credit = stderr.toLowerCase().includes("out of credits");
    return {
      verdict: "ERROR",
      reason: credit ? "codex 工作区额度不足(out of credits),无法审查。" : `codex review 未产出审查结论:${stderr || "(无错误信息)"}`,
      raw,
    };
  }

  // 仅对干净的审查正文做话术判定:命中「无问题」→ ALLOW,否则视为报告了问题 → BLOCK。
  const clean = CLEAN_SIGNALS.some((s) => stdout.toLowerCase().includes(s));
  return clean
    ? { verdict: "ALLOW", reason: "codex review 未发现需修复的问题。", raw }
    : { verdict: "BLOCK", reason: "codex review 报告了需关注的问题,详见原始输出。", raw };
}

// 确保项目 .gitignore 忽略 codex-review/,避免 review 产物被下次 review 当成项目改动(自我污染)。
function ensureIgnored(cwd) {
  try {
    const gi = path.join(cwd, ".gitignore");
    let content = "";
    try {
      content = fs.readFileSync(gi, "utf8");
    } catch {
      /* 无 .gitignore */
    }
    const lines = content.split(/\r?\n/).map((l) => l.trim());
    if (!lines.includes("codex-review/") && !lines.includes("codex-review")) {
      const prefix = content && !content.endsWith("\n") ? "\n" : "";
      fs.appendFileSync(gi, `${prefix}codex-review/\n`, "utf8");
    }
  } catch {
    /* 忽略失败不影响主流程 */
  }
}

function writeReviewMd(cwd, result) {
  ensureIgnored(cwd);
  const dir = path.join(cwd, "codex-review");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const file = path.join(dir, `review-${stamp}.md`);
  const md = [
    `# Codex Review — ${ts.toLocaleString("zh-CN")}`,
    "",
    `**判决: ${result.verdict}**`,
    "",
    `> ${result.verdict === "BLOCK" ? "发现问题,已拦截会话要求修复。" : result.verdict === "ALLOW" ? "通过,放行。" : "审查过程异常。"}`,
    "",
    "## 理由",
    "",
    result.reason || "(无)",
    "",
    "## 原始输出",
    "",
    "```",
    result.raw || "(无)",
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(file, md, "utf8");
  return file;
}

function main() {
  const input = readHookInput();
  const sessionCwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // 调试落地:无条件记录「本 hook 被进程拉起」这一事实(用于排查是否被调用)。
  try {
    fs.appendFileSync(
      path.join(os.homedir(), ".claude", "hooks", "codex-review-on-stop.debug.log"),
      `${new Date().toISOString()} fired cwd=${sessionCwd} transcript=${input.transcript_path || "(none)"}\n`,
      "utf8"
    );
  } catch { /* 落地失败不影响主流程 */ }

  // 优先用会话 cwd;cwd 非仓库时,跟随 /goal 文本指向的真实工作目录(允许跨目录)。
  const cwd = pickReviewDir(input, sessionCwd);

  if (!hasChanges(cwd)) return; // 非 git / 无改动 → 放行

  const companion = findCompanion();
  if (!companion) return; // 没装 codex → 放行(不打扰)

  const result = runReviewGate(companion, cwd);

  let file = null;
  try {
    file = writeReviewMd(cwd, result);
  } catch {
    /* 写文件失败也不卡会话 */
  }
  const note = file ? `codex review 已写入: ${file}` : "";

  if (result.verdict === "BLOCK") {
    emitDecision({
      decision: "block",
      reason: `codex review 发现问题,需修复后再停:${result.reason}${note ? `\n(${note})` : ""}`,
    });
    return;
  }

  // ALLOW 或 ERROR → 放行(ERROR 不拦,避免误伤;详情见 MD)。
  if (note) process.stderr.write(`${note}\n`);
}

try {
  main();
} catch {
  process.exit(0);
}
