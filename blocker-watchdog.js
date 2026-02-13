"use strict";

const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

function toBoundedInt(value, minVal, maxVal, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minVal, Math.min(maxVal, Math.round(n)));
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function hasItems(value) {
  return Array.isArray(value) && value.some(item => String(item || "").trim());
}

function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const parts = timeStr.split(":").map(Number);
  if (parts.length < 2) return null;
  const hh = parts[0];
  const mm = parts[1];
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return Math.max(0, Math.min(1440, (hh * 60) + mm));
}

function nowMinutes(nowDate) {
  return (nowDate.getHours() * 60) + nowDate.getMinutes();
}

function isTimeInsideWindow(minuteNow, startMinute, endMinute) {
  if (startMinute === endMinute) return true;
  if (startMinute < endMinute) return minuteNow >= startMinute && minuteNow < endMinute;
  return minuteNow >= startMinute || minuteNow < endMinute;
}

function computeScheduleActive(cfg, nowTs = Date.now()) {
  const schedule = asObject(cfg && cfg.schedule, {});
  const rawDays = Array.isArray(schedule.days) ? schedule.days : [];
  const days = rawDays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  if (!days.length) return false;
  const startMins = timeToMinutes(schedule.startTime);
  const endMins = timeToMinutes(schedule.endTime);
  if (startMins === null || endMins === null) return false;
  const now = new Date(nowTs);
  const currentDay = now.getDay();
  const previousDay = (currentDay + 6) % 7;
  const minuteNow = nowMinutes(now);
  const daySet = new Set(days);
  if (startMins === endMins) return daySet.has(currentDay);
  if (startMins < endMins) return daySet.has(currentDay) && isTimeInsideWindow(minuteNow, startMins, endMins);
  if (minuteNow >= startMins) return daySet.has(currentDay);
  return daySet.has(previousDay) && minuteNow < endMins;
}

function shouldArmWatchdog(cfg, nowTs = Date.now()) {
  const incoming = asObject(cfg, {});
  const runtime = asObject(incoming.runtime, {});
  const blockedActive = Number(runtime.blockedUntilTs || 0) > nowTs;
  const lockoutActive = Number(runtime.lockoutUntilTs || 0) > nowTs;
  const frozenActive = Number(runtime.frozenUntilTs || 0) > nowTs;
  const sessionActive = Number(incoming.sessionUntilTs || 0) > nowTs;
  const scheduleActive = computeScheduleActive(incoming, nowTs);
  const alwaysOn = typeof incoming.alwaysOn === "boolean" ? incoming.alwaysOn : true;
  const mainArmed = !!(incoming.enabled && (alwaysOn || scheduleActive || sessionActive || blockedActive || lockoutActive || frozenActive));

  const pornGroup = asObject(incoming.pornGroup, {});
  const pornEnabled = typeof pornGroup.enabled === "boolean" ? pornGroup.enabled : !!incoming.pornBlockEnabled;
  const pornAlwaysOn = typeof pornGroup.alwaysOn === "boolean" ? pornGroup.alwaysOn : true;
  const pornHasRules = hasItems(pornGroup.blockedDomains)
    || hasItems(pornGroup.blockedKeywords)
    || hasItems(pornGroup.blockedSearchTerms)
    || hasItems(pornGroup.customKeywords)
    || hasItems(incoming.pornKeywords);
  const pornArmed = !!(pornEnabled && pornAlwaysOn && pornHasRules);
  const extensionGuardEnabled = !!asObject(incoming.extensionGuard).enabled;

  return mainArmed || pornArmed || sessionActive || blockedActive || lockoutActive || frozenActive || extensionGuardEnabled;
}

function parseArgsFromEnv(value) {
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(v => String(v)) : [];
  } catch (_) {
    return [];
  }
}

const APP_PATH = String(process.env.TRAJECTORY_WATCHDOG_APP_PATH || "");
const APP_ARGS = parseArgsFromEnv(process.env.TRAJECTORY_WATCHDOG_APP_ARGS_JSON || "");
const CONFIG_PATH = String(process.env.TRAJECTORY_WATCHDOG_CONFIG_PATH || "");
const OWNER_PID = Number(process.env.TRAJECTORY_WATCHDOG_OWNER_PID || 0);
const POLL_MS = toBoundedInt(process.env.TRAJECTORY_WATCHDOG_POLL_MS, 1000, 60000, 2500);
const RELAUNCH_COOLDOWN_MS = toBoundedInt(process.env.TRAJECTORY_WATCHDOG_RELAUNCH_COOLDOWN_MS, 4000, 120000, 9000);

let timerId = null;
let tickBusy = false;
let shuttingDown = false;
let lastLaunchTs = 0;

function readConfig() {
  try {
    if (!CONFIG_PATH || !fs.existsSync(CONFIG_PATH)) return null;
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function runPowerShell(command, { timeoutMs = 2500 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", String(command || "")],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 128 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(String(stdout || "").trim());
      }
    );
  });
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function isTargetAppRunning() {
  if (!APP_PATH) return Promise.resolve(false);
  const appName = path.basename(APP_PATH);
  if (!appName) return Promise.resolve(false);
  const escapedName = appName.replace(/'/g, "''");
  const escapedPath = APP_PATH.replace(/'/g, "''");
  const psScript = `
$targetName = '${escapedName}'
$targetPath = '${escapedPath}'
$targetRegex = [regex]::Escape($targetPath)
$found = $false
$procs = Get-CimInstance Win32_Process -Filter "Name='$targetName'" -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  $exe = [string]$p.ExecutablePath
  if (-not [string]::IsNullOrWhiteSpace($exe) -and [string]::Equals($exe, $targetPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    $found = $true
    break
  }
  $cmd = [string]$p.CommandLine
  if (-not [string]::IsNullOrWhiteSpace($cmd) -and $cmd -match $targetRegex) {
    $found = $true
    break
  }
}
if (-not $found) {
  $shortName = [System.IO.Path]::GetFileNameWithoutExtension($targetName)
  $fallback = Get-Process -Name $shortName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($fallback) { $found = $true }
}
if ($found) { '1' } else { '0' }
`;
  return runPowerShell(psScript, { timeoutMs: 3000 })
    .then(out => String(out || "").trim() === "1")
    .catch(() => false);
}

function relaunchApp() {
  if (!APP_PATH || !fs.existsSync(APP_PATH)) return false;
  try {
    const child = spawn(APP_PATH, APP_ARGS, {
      cwd: path.dirname(APP_PATH),
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  process.exit(exitCode);
}

async function runTick() {
  if (tickBusy || shuttingDown) return;
  tickBusy = true;
  try {
    const cfg = readConfig();
    if (!shouldArmWatchdog(cfg)) {
      shutdown(0);
      return;
    }

    const running = await isTargetAppRunning();
    const ownerAlive = isPidAlive(OWNER_PID);

    if (ownerAlive) return;

    if (running && OWNER_PID > 0 && !ownerAlive) {
      shutdown(0);
      return;
    }

    if (running) return;

    const nowTs = Date.now();
    if ((nowTs - lastLaunchTs) < RELAUNCH_COOLDOWN_MS) return;

    if (relaunchApp()) {
      lastLaunchTs = nowTs;
    }
  } catch (_) {
    // Keep watchdog alive; intermittent OS command failures are expected.
  } finally {
    tickBusy = false;
  }
}

process.on("message", (msg) => {
  if (msg && msg.type === "shutdown") shutdown(0);
});
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("uncaughtException", () => {
  shutdown(1);
});

if (!APP_PATH || !CONFIG_PATH) {
  shutdown(0);
} else {
  timerId = setInterval(() => {
    void runTick();
  }, POLL_MS);
  void runTick();
}
