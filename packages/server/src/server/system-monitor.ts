import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { execCommand } from "../utils/spawn.js";

export type PortEntry = {
  port: number;
  pid: number | null;
  process: string;
  framework: string | null;
  uptimeSeconds: number | null;
  status: "healthy" | "unknown";
};

export type SystemResources = {
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  loadAvg1m: number | null;
};

export type SystemMonitorData = {
  ports: PortEntry[];
  resources: SystemResources;
};

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Array<{ match: RegExp; label: string }> = [
  { match: /next[-_]?(?:js|server|dev)/i, label: "Next.js" },
  { match: /nuxt/i, label: "Nuxt" },
  { match: /vite/i, label: "Vite" },
  { match: /webpack(?:-dev)?-server/i, label: "Webpack" },
  { match: /react[-_]?scripts/i, label: "Create React App" },
  { match: /nestjs|nest(?:\s|$)/i, label: "NestJS" },
  { match: /fastify/i, label: "Fastify" },
  { match: /express/i, label: "Express" },
  { match: /django/i, label: "Django" },
  { match: /flask/i, label: "Flask" },
  { match: /uvicorn|gunicorn/i, label: "Python WSGI" },
  { match: /ruby|rails|puma/i, label: "Rails" },
  { match: /java|spring/i, label: "Spring" },
  { match: /golang|go\s+run/i, label: "Go" },
  { match: /postgres|postgresql/i, label: "PostgreSQL" },
  { match: /mysql|mariadb/i, label: "MySQL" },
  { match: /mongod/i, label: "MongoDB" },
  { match: /redis-server|redis/i, label: "Redis" },
  { match: /localstack/i, label: "LocalStack" },
  { match: /nginx/i, label: "Nginx" },
  { match: /apache2|httpd/i, label: "Apache" },
  { match: /docker/i, label: "Docker" },
  { match: /node/i, label: "Node.js" },
  { match: /python3?/i, label: "Python" },
  { match: /ruby/i, label: "Ruby" },
];

function detectFramework(processName: string, cmdline?: string): string | null {
  const haystack = [processName, cmdline ?? ""].join(" ").toLowerCase();
  for (const { match, label } of FRAMEWORK_PATTERNS) {
    if (match.test(haystack)) {
      return label;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Listening ports — Linux (ss)
// ---------------------------------------------------------------------------

async function getLinuxPortsViaSs(): Promise<PortEntry[]> {
  // ss -tlnp: TCP, listening, numeric ports, with process info
  const { stdout } = await execCommand("ss", ["-tlnp"], { timeout: 8000 });

  const entries: PortEntry[] = [];

  for (const line of stdout.split("\n")) {
    // Example line:
    // LISTEN  0  128  0.0.0.0:3000  0.0.0.0:*  users:(("node",pid=1234,fd=10))
    if (!line.startsWith("LISTEN")) {
      continue;
    }

    const portMatch = line.match(/:(\d+)\s+\S+:\*/);
    if (!portMatch) {
      continue;
    }
    const port = parseInt(portMatch[1], 10);
    if (!port) {
      continue;
    }

    let pid: number | null = null;
    let processName = "unknown";
    const usersMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (usersMatch) {
      processName = usersMatch[1];
      pid = parseInt(usersMatch[2], 10);
    }

    let cmdline: string | undefined;
    if (pid) {
      try {
        const raw = await readFile(`/proc/${pid}/cmdline`, "utf8");
        cmdline = raw.replace(/\0/g, " ").trim();
      } catch {
        // process may have exited
      }
    }

    let uptimeSeconds: number | null = null;
    if (pid) {
      try {
        const statRaw = await readFile(`/proc/${pid}/stat`, "utf8");
        const fields = statRaw.split(" ");
        const startTimeTicks = parseInt(fields[21] ?? "0", 10);
        const uptimeRaw = await readFile("/proc/uptime", "utf8");
        const systemUptimeSec = parseFloat(uptimeRaw.split(" ")[0] ?? "0");
        const hertz = 100; // USER_HZ is almost always 100
        const processStartSec = startTimeTicks / hertz;
        uptimeSeconds = Math.max(0, Math.floor(systemUptimeSec - processStartSec));
      } catch {
        // ignore
      }
    }

    entries.push({
      port,
      pid,
      process: processName,
      framework: detectFramework(processName, cmdline),
      uptimeSeconds,
      status: "healthy",
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Listening ports — macOS / other Unix (lsof)
// ---------------------------------------------------------------------------

async function getMacOsPortsViaLsof(): Promise<PortEntry[]> {
  const { stdout } = await execCommand("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P", "-F", "pcn"], {
    timeout: 10000,
  });

  // lsof -F output format:
  // p<pid>
  // c<command>
  // n<host:port>
  type LsofRecord = { pid: number; command: string; ports: number[] };
  const records: LsofRecord[] = [];
  let current: Partial<LsofRecord> = {};

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const indicator = line[0];
    const value = line.slice(1);
    if (indicator === "p") {
      current = { pid: parseInt(value, 10), ports: [] };
      records.push(current as LsofRecord);
    } else if (indicator === "c") {
      if (current) {
        current.command = value;
      }
    } else if (indicator === "n") {
      const portMatch = value.match(/:(\d+)$/);
      if (portMatch && current.ports) {
        current.ports.push(parseInt(portMatch[1], 10));
      }
    }
  }

  const entries: PortEntry[] = [];
  for (const record of records) {
    if (!record.pid || !record.command || !record.ports?.length) {
      continue;
    }

    let uptimeSeconds: number | null = null;
    try {
      const { stdout: psOut } = await execCommand(
        "ps",
        ["-p", String(record.pid), "-o", "etimes="],
        { timeout: 3000 },
      );
      const parsed = parseInt(psOut.trim(), 10);
      if (!Number.isNaN(parsed)) {
        uptimeSeconds = parsed;
      }
    } catch {
      // ignore
    }

    for (const port of record.ports) {
      entries.push({
        port,
        pid: record.pid,
        process: record.command,
        framework: detectFramework(record.command),
        uptimeSeconds,
        status: "healthy",
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// System resources — Linux (/proc)
// ---------------------------------------------------------------------------

async function getLinuxResources(): Promise<SystemResources> {
  // CPU: take two samples 200ms apart for an instant reading
  async function readCpuStats(): Promise<{
    idle: number;
    total: number;
  }> {
    const raw = await readFile("/proc/stat", "utf8");
    const cpuLine = raw.split("\n").find((l) => l.startsWith("cpu ")) ?? "";
    const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
    // user, nice, system, idle, iowait, irq, softirq, steal
    const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
    const total = parts.reduce((s, v) => s + v, 0);
    return { idle, total };
  }

  const [s1] = await Promise.all([readCpuStats(), new Promise((r) => setTimeout(r, 200))]);
  const s2 = await readCpuStats();

  const idleDelta = s2.idle - s1.idle;
  const totalDelta = s2.total - s1.total;
  const cpuPercent = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 100) : 0;

  // Memory
  let memUsedBytes: number | null = null;
  let memTotalBytes: number | null = null;
  try {
    const memRaw = await readFile("/proc/meminfo", "utf8");
    const parse = (key: string) => {
      const m = memRaw.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
      return m ? parseInt(m[1], 10) * 1024 : null;
    };
    const total = parse("MemTotal");
    const available = parse("MemAvailable");
    if (total !== null && available !== null) {
      memTotalBytes = total;
      memUsedBytes = total - available;
    }
  } catch {
    // ignore
  }

  // Load average
  let loadAvg1m: number | null = null;
  try {
    const loadRaw = await readFile("/proc/loadavg", "utf8");
    loadAvg1m = parseFloat(loadRaw.split(" ")[0] ?? "0");
  } catch {
    // ignore
  }

  return { cpuPercent, memUsedBytes, memTotalBytes, loadAvg1m };
}

// ---------------------------------------------------------------------------
// System resources — macOS
// ---------------------------------------------------------------------------

async function getMacOsResources(): Promise<SystemResources> {
  let cpuPercent: number | null = null;
  let memUsedBytes: number | null = null;
  let memTotalBytes: number | null = null;
  let loadAvg1m: number | null = null;

  // CPU via iostat (quick 1-second sample)
  try {
    const { stdout } = await execCommand("iostat", ["-c", "2", "-w", "1"], { timeout: 5000 });
    // Last line has the averages; columns: cpu user sys idle
    const lines = stdout.trim().split("\n").filter(Boolean);
    const lastLine = lines[lines.length - 1] ?? "";
    const parts = lastLine.trim().split(/\s+/);
    // iostat on macOS: cpu user sys idle - indices vary, try last 3
    const idle = parseFloat(parts[parts.length - 1] ?? "");
    if (!Number.isNaN(idle)) {
      cpuPercent = Math.round(100 - idle);
    }
  } catch {
    // fallback: try top
    try {
      const { stdout } = await execCommand("top", ["-l", "1", "-n", "0"], { timeout: 5000 });
      const cpuLine = stdout.split("\n").find((l) => l.startsWith("CPU usage"));
      if (cpuLine) {
        const idleMatch = cpuLine.match(/([\d.]+)%\s+idle/);
        if (idleMatch) {
          cpuPercent = Math.round(100 - parseFloat(idleMatch[1]));
        }
      }
    } catch {
      // ignore
    }
  }

  // Memory via sysctl
  try {
    const { stdout: totalOut } = await execCommand("sysctl", ["-n", "hw.memsize"], {
      timeout: 3000,
    });
    memTotalBytes = parseInt(totalOut.trim(), 10) || null;
  } catch {
    // ignore
  }

  try {
    const { stdout: vmOut } = await execCommand("vm_stat", [], { timeout: 3000 });
    const parse = (key: string) => {
      const m = vmOut.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1], 10) : null;
    };
    const pageSize = 16384; // macOS default page size
    const free = parse("Pages free");
    const inactive = parse("Pages inactive");
    const speculative = parse("Pages speculative");
    if (free !== null && memTotalBytes !== null) {
      const freeBytes = (free + (inactive ?? 0) + (speculative ?? 0)) * pageSize;
      memUsedBytes = memTotalBytes - freeBytes;
    }
  } catch {
    // ignore
  }

  // Load average via uptime
  try {
    const { stdout } = await execCommand("sysctl", ["-n", "vm.loadavg"], { timeout: 3000 });
    // output: "{ 1.23 0.45 0.67 }"
    const m = stdout.match(/\{\s*([\d.]+)/);
    if (m) {
      loadAvg1m = parseFloat(m[1]);
    }
  } catch {
    // ignore
  }

  return { cpuPercent, memUsedBytes, memTotalBytes, loadAvg1m };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getListeningPorts(): Promise<PortEntry[]> {
  try {
    if (platform() === "linux") {
      return await getLinuxPortsViaSs();
    }
    return await getMacOsPortsViaLsof();
  } catch {
    return [];
  }
}

export async function getSystemResources(): Promise<SystemResources> {
  try {
    if (platform() === "linux") {
      return await getLinuxResources();
    }
    return await getMacOsResources();
  } catch {
    return { cpuPercent: null, memUsedBytes: null, memTotalBytes: null, loadAvg1m: null };
  }
}

export async function getSystemMonitorData(): Promise<SystemMonitorData> {
  const [ports, resources] = await Promise.all([getListeningPorts(), getSystemResources()]);
  return { ports, resources };
}
