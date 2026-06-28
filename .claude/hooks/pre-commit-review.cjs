#!/usr/bin/env node

// pre-commit-review.cjs — PreToolUse hook
//
// 拦截所有 Bash 工具调用中的 `git commit`，先跑 codex review：
//   ALLOW → 放行，提交正常执行
//   BLOCK → decision:block 拒绝提交，把问题反馈给 Claude 修
//   ERROR → 放行（额度不足 / 工具异常不误拦）
//
// 不依赖"stop 前不能 commit"的行为规则，直接在 commit 发生点把守。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins')

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: r.status === 0, out: (r.stdout || '').trim() }
}

function isRepo(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return false
  } catch {
    return false
  }
  const r = git(dir, ['rev-parse', '--is-inside-work-tree'])
  return r.ok && r.out === 'true'
}

function hasChanges(cwd) {
  if (!isRepo(cwd)) return false
  const r = git(cwd, ['status', '--short', '--untracked-files=all'])
  return r.ok && r.out.length > 0
}

function findCompanion() {
  const candidates = [
    path.join(PLUGINS_DIR, 'marketplaces', 'openai-codex', 'plugins', 'codex', 'scripts', 'codex-companion.mjs'),
  ]
  const cacheRoot = path.join(PLUGINS_DIR, 'cache', 'openai-codex', 'codex')
  try {
    for (const v of fs.readdirSync(cacheRoot).sort().reverse()) {
      candidates.push(path.join(cacheRoot, v, 'scripts', 'codex-companion.mjs'))
    }
  } catch { /* no cache */ }
  return candidates.find((c) => {
    try { return fs.statSync(c).isFile() } catch { return false }
  })
}

const CLEAN_SIGNALS = [
  'did not find any', 'did not identify any', 'no discrete', 'no actionable',
  'no issues', 'no bugs', 'no problems', 'looks good', 'lgtm',
  '没有发现', '未发现', '无明显问题',
]

function runReviewGate(companion, cwd) {
  const r = spawnSync(
    process.execPath,
    [companion, 'review', '--json', '--wait', '--scope', 'working-tree'],
    { cwd, encoding: 'utf8', timeout: 15 * 60 * 1000 }
  )

  if (r.error?.code === 'ETIMEDOUT') {
    return { verdict: 'ERROR', reason: 'codex review 超时（15 分钟）', raw: '' }
  }

  let payload
  try {
    payload = JSON.parse(r.stdout || '')
  } catch {
    return {
      verdict: 'ERROR',
      reason: '解析 codex 输出失败，无法判定',
      raw: `${r.stdout || ''}\n${r.stderr || ''}`.trim(),
    }
  }

  const codex = payload.codex || {}
  const stdout = String(codex.stdout || '').trim()
  const stderr = String(codex.stderr || '').trim()
  const raw = stdout || stderr || JSON.stringify(payload)

  if (codex.status !== 0 || !stdout) {
    const credit = stderr.toLowerCase().includes('out of credits')
    return {
      verdict: 'ERROR',
      reason: credit ? 'codex 额度不足，跳过审查放行' : `codex review 未产出结论: ${stderr || '(无错误信息)'}`,
      raw,
    }
  }

  const clean = CLEAN_SIGNALS.some((s) => stdout.toLowerCase().includes(s))
  return clean
    ? { verdict: 'ALLOW', reason: 'codex review 未发现问题，允许提交', raw }
    : { verdict: 'BLOCK', reason: 'codex review 报告了需关注的问题，拦截提交', raw }
}

function ensureIgnored(cwd) {
  try {
    const gi = path.join(cwd, '.gitignore')
    let content = ''
    try { content = fs.readFileSync(gi, 'utf8') } catch { /* 无 .gitignore */ }
    const lines = content.split(/\r?\n/).map((l) => l.trim())
    if (!lines.includes('codex-review/') && !lines.includes('codex-review')) {
      const prefix = content && !content.endsWith('\n') ? '\n' : ''
      fs.appendFileSync(gi, `${prefix}codex-review/\n`, 'utf8')
    }
  } catch { /* 不影响主流程 */ }
}

function writeReviewMd(cwd, result) {
  ensureIgnored(cwd)
  const dir = path.join(cwd, 'codex-review')
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
  const file = path.join(dir, `review-${stamp}.md`)
  const md = [
    `# Codex Review (Pre-Commit) — ${ts.toLocaleString('zh-CN')}`,
    '',
    `**判决: ${result.verdict}**`,
    '',
    `> ${result.verdict === 'BLOCK' ? '发现问题，已拦截 git commit，请修复后重试。' : result.verdict === 'ALLOW' ? '审查通过，放行提交。' : '审查过程异常，已放行。'}`,
    '',
    '## 原因',
    '',
    result.reason || '(无)',
    '',
    '## 原始输出',
    '',
    '```',
    result.raw || '(无)',
    '```',
    '',
  ].join('\n')
  fs.writeFileSync(file, md, 'utf8')
  return file
}

function main() {
  const input = readHookInput()

  // 只处理 Bash 工具
  if (input.tool_name !== 'Bash') return

  const command = input.tool_input?.command || ''

  // 只拦截 git commit 调用（含带全局选项的形式: `git -C <dir> commit`、`git -c user.name=... commit`、`git --no-pager commit` 等）
  const GIT_COMMIT_RE = /\bgit\s+(?:--?[a-zA-Z][\w=-]*(?:\s+\S+)?\s+)*commit\b/
  if (!GIT_COMMIT_RE.test(command)) return

  const cwd = input.cwd || process.cwd()

  // 非 git 仓库 / 无未提交改动 → 放行
  if (!hasChanges(cwd)) return

  const companion = findCompanion()
  // 没装 codex → 放行
  if (!companion) return

  const result = runReviewGate(companion, cwd)

  let file = null
  try { file = writeReviewMd(cwd, result) } catch { /* 写文件失败不卡主流程 */ }

  if (result.verdict === 'BLOCK') {
    emitDecision({
      decision: 'block',
      reason: [
        `[Codex Review Gate] 拦截 git commit — ${result.reason}`,
        file ? `报告已写入: ${file}` : '',
        '',
        '--- Codex 原始输出 ---',
        result.raw,
      ].filter(Boolean).join('\n'),
    })
    return
  }

  // ALLOW / ERROR → 放行
  if (file) process.stderr.write(`[Codex Review] ${result.verdict} — ${file}\n`)
}

try {
  main()
} catch {
  process.exit(0)
}
