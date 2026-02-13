"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ENFORCEMENT_MIN_POLL_SECS = 1;
const ENFORCEMENT_MAX_POLL_SECS = 30;
const ENFORCEMENT_REPEAT_GRACE_MS = 15 * 1000;
const ENFORCEMENT_BROWSER_PROCESSES = [
  "chrome",
  "msedge",
  "firefox",
  "brave",
  "opera",
  "opera_gx",
  "arc"
];
const PORN_DEFAULT_BLOCKED_DOMAINS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "redtube.com",
  "youporn.com",
  "xhamster.com",
  "spankbang.com",
  "rule34.xxx"
];
const PORN_DEFAULT_BLOCKED_KEYWORDS = [
  "porn",
  "porno",
  "pornography",
  "pornhub",
  "xvideos",
  "xnxx",
  "redtube",
  "youporn",
  "xhamster",
  "spankbang",
  "rule34",
  "hentai",
  "nsfw"
];
const PORN_DEFAULT_SEARCH_TERMS = [
  "porn",
  "porno",
  "pornography",
  "xxx",
  "hentai",
  "blowjob",
  "milf",
  "onlyfans",
  "camgirl"
];
const SEARCH_ENGINE_HINTS = [
  "google search",
  "bing",
  "duckduckgo",
  "yahoo search",
  "search results"
];
const EXTENSION_GUARD_BROWSERS = ["chrome", "edge", "brave"];
const EXTENSION_GUARD_CHECK_MIN_SECS = 2;
const EXTENSION_GUARD_CHECK_MAX_SECS = 30;
const EXTENSION_GUARD_PAGE_OPEN_COOLDOWN_MS = 8000;
const EXTENSION_GUARD_PREFS_RELATIVE_PATHS = {
  chrome: ["Google", "Chrome", "User Data", "Default", "Preferences"],
  edge: ["Microsoft", "Edge", "User Data", "Default", "Preferences"],
  brave: ["BraveSoftware", "Brave-Browser", "User Data", "Default", "Preferences"]
};

function toBoundedInt(v, minVal, maxVal, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minVal, Math.min(maxVal, Math.round(n)));
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function toList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map(x => x.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqLowerList(items) {
  const set = new Set();
  toList(items).forEach(raw => {
    const v = String(raw || "").trim().toLowerCase();
    if (v) set.add(v);
  });
  return Array.from(set);
}

function normalizeProcessName(name) {
  let v = String(name || "").trim().toLowerCase();
  if (!v) return "";
  if (v.endsWith(".exe")) v = v.slice(0, -4);
  return v;
}

function processDisplayName(name) {
  const base = normalizeProcessName(name);
  if (!base) return "";
  return `${base}.exe`;
}

function firstMatchInText(text, patterns) {
  const src = String(text || "").toLowerCase();
  if (!src) return "";
  for (const p of uniqLowerList(patterns)) {
    if (p && src.includes(p)) return p;
  }
  return "";
}

function normalizePornGroupConfig(rawGroup, legacyKeywords = []) {
  const incoming = rawGroup && typeof rawGroup === "object" ? rawGroup : {};
  const customKeywords = uniqLowerList(
    incoming.customKeywords && incoming.customKeywords.length
      ? incoming.customKeywords
      : legacyKeywords
  );
  return {
    enabled: typeof incoming.enabled === "boolean" ? incoming.enabled : true,
    alwaysOn: typeof incoming.alwaysOn === "boolean" ? incoming.alwaysOn : true,
    blockedDomains: uniqLowerList(incoming.blockedDomains || PORN_DEFAULT_BLOCKED_DOMAINS),
    blockedKeywords: uniqLowerList(incoming.blockedKeywords || PORN_DEFAULT_BLOCKED_KEYWORDS),
    blockedSearchTerms: uniqLowerList(incoming.blockedSearchTerms || PORN_DEFAULT_SEARCH_TERMS),
    customKeywords
  };
}

function looksLikeSearchPageText(srcLower) {
  const src = String(srcLower || "").toLowerCase();
  if (!src) return false;
  if (SEARCH_ENGINE_HINTS.some(h => src.includes(h))) return true;
  return src.includes("?q=") || src.includes("&q=") || src.includes("search?q=") || src.includes("query=");
}

function findDomainMatchInText(textLower, domains) {
  const src = String(textLower || "").toLowerCase();
  if (!src) return "";
  const domainList = uniqLowerList(domains || []);
  for (const domainRaw of domainList) {
    const domain = domainRaw.replace(/^https?:\/\//, "").replace(/^www\./, "").trim();
    if (!domain) continue;
    if (src.includes(domain)) return domainRaw;
    if (src.includes(`www.${domain}`)) return domainRaw;
  }
  return "";
}

function findPornMatchInTitle(titleLower, pornGroup) {
  const src = String(titleLower || "").toLowerCase();
  if (!src) return null;
  const group = normalizePornGroupConfig(pornGroup);
  if (!group.enabled) return null;

  const domainMatch = findDomainMatchInText(src, group.blockedDomains);
  if (domainMatch) return { type: "domain", token: domainMatch };

  const customMatch = firstMatchInText(src, group.customKeywords || []);
  if (customMatch) return { type: "custom", token: customMatch };

  const keywordMatch = firstMatchInText(src, group.blockedKeywords || []);
  if (keywordMatch) return { type: "keyword", token: keywordMatch };

  if (!looksLikeSearchPageText(src)) return null;
  const searchMatch = firstMatchInText(src, group.blockedSearchTerms || []);
  if (searchMatch) return { type: "search", token: searchMatch };
  return null;
}

function isPornGroupAlwaysOn(cfg) {
  const group = normalizePornGroupConfig(cfg && cfg.pornGroup, cfg && cfg.pornKeywords);
  return !!(group.enabled && group.alwaysOn);
}

function isBrowserProcess(name) {
  const normalized = normalizeProcessName(name);
  return ENFORCEMENT_BROWSER_PROCESSES.includes(normalized);
}

function normalizeGuardBrowser(value, fallback = "chrome") {
  const next = String(value || fallback || "chrome").trim().toLowerCase();
  return EXTENSION_GUARD_BROWSERS.includes(next) ? next : fallback;
}

function getGuardBrowserProcessCandidates(browser) {
  const target = normalizeGuardBrowser(browser);
  if (target === "edge") return ["msedge"];
  if (target === "brave") return ["brave"];
  return ["chrome"];
}

function normalizePathValue(rawPath) {
  const raw = String(rawPath || "").trim();
  if (!raw) return "";
  try {
    return path.resolve(raw).replace(/[\\/]+/g, "/").toLowerCase();
  } catch (_) {
    return raw.replace(/[\\/]+/g, "/").toLowerCase();
  }
}

function resolveGuardUserDataPath(browser) {
  const target = normalizeGuardBrowser(browser);
  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) return "";
  const relPath = EXTENSION_GUARD_PREFS_RELATIVE_PATHS[target] || EXTENSION_GUARD_PREFS_RELATIVE_PATHS.chrome;
  const userDataRel = relPath.slice(0, Math.max(1, relPath.length - 2));
  try {
    return path.join(localAppData, ...userDataRel);
  } catch (_) {
    return "";
  }
}

function readProfileDirsFromLocalState(userDataPath) {
  const basePath = String(userDataPath || "").trim();
  if (!basePath) return [];
  const localStatePath = path.join(basePath, "Local State");
  if (!fs.existsSync(localStatePath)) return [];
  try {
    const raw = fs.readFileSync(localStatePath, "utf8");
    const parsed = raw ? JSON.parse(raw) : null;
    const infoCache = asObject(asObject(parsed).profile).info_cache;
    const keys = Object.keys(asObject(infoCache, {})).filter(Boolean);
    return keys.map(v => String(v || "").trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function resolveGuardPreferencesPaths(browser) {
  const userDataPath = resolveGuardUserDataPath(browser);
  if (!userDataPath || !fs.existsSync(userDataPath)) {
    return { userDataPath, prefsPaths: [] };
  }
  const candidateDirs = new Set(["Default"]);
  readProfileDirsFromLocalState(userDataPath).forEach(dir => candidateDirs.add(dir));

  try {
    const entries = fs.readdirSync(userDataPath, { withFileTypes: true });
    entries.forEach(entry => {
      if (!entry || !entry.isDirectory()) return;
      const dirName = String(entry.name || "").trim();
      if (!dirName || dirName.startsWith(".")) return;
      const prefsPath = path.join(userDataPath, dirName, "Preferences");
      if (fs.existsSync(prefsPath)) candidateDirs.add(dirName);
    });
  } catch (_) {}

  const prefsPaths = [];
  candidateDirs.forEach(dirName => {
    try {
      const prefsPath = path.join(userDataPath, dirName, "Preferences");
      if (fs.existsSync(prefsPath)) prefsPaths.push(prefsPath);
    } catch (_) {}
  });
  return { userDataPath, prefsPaths };
}

function isExtensionsManagerTitle(title, browser) {
  const target = normalizeGuardBrowser(browser);
  const titleLower = String(title || "").toLowerCase();
  if (!titleLower) return false;
  const schemeToken = `${target}://extensions`;
  if (titleLower.includes(schemeToken)) return true;
  const hasExtensionsWord = titleLower.includes("extension");
  if (!hasExtensionsWord) return false;
  if (target === "edge") return titleLower.includes("edge");
  if (target === "brave") return titleLower.includes("brave");
  return titleLower.includes("chrome");
}

function getExtensionManagerUrl(browser) {
  const target = normalizeGuardBrowser(browser);
  if (target === "edge") return "edge://extensions";
  if (target === "brave") return "brave://extensions";
  return "chrome://extensions";
}

function getBrowserExecutableCandidates(browser) {
  const target = normalizeGuardBrowser(browser);
  if (target === "edge") {
    return [
      path.join(String(process.env["ProgramFiles(x86)"] || ""), "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(String(process.env.ProgramFiles || ""), "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(String(process.env.LOCALAPPDATA || ""), "Microsoft", "Edge", "Application", "msedge.exe")
    ];
  }
  if (target === "brave") {
    return [
      path.join(String(process.env.ProgramFiles || ""), "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(String(process.env["ProgramFiles(x86)"] || ""), "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(String(process.env.LOCALAPPDATA || ""), "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
    ];
  }
  return [
    path.join(String(process.env.ProgramFiles || ""), "Google", "Chrome", "Application", "chrome.exe"),
    path.join(String(process.env["ProgramFiles(x86)"] || ""), "Google", "Chrome", "Application", "chrome.exe"),
    path.join(String(process.env.LOCALAPPDATA || ""), "Google", "Chrome", "Application", "chrome.exe")
  ];
}

function openExtensionManagerPage(browser, { force = false } = {}) {
  const nowTs = Date.now();
  if (!force && (nowTs - lastExtensionGuardPageOpenTs) < EXTENSION_GUARD_PAGE_OPEN_COOLDOWN_MS) {
    return Promise.resolve(false);
  }
  lastExtensionGuardPageOpenTs = nowTs;

  const target = normalizeGuardBrowser(browser);
  const url = getExtensionManagerUrl(target);
  const candidates = getBrowserExecutableCandidates(target)
    .map(p => String(p || "").trim())
    .filter(Boolean);
  const escapedUrl = url.replace(/'/g, "''");
  const escapedPaths = candidates.map(p => `'${p.replace(/'/g, "''")}'`).join(", ");
  const script = `
$url = '${escapedUrl}'
$launched = $false
$paths = @(${escapedPaths})
foreach ($p in $paths) {
  if ([string]::IsNullOrWhiteSpace($p)) { continue }
  if (Test-Path $p) {
    try {
      Start-Process -FilePath $p -ArgumentList $url -ErrorAction Stop | Out-Null
      $launched = $true
      break
    } catch {}
  }
}
if (-not $launched) {
  try {
    Start-Process $url -ErrorAction Stop | Out-Null
    $launched = $true
  } catch {}
}
if ($launched) { '1' } else { '0' }
`;
  return runPowerShell(script, { timeoutMs: 2800 })
    .then(out => String(out || "").trim() === "1")
    .catch(() => false);
}

function readGuardExtensionState(guardCfg) {
  const guard = asObject(guardCfg, {});
  const browser = normalizeGuardBrowser(guard.browser, "chrome");
  const { prefsPaths } = resolveGuardPreferencesPaths(browser);
  const expectedPath = normalizePathValue(guard.requiredExtensionPath || guard.extensionPath);

  if (!prefsPaths.length) {
    return {
      ok: false,
      browser,
      installed: false,
      enabled: false,
      reason: "browser-preferences-not-found"
    };
  }

  let parseSuccessCount = 0;
  let hasMatchedInstall = false;
  let hasMatchedEnabled = false;
  let matchedExtensionId = "";

  for (const prefsPath of prefsPaths) {
    let parsed = null;
    try {
      const raw = fs.readFileSync(prefsPath, "utf8");
      parsed = raw ? JSON.parse(raw) : null;
      parseSuccessCount += 1;
    } catch (_) {
      continue;
    }

    const extensionsNode = asObject(asObject(asObject(parsed).extensions).settings, {});
    for (const [extensionId, entryRaw] of Object.entries(extensionsNode)) {
      const entry = asObject(entryRaw, {});
      const manifest = asObject(entry.manifest, {});
      const entryPath = normalizePathValue(entry.path || manifest.path || "");
      const entryName = String(manifest.name || entry.name || "").toLowerCase();
      const matchesPath = expectedPath && entryPath && entryPath === expectedPath;
      const looksLikeTrajectory = entryName.includes("trajectory") && entryName.includes("blocker");
      if (!matchesPath && !looksLikeTrajectory) continue;

      hasMatchedInstall = true;
      matchedExtensionId = matchedExtensionId || String(extensionId || "");
      const stateNum = Number(entry.state);
      const disableReasons = Number(entry.disable_reasons || 0);
      const blacklisted = Number(entry.blacklist || 0) !== 0;
      const enabled = stateNum === 1 && disableReasons === 0 && !blacklisted;
      if (enabled) {
        hasMatchedEnabled = true;
        break;
      }
    }
    if (hasMatchedEnabled) break;
  }

  if (!parseSuccessCount) {
    return {
      ok: false,
      browser,
      installed: false,
      enabled: false,
      reason: "browser-preferences-read-failed"
    };
  }

  if (!hasMatchedInstall) {
    return {
      ok: true,
      browser,
      installed: false,
      enabled: false,
      reason: "extension-missing"
    };
  }

  return {
    ok: true,
    browser,
    installed: true,
    enabled: hasMatchedEnabled,
    extensionId: matchedExtensionId,
    reason: hasMatchedEnabled ? "extension-enabled" : "extension-disabled"
  };
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

function getDefaultEnforcementState() {
  return {
    enabled: false,
    alwaysOn: true,
    pollEverySecs: 2,
    softNudgeEverySecs: 45,
    schedule: {
      startTime: "16:00",
      endTime: "21:00",
      days: [1, 2, 3, 4, 5]
    },
    sessionUntilTs: 0,
    runtime: {
      blockedUntilTs: 0,
      lockoutUntilTs: 0,
      frozenUntilTs: 0
    },
    pornBlockEnabled: true, // legacy alias; mirrors pornGroup.enabled
    pornKeywords: [], // legacy alias; mirrors pornGroup.customKeywords
    pornGroup: {
      enabled: true,
      alwaysOn: true,
      blockedDomains: PORN_DEFAULT_BLOCKED_DOMAINS.slice(),
      blockedKeywords: PORN_DEFAULT_BLOCKED_KEYWORDS.slice(),
      blockedSearchTerms: PORN_DEFAULT_SEARCH_TERMS.slice(),
      customKeywords: []
    },
    extensionGuard: {
      enabled: true,
      browser: "chrome",
      requireInstalled: true,
      checkEverySecs: 3,
      requiredExtensionPath: ""
    },
    blockedProcesses: [
      "robloxplayerbeta",
      "discord",
      "steam",
      "epicgameslauncher"
    ],
    blockedTitleKeywords: [
      "roblox",
      "twitch",
      "netflix",
      "instagram"
    ],
    hardBlockedProcesses: [],
    hardBlockedKeywords: [],
    escalation: {
      killProcessOnBlock: true
    }
  };
}

function normalizeEnforcementConfig(rawCfg) {
  const defaults = getDefaultEnforcementState();
  const incoming = rawCfg && typeof rawCfg === "object" ? rawCfg : {};
  const cfg = {};
  cfg.enabled = !!incoming.enabled;
  cfg.alwaysOn = typeof incoming.alwaysOn === "boolean" ? incoming.alwaysOn : defaults.alwaysOn;
  cfg.pollEverySecs = toBoundedInt(incoming.pollEverySecs, ENFORCEMENT_MIN_POLL_SECS, ENFORCEMENT_MAX_POLL_SECS, defaults.pollEverySecs);
  cfg.softNudgeEverySecs = toBoundedInt(incoming.softNudgeEverySecs, 10, 600, defaults.softNudgeEverySecs);
  cfg.schedule = incoming.schedule && typeof incoming.schedule === "object" ? incoming.schedule : {};
  cfg.schedule.startTime = typeof cfg.schedule.startTime === "string" ? cfg.schedule.startTime : defaults.schedule.startTime;
  cfg.schedule.endTime = typeof cfg.schedule.endTime === "string" ? cfg.schedule.endTime : defaults.schedule.endTime;
  cfg.schedule.days = uniqLowerList(cfg.schedule.days || defaults.schedule.days)
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  if (!cfg.schedule.days.length) cfg.schedule.days = defaults.schedule.days.slice();

  cfg.sessionUntilTs = Number(incoming.sessionUntilTs) || 0;
  cfg.runtime = incoming.runtime && typeof incoming.runtime === "object" ? incoming.runtime : {};
  cfg.runtime.blockedUntilTs = Number(cfg.runtime.blockedUntilTs) || 0;
  cfg.runtime.lockoutUntilTs = Number(cfg.runtime.lockoutUntilTs) || 0;
  cfg.runtime.frozenUntilTs = Number(cfg.runtime.frozenUntilTs) || 0;

  cfg.pornBlockEnabled = typeof incoming.pornBlockEnabled === "boolean" ? incoming.pornBlockEnabled : defaults.pornBlockEnabled;
  cfg.pornKeywords = uniqLowerList(incoming.pornKeywords || defaults.pornKeywords);
  cfg.pornGroup = normalizePornGroupConfig(incoming.pornGroup || {}, cfg.pornKeywords);
  if (typeof incoming.pornBlockEnabled === "boolean") {
    cfg.pornGroup.enabled = !!incoming.pornBlockEnabled;
  }
  cfg.pornBlockEnabled = !!cfg.pornGroup.enabled;
  cfg.pornKeywords = uniqLowerList(cfg.pornGroup.customKeywords || []);
  cfg.extensionGuard = incoming.extensionGuard && typeof incoming.extensionGuard === "object"
    ? incoming.extensionGuard
    : {};
  cfg.extensionGuard.enabled = typeof cfg.extensionGuard.enabled === "boolean"
    ? cfg.extensionGuard.enabled
    : defaults.extensionGuard.enabled;
  cfg.extensionGuard.browser = normalizeGuardBrowser(
    cfg.extensionGuard.browser,
    defaults.extensionGuard.browser
  );
  cfg.extensionGuard.requireInstalled = typeof cfg.extensionGuard.requireInstalled === "boolean"
    ? cfg.extensionGuard.requireInstalled
    : defaults.extensionGuard.requireInstalled;
  cfg.extensionGuard.checkEverySecs = toBoundedInt(
    cfg.extensionGuard.checkEverySecs,
    EXTENSION_GUARD_CHECK_MIN_SECS,
    EXTENSION_GUARD_CHECK_MAX_SECS,
    defaults.extensionGuard.checkEverySecs
  );
  cfg.extensionGuard.requiredExtensionPath = String(
    cfg.extensionGuard.requiredExtensionPath
    || cfg.extensionGuard.extensionPath
    || defaults.extensionGuard.requiredExtensionPath
    || ""
  ).trim();
  cfg.blockedProcesses = uniqLowerList(incoming.blockedProcesses || defaults.blockedProcesses).map(normalizeProcessName).filter(Boolean);
  cfg.blockedTitleKeywords = uniqLowerList(incoming.blockedTitleKeywords || defaults.blockedTitleKeywords);
  cfg.hardBlockedProcesses = uniqLowerList(incoming.hardBlockedProcesses || defaults.hardBlockedProcesses).map(normalizeProcessName).filter(Boolean);
  cfg.hardBlockedKeywords = uniqLowerList(incoming.hardBlockedKeywords || defaults.hardBlockedKeywords);
  cfg.escalation = incoming.escalation && typeof incoming.escalation === "object" ? incoming.escalation : {};
  cfg.escalation.killProcessOnBlock = typeof cfg.escalation.killProcessOnBlock === "boolean"
    ? cfg.escalation.killProcessOnBlock
    : defaults.escalation.killProcessOnBlock;
  return cfg;
}

let enforcementCfg = normalizeEnforcementConfig(getDefaultEnforcementState());
let pollTimerId = null;
let pollTimerMs = 0;
let tickBusy = false;
let isShuttingDown = false;
let lastFingerprint = "";
let lastFingerprintTs = 0;
let lastSoftPopupTs = 0;
let lastHardPopupTs = 0;
let lastExtensionGuardCheckTs = 0;
let lastExtensionGuardPageOpenTs = 0;

function emitToParent(type, payload) {
  if (!process || typeof process.send !== "function") return;
  try {
    process.send(Object.assign({ type, ts: Date.now() }, payload || {}));
  } catch (_) {}
}

function runPowerShell(command, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", String(command || "")],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 256 * 1024 },
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

function showSystemPopup(message, { title = "Trajectory Blocker", seconds = 4, force = false, hard = false } = {}) {
  const nowTs = Date.now();
  const gateMs = hard ? 3000 : 10000;
  const lastTs = hard ? lastHardPopupTs : lastSoftPopupTs;
  if (!force && nowTs - lastTs < gateMs) return;
  if (hard) lastHardPopupTs = nowTs;
  else lastSoftPopupTs = nowTs;

  const safeMessage = String(message || "").replace(/'/g, "''");
  const safeTitle = String(title || "").replace(/'/g, "''");
  const timeoutSecs = toBoundedInt(seconds, 1, 20, 4);
  const script = `$ws = New-Object -ComObject WScript.Shell; $null = $ws.Popup('${safeMessage}', ${timeoutSecs}, '${safeTitle}', 4144)`;
  execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script],
    { windowsHide: true, timeout: 3500, maxBuffer: 64 * 1024 },
    () => {}
  );
}

function getForegroundWindowSnapshot() {
  const psScript = `
$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ActiveWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue | Out-Null
$h = [ActiveWin]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { return }
[IntPtr]$target = $h
$root = [ActiveWin]::GetAncestor($h, 2)
if ($root -ne [IntPtr]::Zero) { $target = $root }
[uint32]$focusPid = 0
[ActiveWin]::GetWindowThreadProcessId($h, [ref]$focusPid) | Out-Null
[uint32]$procId = 0
[ActiveWin]::GetWindowThreadProcessId($target, [ref]$procId) | Out-Null
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
if (-not $proc) { return }
$sb = New-Object System.Text.StringBuilder 2048
[void][ActiveWin]::GetWindowText($target, $sb, $sb.Capacity)
$title = $sb.ToString()
if ([string]::IsNullOrWhiteSpace($title)) { $title = $proc.MainWindowTitle }
if ($null -eq $title) { $title = "" }
[PSCustomObject]@{
  process = $proc.ProcessName
  pid = $procId
  focusPid = $focusPid
  hwnd = [Int64]$target
  title = $title
} | ConvertTo-Json -Compress
`;
  return runPowerShell(psScript, { timeoutMs: 2800 })
    .then(out => {
      if (!out) return null;
      try {
        const parsed = JSON.parse(out);
        return {
          process: String(parsed.process || ""),
          pid: Number(parsed.pid || 0),
          focusPid: Number(parsed.focusPid || 0),
          hwnd: Number(parsed.hwnd || 0),
          title: String(parsed.title || "")
        };
      } catch (_) {
        return null;
      }
    })
    .catch(() => null);
}

function closeActiveBrowserTabByPid(pid, { attempts = 1, hwnd = 0 } = {}) {
  if (!pid && !hwnd) return Promise.resolve(false);
  const loops = toBoundedInt(attempts, 1, 8, 1);
  const pidNum = Number(pid || 0);
  const hwndNum = Number(hwnd || 0);
  const script = `
$ok = $false
$loops = ${loops}
$targetPid = ${pidNum}
$h = [IntPtr]::Zero
if (${hwndNum} -gt 0) { $h = [IntPtr]${hwndNum} }
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class NativeTabCloser {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const byte VK_CONTROL = 0x11;
  public const byte VK_W = 0x57;
  public const byte VK_F4 = 0x73;
  public const uint WM_COMMAND = 0x0111;
  public const uint IDC_CLOSE_TAB = 34015;
  public static void SendCtrlW() {
    keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
    keybd_event(VK_W, 0, 0, UIntPtr.Zero);
    keybd_event(VK_W, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
  public static void SendCtrlF4() {
    keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
    keybd_event(VK_F4, 0, 0, UIntPtr.Zero);
    keybd_event(VK_F4, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue | Out-Null

function Focus-Target {
  param([IntPtr]$Handle, [int]$Pid)
  if ($Handle -ne [IntPtr]::Zero -and [NativeTabCloser]::IsWindow($Handle)) {
    [uint32]$targetPidInner = 0
    $targetTid = [NativeTabCloser]::GetWindowThreadProcessId($Handle, [ref]$targetPidInner)
    $fg = [NativeTabCloser]::GetForegroundWindow()
    [uint32]$fgPidInner = 0
    [uint32]$fgTid = 0
    if ($fg -ne [IntPtr]::Zero) { $fgTid = [NativeTabCloser]::GetWindowThreadProcessId($fg, [ref]$fgPidInner) }
    $curTid = [NativeTabCloser]::GetCurrentThreadId()
    $attachedCur = $false
    $attachedFg = $false
    try {
      if ($targetTid -ne 0 -and $curTid -ne $targetTid) {
        $attachedCur = [NativeTabCloser]::AttachThreadInput([uint32]$curTid, [uint32]$targetTid, $true)
      }
      if ($targetTid -ne 0 -and $fgTid -ne 0 -and $fgTid -ne $targetTid) {
        $attachedFg = [NativeTabCloser]::AttachThreadInput([uint32]$fgTid, [uint32]$targetTid, $true)
      }
      [void][NativeTabCloser]::ShowWindow($Handle, 9)
      [void][NativeTabCloser]::BringWindowToTop($Handle)
      [void][NativeTabCloser]::SetActiveWindow($Handle)
      [void][NativeTabCloser]::SetFocus($Handle)
      [void][NativeTabCloser]::SetForegroundWindow($Handle)
      Start-Sleep -Milliseconds 180
      return $true
    } finally {
      if ($attachedFg) { [void][NativeTabCloser]::AttachThreadInput([uint32]$fgTid, [uint32]$targetTid, $false) }
      if ($attachedCur) { [void][NativeTabCloser]::AttachThreadInput([uint32]$curTid, [uint32]$targetTid, $false) }
    }
  }
  if ($Pid -gt 0) {
    try {
      $ws = New-Object -ComObject WScript.Shell
      if ($ws.AppActivate($Pid)) {
        Start-Sleep -Milliseconds 140
        return $true
      }
    } catch {}
  }
  return $false
}

$ok = Focus-Target -Handle $h -Pid $targetPid
if ($ok) {
  for ($i = 0; $i -lt $loops; $i++) {
    if ($h -ne [IntPtr]::Zero -and [NativeTabCloser]::IsWindow($h)) {
      [void][NativeTabCloser]::PostMessage($h, [NativeTabCloser]::WM_COMMAND, [UIntPtr][NativeTabCloser]::IDC_CLOSE_TAB, [IntPtr]::Zero)
      [void][NativeTabCloser]::SetForegroundWindow($h)
      Start-Sleep -Milliseconds 70
    }
    [NativeTabCloser]::SendCtrlW()
    try {
      Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue | Out-Null
      [System.Windows.Forms.SendKeys]::SendWait('^w')
    } catch {}
    Start-Sleep -Milliseconds 90
    [NativeTabCloser]::SendCtrlF4()
    Start-Sleep -Milliseconds 160
  }
}
if ($ok) { '1' } else { '0' }
`;
  return runPowerShell(script, { timeoutMs: 4200 })
    .then(out => String(out || "").trim() === "1")
    .catch(() => false);
}

function killProcessByPid(pid) {
  if (!pid) return Promise.resolve(false);
  return new Promise(resolve => {
    execFile(
      "taskkill.exe",
      ["/PID", String(pid), "/F", "/T"],
      { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024 },
      err => resolve(!err)
    );
  });
}

function killProcessByName(name) {
  const image = processDisplayName(name);
  if (!image) return Promise.resolve(false);
  return new Promise(resolve => {
    execFile(
      "taskkill.exe",
      ["/IM", image, "/F", "/T"],
      { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024 },
      err => resolve(!err)
    );
  });
}

function evaluatePornGroupViolation(snapshot, cfg) {
  if (!snapshot || !cfg) return null;
  const processName = normalizeProcessName(snapshot.process);
  const titleLower = String(snapshot.title || "").toLowerCase();
  if (!processName && !titleLower) return null;
  if (processName.includes("trajectory")) return null;
  if (processName === "electron" && titleLower.includes("trajectory")) return null;

  const group = normalizePornGroupConfig(cfg.pornGroup, cfg.pornKeywords);
  if (!group.enabled) return null;
  const match = findPornMatchInTitle(titleLower, group);
  if (!match) return null;
  const reasonMap = {
    domain: `Porn domain "${match.token}" matched.`,
    custom: `Custom porn term "${match.token}" matched.`,
    keyword: `Porn keyword "${match.token}" matched.`,
    search: `Porn search term "${match.token}" matched.`
  };
  return {
    severity: "hard",
    type: "porn",
    reason: reasonMap[match.type] || `Porn signal "${match.token}" matched.`
  };
}

function evaluateExtensionGuardViolation(snapshot, cfg, nowTs = Date.now()) {
  if (!snapshot || !cfg) return null;
  const guard = asObject(cfg.extensionGuard, {});
  if (!guard.enabled) return null;

  const browser = normalizeGuardBrowser(guard.browser, "chrome");
  const processName = normalizeProcessName(snapshot.process);
  if (!processName) return null;
  const guardedProcessSet = new Set(getGuardBrowserProcessCandidates(browser));
  if (!guardedProcessSet.has(processName)) return null;
  if (isExtensionsManagerTitle(snapshot.title, browser)) {
    // Don't harass while user is actively in extensions manager fixing the issue.
    lastExtensionGuardPageOpenTs = nowTs;
    return null;
  }

  const checkMs = toBoundedInt(
    guard.checkEverySecs,
    EXTENSION_GUARD_CHECK_MIN_SECS,
    EXTENSION_GUARD_CHECK_MAX_SECS,
    3
  ) * 1000;
  if ((nowTs - lastExtensionGuardCheckTs) < checkMs) return null;
  lastExtensionGuardCheckTs = nowTs;

  const status = readGuardExtensionState(guard);
  if (!status.ok) return null;
  if (!status.installed && !guard.requireInstalled) return null;
  if (status.installed && status.enabled) return null;

  const browserLabel = status.browser === "edge"
    ? "Edge"
    : status.browser === "brave"
      ? "Brave"
      : "Chrome";
  const reason = !status.installed
    ? `Trajectory browser blocker extension is missing in ${browserLabel}.`
    : `Trajectory browser blocker extension is disabled in ${browserLabel}.`;

  return {
    severity: "hard",
    type: "extension-guard",
    reason,
    browser: status.browser || browser,
    extensionState: status.reason || ""
  };
}

function evaluateDirectHardViolation(snapshot, cfg, { pornOnly = false } = {}) {
  if (!snapshot) return null;
  const processName = normalizeProcessName(snapshot.process);
  const titleLower = String(snapshot.title || "").toLowerCase();
  const hardProcessSet = new Set(uniqLowerList(cfg.hardBlockedProcesses || []).map(normalizeProcessName).filter(Boolean));

  if (!processName && !titleLower) return null;
  if (processName.includes("trajectory")) return null;
  if (processName === "electron" && titleLower.includes("trajectory")) return null;

  const pornViolation = evaluatePornGroupViolation(snapshot, cfg);
  if (pornViolation) return pornViolation;
  if (pornOnly) return null;

  if (hardProcessSet.has(processName)) {
    return {
      severity: "hard",
      type: "hard-process",
      reason: `${processDisplayName(snapshot.process)} is hard-blocked.`
    };
  }

  const hardKeywordMatch = firstMatchInText(titleLower, cfg.hardBlockedKeywords || []);
  if (hardKeywordMatch) {
    return {
      severity: "hard",
      type: "hard-keyword",
      reason: `Hard keyword "${hardKeywordMatch}" matched.`
    };
  }
  return null;
}

function evaluateSoftViolation(snapshot, cfg) {
  if (!snapshot) return null;
  const processName = normalizeProcessName(snapshot.process);
  const titleLower = String(snapshot.title || "").toLowerCase();
  if (!processName && !titleLower) return null;
  if (processName.includes("trajectory")) return null;
  if (processName === "electron" && titleLower.includes("trajectory")) return null;

  const blockedProcess = uniqLowerList(cfg.blockedProcesses || [])
    .map(normalizeProcessName)
    .filter(Boolean)
    .includes(processName);
  if (blockedProcess) {
    return {
      severity: "soft",
      type: "blocked-process",
      reason: `${processDisplayName(snapshot.process)} is blocked during focus.`
    };
  }

  const keyword = firstMatchInText(titleLower, cfg.blockedTitleKeywords || []);
  if (keyword) {
    return {
      severity: "soft",
      type: "blocked-keyword",
      reason: `Blocked keyword "${keyword}" matched.`
    };
  }
  return null;
}

function computeScheduleActive(cfg, nowTs) {
  const now = new Date(nowTs);
  const startMins = timeToMinutes(cfg.schedule && cfg.schedule.startTime);
  const endMins = timeToMinutes(cfg.schedule && cfg.schedule.endTime);
  const days = Array.isArray(cfg.schedule && cfg.schedule.days) ? cfg.schedule.days : [];
  if (startMins === null || endMins === null || !days.length) return false;
  const currentDay = now.getDay();
  const previousDay = (currentDay + 6) % 7;
  const minuteNow = nowMinutes(now);
  const daySet = new Set(days.map(Number));
  if (startMins === endMins) return daySet.has(currentDay);
  if (startMins < endMins) return daySet.has(currentDay) && isTimeInsideWindow(minuteNow, startMins, endMins);
  if (minuteNow >= startMins) return daySet.has(currentDay);
  return daySet.has(previousDay) && minuteNow < endMins;
}

function isEnforcementActive(cfg, nowTs = Date.now()) {
  if (!cfg) return false;
  const rt = cfg.runtime || {};
  const blockedActive = Number(rt.blockedUntilTs || 0) > nowTs;
  const lockoutActive = Number(rt.lockoutUntilTs || 0) > nowTs;
  const frozenActive = Number(rt.frozenUntilTs || 0) > nowTs;
  const sessionActive = Number(cfg.sessionUntilTs || 0) > nowTs;
  const scheduleActive = computeScheduleActive(cfg, nowTs);
  const mainActive = !!(cfg.enabled && (cfg.alwaysOn || scheduleActive || sessionActive || lockoutActive || blockedActive || frozenActive));
  const extensionGuardEnabled = !!asObject(cfg.extensionGuard).enabled;
  return mainActive || isPornGroupAlwaysOn(cfg) || extensionGuardEnabled;
}

async function enforceHardViolation(snapshot, violation, cfg) {
  if (violation && violation.type === "extension-guard") {
    const browser = normalizeGuardBrowser(
      violation.browser || asObject(cfg.extensionGuard).browser,
      "chrome"
    );
    const processCandidates = getGuardBrowserProcessCandidates(browser);
    const extensionPageUrl = getExtensionManagerUrl(browser);
    const openedManager = await openExtensionManagerPage(browser);
    const action = openedManager ? "extension-guard-opened-manager" : "extension-guard-nag";
    const msg = `${violation.reason} Re-enable it now at ${extensionPageUrl}.`;
    showSystemPopup(msg, { title: "Trajectory Extension Lock", seconds: 7, force: false, hard: true });
    emitToParent("event", {
      level: "hard",
      reason: violation.reason,
      process: processCandidates.map(processDisplayName).filter(Boolean).join(", "),
      title: "",
      action
    });
    return;
  }

  if (!snapshot) return;
  const processName = normalizeProcessName(snapshot.process);
  const browser = isBrowserProcess(processName);
  let action = "popup-only";
  let tabClosed = false;
  let rendererKilled = false;
  let killed = false;
  if (browser && (violation.type === "porn" || violation.type === "hard-keyword")) {
    tabClosed = await closeActiveBrowserTabByPid(snapshot.pid, {
      attempts: 3,
      hwnd: snapshot.hwnd
    });
    if (!tabClosed) {
      const focusPid = Number(snapshot.focusPid || 0);
      const browserPid = Number(snapshot.pid || 0);
      if (focusPid && browserPid && focusPid !== browserPid) {
        rendererKilled = await killProcessByPid(focusPid);
      }
    }
    if (tabClosed) action = "close-tab";
    else if (rendererKilled) action = "kill-renderer";
    else action = "close-tab-failed";
  } else if (browser && violation.type === "hard-process" && cfg.escalation.killProcessOnBlock) {
    killed = await killProcessByPid(snapshot.pid);
    if (!killed) killed = await killProcessByName(snapshot.process);
    action = killed ? "kill-browser" : "kill-browser-failed";
  } else {
    killed = await killProcessByPid(snapshot.pid);
    if (!killed) killed = await killProcessByName(snapshot.process);
    action = killed ? "kill-process" : "kill-process-failed";
  }

  const msg = `${violation.reason} Blocker intervened immediately.`;
  showSystemPopup(msg, { title: "Trajectory Hard Block", seconds: 8, force: true, hard: true });
  emitToParent("event", {
    level: "hard",
    reason: violation.reason,
    process: processDisplayName(snapshot.process),
    title: String(snapshot.title || ""),
    action
  });
}

function enforceSoftViolation(snapshot, violation, cfg, nowTs) {
  const minGapMs = Math.max(10, Number(cfg.softNudgeEverySecs || 45)) * 1000;
  if ((nowTs - lastSoftPopupTs) < minGapMs) return;
  const msg = `${violation.reason} Return to your plan now.`;
  showSystemPopup(msg, { title: "Trajectory Nudge", seconds: 4, force: false, hard: false });
  emitToParent("event", {
    level: "soft",
    reason: violation.reason,
    process: processDisplayName(snapshot.process),
    title: String(snapshot.title || ""),
    action: violation.type || "soft"
  });
}

async function runTick() {
  if (tickBusy || isShuttingDown) return;
  tickBusy = true;
  try {
    const nowTs = Date.now();
    const cfg = enforcementCfg;
    if (!isEnforcementActive(cfg, nowTs)) return;
    const pornOnlyMode = !cfg.enabled && isPornGroupAlwaysOn(cfg);
    const snapshot = await getForegroundWindowSnapshot();
    if (!snapshot) return;
    const extensionGuardHard = evaluateExtensionGuardViolation(snapshot, cfg, nowTs);
    const hard = extensionGuardHard || evaluateDirectHardViolation(snapshot, cfg, { pornOnly: pornOnlyMode });
    const soft = (hard || pornOnlyMode) ? null : evaluateSoftViolation(snapshot, cfg);
    const violation = hard || soft;
    if (!violation) return;

    const fingerprint = [
      violation.type || "",
      normalizeProcessName(snapshot.process),
      String(snapshot.title || "").toLowerCase().slice(0, 140)
    ].join("|");
    const isRepeat = fingerprint === lastFingerprint && (nowTs - lastFingerprintTs) < ENFORCEMENT_REPEAT_GRACE_MS;
    if (isRepeat && violation.severity === "soft") return;
    lastFingerprint = fingerprint;
    lastFingerprintTs = nowTs;

    if (violation.severity === "hard") {
      await enforceHardViolation(snapshot, violation, cfg);
      return;
    }
    enforceSoftViolation(snapshot, violation, cfg, nowTs);
  } catch (err) {
    emitToParent("error", { message: String(err && err.message ? err.message : err || "tick-failed") });
  } finally {
    tickBusy = false;
  }
}

function ensureTicker() {
  const targetMs = Math.max(
    ENFORCEMENT_MIN_POLL_SECS * 1000,
    Math.min(ENFORCEMENT_MAX_POLL_SECS * 1000, Number(enforcementCfg.pollEverySecs || 2) * 1000)
  );
  if (pollTimerId && pollTimerMs === targetMs) return;
  if (pollTimerId) {
    clearInterval(pollTimerId);
    pollTimerId = null;
    pollTimerMs = 0;
  }
  pollTimerMs = targetMs;
  pollTimerId = setInterval(() => {
    void runTick();
  }, targetMs);
  void runTick();
}

function applyIncomingConfig(nextConfig) {
  enforcementCfg = normalizeEnforcementConfig(nextConfig || {});
  ensureTicker();
  emitToParent("config-applied", {
    enabled: !!enforcementCfg.enabled,
    pollEverySecs: Number(enforcementCfg.pollEverySecs || 0)
  });
}

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (pollTimerId) {
    clearInterval(pollTimerId);
    pollTimerId = null;
  }
  emitToParent("stopped", {});
  process.exit(0);
}

process.on("message", (msg) => {
  const type = msg && msg.type ? String(msg.type) : "";
  if (type === "config") {
    applyIncomingConfig(msg.config || {});
    return;
  }
  if (type === "ping") {
    emitToParent("pong", {});
    return;
  }
  if (type === "shutdown") {
    shutdown();
  }
});

process.on("disconnect", () => {
  shutdown();
});
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

ensureTicker();
emitToParent("started", { pid: process.pid });
