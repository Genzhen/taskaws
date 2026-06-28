#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT        = 3099;
const DIR         = import.meta.dirname;
const PROJECT     = path.resolve(DIR, '../..');
const BACKLOG     = path.join(PROJECT, 'specs/TASKS_BACKLOG.md');
const EVENTS_FILE = path.join(DIR, 'events.jsonl');
const SNAP_FILE   = path.join(DIR, 'state-snapshot.json');

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  primarySession: null,
  activeCommand:  null,
  currentNode:    null,
  completedNodes: [],   // nodes completed in current session
  taskLoopCount:  0,    // how many task loops (N3→N7) completed
  featureLoopCount: 0,  // how many feature loops completed
  retryCount:     0,    // N4→N3 retry count in current task
  currentCycle:   null,
  currentTask:    null,
  qaScore:        null,
  agents: {
    'gz-frontend-engineer': { active: false, task: '', totalCalls: 0, startTime: null },
    'gz-backend-engineer':  { active: false, task: '', totalCalls: 0, startTime: null },
    'gz-database-engineer': { active: false, task: '', totalCalls: 0, startTime: null },
    'gz-qa-engineer':       { active: false, task: '', totalCalls: 0, startTime: null },
  },
  sessions:        {},   // session_id → { role: 'primary'|'subagent', agentName: string|null }
  pendingDispatch: null, // subagent_type pending association with next new session
  currentTool:     null,
  toolCounts:      {},
  totalTools:      0,
  pendingTools:    {},
  startTime:       null,
  backlog:         null, // parsed backlog data
  events:          [],
};

const clients  = new Set();
const MAX_EVTS = 400;

// ── Persistence ───────────────────────────────────────────────────────────────

function loadSnapshot() {
  try {
    const snap = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8'));
    Object.assign(state, snap);
    // Re-hydrate events from .jsonl (last 200 lines)
    if (fs.existsSync(EVENTS_FILE)) {
      const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
      state.events = lines.slice(-200).map(l => JSON.parse(l));
    }
    console.log(`  ↳ Restored snapshot (${state.events.length} events)`);
  } catch {}
}

let saveTimer = null;
function schedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const { events, pendingTools, pendingDispatch, currentTool, ...snap } = state;
      fs.writeFileSync(SNAP_FILE, JSON.stringify(snap), 'utf8');
    } catch {}
  }, 800);
}

function appendEvent(event) {
  try { fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n'); } catch {}
}

// ── Backlog Parser ────────────────────────────────────────────────────────────

function parseBacklog() {
  try {
    const raw = fs.readFileSync(BACKLOG, 'utf8');

    // Status table
    const cycle = (raw.match(/\|\s*当前 Cycle\s*\|\s*([^|\n]+)\|/) || [])[1]?.trim();
    const node  = (raw.match(/\|\s*当前 Node\s*\|\s*([^|\n]+)\|/)  || [])[1]?.trim();
    const task  = (raw.match(/\|\s*当前 Task\s*\|\s*([^|\n]+)\|/)  || [])[1]?.trim();
    if (cycle && !/^—/.test(cycle)) state.currentCycle = cycle;
    if (node  && !/^—/.test(node))  state.currentNode  = normalizeNodeId(node);
    if (task  && !/^—/.test(task))  state.currentTask  = task;

    // Completed cycles from history table
    const doneCycles = new Set();
    const histRe = /\|\s*(Cycle\s*\d+|DEPLOY)\s*\|[^|]*\|\s*✅/g;
    let hm;
    while ((hm = histRe.exec(raw)) !== null) doneCycles.add(hm[1].replace(/\s+/, ' '));

    // Parse phases → cycles → checkboxes
    const phases = [];
    const phaseRe = /^## (Phase \d+: [^\n]+)/gm;
    const phaseMatches = [...raw.matchAll(phaseRe)];

    phaseMatches.forEach((pm, pi) => {
      const phaseTitle = pm[1];
      const phaseStart = pm.index;
      const phaseEnd   = phaseMatches[pi + 1]?.index ?? raw.length;
      const phaseBody  = raw.slice(phaseStart, phaseEnd);

      const cycleRe2 = /^### (Cycle \d+: [^\n]+)/gm;
      const cycleMatches = [...phaseBody.matchAll(cycleRe2)];
      const cycles = [];

      cycleMatches.forEach((cm, ci) => {
        const cycleTitle = cm[1];
        const cycleNum   = (cycleTitle.match(/Cycle (\d+)/) || [])[1];
        const cycleStart = cm.index;
        const cycleEnd   = cycleMatches[ci + 1]?.index ?? phaseBody.length;
        const cycleBody  = phaseBody.slice(cycleStart, cycleEnd);

        // Parse tasks
        const taskRe = /^#### (Task [^\n]+)/gm;
        const taskMatches = [...cycleBody.matchAll(taskRe)];
        const tasks = [];

        taskMatches.forEach((tm, ti) => {
          const taskTitle = tm[1];
          const tStart    = tm.index;
          const tEnd      = taskMatches[ti + 1]?.index ?? cycleBody.length;
          const tBody     = cycleBody.slice(tStart, tEnd);
          const pending   = [...tBody.matchAll(/^- \[ \] (.+)$/gm)].map(m => m[1]);
          const done      = (tBody.match(/^- \[x\] /gm) || []).length;
          tasks.push({ title: taskTitle, pending, done });
        });

        const totalPending = tasks.reduce((s, t) => s + t.pending.length, 0);
        const totalDone    = tasks.reduce((s, t) => s + t.done, 0);
        const isDone       = doneCycles.has(`Cycle ${cycleNum}`);

        cycles.push({ num: cycleNum, title: cycleTitle, tasks, totalPending, totalDone, isDone });
      });

      const pPending = cycles.reduce((s, c) => s + (c.isDone ? 0 : c.totalPending), 0);
      const pDone    = cycles.reduce((s, c) => s + c.totalDone + (c.isDone ? c.totalPending : 0), 0);
      phases.push({ title: phaseTitle, cycles, totalPending: pPending, totalDone: pDone });
    });

    state.backlog = { phases, doneCycles: [...doneCycles] };
  } catch (e) {
    // Backlog file may not exist yet
  }
}

setInterval(parseBacklog, 1500);
parseBacklog();

// Instant re-parse when backlog file changes
try {
  fs.watch(BACKLOG, { persistent: false }, () => {
    setTimeout(parseBacklog, 50); // debounce 50ms
    if (clients.size > 0) setTimeout(() => broadcast('state', stateSummary()), 100);
  });
} catch {}

// ── Notification Parser ───────────────────────────────────────────────────────

const NOTIF_PATTERNS = [
  { re: /进入\s*N(\d+)/,                              act: 'nextNode' },
  { re: /[✓✅]\s*N(\d+)/,                             act: 'completeNode' },
  { re: /N(\d+)[：:]\s*(?:完成|done)/i,               act: 'completeNode' },
  { re: /当前\s*Node[^N]*N(\d+)/,                    act: 'setNode' },
  // QA score: match decimal first, then integer fallback
  { re: /(?:QA|评分|总分)[^\d]*(\d{2,3}\.\d+)/,      act: 'qaScore' },
  { re: /(?:QA|评分|总分)[^\d]*(\d{2,3})(?!\.\d)/,   act: 'qaScore' },
];

function parseNotification(message) {
  if (!message) return;
  const seen = new Set(); // each act fires only once per message
  for (const { re, act } of NOTIF_PATTERNS) {
    if (seen.has(act)) continue;
    const m = message.match(re);
    if (!m) continue;
    seen.add(act);
    if (act === 'nextNode' || act === 'setNode') {
      advanceNode(`N${m[1]}`);
    } else if (act === 'completeNode') {
      const nid = `N${m[1]}`;
      if (!state.completedNodes.includes(nid)) state.completedNodes.push(nid);
      advanceNode(`N${Number(m[1]) + 1}`);
    } else if (act === 'qaScore') {
      state.qaScore = parseFloat(m[1]);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeNodeId(raw) {
  const m = raw.match(/N(\d+)/);
  return m ? `N${m[1]}` : null;
}

function getPreview(event) {
  const i = event.tool_input || {};
  if (i.command)     return i.command.slice(0, 140);
  if (i.file_path)   return i.file_path.replace(PROJECT + '/', '');
  if (i.description) return i.description.slice(0, 120);
  if (i.query)       return i.query.slice(0, 120);
  if (i.skill)       return i.skill;
  if (i.prompt)      return i.prompt.slice(0, 100);
  return event.message?.slice(0, 120) || '';
}

const NODE_SKILLS = {
  'gz-coding-nodes:N1-init':         'N1',
  'gz-coding-nodes:N3-execute-task': 'N3',
  'gz-coding-nodes:N4-review':       'N4',
  'gz-coding-nodes:N6-qa':           'N6',
  'gz-coding-nodes:N7-context':      'N7',
};

// Detect node from Read file path patterns
const NODE_FILE_PATTERNS = [
  { re: /N1.?init/i,         node: 'N1' },
  { re: /N3.?execute/i,      node: 'N3' },
  { re: /N4.?review/i,       node: 'N4' },
  { re: /N6.?qa/i,           node: 'N6' },
  { re: /N7.?context/i,      node: 'N7' },
];

function nodeFromFilePath(fp) {
  if (!fp) return null;
  for (const { re, node } of NODE_FILE_PATTERNS) {
    if (re.test(fp)) return node;
  }
  return null;
}

function advanceNode(newNode) {
  if (!newNode) return;
  const prev = state.currentNode;
  state.currentNode = newNode;
  if (prev && prev !== newNode && !state.completedNodes.includes(prev)) {
    state.completedNodes.push(prev);
  }
  // Track loops
  if (newNode === 'N3' && prev === 'N7') state.taskLoopCount++;
  if (newNode === 'N2' && prev === 'N7') state.featureLoopCount++;
  if (newNode === 'N3' && (prev === 'N4' || prev === 'N6')) state.retryCount++;
  if (newNode === 'N3' && prev !== 'N7' && prev !== 'N4' && prev !== 'N6') state.retryCount = 0;
}

const CMD_SKILLS = new Set([
  'gz:coding','gz:prd','gz:init','gz:deploy',
  'gz:deploy-verify','gz:ai-integration','gz:payments',
]);

// ── Event Processor ───────────────────────────────────────────────────────────

function processEvent(raw) {
  const ev   = { ...raw, timestamp: Date.now() };
  ev._preview = getPreview(ev);

  const type  = ev.hook_event_name;
  const tool  = ev.tool_name;
  const inp   = ev.tool_input || {};
  const sid   = ev.session_id;

  if (!state.startTime) state.startTime = ev.timestamp;

  // ── Session tracking ────────────────────────────────────────────────────────
  if (sid) {
    if (!state.primarySession) {
      state.primarySession = sid;
      state.sessions[sid]  = { role: 'primary', agentName: null };
    } else if (!state.sessions[sid]) {
      // New session = subagent
      const agentName = state.pendingDispatch || null;
      state.sessions[sid] = { role: 'subagent', agentName };
      state.pendingDispatch = null;
    }
    ev._sessionRole  = state.sessions[sid]?.role  || 'unknown';
    ev._agentName    = state.sessions[sid]?.agentName || null;
  }

  // ── Command detection ───────────────────────────────────────────────────────
  if (type === 'PreToolUse' && tool === 'Skill') {
    const sk = inp.skill || '';
    if (CMD_SKILLS.has(sk)) state.activeCommand = `/${sk}`;
    if (NODE_SKILLS[sk])    advanceNode(NODE_SKILLS[sk]);
  }

  // ── Read file path → node detection ─────────────────────────────────────────
  if (type === 'PreToolUse' && tool === 'Read') {
    const detected = nodeFromFilePath(inp.file_path || '');
    if (detected) advanceNode(detected);
  }

  // ── Agent tracking ──────────────────────────────────────────────────────────
  if (type === 'PreToolUse' && tool === 'Agent') {
    const at = inp.subagent_type || '';
    if (state.agents[at]) {
      state.agents[at].active    = true;
      state.agents[at].task      = inp.description || '';
      state.agents[at].startTime = Date.now();
      state.agents[at].totalCalls++;
    }
    state.pendingDispatch = at || null;
    if (!state.currentNode || state.currentNode === 'N2') advanceNode('N3');
  }

  if (type === 'PostToolUse' && tool === 'Agent') {
    const at = inp.subagent_type || '';
    if (state.agents[at]) {
      state.agents[at].active    = false;
      state.agents[at].startTime = null;
    }
  }

  // ── Bash inference ──────────────────────────────────────────────────────────
  if (type === 'PreToolUse' && tool === 'Bash') {
    const cmd = (inp.command || '').toLowerCase();
    if ((cmd.includes('pnpm test') || cmd.includes('pnpm lint')) && state.currentNode === 'N3')
      advanceNode('N6');
    if (cmd.includes('pnpm build') || cmd.includes('open-next'))
      advanceNode('N8');
    if (cmd.includes('check-types') && state.currentNode === 'N3')
      advanceNode('N4');
  }

  // ── Notification parsing ────────────────────────────────────────────────────
  if (type === 'Notification') parseNotification(ev.message || '');

  // ── Stop ────────────────────────────────────────────────────────────────────
  if (type === 'Stop') {
    state.currentTool = null;
    for (const a of Object.values(state.agents)) { a.active = false; a.startTime = null; }
  }

  // ── Tool stats ──────────────────────────────────────────────────────────────
  if (type === 'PreToolUse') {
    state.totalTools++;
    state.toolCounts[tool] = (state.toolCounts[tool] || 0) + 1;
    state.pendingTools[tool] = ev.timestamp;
    state.currentTool = { name: tool, preview: ev._preview, startTime: ev.timestamp };
  }

  if (type === 'PostToolUse') {
    const dur = state.pendingTools[tool] ? ev.timestamp - state.pendingTools[tool] : null;
    delete state.pendingTools[tool];
    ev._duration = dur;
    if (state.currentTool?.name === tool) state.currentTool = null;
  }

  // ── Store ───────────────────────────────────────────────────────────────────
  state.events.push(ev);
  if (state.events.length > MAX_EVTS) state.events.shift();
  appendEvent(ev);
  schedSave();

  return ev;
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch {} }
}

function stateSummary() {
  return {
    startTime:        state.startTime,
    activeCommand:    state.activeCommand,
    currentNode:      state.currentNode,
    completedNodes:   state.completedNodes,
    taskLoopCount:    state.taskLoopCount,
    featureLoopCount: state.featureLoopCount,
    retryCount:       state.retryCount,
    currentCycle:     state.currentCycle,
    currentTask:      state.currentTask,
    qaScore:          state.qaScore,
    agents:           state.agents,
    sessions:         state.sessions,
    currentTool:      state.currentTool,
    toolCounts:       state.toolCounts,
    totalTools:       state.totalTools,
    backlog:          state.backlog,
    events:           state.events.slice(-120),
  };
}

// ── HTML Dashboard ──────────────────────────────────────────────────────────
const DASHBOARD_FILE = new URL('./dashboard.html', import.meta.url).pathname;
function getHTML() {
  try { return fs.readFileSync(DASHBOARD_FILE, 'utf8'); } 
  catch { return '<h1 style="color:#fff;font-family:monospace">dashboard.html not found</h1>'; }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

loadSnapshot();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/event') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const ev = processEvent(JSON.parse(body));
        broadcast('event', ev);
        broadcast('state', stateSummary());
        res.writeHead(200); res.end('{"ok":true}');
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`event: init\ndata: ${JSON.stringify(stateSummary())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHTML());
    return;
  }

  if (req.method === 'GET' && req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stateSummary(), null, 2));
    return;
  }

  res.writeHead(404); res.end('not found');
});

// Push backlog updates every 5s
setInterval(() => {
  if (clients.size > 0) broadcast('state', stateSummary());
}, 5000);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n⚡ GZ AI Workflow Visualizer  →  http://localhost:${PORT}`);
  console.log(`   Project : ${PROJECT}`);
  console.log(`   Backlog : ${BACKLOG}`);
  console.log(`   History : ${EVENTS_FILE}\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ Port ${PORT} busy. Kill with: lsof -ti:${PORT} | xargs kill\n`);
    process.exit(1);
  }
});
