#!/usr/bin/env node
/**
 * Paseo Dev TUI
 *
 * A custom split-pane terminal UI for running all dev services,
 * inspired by Turborepo's TUI. Zero extra dependencies — pure Node.js.
 *
 * Usage:
 *   node scripts/dev-tui.mjs            # local only
 *   node scripts/dev-tui.mjs --remote   # bind to Tailscale IP for Windows access
 *   PASEO_HOME=~/.paseo-blue node scripts/dev-tui.mjs
 *
 * Keys (normal mode):
 *   ↑ / k        — select previous service
 *   ↓ / j        — select next service
 *   1-9          — jump to service by number
 *   i / Enter    — enter input mode (send keystrokes to selected service)
 *   r            — restart selected service
 *   u / PgUp     — scroll up
 *   d / PgDn     — scroll down
 *   g            — scroll to top
 *   G            — scroll to bottom (follow live output)
 *   q / Ctrl+C   — quit (kills all services)
 *
 * Keys (input mode):
 *   Esc          — exit input mode, back to TUI
 *   everything else is forwarded to the selected service's stdin
 */

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import QRCode from "qrcode";
import pty from "node-pty";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── CLI args ──────────────────────────────────────────────────────────────────

const REMOTE_MODE = process.argv.includes("--remote");

// In remote mode, detect Tailscale IP so Windows can reach daemon + Metro.
// Metro bakes EXPO_PUBLIC_LOCAL_DAEMON into the bundle at startup — it must
// be the IP Windows will use, not localhost.
function getTailscaleIP() {
  try {
    return execFileSync("tailscale", ["ip", "-4"], {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
  } catch {
    console.error("--remote requires Tailscale. Run: tailscale up");
    process.exit(1);
  }
}

const TAILSCALE_IP = REMOTE_MODE ? getTailscaleIP() : null;
const DAEMON_HOST = REMOTE_MODE ? `${TAILSCALE_IP}:9239` : "localhost:9239";
const DAEMON_LISTEN = REMOTE_MODE ? "0.0.0.0:9239" : "127.0.0.1:9239";

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(ROOT, "packages", "app");
const DESKTOP_DIR = path.join(ROOT, "packages", "desktop");

// ── PASEO_HOME (mirrors dev.sh logic) ────────────────────────────────────────

function derivePaseoHome() {
  // Use DEV_PASEO_HOME for explicit override — deliberately NOT inheriting
  // PASEO_HOME because the prod daemon sets that env var, which would cause
  // both daemons to share ~/.paseo and trigger the "already running" check.
  if (process.env.DEV_PASEO_HOME) return process.env.DEV_PASEO_HOME;
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    const gitCommonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (gitDir !== gitCommonDir) {
      const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      const name = path.basename(toplevel)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      const home = path.join(homedir(), `.paseo-${name}`);
      mkdirSync(home, { recursive: true });
      return home;
    }
  } catch {}
  return mkdtempSync(path.join(tmpdir(), "paseo-dev."));
}

const PASEO_HOME = derivePaseoHome();
const PASEO_LOCAL_MODELS_DIR =
  process.env.PASEO_LOCAL_MODELS_DIR ??
  path.join(homedir(), ".paseo", "models", "local-speech");

mkdirSync(PASEO_LOCAL_MODELS_DIR, { recursive: true });

// ── Stale lock cleanup ────────────────────────────────────────────────────────
// If a previous TUI session crashed without cleaning up, the daemon pid lock
// file can block the new daemon from starting. Clear it if the pid is dead.
function clearStaleLock() {
  const lockFile = path.join(PASEO_HOME, "paseo.pid");
  if (!existsSync(lockFile)) return;
  try {
    const contents = readFileSync(lockFile, "utf-8").trim();
    const pid = parseInt(JSON.parse(contents)?.pid ?? contents, 10);
    if (isNaN(pid)) return;
    // Check if the process is still alive
    try {
      process.kill(pid, 0); // signal 0 = probe only, throws if dead
      // Still alive — leave the lock alone
    } catch {
      // Dead — remove the stale lock
      rmSync(lockFile, { force: true });
    }
  } catch {}
}

clearStaleLock();

// ── Service definitions ───────────────────────────────────────────────────────

const SERVICE_DEFS = [
  {
    key: "daemon",
    label: "daemon",
    color: 36, // cyan
    cwd: ROOT,
    cmd: "npm",
    args: ["run", "dev:server"],
    env: {
      PASEO_HOME,
      PASEO_LOCAL_MODELS_DIR,
      PASEO_CORS_ORIGINS: "*",
      PASEO_LISTEN: DAEMON_LISTEN,
      NODE_ENV: "development",
      EXPO_PUBLIC_LOCAL_DAEMON: DAEMON_HOST,
    },
  },
  {
    key: "metro",
    label: "metro",
    color: 35, // magenta
    cwd: APP_DIR,
    cmd: "npx",
    args: ["expo", "start", "--tunnel", "--port", "8090"],
    usePty: true, // needs a real PTY so Expo shows QR + tunnel URL
    env: {
      BROWSER: "none",
      EXPO_PUBLIC_LOCAL_DAEMON: DAEMON_HOST,
    },
  },
  // Desktop (Electron) requires a GUI display — run on Windows via the tunnel
  // workflow described in docs/DEVELOPMENT.md, or uncomment + set DISPLAY here
  // if you have Xvfb running: DISPLAY=:99 Xvfb :99 -screen 0 1280x800x24 &
  // {
  //   key: "desktop",
  //   label: "desktop",
  //   color: 33,
  //   cwd: ROOT,
  //   cmd: "sh",
  //   args: ["-c", `npm run build:main --workspace=@getpaseo/desktop && EXPO_DEV_URL=http://localhost:8090 npx electron "${DESKTOP_DIR}"`],
  //   env: { DISPLAY: ":99", EXPO_DEV_URL: "http://localhost:8090", PASEO_LISTEN: "127.0.0.1:6768" },
  // },
  // Uncomment to add the marketing site:
  // {
  //   key: 'website',
  //   label: 'website',
  //   color: 34, // blue
  //   cwd: ROOT,
  //   cmd: 'npm',
  //   args: ['run', 'dev:website'],
  //   env: {},
  // },
];

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const INVERT = "\x1b[7m";
const fg = (n) => `\x1b[${n}m`;

const STATUS_DOT = {
  starting: `\x1b[33m◌${RESET}`,
  running: `\x1b[32m●${RESET}`,
  stopped: `\x1b[90m●${RESET}`,
  error: `\x1b[31m✕${RESET}`,
};

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function truncateAnsi(str, maxLen) {
  let visible = 0;
  let result = "";
  let i = 0;
  while (i < str.length) {
    if (str[i] === "\x1b" && str[i + 1] === "[") {
      let j = i + 2;
      while (j < str.length && !/[A-Za-z]/.test(str[j])) j++;
      result += str.slice(i, j + 1);
      i = j + 1;
    } else if (visible < maxLen) {
      result += str[i];
      visible++;
      i++;
    } else {
      i++;
    }
  }
  result += RESET;
  if (visible < maxLen) result += " ".repeat(maxLen - visible);
  return result;
}

// ── State ─────────────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 2000;
const SIDEBAR_W = 16;

const services = SERVICE_DEFS.map((def) => ({
  ...def,
  proc: null,
  status: "starting",
  logs: [],
  exitCode: null,
  restarts: 0,
}));

// Tracks the Metro URL once it reports "Waiting on ..."
let metroUrl = null;
let metroTunnelMode = false; // true once "Tunnel ready." is seen

let selectedIdx = 0;
let scrollOffset = 0;
let inputMode = false; // when true, keystrokes are forwarded to the selected process stdin

// ── Render scheduler ──────────────────────────────────────────────────────────
// Keyboard events render immediately (no perceptible delay).
// Log output is capped at ~30fps so rapid output doesn't flood the terminal.

const FRAME_MS = 1000 / 30;
let lastRenderTime = 0;
let frameTimer = null;

function scheduleRender(immediate = false) {
  if (immediate) {
    // Cancel any pending throttled render and draw right now
    if (frameTimer) {
      clearTimeout(frameTimer);
      frameTimer = null;
    }
    render();
    lastRenderTime = Date.now();
    return;
  }
  // Throttled path: coalesce rapid log updates into one frame
  if (frameTimer) return;
  const elapsed = Date.now() - lastRenderTime;
  const wait = Math.max(0, FRAME_MS - elapsed);
  frameTimer = setTimeout(() => {
    frameTimer = null;
    render();
    lastRenderTime = Date.now();
  }, wait);
}

// ── Process management ────────────────────────────────────────────────────────

function spawnService(svc) {
  if (svc.proc) {
    killService(svc);
  }

  svc.status = "starting";
  svc.exitCode = null;

  if (svc.usePty) {
    // PTY mode: child sees a real TTY so interactive CLIs (Expo) work fully
    const cols = Math.max(80, (process.stdout.columns || 120) - SIDEBAR_W - 2);
    const rows = Math.max(24, (process.stdout.rows || 30) - 4);
    const ptyProc = pty.spawn(svc.cmd, svc.args, {
      name: "xterm-color",
      cols,
      rows,
      cwd: svc.cwd,
      env: { ...process.env, ...svc.env },
    });

    svc.proc = ptyProc;

    ptyProc.onData((data) => ingestChunk(svc, data));

    ptyProc.onExit(({ exitCode, signal }) => {
      if (services[selectedIdx] === svc && inputMode) inputMode = false;
      svc.proc = null;
      svc.exitCode = exitCode;
      svc.status = exitCode === 0 || signal === 15 ? "stopped" : "error";
      pushLine(svc, `${DIM}■ exited ${exitCode != null ? `code=${exitCode}` : `signal=${signal}`}${RESET}`);
      scheduleRender(true);
    });

    pushLine(svc, `${DIM}▶ started pid=${ptyProc.pid}${RESET}`);
    svc.status = "running";
    scheduleRender(true);
  } else {
    // Regular pipe mode for non-interactive services (daemon, etc.)
    svc.proc = spawn(svc.cmd, svc.args, {
      cwd: svc.cwd,
      env: { ...process.env, ...svc.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    svc.proc.stdout.on("data", (chunk) => ingestChunk(svc, chunk.toString()));
    svc.proc.stderr.on("data", (chunk) => ingestChunk(svc, chunk.toString()));

    svc.proc.on("spawn", () => {
      svc.status = "running";
      pushLine(svc, `${DIM}▶ started pid=${svc.proc.pid}${RESET}`);
      scheduleRender(true);
    });

    svc.proc.on("error", (err) => {
      svc.status = "error";
      pushLine(svc, `\x1b[31m✕ spawn error: ${err.message}${RESET}`);
      scheduleRender(true);
    });

    svc.proc.on("exit", (code, signal) => {
      if (services[selectedIdx] === svc && inputMode) inputMode = false;
      svc.proc = null;
      svc.exitCode = code;
      svc.status = code === 0 || signal === "SIGTERM" ? "stopped" : "error";
      pushLine(svc, `${DIM}■ exited ${code != null ? `code=${code}` : `signal=${signal}`}${RESET}`);
      scheduleRender(true);
    });
  }
}

async function injectMetroReady(svc, url) {
  const label = url.tunnel ? "Tunnel ready" : "Metro ready";
  pushLine(svc, "");
  pushLine(svc, `\x1b[32m✦ ${label}${RESET}`);
  pushLine(svc, `${DIM}  Expo Go:  ${url.expo}${RESET}`);
  pushLine(svc, `${DIM}  Web:      ${url.web}${RESET}`);
  pushLine(svc, `${DIM}  Press [i] then [a] Android · [i] iOS · [w] web${RESET}`);
  pushLine(svc, "");

  try {
    const qr = await QRCode.toString(url.expo, { type: "terminal", small: true });
    for (const line of qr.split("\n")) {
      pushLine(svc, "  " + line);
    }
  } catch {
    pushLine(svc, `${DIM}  (QR unavailable)${RESET}`);
  }

  pushLine(svc, "");
  scheduleRender(true);
}

function ingestChunk(svc, chunk) {
  const parts = chunk.split(/(\r\n|\r|\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i];
    const sep = parts[i + 1] ?? "";
    if (text === "" && sep === "") continue;
    if (sep === "\r" && i + 2 < parts.length) {
      if (svc.logs.length > 0) svc.logs[svc.logs.length - 1] = text;
      else svc.logs.push(text);
    } else if (text !== "" || sep.includes("\n")) {
      pushLine(svc, text);
    }

    // Detect Metro coming online
    if (svc.key === "metro" && !metroUrl) {
      const plain = stripAnsi(text);

      // Step 1: note when tunnel is established (so we don't fire on localhost URL)
      if (plain.includes("Tunnel ready")) {
        metroTunnelMode = true;
      }

      // Step 2: "Metro waiting on exp+slug://..." — the real scannable tunnel URL
      const tunnelMatch = plain.match(/Metro waiting on (exp[+\w]*:\/\/\S+)/i);
      if (tunnelMatch) {
        const expoUrl = tunnelMatch[1];
        metroUrl = { web: `http://localhost:8090`, expo: expoUrl, tunnel: true };
        injectMetroReady(svc, metroUrl);
        return;
      }

      // Step 3: "Waiting on http://..." — only use for local mode (no tunnel)
      if (!metroTunnelMode) {
        const localMatch = plain.match(/Waiting on (https?:\/\/\S+)/);
        if (localMatch) {
          const localUrl = localMatch[1];
          const host = REMOTE_MODE ? TAILSCALE_IP : "localhost";
          const port = new URL(localUrl).port || "8090";
          metroUrl = { web: `http://${host}:${port}`, expo: `exp://${host}:${port}`, tunnel: false };
          injectMetroReady(svc, metroUrl);
          return;
        }
      }
    }
  }
  // Don't re-render while in input mode — it scrolls the log pane under the
  // user's hands. The display resumes as soon as they press Esc.
  if (!inputMode) scheduleRender();
}

function pushLine(svc, line) {
  svc.logs.push(line);
  if (svc.logs.length > MAX_LOG_LINES) svc.logs.shift();
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!process.stdout.isTTY) return;

  const W = process.stdout.columns || 120;
  const H = process.stdout.rows || 30;
  const LOG_H = H - 4;
  // Total log area width = W - sidebar - border char.
  // Log content = ' ' + text, so truncate budget = LOG_W - 1.
  const LOG_W = W - SIDEBAR_W - 1;

  const out = [];
  const p = (s) => out.push(s);
  const at = (r, c) => `\x1b[${r};${c}H`;

  // ── Header ──────────────────────────────────────────────────────────────────
  p(at(1, 1));
  const title = `${BOLD}${fg(37)} Paseo Dev ${RESET}`;
  let hints;
  if (inputMode) {
    hints = `${INVERT} INPUT MODE ${RESET}${DIM}  Esc → back to TUI${RESET}`;
  } else if (metroUrl) {
    const badge = metroUrl.tunnel ? `${fg(32)}tunnel${RESET}` : `${fg(32)}local${RESET}`;
    hints = `${badge} ${DIM}exp: ${RESET}${fg(32)}${metroUrl.expo}${RESET}  ${DIM}web: ${metroUrl.web}  [q] quit${RESET}`;
  } else {
    hints = `${DIM}[↑↓] switch  [i] input  [r] restart  [g/G] scroll  [q] quit${RESET}`;
  }
  const titleLen = 11;
  const hintsLen = stripAnsi(hints).length;
  const gap = Math.max(1, W - titleLen - hintsLen);
  p(title + " ".repeat(gap) + hints + "\x1b[K");

  // ── Top border ──────────────────────────────────────────────────────────────
  p(at(2, 1));
  const borderColor = inputMode ? fg(33) : DIM; // yellow border in input mode
  p(`${borderColor}${"─".repeat(SIDEBAR_W)}┬${"─".repeat(W - SIDEBAR_W - 1)}${RESET}\x1b[K`);

  // ── Body ────────────────────────────────────────────────────────────────────
  const sel = services[selectedIdx];
  const logLines = sel?.logs ?? [];
  const totalLines = logLines.length;
  const maxScroll = Math.max(0, totalLines - LOG_H);
  const clampedScroll = Math.min(scrollOffset, maxScroll);
  const logStart = Math.max(0, totalLines - LOG_H - clampedScroll);

  for (let i = 0; i < LOG_H; i++) {
    p(at(3 + i, 1));

    // ── Sidebar cell ──────────────────────────────────────────────────────────
    const svc = services[i];
    if (svc) {
      const active = i === selectedIdx;
      const arrow = active ? `${BOLD}${fg(svc.color)}▶${RESET} ` : "  ";
      const label = truncateAnsi(
        `${active ? BOLD : ""}${fg(svc.color)}${svc.label}${RESET}`,
        SIDEBAR_W - 6,
      );
      const dot = STATUS_DOT[svc.status] ?? STATUS_DOT.starting;
      const num = `${DIM}${i + 1}${RESET}`;
      const rawLabelLen = Math.min(svc.label.length, SIDEBAR_W - 6);
      const pad = Math.max(0, SIDEBAR_W - 2 - 2 - rawLabelLen - 1 - 1);
      p(`${num} ${arrow}${label} ${dot}${" ".repeat(pad)}`);
    } else {
      p(" ".repeat(SIDEBAR_W));
    }

    // ── Border ────────────────────────────────────────────────────────────────
    p(`${borderColor}│${RESET}`);

    // ── Log line ──────────────────────────────────────────────────────────────
    const lineIdx = logStart + i;
    if (lineIdx >= 0 && lineIdx < logLines.length) {
      p(" " + truncateAnsi(logLines[lineIdx], LOG_W - 1) + "\x1b[K");
    } else {
      p("\x1b[K");
    }
  }

  // ── Bottom border ─────────────────────────────────────────────────────────
  p(at(H - 1, 1));
  p(`${borderColor}${"─".repeat(SIDEBAR_W)}┴${"─".repeat(W - SIDEBAR_W - 1)}${RESET}\x1b[K`);

  // ── Status bar ────────────────────────────────────────────────────────────
  p(at(H, 1));
  const selLabel = sel ? `${fg(sel.color)}${sel.label}${RESET}` : "";
  const selState = sel
    ? `${DIM}${sel.status}${sel.exitCode != null ? ` · exit ${sel.exitCode}` : ""}${
        sel.restarts > 0 ? ` · ↺${sel.restarts}` : ""
      }${RESET}`
    : "";
  const scrollBadge =
    clampedScroll > 0
      ? `  ${DIM}↑ ${clampedScroll} lines${RESET}`
      : `  ${DIM}following${RESET}`;
  const homeLabel = `${DIM}${PASEO_HOME}${RESET}`;
  const left = `  ${selLabel} ${selState}${scrollBadge}`;
  const statusPad = Math.max(
    0,
    W - stripAnsi(left).length - stripAnsi(homeLabel).length - 1,
  );
  p(left + " ".repeat(statusPad) + homeLabel + "\x1b[K");

  process.stdout.write(out.join(""));
}

// ── Keyboard input ────────────────────────────────────────────────────────────

function setupInput() {
  if (!process.stdin.isTTY) return;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");

  const PAGE = () => Math.max(1, (process.stdout.rows || 30) - 4);

  process.stdin.on("data", (key) => {
    // ── Input mode: forward everything to the selected process ───────────────
    if (inputMode) {
      if (key === "\x1b") {
        // Esc → exit input mode
        inputMode = false;
        scheduleRender(true);
        return;
      }
      // Ctrl+C in input mode: send SIGINT to child, don't quit TUI
      if (key === "\x03") {
        const svc = services[selectedIdx];
        if (svc?.proc) {
          try {
            svc.proc.kill("SIGINT");
          } catch {}
        }
        return;
      }
      // Forward keystroke to selected service stdin (PTY or pipe)
      const svc = services[selectedIdx];
      if (svc?.proc) {
        try {
          if (svc.usePty) {
            svc.proc.write(key); // node-pty API
          } else if (svc.proc.stdin && !svc.proc.stdin.destroyed) {
            svc.proc.stdin.write(key);
          }
        } catch {}
      }
      return;
    }

    // ── Normal mode: TUI controls ─────────────────────────────────────────────

    // Quit
    if (key === "q" || key === "\x03" || key === "\x04") {
      cleanup();
      return;
    }
    // Enter input mode (i or Enter)
    if (key === "i" || key === "\r") {
      const svc = services[selectedIdx];
      if (svc?.proc) {
        inputMode = true;
        scheduleRender(true);
      }
      return;
    }
    // Select previous (↑ or k)
    if (key === "\x1b[A" || key === "k") {
      selectedIdx = (selectedIdx - 1 + services.length) % services.length;
      scrollOffset = 0;
      scheduleRender(true);
    }
    // Select next (↓ or j)
    if (key === "\x1b[B" || key === "j") {
      selectedIdx = (selectedIdx + 1) % services.length;
      scrollOffset = 0;
      scheduleRender(true);
    }
    // Scroll up (u or PgUp)
    if (key === "u" || key === "\x1b[5~") {
      scrollOffset += PAGE();
      scheduleRender(true);
    }
    // Scroll down (d or PgDn)
    if (key === "d" || key === "\x1b[6~") {
      scrollOffset = Math.max(0, scrollOffset - PAGE());
      scheduleRender(true);
    }
    // Go to top (g)
    if (key === "g") {
      scrollOffset = MAX_LOG_LINES;
      scheduleRender(true);
    }
    // Go to bottom / follow (G)
    if (key === "G") {
      scrollOffset = 0;
      scheduleRender(true);
    }
    // Restart selected (r)
    if (key === "r") {
      const svc = services[selectedIdx];
      if (svc) {
        svc.restarts++;
        if (svc.key === "metro") { metroUrl = null; metroTunnelMode = false; }
        pushLine(svc, `${DIM}↺ restarting...${RESET}`);
        spawnService(svc);
        scheduleRender(true);
      }
    }
    // Number keys 1-9: jump to service
    const num = parseInt(key, 10);
    if (!isNaN(num) && num >= 1 && num <= services.length) {
      selectedIdx = num - 1;
      scrollOffset = 0;
      scheduleRender(true);
    }
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

let cleanupCalled = false;

function killService(svc) {
  if (!svc.proc) return;
  const proc = svc.proc;
  svc.proc = null;
  try {
    if (svc.usePty) {
      // node-pty has its own kill method
      proc.kill("SIGTERM");
    } else {
      // Kill the entire process group (negative pid) to catch all grandchildren
      // e.g. npm → tsx → node
      const pid = proc.pid;
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try { process.kill(pid, "SIGTERM"); } catch {}
      }
    }
  } catch {}
}

function killAll() {
  for (const svc of services) {
    killService(svc);
  }
}

function cleanup() {
  if (cleanupCalled) return;
  cleanupCalled = true;

  killAll();

  // Restore terminal state
  try { process.stdout.write("\x1b[?25h\x1b[?1049l"); } catch {}
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}

  process.exit(0);
}

// 'exit' fires last — only kill children here, don't call process.exit() again
process.on("exit", killAll);

// Terminal closed / SSH disconnected
process.on("SIGHUP", cleanup);
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
process.on("uncaughtException", (err) => {
  cleanup();
  console.error(err);
  process.exit(1);
});

process.stdout.on("resize", () => {
  // Resize any active PTY processes to match the new log pane dimensions
  const cols = Math.max(80, (process.stdout.columns || 120) - SIDEBAR_W - 2);
  const rows = Math.max(24, (process.stdout.rows || 30) - 4);
  for (const svc of services) {
    if (svc.usePty && svc.proc) {
      try { svc.proc.resize(cols, rows); } catch {}
    }
  }
  scheduleRender(true);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l");

setupInput();

for (const svc of services) {
  pushLine(svc, `${DIM}▶ starting ${svc.label}...${RESET}`);
}

if (REMOTE_MODE) {
  const daemonSvc = services.find((s) => s.key === "daemon");
  if (daemonSvc) {
    pushLine(daemonSvc, `\x1b[32m✦ Remote mode — Tailscale IP: ${TAILSCALE_IP}${RESET}`);
    pushLine(daemonSvc, `${DIM}  Daemon:   ${DAEMON_HOST}${RESET}`);
    pushLine(daemonSvc, `${DIM}  App:      http://${TAILSCALE_IP}:8090${RESET}`);
    pushLine(daemonSvc, `${DIM}  Electron: EXPO_DEV_URL=http://${TAILSCALE_IP}:8090 npx electron packages/desktop${RESET}`);
  }
}

for (const svc of services) {
  spawnService(svc);
}

scheduleRender();
