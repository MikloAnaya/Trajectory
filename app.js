/**
 * Stage 2:
 * - Weekly calendar (Mon–Sun)
 * - Plan sprint objective + time budget
 * - Add commitments to specific days
 * - Move commitments between days (dropdown)
 * - Mark done
 * - "Today focus" auto-picks next best item
 * - Persist locally via localStorage
 */

const STORAGE_KEY = "trajectory_stage2_v2"; // bumped to allow schema additions
const SCHEMA_VERSION = 3;

let execFileSafe = null;
let spawnSafe = null;
let ipcRendererSafe = null;
let httpSafe = null;
let httpRequestSafe = null;
let httpsRequestSafe = null;
let shellSafe = null;
let clipboardSafe = null;
let fsSafe = null;
let pathSafe = null;
let osSafe = null;
try {
  ({ execFile: execFileSafe, spawn: spawnSafe } = require("child_process"));
} catch (err) {
  console.warn("child_process not available in renderer", err);
}
try {
  ({ ipcRenderer: ipcRendererSafe, shell: shellSafe, clipboard: clipboardSafe } = require("electron"));
} catch (err) {
  console.warn("ipcRenderer not available in renderer", err);
}
try {
  httpSafe = require("http");
  ({ request: httpRequestSafe } = httpSafe);
  ({ request: httpsRequestSafe } = require("https"));
} catch (err) {
  console.warn("http/https not available in renderer", err);
}
try {
  fsSafe = require("fs");
  pathSafe = require("path");
  osSafe = require("os");
} catch (err) {
  console.warn("fs/path/os not available in renderer", err);
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STAT_COLORS = {
  INT: "#0EA5E9",
  STR: "#F97316",
  DISC: "#22C55E",
  MONEY: "#F59E0B"
};
const COLOR_SWATCHES = [
  "#0EA5E9",
  "#14B8A6",
  "#22C55E",
  "#84CC16",
  "#F59E0B",
  "#F97316",
  "#EF4444",
  "#6366F1"
];

// Stat progression thresholds (XP) per attribute level.
// Levels: 0..5 (max), tuned to be challenging but reachable.
const ATTR_TIERS = [0, 40, 120, 260, 500, 900];

const defaultSprint = () => ({
  title: "Sprint — Weekly Plan",
  objective: "Ship at least one artifact + one clean writeup.",
  timeBudgetHours: 12,
  commitments: []
});

const state = loadState() ?? {
  view: "home", // "home" | "week" | "month" | "plan" | "stats" | "workout" | "blocker" | "settings"
  weekStartISO: toISO(getWeekStart(new Date())), // Monday ISO date
  sprints: {}, // { [weekStartISO]: Sprint }
};

// Defaults for runtime-only settings
const DAILY_WARN_HOURS = 4; // soft warning threshold per day
const PLAN_TIME_STEP_MINS = 5;
const PLAN_MIN_DURATION_MINS = 15;
const PLAN_DEFAULT_START_MINS = 9 * 60;
const TODAY_PLAN_TARGET_MINS = 5 * 60;

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
const BLOCKER_BG_IMAGES = [
  "./assets/blocker/blocker-1.jpg",
  "./assets/blocker/blocker-2.jpg",
  "./assets/blocker/blocker-3.jpg",
  "./assets/blocker/blocker-4.jpg",
  "./assets/blocker/blocker-5.jpg",
  "./assets/blocker/blocker-6.jpg",
  "./assets/blocker/blocker-7.jpg"
];
const BROWSER_BLOCKER_EXTENSION_REL_DIR = ["browser-extension", "trajectory-browser-blocker"];
const BROWSER_BLOCKER_SEARCH_HOSTS = [
  "google.com",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.com"
];
const EXTENSION_GUARD_BROWSERS = ["chrome", "edge", "brave"];
const EXTENSION_GUARD_MIN_CHECK_SECS = 2;
const EXTENSION_GUARD_MAX_CHECK_SECS = 30;
const EXTENSION_PLANNER_SYNC_HOST = "127.0.0.1";
const EXTENSION_PLANNER_SYNC_PORT = 38463;
const EXTENSION_PLANNER_SYNC_ROUTE = "/trajectory-extension-sync/v1/planner";
const EXTENSION_PLANNER_SYNC_HEALTH_ROUTE = "/trajectory-extension-sync/health";
const EXTENSION_PLANNER_SOURCE = "extension-planner";
const CANVAS_SYNC_MIN_MINS = 15;
const CANVAS_SYNC_MAX_MINS = 1440;
const CANVAS_AUTOPILOT_MIN_LEAD_DAYS = 1;
const CANVAS_AUTOPILOT_MAX_LEAD_DAYS = 30;
const CANVAS_AUTOPILOT_MIN_BLOCK_MINS = 15;
const CANVAS_AUTOPILOT_MAX_BLOCK_MINS = 240;
const CANVAS_AUTOPILOT_MIN_BLOCKS = 1;
const CANVAS_AUTOPILOT_MAX_BLOCKS = 8;
const CANVAS_AUTOPILOT_DEFAULT_QUIET_END_MINS = 22 * 60; // 10pm
const CANVAS_AUTOPILOT_MISSED_GRACE_MS = 5 * 60 * 1000;
const CANVAS_AUTOPILOT_BUMP_COOLDOWN_MS = 10 * 60 * 1000;
const CANVAS_AUTOPILOT_TICK_MS = 60 * 1000;
const MORNING_GATE_TICK_MS = 5 * 1000;
const CANVAS_FEED_DEFAULT_COLORS = {
  alamo: "#0EA5E9",
  utsa: "#F97316"
};

function cloneJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (err) {
    return null;
  }
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

const TASK_ICON_KEYS = new Set(["", "school", "dumbbell", "brain", "idea", "home"]);
const ICON_PICK_VALUES = new Set(["auto", "none", "school", "dumbbell", "brain", "idea", "home"]);

function normalizeTaskIconKey(v) {
  const key = String(v || "").trim().toLowerCase();
  return TASK_ICON_KEYS.has(key) ? key : "";
}

function normalizeIconPickerValue(v) {
  const key = String(v || "").trim().toLowerCase();
  return ICON_PICK_VALUES.has(key) ? key : "auto";
}

function inferTaskIconKey(c) {
  if (!c) return "";
  if (c.externalSource === "canvas" || c.canvasAutopilot) return "school";

  const title = String(c.title || "").toLowerCase();
  if (title.includes("homework") || title.includes("assignment") || title.includes("quiz") || title.includes("exam") || title.includes("discussion") || title.includes("chapter")) {
    return "school";
  }
  if (title.includes("gym") || title.includes("workout") || title.includes("lift") || title.includes("run") || title.includes("cardio")) {
    return "dumbbell";
  }
  if (title.includes("clean") || title.includes("laundry") || title.includes("dishes") || title.includes("room") || title.includes("house") || title.includes("home") || title.includes("fix") || title.includes("repair")) {
    return "home";
  }

  const stat = String(c.stat || "").toUpperCase();
  if (stat === "STR") return "dumbbell";
  if (stat === "INT") return "idea";
  if (stat === "DISC") return "brain";
  return "";
}

function getTaskIconKey(c) {
  if (!c) return "";
  // If an icon was explicitly set (including empty string = "none"), don't infer.
  if (Object.prototype.hasOwnProperty.call(c, "icon")) return normalizeTaskIconKey(c.icon);
  return inferTaskIconKey(c);
}

function renderTaskIconSvg(iconKey, { className = "", title = "" } = {}) {
  const key = normalizeTaskIconKey(iconKey);
  if (!key) return "";
  const cls = String(className || "").trim();
  const titleTag = title ? `<title>${escapeHtml(title)}</title>` : "";
  switch (key) {
    case "school":
      return `<svg class="task-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${titleTag}<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M7 10v6c0 1 2.5 3 5 3s5-2 5-3v-6"/><path d="M21 11v6"/></svg>`;
    case "dumbbell":
      return `<svg class="task-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${titleTag}<path d="M7 8v8"/><path d="M17 8v8"/><path d="M5 10v4"/><path d="M19 10v4"/><path d="M7 12h10"/></svg>`;
    case "brain":
      return `<svg class="task-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${titleTag}<path d="M9 4a3 3 0 00-3 3v1a3 3 0 000 6v1a3 3 0 003 3"/><path d="M15 4a3 3 0 013 3v1a3 3 0 010 6v1a3 3 0 01-3 3"/><path d="M9 7h.01"/><path d="M15 7h.01"/><path d="M12 4v16"/></svg>`;
    case "idea":
      return `<svg class="task-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${titleTag}<path d="M9 21h6"/><path d="M10 17h4"/><path d="M12 2a7 7 0 00-4 12c.7.6 1 1.3 1 2h6c0-.7.3-1.4 1-2a7 7 0 00-4-12z"/></svg>`;
    case "home":
      return `<svg class="task-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${titleTag}<path d="M14 3l7 7-3 3-7-7z"/><path d="M2 22l6-2-4-4-2 6z"/><path d="M6 16l8-8"/></svg>`;
    default:
      return "";
  }
}

function applyCommitIconUI(rawPickValue) {
  const pick = normalizeIconPickerValue(rawPickValue);
  const input = $("#cIcon");
  if (input) input.value = pick;

  document.querySelectorAll("#cIconPicker .icon-choice").forEach(btn => {
    const btnPick = normalizeIconPickerValue(btn.getAttribute("data-icon"));
    const isOn = btnPick === pick;
    btn.classList.toggle("icon-choice--selected", isOn);
    try { btn.setAttribute("aria-pressed", isOn ? "true" : "false"); } catch (_) {}
  });
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

function firstMatchInLowerText(textLower, patterns) {
  const src = String(textLower || "");
  if (!src) return "";
  if (Array.isArray(patterns)) {
    for (const p of patterns) {
      if (p && src.includes(p)) return p;
    }
    return "";
  }
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
  const domainList = Array.isArray(domains) ? domains : uniqLowerList(domains || []);
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
  const group = pornGroup && typeof pornGroup === "object" ? pornGroup : normalizePornGroupConfig(pornGroup);
  if (!group.enabled) return null;

  const domainMatch = findDomainMatchInText(src, group.blockedDomains);
  if (domainMatch) return { type: "domain", token: domainMatch };

  const customMatch = firstMatchInLowerText(src, group.customKeywords || []);
  if (customMatch) return { type: "custom", token: customMatch };

  const keywordMatch = firstMatchInLowerText(src, group.blockedKeywords || []);
  if (keywordMatch) return { type: "keyword", token: keywordMatch };

  if (!looksLikeSearchPageText(src)) return null;
  const searchMatch = firstMatchInLowerText(src, group.blockedSearchTerms || []);
  if (searchMatch) return { type: "search", token: searchMatch };
  return null;
}

function isPornGroupAlwaysOn(cfg) {
  const raw = cfg && cfg.pornGroup;
  if (raw && typeof raw === "object") {
    return !!(raw.enabled && raw.alwaysOn);
  }
  const group = normalizePornGroupConfig(cfg && cfg.pornGroup, cfg && cfg.pornKeywords);
  return !!(group.enabled && group.alwaysOn);
}

function normalizeTimeValue(v, fallback) {
  const mins = timeToMinutes(v);
  if (mins === null) return fallback;
  return minutesToTime(mins);
}

function toBoundedInt(v, minVal, maxVal, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minVal, Math.min(maxVal, Math.round(n)));
}

function getDefaultEnforcementState() {
  return {
    enabled: false,
    alwaysOn: true,
    strictMode: true,
    tone: "hard", // "normal" | "hard"
    pollEverySecs: 2,
    softNudgeEverySecs: 45,
    freezeDurationMins: 60,
    schedule: {
      startTime: "16:00",
      endTime: "21:00",
      days: [1, 2, 3, 4, 5] // Mon..Fri (JS getDay)
    },
    sessionDurationMins: 60,
    sessionUntilTs: 0,
    youtube: {
      enabled: true,
      requireIntentCheck: true,
      allowKeywords: [
        "tutorial",
        "lecture",
        "lesson",
        "homework",
        "study",
        "how to"
      ],
      allowMinutes: 12,
      lastIntentUntilTs: 0,
      lastIntentText: ""
    },
    pornBlockEnabled: true, // legacy alias; mirrors pornGroup.enabled
    pornKeywords: [], // legacy alias; mirrors pornGroup.customKeywords
    pornGroup: {
      enabled: true,
      alwaysOn: true,
      blockedDomains: cloneJson(PORN_DEFAULT_BLOCKED_DOMAINS),
      blockedKeywords: cloneJson(PORN_DEFAULT_BLOCKED_KEYWORDS),
      blockedSearchTerms: cloneJson(PORN_DEFAULT_SEARCH_TERMS),
      customKeywords: []
    },
    extensionGuard: {
      enabled: true,
      browser: "chrome",
      requireInstalled: true,
      checkEverySecs: 3,
      extensionPath: ""
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
    websiteMode: "blocklist", // "blocklist" | "allowlist"
    allowlistedTitleKeywords: [
      "docs",
      "homework",
      "course",
      "lecture",
      "tutorial",
      "research"
    ],
    allowlistedProcesses: [
      "code",
      "notion",
      "obsidian"
    ],
    escalation: {
      nudgeAfter: 1,
      lockoutAfter: 2,
      blockAfter: 3,
      cooldownMins: 30,
      lockoutMins: 5,
      blockMins: 15,
      killProcessOnBlock: true
    },
    prompts: {
      normal: {
        nudge: "You said this goal matters. Move back to your planned work.",
        lockout: "Pause the distraction and return to the task you committed to.",
        block: "Hard block engaged. Protect the next focused block."
      },
      hard: {
        nudge: "You said this matters. Act like it.",
        lockout: "This click is short-term dopamine over the goals you asked for.",
        block: "Future you pays for this. Block active. Get back to work now."
      },
      youtubeIntentQuestion: "What are you here to learn? (1 sentence)"
    },
    runtime: {
      strikeCount: 0,
      lastStrikeTs: 0,
      lockoutUntilTs: 0,
      blockedUntilTs: 0,
      frozenUntilTs: 0,
      lastSoftNudgeTs: 0,
      lastDetectionTs: 0,
      lastAction: "idle",
      lastReason: "",
      lastTitle: "",
      lastProcess: ""
    }
  };
}

function ensureEnforcementStateShape() {
  const defaults = getDefaultEnforcementState();
  if (!state.enforcement || typeof state.enforcement !== "object") {
    state.enforcement = cloneJson(defaults);
  }

  const e = state.enforcement;
  e.enabled = !!e.enabled;
  e.alwaysOn = typeof e.alwaysOn === "boolean" ? e.alwaysOn : defaults.alwaysOn;
  e.strictMode = typeof e.strictMode === "boolean" ? e.strictMode : defaults.strictMode;
  e.tone = e.tone === "normal" ? "normal" : "hard";
  e.pollEverySecs = toBoundedInt(
    e.pollEverySecs,
    ENFORCEMENT_MIN_POLL_SECS,
    ENFORCEMENT_MAX_POLL_SECS,
    defaults.pollEverySecs
  );
  e.softNudgeEverySecs = toBoundedInt(e.softNudgeEverySecs, 10, 600, defaults.softNudgeEverySecs);
  e.freezeDurationMins = toBoundedInt(e.freezeDurationMins, 5, 600, defaults.freezeDurationMins);

  e.schedule = e.schedule && typeof e.schedule === "object" ? e.schedule : {};
  e.schedule.startTime = normalizeTimeValue(
    e.schedule.startTime,
    defaults.schedule.startTime
  );
  e.schedule.endTime = normalizeTimeValue(
    e.schedule.endTime,
    defaults.schedule.endTime
  );
  const daySet = new Set(
    toList(e.schedule.days)
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
  );
  e.schedule.days = daySet.size ? Array.from(daySet).sort((a, b) => a - b) : cloneJson(defaults.schedule.days);

  e.sessionDurationMins = toBoundedInt(e.sessionDurationMins, 5, 600, defaults.sessionDurationMins);
  e.sessionUntilTs = Number(e.sessionUntilTs) || 0;

  e.youtube = e.youtube && typeof e.youtube === "object" ? e.youtube : {};
  e.youtube.enabled = typeof e.youtube.enabled === "boolean" ? e.youtube.enabled : defaults.youtube.enabled;
  e.youtube.requireIntentCheck = typeof e.youtube.requireIntentCheck === "boolean" ? e.youtube.requireIntentCheck : defaults.youtube.requireIntentCheck;
  e.youtube.allowKeywords = uniqLowerList(e.youtube.allowKeywords || defaults.youtube.allowKeywords);
  if (!e.youtube.allowKeywords.length) e.youtube.allowKeywords = cloneJson(defaults.youtube.allowKeywords);
  e.youtube.allowMinutes = toBoundedInt(e.youtube.allowMinutes, 1, 180, defaults.youtube.allowMinutes);
  e.youtube.lastIntentUntilTs = Number(e.youtube.lastIntentUntilTs) || 0;
  e.youtube.lastIntentText = String(e.youtube.lastIntentText || "");

  const hasLegacyPornEnabled = typeof e.pornBlockEnabled === "boolean";
  e.pornBlockEnabled = hasLegacyPornEnabled ? e.pornBlockEnabled : defaults.pornBlockEnabled;
  e.pornKeywords = uniqLowerList(e.pornKeywords || defaults.pornKeywords);
  e.pornGroup = normalizePornGroupConfig(
    e.pornGroup || {},
    e.pornKeywords
  );
  if (hasLegacyPornEnabled) {
    e.pornGroup.enabled = e.pornBlockEnabled;
  } else {
    e.pornBlockEnabled = !!e.pornGroup.enabled;
  }
  e.pornKeywords = uniqLowerList(e.pornGroup.customKeywords || []);
  e.pornBlockEnabled = !!e.pornGroup.enabled;
  e.extensionGuard = e.extensionGuard && typeof e.extensionGuard === "object" ? e.extensionGuard : {};
  e.extensionGuard.enabled = typeof e.extensionGuard.enabled === "boolean"
    ? e.extensionGuard.enabled
    : defaults.extensionGuard.enabled;
  const nextGuardBrowser = String(e.extensionGuard.browser || defaults.extensionGuard.browser).toLowerCase();
  e.extensionGuard.browser = EXTENSION_GUARD_BROWSERS.includes(nextGuardBrowser)
    ? nextGuardBrowser
    : defaults.extensionGuard.browser;
  e.extensionGuard.requireInstalled = typeof e.extensionGuard.requireInstalled === "boolean"
    ? e.extensionGuard.requireInstalled
    : defaults.extensionGuard.requireInstalled;
  e.extensionGuard.checkEverySecs = toBoundedInt(
    e.extensionGuard.checkEverySecs,
    EXTENSION_GUARD_MIN_CHECK_SECS,
    EXTENSION_GUARD_MAX_CHECK_SECS,
    defaults.extensionGuard.checkEverySecs
  );
  const detectedExtensionPath = getBrowserBlockerExtensionDir();
  e.extensionGuard.extensionPath = String(
    e.extensionGuard.extensionPath
    || detectedExtensionPath
    || defaults.extensionGuard.extensionPath
    || ""
  ).trim();
  e.blockedProcesses = uniqLowerList(e.blockedProcesses || defaults.blockedProcesses).map(normalizeProcessName).filter(Boolean);
  e.blockedTitleKeywords = uniqLowerList(e.blockedTitleKeywords || defaults.blockedTitleKeywords);
  e.hardBlockedProcesses = uniqLowerList(e.hardBlockedProcesses || defaults.hardBlockedProcesses).map(normalizeProcessName).filter(Boolean);
  e.hardBlockedKeywords = uniqLowerList(e.hardBlockedKeywords || defaults.hardBlockedKeywords);
  e.websiteMode = e.websiteMode === "allowlist" ? "allowlist" : "blocklist";
  e.allowlistedTitleKeywords = uniqLowerList(e.allowlistedTitleKeywords || defaults.allowlistedTitleKeywords);
  if (!e.allowlistedTitleKeywords.length) e.allowlistedTitleKeywords = cloneJson(defaults.allowlistedTitleKeywords);
  e.allowlistedProcesses = uniqLowerList(e.allowlistedProcesses || defaults.allowlistedProcesses).map(normalizeProcessName).filter(Boolean);

  e.escalation = e.escalation && typeof e.escalation === "object" ? e.escalation : {};
  e.escalation.nudgeAfter = toBoundedInt(e.escalation.nudgeAfter, 1, 20, defaults.escalation.nudgeAfter);
  e.escalation.lockoutAfter = toBoundedInt(
    e.escalation.lockoutAfter,
    e.escalation.nudgeAfter,
    30,
    defaults.escalation.lockoutAfter
  );
  e.escalation.blockAfter = toBoundedInt(
    e.escalation.blockAfter,
    e.escalation.lockoutAfter,
    60,
    defaults.escalation.blockAfter
  );
  e.escalation.cooldownMins = toBoundedInt(e.escalation.cooldownMins, 1, 240, defaults.escalation.cooldownMins);
  e.escalation.lockoutMins = toBoundedInt(e.escalation.lockoutMins, 1, 240, defaults.escalation.lockoutMins);
  e.escalation.blockMins = toBoundedInt(e.escalation.blockMins, 1, 720, defaults.escalation.blockMins);
  e.escalation.killProcessOnBlock = typeof e.escalation.killProcessOnBlock === "boolean"
    ? e.escalation.killProcessOnBlock
    : defaults.escalation.killProcessOnBlock;

  e.prompts = e.prompts && typeof e.prompts === "object" ? e.prompts : {};
  e.prompts.normal = e.prompts.normal && typeof e.prompts.normal === "object" ? e.prompts.normal : {};
  e.prompts.hard = e.prompts.hard && typeof e.prompts.hard === "object" ? e.prompts.hard : {};
  e.prompts.normal.nudge = String(e.prompts.normal.nudge || defaults.prompts.normal.nudge);
  e.prompts.normal.lockout = String(e.prompts.normal.lockout || defaults.prompts.normal.lockout);
  e.prompts.normal.block = String(e.prompts.normal.block || defaults.prompts.normal.block);
  e.prompts.hard.nudge = String(e.prompts.hard.nudge || defaults.prompts.hard.nudge);
  e.prompts.hard.lockout = String(e.prompts.hard.lockout || defaults.prompts.hard.lockout);
  e.prompts.hard.block = String(e.prompts.hard.block || defaults.prompts.hard.block);
  e.prompts.youtubeIntentQuestion = String(
    e.prompts.youtubeIntentQuestion || defaults.prompts.youtubeIntentQuestion
  );

  e.runtime = e.runtime && typeof e.runtime === "object" ? e.runtime : {};
  e.runtime.strikeCount = toBoundedInt(e.runtime.strikeCount, 0, 999, 0);
  e.runtime.lastStrikeTs = Number(e.runtime.lastStrikeTs) || 0;
  e.runtime.lockoutUntilTs = Number(e.runtime.lockoutUntilTs) || 0;
  e.runtime.blockedUntilTs = Number(e.runtime.blockedUntilTs) || 0;
  e.runtime.frozenUntilTs = Number(e.runtime.frozenUntilTs) || 0;
  e.runtime.lastSoftNudgeTs = Number(e.runtime.lastSoftNudgeTs) || 0;
  e.runtime.lastDetectionTs = Number(e.runtime.lastDetectionTs) || 0;
  e.runtime.lastAction = String(e.runtime.lastAction || "idle");
  e.runtime.lastReason = String(e.runtime.lastReason || "");
  e.runtime.lastTitle = String(e.runtime.lastTitle || "");
  e.runtime.lastProcess = String(e.runtime.lastProcess || "");

  if (!Array.isArray(state.enforcementLog)) state.enforcementLog = [];
}

const enforcementOverlay = {
  visible: false,
  stage: "nudge",
  reason: "",
  message: "",
  bgImage: "",
  processName: "",
  title: "",
  lockUntilTs: 0,
  hardDeadlineTs: 0,
  hardCycle: 0,
  hardMode: false,
  requiresIntent: false,
  error: ""
};

let _enforcementTickerId = null;
let _enforcementTickerMs = 0;
let _enforcementTickBusy = false;
let _enforcementLastFingerprint = "";
let _enforcementLastFingerprintTs = 0;
let _enforcementLastNoticeTs = 0;
let _enforcementLastSystemPopupTs = 0;
let _hardBlockTickBusy = false;
let _hardBlockTimerId = null;
const HARD_BLOCK_SECONDS = 8;
const hardBlockState = {
  active: false,
  fingerprint: "",
  process: "",
  pid: 0,
  reason: "",
  bgImage: "",
  deadlineTs: 0,
  cycles: 0,
  isBrowser: false
};
let _canvasSyncTickBusy = false;
let _canvasSyncTimerId = null;
let _canvasSyncTimerMs = 0;
let _canvasAutopilotTickBusy = false;
let _canvasAutopilotTimerId = null;
let _canvasAutopilotLastInterruptTs = 0;
let _morningGateTickBusy = false;
let _morningGateTimerId = null;
let _extensionPlannerBridgeServer = null;

// ensure inbox exists
if (!state.inbox) state.inbox = [];
ensureEnforcementStateShape();

function getActiveSprint() {
  const key = state.weekStartISO;
  if (!state.sprints[key]) state.sprints[key] = defaultSprint();
  return state.sprints[key];
}

function getOrCreateSprintForISO(dateISO) {
  // dateISO is YYYY-MM-DD; compute weekStartISO (Monday) and ensure sprint
  const d = fromISO(dateISO);
  const wk = toISO(getWeekStart(d));
  if (!state.sprints[wk]) state.sprints[wk] = defaultSprint();
  return { sprint: state.sprints[wk], weekStartISO: wk };
}

function syncEnforcementConfigToMain() {
  if (!ipcRendererSafe || typeof ipcRendererSafe.send !== "function") return;
  try {
    ensureEnforcementStateShape();
    ipcRendererSafe.send("blocker:daemon-config", {
      // Electron IPC will serialize/clone this payload; avoid extra JSON clone overhead.
      enforcement: state.enforcement,
      sentAt: Date.now()
    });
  } catch (err) {
    console.warn("syncEnforcementConfigToMain failed", err);
  }
}

let _queuedSaveTimer = null;
function queueSaveState(delayMs = 250) {
  const ms = Math.max(0, Number(delayMs || 0));
  if (_queuedSaveTimer) clearTimeout(_queuedSaveTimer);
  _queuedSaveTimer = setTimeout(() => {
    _queuedSaveTimer = null;
    saveState();
  }, ms);
}
function flushQueuedSaveState() {
  if (_queuedSaveTimer) {
    clearTimeout(_queuedSaveTimer);
    _queuedSaveTimer = null;
  }
  saveState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  syncEnforcementConfigToMain();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // try older key for migration
      const old = localStorage.getItem("trajectory_stage2_v1");
      if (old) {
        const parsed = JSON.parse(old);
        // migrate minimal: keep existing sprints and add schemaVersion + longPlans
        parsed.schemaVersion = parsed.schemaVersion || 1;
        parsed.longPlans = parsed.longPlans || [];
        parsed.rituals = parsed.rituals || {};
        parsed.planMode = parsed.planMode || "day";
        parsed.schemaVersion = SCHEMA_VERSION;
        return parsed;
      }
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed.schemaVersion) parsed.schemaVersion = 1;
    if (!parsed.longPlans) parsed.longPlans = [];
    if (!parsed.rituals) parsed.rituals = {};
    if (!parsed.planMode) parsed.planMode = "day";
    return parsed;
  } catch (err) {
    console.error('Failed to load state', err);
    return null;
  }
}

// ---------- Date helpers ----------
function toISO(d) {
  // local date -> YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addMonths(d, n) {
  const x = new Date(d);
  const m = x.getMonth();
  x.setMonth(m + n);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function getWeekStart(date) {
  // Monday as start
  const d = new Date(date);
  const day = d.getDay(); // Sun=0, Mon=1...
  const diffToMon = (day === 0 ? -6 : 1 - day);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diffToMon);
  return d;
}
function formatRange(weekStartDate) {
  const end = addDays(weekStartDate, 6);
  const opts = { month: "short", day: "numeric" };
  const startStr = weekStartDate.toLocaleDateString(undefined, opts);
  const endStr = end.toLocaleDateString(undefined, opts);
  return `${startStr} – ${endStr}`;
}
function dayIndexForDate(weekStart, date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const a = new Date(weekStart); a.setHours(0,0,0,0);
  const b = new Date(date); b.setHours(0,0,0,0);
  const diff = Math.round((b - a) / msPerDay);
  return diff;
}

// ---------- Time helpers ----------
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':').map(Number);
  if (parts.length < 2) return null;
  const hh = parts[0]; const mm = parts[1];
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return clampMinutes((hh * 60) + mm, 0, 1440);
}
function minutesToTime(mins) {
  const clamped = clampMinutes(Math.round(mins), 0, 1440);
  const hh = Math.floor(clamped / 60) % 24;
  const mm = clamped % 60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}
function snapMinutes(mins, step) {
  const s = Math.max(1, Number(step || 1));
  return Math.round(mins / s) * s;
}
function clampMinutes(mins, min = 0, max = 1440) {
  const v = Number(mins);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function formatTimeRange(startMins, durationMins) {
  const start = clampMinutes(startMins, 0, 1440);
  const dur = Math.max(PLAN_MIN_DURATION_MINS, Number(durationMins || 0));
  const end = clampMinutes(start + dur, 0, 1440);
  return `${minutesToTime(start)}-${minutesToTime(end)}`;
}
function formatMinutesCompact(mins) {
  const total = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function normalizeDurationMins(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}
function durationInputValue(value) {
  const n = normalizeDurationMins(value);
  return n === null ? "" : String(n);
}
function getDurationMinsForItem(c) {
  const dur = Number(c && c.durationMins);
  if (Number.isFinite(dur) && dur > 0) return dur;
  const est = Number(c && c.estHours);
  if (Number.isFinite(est) && est > 0) return Math.round(est * 60);
  return 60;
}

// ---------- Color helpers ----------
function colorForStat(stat) {
  const key = String(stat || 'INT').toUpperCase();
  return STAT_COLORS[key] || STAT_COLORS.INT;
}
function normalizeHexColor(val) {
  const raw = String(val || '').trim();
  if (!raw) return null;
  const v = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return `#${v.toUpperCase()}`;
}
function getCommitColor(c) {
  const explicit = normalizeHexColor(c && c.color);
  if (explicit) return explicit;
  const stat = c && c.stat ? c.stat : 'INT';
  return colorForStat(stat);
}
function applyCommitColorUI(color) {
  const hex = normalizeHexColor(color);
  if (!hex) return;
  const colorInput = $("#cColor");
  const hexInput = $("#cColorHex");
  const preview = $("#cColorPreview");
  if (colorInput) colorInput.value = hex;
  if (hexInput) hexInput.value = hex;
  if (preview) preview.style.background = hex;
  document.querySelectorAll('.color-swatch').forEach(btn => {
    const sw = normalizeHexColor(btn.getAttribute('data-color'));
    btn.classList.toggle('is-selected', sw === hex);
  });
}

function getCanvasFeedDefaultColor(feedId) {
  const key = String(feedId || "").trim().toLowerCase();
  return normalizeHexColor(CANVAS_FEED_DEFAULT_COLORS[key]) || "#0EA5E9";
}

function buildOccurrenceXpCommit(occId) {
  const parts = String(occId || "").split(":");
  const templateId = parts[0];
  const tmpl = (state.taskTemplates || []).find(t => t.id === templateId) || null;
  const fakeCommit = { id: String(occId || "") };
  if (!tmpl) return fakeCommit;
  fakeCommit.estHours = tmpl.estHours || (tmpl.durationMins ? tmpl.durationMins / 60 : 0);
  fakeCommit.durationMins = tmpl.durationMins;
  if (tmpl.goalId) fakeCommit.linkedPlanIds = [tmpl.goalId];
  fakeCommit.title = tmpl.title;
  fakeCommit.deliverable = tmpl.deliverable;
  fakeCommit.proofUrl = null;
  fakeCommit.stat = tmpl.stat || "INT";
  return fakeCommit;
}

function setCommitDoneStatus(commit, done, sprintWeekISO = state.weekStartISO) {
  if (!commit) return false;
  const next = !!done;
  const wasDone = !!commit.done;
  commit.done = next;
  if (!wasDone && next) {
    try { awardXpForCommitCompletion(commit, sprintWeekISO); } catch (e) { console.error("awardXp error", e); }
  }
  return true;
}

function setOccurrenceDoneStatus(occId, done, sprintWeekISO = state.weekStartISO) {
  if (!occId) return false;
  state.occurrenceDone = state.occurrenceDone || {};
  const next = !!done;
  const wasDone = !!state.occurrenceDone[occId];
  state.occurrenceDone[occId] = next;
  if (!wasDone && next) {
    try {
      const fakeCommit = buildOccurrenceXpCommit(occId);
      awardXpForCommitCompletion(fakeCommit, sprintWeekISO);
    } catch (e) {
      console.error("occurrence xp award failed", e);
    }
  }
  return true;
}

// ---------- Compute ----------
function compute() {
  const sprint = getActiveSprint();
  const plannedHours = sprint.commitments.reduce((sum, c) => sum + (Number(c.estHours) || 0), 0);
  const doneHours = sprint.commitments.filter(c => c.done).reduce((sum, c) => sum + (Number(c.estHours) || 0), 0);
  const remainingBudget = Math.max(Number(sprint.timeBudgetHours) - doneHours, 0);

  const total = sprint.commitments.length;
  const doneCount = sprint.commitments.filter(c => c.done).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  const overbooked = plannedHours > Number(sprint.timeBudgetHours);
  const todayFocus = pickTodayFocus(sprint);

  return { sprint, plannedHours, doneHours, remainingBudget, total, doneCount, pct, overbooked, todayFocus };
}

function pickTodayFocus(sprint) {
  // Best-next: unfinished scheduled for today; else earliest unfinished in week; else null.
  const weekStart = fromISO(state.weekStartISO);
  const now = new Date();
  const idx = dayIndexForDate(weekStart, now);

  const unfinished = sprint.commitments.filter(c => !c.done);

  // if viewing a different week than current week, don't force "today", just pick earliest
  const isCurrentWeek = toISO(getWeekStart(now)) === state.weekStartISO;

  if (isCurrentWeek && idx >= 0 && idx <= 6) {
    const todayItems = unfinished.filter(c => Number(c.dayIndex) === idx);
    if (todayItems.length) return todayItems.sort((a,b) => (a.estHours||0) - (b.estHours||0))[0];
  }

  if (!unfinished.length) return null;
  return unfinished.sort((a,b) => (Number(a.dayIndex) - Number(b.dayIndex)) || (a.estHours||0) - (b.estHours||0))[0];
}

// ---------- UI helpers ----------
const $ = (sel) => document.querySelector(sel);
const THEME_OPTIONS = new Set(["dark", "light"]);
const BLOCKER_SUBTABS = new Set(["overview", "rules", "advanced"]);

function ensureUiStateShape() {
  if (!state.ui || typeof state.ui !== "object") state.ui = {};
  if (!state.ui.calendarClassFilter) state.ui.calendarClassFilter = "all";
  if (!state.ui.sectionCollapsed || typeof state.ui.sectionCollapsed !== "object") {
    state.ui.sectionCollapsed = {};
  }
  if (!state.ui.drawer || typeof state.ui.drawer !== "object") {
    state.ui.drawer = { open: false, kind: "", payload: null };
  }
  if (!state.ui.homePanels || typeof state.ui.homePanels !== "object") {
    state.ui.homePanels = { goalsOpen: false, inboxOpen: false };
  }
  if (!state.ui.planPanels || typeof state.ui.planPanels !== "object") {
    state.ui.planPanels = { kpiCollapsed: false, settingsCollapsed: true };
  }
  if (!state.ui.workout || typeof state.ui.workout !== "object") {
    state.ui.workout = { selectedExerciseId: "", showWarmups: false };
  }
  state.ui.workout.selectedExerciseId = String(state.ui.workout.selectedExerciseId || "");
  state.ui.workout.showWarmups = !!state.ui.workout.showWarmups;
  if (typeof state.ui.calendarIntegrationsOpen !== "boolean") {
    state.ui.calendarIntegrationsOpen = false;
  }
  const blockerSubtab = String(state.ui.blockerSubtab || "overview").toLowerCase();
  state.ui.blockerSubtab = BLOCKER_SUBTABS.has(blockerSubtab) ? blockerSubtab : "overview";
  return state.ui;
}

function getUiCollapsed(key, defaultCollapsed = false) {
  ensureUiStateShape();
  const k = String(key || "").trim();
  if (!k) return !!defaultCollapsed;
  if (!Object.prototype.hasOwnProperty.call(state.ui.sectionCollapsed, k)) {
    state.ui.sectionCollapsed[k] = !!defaultCollapsed;
  }
  return !!state.ui.sectionCollapsed[k];
}

function setUiCollapsed(key, collapsed, { persist = true } = {}) {
  ensureUiStateShape();
  const k = String(key || "").trim();
  if (!k) return;
  state.ui.sectionCollapsed[k] = !!collapsed;
  if (persist) saveState();
}

function openUiDrawer(kind, payload = null) {
  ensureUiStateShape();
  state.ui.drawer = {
    open: true,
    kind: String(kind || "").trim(),
    payload: payload && typeof payload === "object" ? cloneJson(payload) : null
  };
  saveState();
  render();
}

function closeUiDrawer({ persist = true, rerender = true } = {}) {
  ensureUiStateShape();
  state.ui.drawer = { open: false, kind: "", payload: null };
  if (persist) saveState();
  if (rerender) render();
}

function renderCollapseChevron(collapsed) {
  return collapsed ? "▸" : "▾";
}

function renderSectionBlock({
  key,
  title = "",
  meta = "",
  body = "",
  actions = "",
  defaultCollapsed = true
} = {}) {
  const collapsed = getUiCollapsed(key, defaultCollapsed);
  return `
    <section class="card ui-section${collapsed ? " is-collapsed" : ""}">
      <button class="ui-section__header" type="button" data-ui-collapse="${escapeHtml(key || "")}" aria-expanded="${collapsed ? "false" : "true"}">
        <div class="ui-section__titlewrap">
          <h3 class="ui-section__title">${escapeHtml(title || "")}</h3>
          ${meta ? `<div class="ui-section__meta">${escapeHtml(meta)}</div>` : ""}
        </div>
        <div class="ui-section__head-actions">
          ${actions || ""}
          <span class="ui-section__chevron" aria-hidden="true">${renderCollapseChevron(collapsed)}</span>
        </div>
      </button>
      <div class="ui-section__body"${collapsed ? ` hidden` : ``}>
        ${body || ""}
      </div>
    </section>
  `;
}

function renderDrawerGoalsBody() {
  const rows = (state.longPlans || []).map(g => {
    let pct = 0;
    if (g.category === "degree" && g.degree) {
      const req = Number(g.degree.requiredCredits || 0);
      const classes = Array.isArray(g.degree.classes) ? g.degree.classes : [];
      const completed = classes.reduce((sum, c) => sum + ((c && c.completed) ? Number(c.credits || 0) : 0), 0);
      pct = req > 0 ? Math.min(100, Math.round((completed / req) * 100)) : 0;
    } else if (g.category === "health" && g.health) {
      const cur = Number(g.health.currentValue || 0);
      const tgt = Number(g.health.targetValue || 0);
      pct = tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : 0;
    }
    const note = String((g.notes || "").split("\n")[0] || "");
    return `
      <div class="drawer-list__item">
        <div class="drawer-list__main">
          <div class="drawer-list__title">${escapeHtml(g.title || "Untitled")}</div>
          <div class="drawer-list__meta">${escapeHtml(String(g.horizonYears || 1))}y${note ? ` · ${escapeHtml(note)}` : ""}</div>
          <div class="drawer-list__bar"><i style="width:${pct}%"></i></div>
        </div>
        <div class="drawer-list__actions">
          <button class="smallbtn" type="button" data-edit-goal="${escapeHtml(g.id)}">Edit</button>
          <button class="smallbtn" type="button" data-delete-goal="${escapeHtml(g.id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("");
  return `
    <div class="drawer-toolbar">
      <button class="btn btn--ghost" data-add-goal type="button">+ Add Goal</button>
      <button class="btn btn--ghost" data-generate-plan type="button">Generate Plan</button>
    </div>
    <div class="drawer-list">
      ${rows || `<div class="faint">No goals yet. Add one.</div>`}
    </div>
  `;
}

function renderDrawerInboxBody() {
  const rows = (state.inbox || []).map(it => `
    <div class="drawer-list__item">
      <div class="drawer-list__main">
        <div class="drawer-list__title">${escapeHtml(it.title || "Untitled")}</div>
        ${it.deliverable ? `<div class="drawer-list__meta">${escapeHtml(it.deliverable)}</div>` : ``}
      </div>
      <div class="drawer-list__actions">
        <button class="smallbtn" type="button" data-assign-inbox="${escapeHtml(it.id)}">Assign</button>
        <button class="smallbtn" type="button" data-delete-inbox="${escapeHtml(it.id)}">Delete</button>
      </div>
    </div>
  `).join("");
  return `
    <div class="drawer-list">
      ${rows || `<div class="faint">No inbox items yet.</div>`}
    </div>
  `;
}

function renderBlockerPrivateDrawer(cfg) {
  const pg = normalizePornGroupConfig(cfg && cfg.pornGroup, cfg && cfg.pornKeywords);
  return `
    <div class="stack stack--tight">
      <label class="field field--inline">
        <span class="field__label">Enable private group</span>
        <div class="toggle">
          <input id="drawerPornGroupEnabled" type="checkbox" ${pg.enabled ? "checked" : ""} />
          <span class="toggle__ui"></span>
        </div>
      </label>
      <label class="field field--inline">
        <span class="field__label">Always on</span>
        <div class="toggle">
          <input id="drawerPornGroupAlwaysOn" type="checkbox" ${pg.alwaysOn ? "checked" : ""} />
          <span class="toggle__ui"></span>
        </div>
      </label>
      <label class="field">
        <span class="field__label">Blocked domains (one per line)</span>
        <textarea id="drawerPornDomains" class="input enforce-textarea" rows="6">${escapeHtml(listForTextarea(pg.blockedDomains))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Blocked keywords</span>
        <textarea id="drawerPornBlockedKeywords" class="input enforce-textarea" rows="4">${escapeHtml(listForTextarea(pg.blockedKeywords))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Blocked search terms</span>
        <textarea id="drawerPornSearchTerms" class="input enforce-textarea" rows="4">${escapeHtml(listForTextarea(pg.blockedSearchTerms))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Custom sensitive terms</span>
        <textarea id="drawerPornCustomKeywords" class="input enforce-textarea" rows="4">${escapeHtml(listForTextarea(pg.customKeywords))}</textarea>
      </label>
    </div>
  `;
}

function renderBlockerSoftHardDrawer(cfg) {
  return `
    <div class="stack stack--tight">
      <label class="field">
        <span class="field__label">Soft blocked apps/processes</span>
        <textarea id="drawerBlockedProcesses" class="input enforce-textarea" rows="4">${escapeHtml(listForTextarea(cfg.blockedProcesses))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Soft blocked title keywords</span>
        <textarea id="drawerBlockedKeywords" class="input enforce-textarea" rows="4">${escapeHtml(listForTextarea(cfg.blockedTitleKeywords))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Hard blocked apps/processes</span>
        <textarea id="drawerHardBlockedProcesses" class="input enforce-textarea" rows="4">${escapeHtml(listForTextarea(cfg.hardBlockedProcesses))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Hard blocked keywords</span>
        <textarea id="drawerHardBlockedKeywords" class="input enforce-textarea" rows="4">${escapeHtml(listForTextarea(cfg.hardBlockedKeywords))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Allowlisted title keywords</span>
        <textarea id="drawerAllowlistKeywords" class="input enforce-textarea" rows="3">${escapeHtml(listForTextarea(cfg.allowlistedTitleKeywords))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Allowlisted processes</span>
        <textarea id="drawerAllowlistProcesses" class="input enforce-textarea" rows="3">${escapeHtml(listForTextarea(cfg.allowlistedProcesses))}</textarea>
      </label>
    </div>
  `;
}

function renderBlockerYoutubeDrawer(cfg) {
  const yt = cfg.youtube || getDefaultEnforcementState().youtube;
  return `
    <div class="stack stack--tight">
      <label class="field field--inline">
        <span class="field__label">Enable YouTube guardrail</span>
        <div class="toggle">
          <input id="drawerYoutubeEnabled" type="checkbox" ${yt.enabled ? "checked" : ""} />
          <span class="toggle__ui"></span>
        </div>
      </label>
      <label class="field field--inline">
        <span class="field__label">Require intent prompt</span>
        <div class="toggle">
          <input id="drawerYoutubeIntent" type="checkbox" ${yt.requireIntentCheck ? "checked" : ""} />
          <span class="toggle__ui"></span>
        </div>
      </label>
      <label class="field">
        <span class="field__label">Allow window (minutes)</span>
        <input id="drawerYoutubeAllowMins" class="input" type="number" min="1" max="180" step="1" value="${Number(yt.allowMinutes || 12)}" />
      </label>
      <label class="field">
        <span class="field__label">Allow keywords (one per line)</span>
        <textarea id="drawerYoutubeAllowKeywords" class="input enforce-textarea" rows="6">${escapeHtml(listForTextarea(yt.allowKeywords))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Intent question</span>
        <textarea id="drawerYoutubeIntentQuestion" class="input enforce-textarea" rows="3">${escapeHtml(cfg.prompts.youtubeIntentQuestion || "")}</textarea>
      </label>
    </div>
  `;
}

function renderWorkoutSessionDrawerBody(sessionId) {
  ensureWorkoutStateShape();
  const sid = String(sessionId || "").trim();
  const session = sid ? (state.workouts.sessionsById || {})[sid] : null;
  if (!session) return `<div class="faint">Session not found.</div>`;

  const startedTs = parseIsoTs(session.startedAt);
  const endedTs = parseIsoTs(session.endedAt);
  const endLabel = endedTs ? new Date(endedTs).toLocaleString() : "Active";
  const durationLabel = startedTs ? formatElapsed((endedTs || Date.now()) - startedTs) : "";

  const allSets = Object.values(state.workouts.setsById || {}).filter(s => {
    if (!s || typeof s !== "object") return false;
    if (String(s.sessionId || "") !== sid) return false;
    return !asBoolLoose(s.deleted);
  });
  allSets.sort((a, b) => parseIsoTs(a.createdAt) - parseIsoTs(b.createdAt));

  const groups = new Map();
  allSets.forEach(s => {
    const exName = String(
      s.exerciseName
      || ((state.workouts.exercisesById || {})[String(s.exerciseId || "")] || {}).name
      || "Exercise"
    ).trim() || "Exercise";
    if (!groups.has(exName)) groups.set(exName, []);
    groups.get(exName).push(s);
  });

  const groupHtml = Array.from(groups.entries()).map(([name, sets]) => {
    const lines = (sets || []).map((s, idx) => {
      const weight = Number(s.weight);
      const reps = Number(s.reps);
      const unit = String(s.unit || "lb");
      const warm = asBoolLoose(s.isWarmup) ? ` <span class="pill pill--good">Warmup</span>` : "";
      const main = (Number.isFinite(weight) && weight > 0 && Number.isFinite(reps) && reps > 0)
        ? `${weight} ${unit} × ${reps}`
        : `${String(s.weight || "")} ${unit} × ${String(s.reps || "")}`;
      return `
        <div class="workout-setline">
          <div class="meta">Set ${idx + 1}</div>
          <div class="workout-setline__main">${escapeHtml(main)}${warm}</div>
        </div>
      `;
    }).join("");
    return `
      <div class="card card--subtle">
        <div class="card__title">
          <h3>${escapeHtml(name)}</h3>
          <div class="meta">${(sets || []).length} sets</div>
        </div>
        <div class="stack stack--tight">
          ${lines || `<div class="faint">No sets.</div>`}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="stack">
      <div class="card card--subtle">
        <div class="card__title">
          <h3>${escapeHtml(session.routineName || "Workout")}</h3>
          <div class="meta">${startedTs ? escapeHtml(new Date(startedTs).toLocaleString()) : ""}</div>
        </div>
        <div class="stats-grid stats-grid--compact" style="margin-top:10px">
          <div class="kv__item">
            <div class="kv__label">Ends</div>
            <div class="kv__value" style="font-size:14px">${escapeHtml(endLabel)}</div>
          </div>
          <div class="kv__item">
            <div class="kv__label">Duration</div>
            <div class="kv__value" style="font-size:14px">${escapeHtml(durationLabel || "—")}</div>
          </div>
          <div class="kv__item">
            <div class="kv__label">Sets</div>
            <div class="kv__value" style="font-size:14px">${allSets.length}</div>
          </div>
        </div>
        ${session.notes ? `<div class="muted" style="margin-top:10px;white-space:pre-wrap">${escapeHtml(session.notes)}</div>` : ``}
      </div>
      ${groupHtml || `<div class="faint">No sets logged for this session.</div>`}
    </div>
  `;
}

function getUiDrawerModel() {
  ensureUiStateShape();
  const drawer = state.ui.drawer || { open: false, kind: "", payload: null };
  if (!drawer.open || !drawer.kind) return null;
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const kind = String(drawer.kind || "");
  if (kind === "home-goals") {
    return {
      title: "Goals",
      subtitle: "Manage goals without leaving Home",
      body: renderDrawerGoalsBody(),
      actions: `<button class="btn btn--ghost" type="button" data-ui-close-drawer>Done</button>`
    };
  }
  if (kind === "home-inbox") {
    return {
      title: "Inbox",
      subtitle: "Quick-captured items waiting to be assigned",
      body: renderDrawerInboxBody(),
      actions: `<button class="btn btn--ghost" type="button" data-ui-close-drawer>Done</button>`
    };
  }
  if (kind === "blocker-private-group") {
    return {
      title: "Private Hard Block Group",
      subtitle: "Sensitive rules are edited here only",
      body: renderBlockerPrivateDrawer(cfg),
      actions: `<button class="btn btn--ghost" type="button" data-ui-close-drawer>Cancel</button><button class="btn btn--primary" type="button" id="drawerSavePrivateGroup">Save Group</button>`
    };
  }
  if (kind === "blocker-soft-hard") {
    return {
      title: "Soft / Hard Rule Lists",
      subtitle: "Manage app/process/title lists in one place",
      body: renderBlockerSoftHardDrawer(cfg),
      actions: `<button class="btn btn--ghost" type="button" data-ui-close-drawer>Cancel</button><button class="btn btn--primary" type="button" id="drawerSaveSoftHardRules">Save Lists</button>`
    };
  }
  if (kind === "blocker-youtube") {
    return {
      title: "YouTube Guardrail",
      subtitle: "Intent-first controls and allowlist",
      body: renderBlockerYoutubeDrawer(cfg),
      actions: `<button class="btn btn--ghost" type="button" data-ui-close-drawer>Cancel</button><button class="btn btn--primary" type="button" id="drawerSaveYoutubeRules">Save Guardrail</button>`
    };
  }
  if (kind === "workout-session") {
    ensureWorkoutStateShape();
    const sid = drawer.payload && drawer.payload.sessionId ? String(drawer.payload.sessionId) : "";
    const session = sid ? (state.workouts.sessionsById || {})[sid] : null;
    const startedTs = session ? parseIsoTs(session.startedAt) : 0;
    const subtitle = startedTs ? new Date(startedTs).toLocaleString() : "Session details";
    return {
      title: session ? (session.routineName || "Workout session") : "Workout session",
      subtitle,
      body: renderWorkoutSessionDrawerBody(sid),
      actions: `<button class="btn btn--ghost" type="button" data-ui-close-drawer>Done</button>`
    };
  }
  return null;
}

function renderGlobalDrawer() {
  const model = getUiDrawerModel();
  if (!model) return "";
  return `
    <div class="ui-drawer is-open" id="uiDrawerRoot" role="dialog" aria-modal="true" aria-labelledby="uiDrawerTitle">
      <button class="ui-drawer__backdrop" type="button" aria-label="Close panel" data-ui-close-drawer></button>
      <aside class="ui-drawer__panel">
        <header class="ui-drawer__header">
          <div>
            <h2 id="uiDrawerTitle">${escapeHtml(model.title || "Panel")}</h2>
            ${model.subtitle ? `<div class="meta">${escapeHtml(model.subtitle)}</div>` : ""}
          </div>
          <button class="iconbtn" type="button" aria-label="Close panel" data-ui-close-drawer>✕</button>
        </header>
        <div class="ui-drawer__body">${model.body || ""}</div>
        <div class="ui-drawer__footer">${model.actions || `<button class="btn btn--ghost" type="button" data-ui-close-drawer>Close</button>`}</div>
      </aside>
    </div>
  `;
}

function getThemeFromState() {
  const ui = state.ui && typeof state.ui === "object" ? state.ui : {};
  const v = String(ui.theme || "dark").toLowerCase();
  return THEME_OPTIONS.has(v) ? v : "dark";
}

function applyTheme(theme) {
  const next = THEME_OPTIONS.has(String(theme || "").toLowerCase())
    ? String(theme || "").toLowerCase()
    : "dark";
  try {
    document.body.setAttribute("data-theme", next);
  } catch (_) {}
}

function setTheme(theme, { persist = true, rerender = false } = {}) {
  const next = THEME_OPTIONS.has(String(theme || "").toLowerCase())
    ? String(theme || "").toLowerCase()
    : "dark";
  state.ui = state.ui || {};
  state.ui.theme = next;
  applyTheme(next);
  if (persist) saveState();
  if (rerender) render();
}

// Day tracker runtime flags
let _dayTrackerHandlersAdded = false;
let _dayTrackerClockId = null;
let _planTimelineHandlersAdded = false;
let _planDragState = null;
let _planDragSuppressClick = false;
let _commitAutoSaveTimer = null;
let _goalModalDelegatesAdded = false;
let _globalShortcutHandlersAdded = false;
let _lastDrawerOpen = false;
let _lastDrawerKind = "";
// Render ticker for updating elapsed timers
let _renderTickerId = null;

function ensureRenderTicker() {
  // run render every minute while on Home or any started timer exists
  const anyStarted = Object.values(state.sprints || {}).some(sp => (sp.commitments || []).some(c => !!c.started));
  const shouldRun = state.view === 'home' || anyStarted;
  if (shouldRun && !_renderTickerId) {
    // align to next minute roughly by starting immediately then every 60s
    _renderTickerId = setInterval(() => {
      try { render(); } catch (e) { console.error('Render ticker error', e); }
    }, 60 * 1000);
  } else if (!shouldRun && _renderTickerId) {
    clearInterval(_renderTickerId);
    _renderTickerId = null;
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let _lastBlockerBgIndex = -1;
function pickBlockerBackgroundImage() {
  if (!Array.isArray(BLOCKER_BG_IMAGES) || !BLOCKER_BG_IMAGES.length) return "";
  let idx = Math.floor(Math.random() * BLOCKER_BG_IMAGES.length);
  if (BLOCKER_BG_IMAGES.length > 1 && idx === _lastBlockerBgIndex) {
    idx = (idx + 1) % BLOCKER_BG_IMAGES.length;
  }
  _lastBlockerBgIndex = idx;
  return String(BLOCKER_BG_IMAGES[idx] || "");
}

function toCssBgUrl(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  const safe = encodeURI(raw).replaceAll("'", "%27");
  return `url('${safe}')`;
}

function formatElapsed(ms) {
  if (!ms || ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h + 'h';
}

function pillFor(c) {
  if (c.done) return `<span class="pill pill--good">Done</span>`;
  const d = DAY_NAMES[Number(c.dayIndex)] ?? "Day";
  // treat Thu or earlier as "near"
  const warn = Number(c.dayIndex) <= 3;
  return `<span class="pill ${warn ? "pill--warn" : ""}">Due ${d}</span>`;
}

function uuid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
}

function listForTextarea(items) {
  return uniqLowerList(items).join("\n");
}

function formatCountdown(ms) {
  const totalSecs = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function nowMinutes(nowDate) {
  return (nowDate.getHours() * 60) + nowDate.getMinutes();
}

function isTimeInsideWindow(minuteNow, startMinute, endMinute) {
  if (startMinute === endMinute) return true;
  if (startMinute < endMinute) return minuteNow >= startMinute && minuteNow < endMinute;
  // overnight window (e.g. 22:00 -> 06:00)
  return minuteNow >= startMinute || minuteNow < endMinute;
}

function getEnforcementStatus(nowTs = Date.now()) {
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const now = new Date(nowTs);
  const rt = cfg.runtime || {};

  const blockedActive = Number(rt.blockedUntilTs) > nowTs;
  const lockoutActive = Number(rt.lockoutUntilTs) > nowTs;
  const frozenActive = Number(rt.frozenUntilTs) > nowTs;
  const sessionActive = Number(cfg.sessionUntilTs) > nowTs;

  let scheduleActive = false;
  const startMins = timeToMinutes(cfg.schedule.startTime);
  const endMins = timeToMinutes(cfg.schedule.endTime);
  if (startMins !== null && endMins !== null && Array.isArray(cfg.schedule.days) && cfg.schedule.days.length) {
    const currentDay = now.getDay();
    const previousDay = (currentDay + 6) % 7;
    const minuteNow = nowMinutes(now);
    const daySet = new Set(cfg.schedule.days.map(n => Number(n)));
    if (startMins === endMins) {
      scheduleActive = daySet.has(currentDay);
    } else if (startMins < endMins) {
      scheduleActive = daySet.has(currentDay) && isTimeInsideWindow(minuteNow, startMins, endMins);
    } else {
      // Overnight schedule: before end means previous-day schedule is still active.
      if (minuteNow >= startMins) scheduleActive = daySet.has(currentDay);
      else scheduleActive = daySet.has(previousDay) && minuteNow < endMins;
    }
  }

  const alwaysOnActive = !!cfg.alwaysOn;
  const pornAlwaysActive = isPornGroupAlwaysOn(cfg);
  const active = (cfg.enabled && (alwaysOnActive || scheduleActive || sessionActive || lockoutActive || blockedActive || frozenActive)) || pornAlwaysActive;
  let headline = cfg.enabled || pornAlwaysActive ? "Monitoring armed" : "Monitoring off";
  let detail = cfg.enabled || pornAlwaysActive
    ? (alwaysOnActive ? "Always-on blocking is active." : "No active window right now.")
    : "Toggle on to monitor active app/site windows during focus time.";

  if (blockedActive) {
    headline = "Timed block active";
    detail = `Hard block ends in ${formatCountdown(Number(rt.blockedUntilTs) - nowTs)}.`;
  } else if (lockoutActive) {
    headline = "Lockout active";
    detail = `Lockout ends in ${formatCountdown(Number(rt.lockoutUntilTs) - nowTs)}.`;
  } else if (frozenActive) {
    headline = "Frozen mode active";
    detail = `Settings are locked for ${formatCountdown(Number(rt.frozenUntilTs) - nowTs)}.`;
  } else if (sessionActive) {
    headline = "Manual focus session active";
    detail = `Session ends in ${formatCountdown(Number(cfg.sessionUntilTs) - nowTs)}.`;
  } else if (scheduleActive) {
    headline = "Scheduled focus window active";
    detail = `${cfg.schedule.startTime} - ${cfg.schedule.endTime} is currently enforcing.`;
  } else if (alwaysOnActive && cfg.enabled) {
    headline = "Always-on blocker active";
    detail = "Blocking rules are running regardless of schedule.";
  } else if (pornAlwaysActive) {
    headline = "Private hard-block group always on";
    detail = "Private hard-block rules are enforced even if other blocker rules are off.";
  }

  return { active, alwaysOnActive, pornAlwaysActive, blockedActive, lockoutActive, frozenActive, sessionActive, scheduleActive, headline, detail };
}

function renderEnforcementCard() {
  ensureEnforcementStateShape();
  ensureUiStateShape();
  const cfg = state.enforcement;
  const pornGroup = normalizePornGroupConfig(cfg.pornGroup, cfg.pornKeywords);
  const extensionGuard = cfg.extensionGuard || getDefaultEnforcementState().extensionGuard;
  const extensionDir = getBrowserBlockerExtensionDir();
  const extensionReady = !!(fsSafe && extensionDir && fsSafe.existsSync(extensionDir));
  const rt = cfg.runtime || {};
  const status = getEnforcementStatus(Date.now());
  const subtab = BLOCKER_SUBTABS.has(String(state.ui.blockerSubtab || "").toLowerCase())
    ? String(state.ui.blockerSubtab || "").toLowerCase()
    : "overview";
  state.ui.blockerSubtab = subtab;
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const selectedDays = new Set((cfg.schedule.days || []).map(n => Number(n)));
  const lastDetectionAt = rt.lastDetectionTs
    ? new Date(rt.lastDetectionTs).toLocaleString()
    : "none";
  const lastAction = rt.lastAction || "idle";
  const lastReason = rt.lastReason || "No violations yet.";
  const stageClass = status.active ? "is-on" : "is-off";

  const frozenMeta = status.frozenActive
    ? `Frozen for ${formatCountdown(Number(rt.frozenUntilTs || 0) - Date.now())}`
    : "Not frozen";

  return `
    <div class="card enforce-card enforce-card--ct blocker-workbench blocker-workbench--${escapeHtml(subtab)}">
      <div class="card__title">
        <h2>Blocker Workspace</h2>
        <div class="meta">${status.active ? "Active" : "Standby"}</div>
      </div>

      <div class="blocker-subtabs" role="tablist" aria-label="Blocker sections">
        <button class="blocker-subtab${subtab === "overview" ? " is-active" : ""}" type="button" data-blocker-subtab="overview" role="tab" aria-selected="${subtab === "overview"}">Overview</button>
        <button class="blocker-subtab${subtab === "rules" ? " is-active" : ""}" type="button" data-blocker-subtab="rules" role="tab" aria-selected="${subtab === "rules"}">Rule Groups</button>
        <button class="blocker-subtab${subtab === "advanced" ? " is-active" : ""}" type="button" data-blocker-subtab="advanced" role="tab" aria-selected="${subtab === "advanced"}">Advanced</button>
      </div>

      <div class="enforce-ct-banner blocker-pane-section blocker-pane-section--overview">
        <div class="enforce-ct-banner__kicker">Control Workspace</div>
        <div class="enforce-ct-banner__headline">${escapeHtml(status.headline)}</div>
        <div class="enforce-ct-banner__sub">${escapeHtml(status.detail)}</div>
      </div>

      <div class="enforce-status ${stageClass} blocker-pane-section blocker-pane-section--overview">
        <div class="enforce-status__headline">${escapeHtml(status.headline)}</div>
        <div class="enforce-status__detail">${escapeHtml(status.detail)}</div>
        <div class="meta">Strikes: ${Number(rt.strikeCount || 0)} · Last action: ${escapeHtml(lastAction)} · Last detection: ${escapeHtml(lastDetectionAt)}</div>
        <div class="meta">Frozen lock: ${escapeHtml(frozenMeta)} · Last reason: ${escapeHtml(lastReason)}</div>
      </div>

      <div class="enforce-ct-frame">
        <aside class="enforce-ct-side blocker-pane-section blocker-pane-section--overview">

      <div class="row row--3 enforce-grid">
        <label class="field field--inline">
          <span class="field__label">Enabled</span>
          <div class="toggle">
            <input id="enfEnabled" type="checkbox" ${cfg.enabled ? "checked" : ""} />
            <span class="toggle__ui"></span>
          </div>
        </label>
        <label class="field field--inline">
          <span class="field__label">Always on (ignore schedule)</span>
          <div class="toggle">
            <input id="enfAlwaysOn" type="checkbox" ${cfg.alwaysOn ? "checked" : ""} />
            <span class="toggle__ui"></span>
          </div>
        </label>
        <label class="field">
          <span class="field__label">Tone</span>
          <select id="enfTone" class="input">
            <option value="normal" ${cfg.tone === "normal" ? "selected" : ""}>Normal</option>
            <option value="hard" ${cfg.tone === "hard" ? "selected" : ""}>Hard</option>
          </select>
        </label>
      </div>

      <div class="row row--3 enforce-grid">
        <label class="field field--inline">
          <span class="field__label">Strict mode (freeze locks settings)</span>
          <div class="toggle">
            <input id="enfStrictMode" type="checkbox" ${cfg.strictMode ? "checked" : ""} />
            <span class="toggle__ui"></span>
          </div>
        </label>
        <label class="field">
          <span class="field__label">Poll (seconds)</span>
          <input id="enfPollSecs" class="input" type="number" min="${ENFORCEMENT_MIN_POLL_SECS}" max="${ENFORCEMENT_MAX_POLL_SECS}" step="1" value="${Number(cfg.pollEverySecs)}" />
        </label>
        <label class="field">
          <span class="field__label">Manual session (minutes)</span>
          <input id="enfSessionMins" class="input" type="number" min="5" max="600" step="5" value="${Number(cfg.sessionDurationMins)}" />
        </label>
      </div>

      <div class="row row--3 enforce-grid">
        <label class="field">
          <span class="field__label">Freeze duration (minutes)</span>
          <input id="enfFreezeMins" class="input" type="number" min="5" max="600" step="5" value="${Number(cfg.freezeDurationMins || 60)}" />
        </label>
        <label class="field">
          <span class="field__label">Schedule start</span>
          <input id="enfStartTime" class="input" type="time" value="${escapeHtml(cfg.schedule.startTime)}" />
        </label>
        <label class="field">
          <span class="field__label">Schedule end</span>
          <input id="enfEndTime" class="input" type="time" value="${escapeHtml(cfg.schedule.endTime)}" />
        </label>
      </div>

      <div class="row enforce-grid">
        <label class="field">
          <span class="field__label">Website mode</span>
          <select id="enfWebsiteMode" class="input">
            <option value="blocklist" ${cfg.websiteMode === "blocklist" ? "selected" : ""}>Blocklist</option>
            <option value="allowlist" ${cfg.websiteMode === "allowlist" ? "selected" : ""}>Allowlist (strict)</option>
          </select>
        </label>
      </div>

      <div class="enforce-days">
        ${dayLabels.map((label, idx) => `
          <label class="check enforce-day">
            <input type="checkbox" data-enf-day="${idx}" ${selectedDays.has(idx) ? "checked" : ""} />
            ${escapeHtml(label)}
          </label>
        `).join("")}
      </div>

      <div class="enforce-actions">
        <button class="btn btn--primary" id="enfStartSessionBtn" type="button">Start Session Now</button>
        <button class="btn btn--primary" id="enfFreezeSessionBtn" type="button">Start Frozen Session</button>
        <button class="btn btn--ghost" id="enfStopSessionBtn" type="button">Stop Session</button>
        <button class="btn btn--ghost" id="enfUnfreezeBtn" type="button">Unfreeze (when timer ends)</button>
        <button class="btn btn--ghost" id="enfResetRuntimeBtn" type="button">Reset Strikes/Locks</button>
        <button class="btn btn--ghost" id="enfSaveBtn" type="button">Save Blocker Settings</button>
      </div>

        </aside>
        <div class="enforce-ct-main">

      <details class="enforce-details enforce-details--rules blocker-pane-section blocker-pane-section--rules" open>
        <summary>Rule Groups</summary>

        <div class="blocker-rule-grid">
          <div class="enforce-group-card blocker-rule-card">
            <div class="enforce-group-card__head">
              <div>
                <div class="field__label">YouTube guardrail</div>
                <div class="meta">Intent-first access with a short learning window.</div>
              </div>
              <button class="btn btn--ghost" type="button" data-ui-open-drawer="blocker-youtube">Edit</button>
            </div>

            <div class="row row--3 enforce-grid">
              <label class="field field--inline">
                <span class="field__label">Enabled</span>
                <div class="toggle">
                  <input id="enfYoutubeEnabled" type="checkbox" ${cfg.youtube.enabled ? "checked" : ""} />
                  <span class="toggle__ui"></span>
                </div>
              </label>
              <label class="field field--inline">
                <span class="field__label">Ask intent first</span>
                <div class="toggle">
                  <input id="enfYoutubeIntentEnabled" type="checkbox" ${cfg.youtube.requireIntentCheck ? "checked" : ""} />
                  <span class="toggle__ui"></span>
                </div>
              </label>
              <label class="field">
                <span class="field__label">Allow window (minutes)</span>
                <input id="enfYoutubeAllowMins" class="input" type="number" min="1" max="180" step="1" value="${Number(cfg.youtube.allowMinutes)}" />
              </label>
            </div>

            <div class="blocker-rule-card__stats">
              <span class="badge">${Number((cfg.youtube.allowKeywords || []).length)} allow keywords</span>
              <span class="meta">Keyword list stays hidden until you edit.</span>
            </div>
          </div>

          <div class="enforce-group-card blocker-rule-card blocker-rule-card--sensitive">
            <div class="enforce-group-card__head">
              <div>
                <div class="field__label">Private hard block</div>
                <div class="meta">No exceptions. Lists are hidden until you choose to edit.</div>
              </div>
              <button class="btn btn--ghost" type="button" data-ui-open-drawer="blocker-private-group">Edit</button>
            </div>

            <div class="row row--3 enforce-grid">
              <label class="field field--inline">
                <span class="field__label">Enable private group</span>
                <div class="toggle">
                  <input id="enfPornGroupEnabled" type="checkbox" ${pornGroup.enabled ? "checked" : ""} />
                  <span class="toggle__ui"></span>
                </div>
              </label>
              <label class="field field--inline">
                <span class="field__label">Always on (even if blocker disabled)</span>
                <div class="toggle">
                  <input id="enfPornGroupAlwaysOn" type="checkbox" ${pornGroup.alwaysOn ? "checked" : ""} />
                  <span class="toggle__ui"></span>
                </div>
              </label>
              <div></div>
            </div>

            <div class="blocker-rule-card__stats">
              <span class="badge">${Number((pornGroup.blockedDomains || []).length)} domains</span>
              <span class="badge">${Number((pornGroup.blockedKeywords || []).length)} keywords</span>
              <span class="badge">${Number((pornGroup.blockedSearchTerms || []).length)} searches</span>
              <span class="badge">${Number((pornGroup.customKeywords || []).length)} custom</span>
            </div>
          </div>

          <div class="enforce-group-card blocker-rule-card">
            <div class="enforce-group-card__head">
              <div>
                <div class="field__label">Soft / hard lists</div>
                <div class="meta">Apps and window-title keywords.</div>
              </div>
              <button class="btn btn--ghost" type="button" data-ui-open-drawer="blocker-soft-hard">Edit</button>
            </div>

            <div class="blocker-rule-card__stats">
              <span class="badge">${Number((cfg.blockedProcesses || []).length)} soft apps</span>
              <span class="badge">${Number((cfg.blockedTitleKeywords || []).length)} soft keywords</span>
              <span class="badge">${Number((cfg.hardBlockedProcesses || []).length)} hard apps</span>
              <span class="badge">${Number((cfg.hardBlockedKeywords || []).length)} hard keywords</span>
              <span class="badge">${Number((cfg.allowlistedProcesses || []).length)} allow apps</span>
              <span class="badge">${Number((cfg.allowlistedTitleKeywords || []).length)} allow keywords</span>
            </div>

            <label class="field">
              <span class="field__label">Soft nudge interval (seconds)</span>
              <input id="enfSoftNudgeSecs" class="input" type="number" min="10" max="600" step="5" value="${Number(cfg.softNudgeEverySecs || 45)}" />
            </label>
          </div>
        </div>
      </details>

      <details class="enforce-details enforce-details--advanced blocker-pane-section blocker-pane-section--advanced">
        <summary>Advanced controls</summary>

        <div class="enforce-group-card blocker-advanced-card">
          <div class="enforce-group-card__head">
            <div>
              <div class="field__label">Browser extension guard</div>
              <div class="meta">Tamper lock, install helpers, and profile export.</div>
            </div>
          </div>
          <div class="row row--3 enforce-grid">
            <label class="field field--inline">
              <span class="field__label">Tamper lock enabled</span>
              <div class="toggle">
                <input id="enfExtensionGuardEnabled" type="checkbox" ${extensionGuard.enabled ? "checked" : ""} />
                <span class="toggle__ui"></span>
              </div>
            </label>
            <label class="field">
              <span class="field__label">Guard browser</span>
              <select id="enfExtensionGuardBrowser" class="input">
                <option value="chrome" ${extensionGuard.browser === "chrome" ? "selected" : ""}>Chrome</option>
                <option value="edge" ${extensionGuard.browser === "edge" ? "selected" : ""}>Edge</option>
                <option value="brave" ${extensionGuard.browser === "brave" ? "selected" : ""}>Brave</option>
              </select>
            </label>
            <label class="field field--inline">
              <span class="field__label">Require install (missing = block)</span>
              <div class="toggle">
                <input id="enfExtensionGuardRequireInstalled" type="checkbox" ${extensionGuard.requireInstalled ? "checked" : ""} />
                <span class="toggle__ui"></span>
              </div>
            </label>
          </div>
          <label class="field">
            <span class="field__label">Tamper check interval (seconds)</span>
            <input
              id="enfExtensionGuardCheckSecs"
              class="input"
              type="number"
              min="${EXTENSION_GUARD_MIN_CHECK_SECS}"
              max="${EXTENSION_GUARD_MAX_CHECK_SECS}"
              step="1"
              value="${Number(extensionGuard.checkEverySecs || 3)}"
            />
          </label>
          <div class="enforce-actions">
            <button class="btn btn--primary" id="enfOpenBrowserExtensionsPageBtn" type="button">Open Extensions Page</button>
            <button class="btn btn--primary" id="enfOpenBrowserExtensionFolderBtn" type="button">Open Extension Folder</button>
            <button class="btn btn--ghost" id="enfExportBrowserExtensionProfileBtn" type="button">Export Profile JSON</button>
          </div>
          <div class="meta">${extensionReady ? `Folder: ${escapeHtml(extensionDir)}` : "Extension bundle missing from app folder."}</div>
          <div class="meta">Install once: chrome://extensions (or edge://extensions) -> Developer mode -> Load unpacked -> choose that folder.</div>
          <div class="meta">After install: open extension Options to import blocker profile and add planner tasks/reminders.</div>
        </div>

        <div class="row row--3 enforce-grid">
          <label class="field">
            <span class="field__label">Nudge after strike</span>
            <input id="enfNudgeAfter" class="input" type="number" min="1" max="20" step="1" value="${Number(cfg.escalation.nudgeAfter)}" />
          </label>
          <label class="field">
            <span class="field__label">Lockout after strike</span>
            <input id="enfLockoutAfter" class="input" type="number" min="1" max="30" step="1" value="${Number(cfg.escalation.lockoutAfter)}" />
          </label>
          <label class="field">
            <span class="field__label">Block after strike</span>
            <input id="enfBlockAfter" class="input" type="number" min="1" max="60" step="1" value="${Number(cfg.escalation.blockAfter)}" />
          </label>
        </div>

        <div class="row row--3 enforce-grid">
          <label class="field">
            <span class="field__label">Strike cooldown (minutes)</span>
            <input id="enfCooldownMins" class="input" type="number" min="1" max="240" step="1" value="${Number(cfg.escalation.cooldownMins)}" />
          </label>
          <label class="field">
            <span class="field__label">Lockout length (minutes)</span>
            <input id="enfLockoutMins" class="input" type="number" min="1" max="240" step="1" value="${Number(cfg.escalation.lockoutMins)}" />
          </label>
          <label class="field">
            <span class="field__label">Block length (minutes)</span>
            <input id="enfBlockMins" class="input" type="number" min="1" max="720" step="1" value="${Number(cfg.escalation.blockMins)}" />
          </label>
        </div>

        <label class="field field--inline">
          <span class="field__label">Kill blocked process on hard block</span>
          <div class="toggle">
            <input id="enfKillOnBlock" type="checkbox" ${cfg.escalation.killProcessOnBlock ? "checked" : ""} />
            <span class="toggle__ui"></span>
          </div>
        </label>

        <label class="field">
          <span class="field__label">YouTube intent question</span>
          <textarea id="enfPromptYoutubeQuestion" class="input enforce-textarea" rows="2">${escapeHtml(cfg.prompts.youtubeIntentQuestion)}</textarea>
        </label>

        <div class="enforce-prompt-grid">
          <label class="field">
            <span class="field__label">Normal nudge</span>
            <textarea id="enfPromptNormalNudge" class="input enforce-textarea" rows="2">${escapeHtml(cfg.prompts.normal.nudge)}</textarea>
          </label>
          <label class="field">
            <span class="field__label">Normal lockout</span>
            <textarea id="enfPromptNormalLockout" class="input enforce-textarea" rows="2">${escapeHtml(cfg.prompts.normal.lockout)}</textarea>
          </label>
          <label class="field">
            <span class="field__label">Normal block</span>
            <textarea id="enfPromptNormalBlock" class="input enforce-textarea" rows="2">${escapeHtml(cfg.prompts.normal.block)}</textarea>
          </label>
          <label class="field">
            <span class="field__label">Hard nudge</span>
            <textarea id="enfPromptHardNudge" class="input enforce-textarea" rows="2">${escapeHtml(cfg.prompts.hard.nudge)}</textarea>
          </label>
          <label class="field">
            <span class="field__label">Hard lockout</span>
            <textarea id="enfPromptHardLockout" class="input enforce-textarea" rows="2">${escapeHtml(cfg.prompts.hard.lockout)}</textarea>
          </label>
          <label class="field">
            <span class="field__label">Hard block</span>
            <textarea id="enfPromptHardBlock" class="input enforce-textarea" rows="2">${escapeHtml(cfg.prompts.hard.block)}</textarea>
          </label>
        </div>
      </details>
        </div>
      </div>
    </div>
  `;
}

function renderEnforcementOverlay() {
  if (!enforcementOverlay.visible) return "";
  ensureEnforcementStateShape();
  const intentQuestion = state.enforcement.prompts.youtubeIntentQuestion || "What are you here to learn?";
  const stageLabels = {
    nudge: "Nudge",
    lockout: "Lockout",
    block: "Hard Block"
  };
  const stage = enforcementOverlay.stage || "nudge";
  const stageLabel = stageLabels[stage] || "Nudge";
  const remaining = enforcementOverlay.lockUntilTs > Date.now()
    ? `Time remaining: ${formatCountdown(enforcementOverlay.lockUntilTs - Date.now())}`
    : "";
  const hardRemaining = enforcementOverlay.hardDeadlineTs > Date.now()
    ? `Close blocked app in ${getHardCountdownLabel(enforcementOverlay.hardDeadlineTs)}`
    : "";
  const hardCycle = enforcementOverlay.hardCycle ? `Cycle ${Number(enforcementOverlay.hardCycle)}` : "";
  const reasonText = enforcementOverlay.reason ? escapeHtml(enforcementOverlay.reason) : "";
  const processText = enforcementOverlay.processName ? `App: ${escapeHtml(enforcementOverlay.processName)}` : "";
  const titleText = enforcementOverlay.title ? `Window: ${escapeHtml(enforcementOverlay.title)}` : "";
  const hardMode = !!enforcementOverlay.hardMode;
  const panelBg = toCssBgUrl(enforcementOverlay.bgImage);
  const panelStyle = panelBg ? ` style="--enf-bg-image:${escapeHtml(panelBg)};"` : "";

  return `
    <div class="enforce-overlay${hardMode ? " enforce-overlay--hard" : ""}" id="enfOverlay">
      <div class="enforce-overlay__backdrop"></div>
      <div class="enforce-overlay__panel"${panelStyle}>
        <div class="enforce-overlay__eyebrow">${escapeHtml(stageLabel)}</div>
        <div class="enforce-overlay__message">${escapeHtml(enforcementOverlay.message || "Back to focus.")}</div>
        ${hardRemaining ? `<div class="enforce-overlay__meta enforce-overlay__meta--strong">${escapeHtml(hardRemaining)} ${hardCycle ? `· ${escapeHtml(hardCycle)}` : ""}</div>` : ""}
        ${reasonText ? `<div class="enforce-overlay__meta">${reasonText}</div>` : ""}
        ${processText ? `<div class="enforce-overlay__meta">${processText}</div>` : ""}
        ${titleText ? `<div class="enforce-overlay__meta">${titleText}</div>` : ""}
        ${remaining ? `<div class="enforce-overlay__meta">${escapeHtml(remaining)}</div>` : ""}

        ${enforcementOverlay.requiresIntent ? `
          <label class="field enforce-overlay__field">
            <span class="field__label">${escapeHtml(intentQuestion)}</span>
            <textarea id="enfIntentInput" class="input enforce-textarea" rows="3" placeholder="State what you are about to learn and why."></textarea>
          </label>
          ${enforcementOverlay.error ? `<div class="field__error">${escapeHtml(enforcementOverlay.error)}</div>` : ""}
        ` : ""}

        <div class="enforce-overlay__actions">
          ${hardMode
            ? `<button class="btn btn--primary" type="button" id="enfHardRecheckBtn">I Closed It - Recheck</button>`
            : enforcementOverlay.requiresIntent
            ? `<button class="btn btn--primary" type="button" id="enfSubmitIntentBtn">Unlock YouTube Temporarily</button>`
            : `<button class="btn btn--primary" type="button" id="enfAcknowledgeBtn">Back To Work</button>`}
          ${hardMode ? "" : `<button class="btn btn--ghost" type="button" id="enfDismissOverlayBtn">Dismiss</button>`}
        </div>
      </div>
    </div>
  `;
}

function setEnforcementOverlay(nextState) {
  const candidate = Object.assign({}, enforcementOverlay, nextState || {});
  if (candidate.visible && !String(candidate.bgImage || "").trim()) {
    candidate.bgImage = pickBlockerBackgroundImage();
  }
  if (!candidate.visible) candidate.bgImage = "";
  const changed = JSON.stringify(candidate) !== JSON.stringify(enforcementOverlay);
  Object.assign(enforcementOverlay, candidate);
  if (changed) render();
}

function clearEnforcementOverlay() {
  setEnforcementOverlay({
    visible: false,
    stage: "nudge",
    reason: "",
    message: "",
    bgImage: "",
    processName: "",
    title: "",
    lockUntilTs: 0,
    hardDeadlineTs: 0,
    hardCycle: 0,
    hardMode: false,
    requiresIntent: false,
    error: ""
  });
}

function getDefaultCanvasSyncState() {
  return {
    enabled: false,
    autoSyncMins: 120,
    assignmentsOnly: true,
    feeds: [
      {
        id: "alamo",
        label: "Alamo",
        color: getCanvasFeedDefaultColor("alamo"),
        url: "",
        enabled: true,
        pageUrl: "https://alamo.instructure.com/calendar#view_name=month&view_start=2026-02-11",
        lastSyncTs: 0,
        lastImported: 0,
        lastError: ""
      },
      {
        id: "utsa",
        label: "UTSA",
        color: getCanvasFeedDefaultColor("utsa"),
        url: "",
        enabled: true,
        pageUrl: "https://utsa.instructure.com/calendar#view_name=month",
        lastSyncTs: 0,
        lastImported: 0,
        lastError: ""
      }
    ],
    importedByKey: {},
    autopilot: {
      enabled: true,
      leadWindowDays: 7,
      blockMins: 60,
      maxBlocksPerAssignment: 4,
      quietEndMins: CANVAS_AUTOPILOT_DEFAULT_QUIET_END_MINS,
      blocksByKey: {},
      lastRunTs: 0,
      lastSummary: "",
      lastError: ""
    },
    lastSyncTs: 0,
    lastSummary: "",
    lastError: ""
  };
}

function ensureCanvasSyncStateShape() {
  const defaults = getDefaultCanvasSyncState();
  if (!state.canvasSync || typeof state.canvasSync !== "object") {
    state.canvasSync = cloneJson(defaults);
  }
  const cfg = state.canvasSync;
  cfg.enabled = !!cfg.enabled;
  cfg.autoSyncMins = toBoundedInt(cfg.autoSyncMins, CANVAS_SYNC_MIN_MINS, CANVAS_SYNC_MAX_MINS, defaults.autoSyncMins);
  cfg.assignmentsOnly = typeof cfg.assignmentsOnly === "boolean" ? cfg.assignmentsOnly : defaults.assignmentsOnly;

  const feedsById = new Map(toList(cfg.feeds).filter(Boolean).map(f => [String(f.id || "").toLowerCase(), f]));
  cfg.feeds = defaults.feeds.map(base => {
    const incoming = feedsById.get(base.id) || {};
    return {
      id: base.id,
      label: base.label,
      color: normalizeHexColor(incoming.color) || normalizeHexColor(base.color) || getCanvasFeedDefaultColor(base.id),
      url: String(incoming.url || ""),
      enabled: typeof incoming.enabled === "boolean" ? incoming.enabled : base.enabled,
      pageUrl: String(incoming.pageUrl || base.pageUrl),
      lastSyncTs: Number(incoming.lastSyncTs) || 0,
      lastImported: toBoundedInt(incoming.lastImported, 0, 9999, 0),
      lastError: String(incoming.lastError || "")
    };
  });

  cfg.importedByKey = cfg.importedByKey && typeof cfg.importedByKey === "object" ? cfg.importedByKey : {};

  const apDefaults = defaults.autopilot || {};
  if (!cfg.autopilot || typeof cfg.autopilot !== "object") cfg.autopilot = cloneJson(apDefaults);
  const ap = cfg.autopilot;
  ap.enabled = typeof ap.enabled === "boolean" ? ap.enabled : !!apDefaults.enabled;
  ap.leadWindowDays = toBoundedInt(ap.leadWindowDays, CANVAS_AUTOPILOT_MIN_LEAD_DAYS, CANVAS_AUTOPILOT_MAX_LEAD_DAYS, apDefaults.leadWindowDays || 7);
  ap.blockMins = toBoundedInt(ap.blockMins, CANVAS_AUTOPILOT_MIN_BLOCK_MINS, CANVAS_AUTOPILOT_MAX_BLOCK_MINS, apDefaults.blockMins || 60);
  ap.maxBlocksPerAssignment = toBoundedInt(ap.maxBlocksPerAssignment, CANVAS_AUTOPILOT_MIN_BLOCKS, CANVAS_AUTOPILOT_MAX_BLOCKS, apDefaults.maxBlocksPerAssignment || 4);
  ap.quietEndMins = toBoundedInt(ap.quietEndMins, 0, 24 * 60, apDefaults.quietEndMins || CANVAS_AUTOPILOT_DEFAULT_QUIET_END_MINS);
  ap.blocksByKey = ap.blocksByKey && typeof ap.blocksByKey === "object" ? ap.blocksByKey : {};
  ap.lastRunTs = Number(ap.lastRunTs) || 0;
  ap.lastSummary = String(ap.lastSummary || "");
  ap.lastError = String(ap.lastError || "");

  cfg.lastSyncTs = Number(cfg.lastSyncTs) || 0;
  cfg.lastSummary = String(cfg.lastSummary || "");
  cfg.lastError = String(cfg.lastError || "");
}

function getDefaultMorningGateState() {
  return {
    enabled: true,
    baselineHour: 6,
    requiredGoals: 3,
    lastCompletedDayKey: "",
    activeDayKey: "",
    days: {}
  };
}

function ensureMorningGateStateShape() {
  const defaults = getDefaultMorningGateState();
  if (!state.morningGate || typeof state.morningGate !== "object") {
    state.morningGate = cloneJson(defaults);
  }
  const mg = state.morningGate;
  mg.enabled = typeof mg.enabled === "boolean" ? mg.enabled : defaults.enabled;
  mg.baselineHour = toBoundedInt(mg.baselineHour, 0, 23, defaults.baselineHour);
  mg.requiredGoals = toBoundedInt(mg.requiredGoals, 1, 5, defaults.requiredGoals);
  mg.lastCompletedDayKey = String(mg.lastCompletedDayKey || "");
  mg.activeDayKey = String(mg.activeDayKey || "");
  mg.days = mg.days && typeof mg.days === "object" ? mg.days : {};
}

function getBaselineDayKeyISO(now = new Date(), baselineHour = 6) {
  const base = toBoundedInt(baselineHour, 0, 23, 6);
  const d = new Date(now);
  if (Number(d.getHours()) < base) {
    d.setDate(d.getDate() - 1);
  }
  return toISO(d);
}

function getDefaultWorkoutSyncSettings() {
  return {
    url: "",
    token: "",
    lastSyncTs: 0,
    lastError: ""
  };
}

function getDefaultWorkoutCache() {
  return {
    exercisesById: {},
    routinesById: {},
    sessionsById: {},
    setsById: {}
  };
}

function ensureWorkoutStateShape() {
  if (!state.settings || typeof state.settings !== "object") state.settings = {};
  const defaults = getDefaultWorkoutSyncSettings();
  if (!state.settings.workoutSync || typeof state.settings.workoutSync !== "object") {
    state.settings.workoutSync = cloneJson(defaults);
  }
  const ws = state.settings.workoutSync;
  ws.url = normalizeWorkoutExecUrl(ws.url);
  ws.token = String(ws.token || "");
  ws.lastSyncTs = Number(ws.lastSyncTs) || 0;
  ws.lastError = String(ws.lastError || "");

  if (!state.workouts || typeof state.workouts !== "object") {
    state.workouts = getDefaultWorkoutCache();
  }
  const w = state.workouts;
  w.exercisesById = w.exercisesById && typeof w.exercisesById === "object" ? w.exercisesById : {};
  w.routinesById = w.routinesById && typeof w.routinesById === "object" ? w.routinesById : {};
  w.sessionsById = w.sessionsById && typeof w.sessionsById === "object" ? w.sessionsById : {};
  w.setsById = w.setsById && typeof w.setsById === "object" ? w.setsById : {};
  return { ws, w };
}

function getCanvasFeedColorById(sourceId) {
  ensureCanvasSyncStateShape();
  const id = String(sourceId || "").trim().toLowerCase();
  const feed = (state.canvasSync.feeds || []).find(f => String(f.id || "").toLowerCase() === id);
  return normalizeHexColor(feed && feed.color) || getCanvasFeedDefaultColor(id);
}

function applyCanvasFeedColorToImportedCommitments(sourceId, colorHex) {
  const targetId = String(sourceId || "").trim().toLowerCase();
  const nextColor = normalizeHexColor(colorHex);
  if (!targetId || !nextColor) return 0;
  let touched = 0;
  Object.values(state.sprints || {}).forEach(sp => {
    (sp.commitments || []).forEach(c => {
      if (!c || c.externalSource !== "canvas") return;
      if (String(c.externalSourceId || "").trim().toLowerCase() !== targetId) return;
      c.color = nextColor;
      touched += 1;
    });
  });
  return touched;
}

function isLikelyCanvasCalendarPageUrl(url) {
  const v = String(url || "").toLowerCase();
  return v.includes("/calendar#") || v.endsWith("/calendar");
}

function decodeIcsText(v) {
  return String(v || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function unfoldIcsLines(rawText) {
  const lines = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const out = [];
  lines.forEach(line => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  });
  return out;
}

function parseIcsDateValue(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  let m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    return { date: new Date(y, mo, d, 9, 0, 0, 0), allDay: true };
  }

  m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6] || 0);
  const hasZulu = !!m[7];
  const date = hasZulu
    ? new Date(Date.UTC(y, mo, d, hh, mm, ss))
    : new Date(y, mo, d, hh, mm, ss, 0);
  return { date, allDay: false };
}

function parseIcsEvents(icsText) {
  const lines = unfoldIcsLines(icsText);
  const events = [];
  let current = null;
  lines.forEach(line => {
    const token = String(line || "").trim();
    if (token === "BEGIN:VEVENT") {
      current = {};
      return;
    }
    if (token === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      return;
    }
    if (!current) return;

    const idx = line.indexOf(":");
    if (idx <= 0) return;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const headParts = head.split(";");
    const key = String(headParts[0] || "").toUpperCase();
    if (!key) return;
    const params = {};
    headParts.slice(1).forEach(part => {
      const eq = part.indexOf("=");
      if (eq > 0) {
        const pKey = String(part.slice(0, eq) || "").toUpperCase();
        const pVal = String(part.slice(eq + 1) || "");
        params[pKey] = pVal;
      }
    });
    if (!current[key]) current[key] = [];
    current[key].push({
      value: decodeIcsText(value),
      rawValue: value,
      params
    });
  });
  return events;
}

function getFirstIcsValue(eventObj, key) {
  const arr = eventObj && eventObj[String(key || "").toUpperCase()];
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function normalizeCanvasIcsEvent(rawEvent, sourceId) {
  if (!rawEvent || typeof rawEvent !== "object") return null;
  const uidRec = getFirstIcsValue(rawEvent, "UID");
  const summaryRec = getFirstIcsValue(rawEvent, "SUMMARY");
  const descRec = getFirstIcsValue(rawEvent, "DESCRIPTION");
  const urlRec = getFirstIcsValue(rawEvent, "URL");
  const dueRec = getFirstIcsValue(rawEvent, "DUE") || getFirstIcsValue(rawEvent, "DTSTART");
  const dueParsed = dueRec ? parseIcsDateValue(dueRec.rawValue || dueRec.value) : null;

  if (!summaryRec || !dueParsed || !(dueParsed.date instanceof Date) || Number.isNaN(dueParsed.date.getTime())) {
    return null;
  }

  const dueISO = toISO(dueParsed.date);
  const dueMins = (dueParsed.date.getHours() * 60) + dueParsed.date.getMinutes();
  const title = String(summaryRec.value || "").trim();
  const description = String(descRec ? descRec.value : "").trim();
  const url = String(urlRec ? urlRec.value : "").trim();
  const uid = String(uidRec ? uidRec.value : "").trim();
  const key = uid
    ? `${sourceId}|uid:${uid.toLowerCase()}`
    : url
      ? `${sourceId}|url:${url.toLowerCase()}`
      : `${sourceId}|title:${title.toLowerCase()}|due:${dueISO}`;

  return {
    key,
    sourceId,
    uid,
    title,
    description,
    url,
    dueDate: dueParsed.date,
    dueISO,
    startTime: dueParsed.allDay ? "" : minutesToTime(dueMins),
    allDay: !!dueParsed.allDay
  };
}

function isLikelyCanvasAssignment(item) {
  const src = `${item && item.title ? item.title : ""}\n${item && item.description ? item.description : ""}\n${item && item.url ? item.url : ""}`.toLowerCase();
  if (!src) return false;
  if (src.includes("/assignments/")) return true;
  if (/\bassignment\b/.test(src)) return true;
  return false;
}

function fetchTextFromUrl(url, { timeoutMs = 15000, maxRedirects = 4 } = {}) {
  const target = String(url || "").trim();
  if (!target) return Promise.reject(new Error("Empty URL"));
  let parsed = null;
  try {
    parsed = new URL(target);
  } catch (err) {
    return Promise.reject(new Error("Invalid URL"));
  }
  const proto = String(parsed.protocol || "").toLowerCase();
  const requestImpl = proto === "https:" ? httpsRequestSafe : proto === "http:" ? httpRequestSafe : null;
  if (!requestImpl) return Promise.reject(new Error("Unsupported URL protocol"));

  return new Promise((resolve, reject) => {
    let req = null;
    try {
      // Use plain string URL for broad compatibility in Electron renderer contexts.
      req = requestImpl(target, {
        method: "GET",
        headers: {
          "User-Agent": "Trajectory-CanvasSync/1.0",
          "Accept": "text/calendar,text/plain,*/*"
        }
      }, res => {
        const status = Number(res.statusCode || 0);
        const location = res.headers && res.headers.location ? String(res.headers.location) : "";
        if (status >= 300 && status < 400 && location && maxRedirects > 0) {
          const nextUrl = new URL(location, parsed).toString();
          res.resume();
          fetchTextFromUrl(nextUrl, { timeoutMs, maxRedirects: maxRedirects - 1 }).then(resolve).catch(reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        let body = "";
        try { res.setEncoding("utf8"); } catch (_) {}
        res.on("data", chunk => { body += String(chunk || ""); });
        res.on("end", () => {
          resolve(body);
        });
      });
    } catch (err) {
      reject(err);
      return;
    }
    req.on("error", err => reject(err));
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(new Error("Request timeout")); } catch (_) {}
    });
    req.end();
  });
}

function sendExtensionSyncResponse(res, statusCode, payload) {
  const code = Number(statusCode) || 200;
  const body = JSON.stringify(payload || {});
  try {
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end(body);
  } catch (_) {
    try { res.end(); } catch (_) {}
  }
}

function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", chunk => {
      const piece = String(chunk || "");
      size += Buffer.byteLength(piece, "utf8");
      if (size > maxBytes) {
        reject(new Error("payload-too-large"));
        try { req.destroy(); } catch (_) {}
        return;
      }
      body += piece;
    });
    req.on("end", () => resolve(body));
    req.on("error", err => reject(err));
  });
}

function ensureExtensionPlannerBridgeServer() {
  if (_extensionPlannerBridgeServer) return;
  if (!httpSafe || typeof httpSafe.createServer !== "function") return;
  try {
    const server = httpSafe.createServer(async (req, res) => {
      const method = String((req && req.method) || "GET").toUpperCase();
      const reqUrl = String((req && req.url) || "/");
      const parsedUrl = new URL(reqUrl, `http://${EXTENSION_PLANNER_SYNC_HOST}:${EXTENSION_PLANNER_SYNC_PORT}`);
      const route = String(parsedUrl.pathname || "").trim();

      if (method === "OPTIONS") {
        sendExtensionSyncResponse(res, 204, { ok: true });
        return;
      }

      if (method === "GET" && route === EXTENSION_PLANNER_SYNC_HEALTH_ROUTE) {
        const plannerTaskCount = Object.values(state.sprints || {}).reduce((sum, sprint) => {
          const count = (sprint && Array.isArray(sprint.commitments))
            ? sprint.commitments.filter(c => c && String(c.externalSource || "").toLowerCase() === EXTENSION_PLANNER_SOURCE).length
            : 0;
          return sum + count;
        }, 0);
        sendExtensionSyncResponse(res, 200, {
          ok: true,
          app: "trajectory",
          route: EXTENSION_PLANNER_SYNC_ROUTE,
          taskCount: plannerTaskCount,
          ts: Date.now()
        });
        return;
      }

      if (method !== "POST" || route !== EXTENSION_PLANNER_SYNC_ROUTE) {
        sendExtensionSyncResponse(res, 404, { ok: false, error: "not-found" });
        return;
      }

      try {
        const rawBody = await readRequestBody(req, 1024 * 1024);
        let payload = {};
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch (_) {
          sendExtensionSyncResponse(res, 400, { ok: false, error: "invalid-json" });
          return;
        }
        const result = applyExtensionPlannerPayload(payload);
        sendExtensionSyncResponse(res, 200, result);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err || "sync-error");
        const code = msg.includes("payload-too-large") ? 413 : 500;
        sendExtensionSyncResponse(res, code, { ok: false, error: msg });
      }
    });

    server.on("error", err => {
      const msg = String(err && err.message ? err.message : err || "bridge-error");
      if (String(err && err.code || "") === "EADDRINUSE") {
        console.warn(`Extension planner sync bridge port ${EXTENSION_PLANNER_SYNC_PORT} already in use.`);
        return;
      }
      console.warn("Extension planner sync bridge error:", msg);
    });

    server.listen(EXTENSION_PLANNER_SYNC_PORT, EXTENSION_PLANNER_SYNC_HOST, () => {
      console.info(`Extension planner sync bridge listening on http://${EXTENSION_PLANNER_SYNC_HOST}:${EXTENSION_PLANNER_SYNC_PORT}${EXTENSION_PLANNER_SYNC_ROUTE}`);
    });
    _extensionPlannerBridgeServer = server;
  } catch (err) {
    console.warn("Failed to start extension planner sync bridge", err);
  }
}

function stopExtensionPlannerBridgeServer() {
  if (!_extensionPlannerBridgeServer) return;
  try {
    _extensionPlannerBridgeServer.close(() => {});
  } catch (_) {}
  _extensionPlannerBridgeServer = null;
}

function findCommitmentRecordById(id) {
  if (!id) return null;
  let found = null;
  Object.entries(state.sprints || {}).some(([weekStartISO, sprint]) => {
    const idx = (sprint.commitments || []).findIndex(c => c.id === id);
    if (idx === -1) return false;
    found = {
      weekStartISO,
      sprint,
      index: idx,
      commitment: sprint.commitments[idx]
    };
    return true;
  });
  return found;
}

function normalizeExtensionPlannerTaskPayload(rawTask) {
  const src = rawTask && typeof rawTask === "object" ? rawTask : {};
  const id = String(src.id || "").trim();
  const title = String(src.title || "").trim();
  if (!id || !title) return null;
  const dueTsRaw = Number(src.dueTs);
  const dueTs = Number.isFinite(dueTsRaw) && dueTsRaw > 0 ? Math.round(dueTsRaw) : 0;
  return {
    id,
    title,
    plan: String(src.plan || "").trim(),
    notes: String(src.notes || "").trim(),
    dueTs,
    reminderMins: toBoundedInt(src.reminderMins, 0, 1440, 20),
    done: !!src.done
  };
}

function buildExtensionPlannerDeliverable(task) {
  if (!task) return "";
  const parts = [];
  if (task.plan) parts.push(`Plan: ${task.plan}`);
  if (task.notes) parts.push(task.notes);
  if (task.dueTs) {
    const dueDate = new Date(task.dueTs);
    if (!Number.isNaN(dueDate.getTime())) parts.push(`Due: ${dueDate.toLocaleString()}`);
  }
  return parts.join(" · ").slice(0, 240);
}

function findExtensionPlannerCommitmentRecord(taskId) {
  const key = String(taskId || "").trim();
  if (!key) return null;
  let found = null;
  Object.entries(state.sprints || {}).some(([weekStartISO, sprint]) => {
    const idx = (sprint.commitments || []).findIndex(c =>
      c
      && String(c.externalSource || "").trim().toLowerCase() === EXTENSION_PLANNER_SOURCE
      && String(c.externalTaskId || "").trim() === key
    );
    if (idx === -1) return false;
    found = {
      weekStartISO,
      sprint,
      index: idx,
      commitment: sprint.commitments[idx]
    };
    return true;
  });
  return found;
}

function upsertExtensionPlannerTask(task) {
  const incoming = normalizeExtensionPlannerTaskPayload(task);
  if (!incoming) return { action: "skipped", reason: "invalid-task" };

  const now = Date.now();
  let dueDate = incoming.dueTs ? new Date(incoming.dueTs) : new Date();
  if (Number.isNaN(dueDate.getTime())) dueDate = new Date();
  const targetDateISO = toISO(dueDate);
  const target = getOrCreateSprintForISO(targetDateISO);
  const targetWeekISO = target.weekStartISO;
  const targetDayIndex = clampDay(dayIndexForDate(fromISO(targetWeekISO), dueDate));
  const targetStartMins = (dueDate.getHours() * 60) + dueDate.getMinutes();
  const targetStartTime = incoming.dueTs ? minutesToTime(targetStartMins) : "";
  const targetDeliverable = buildExtensionPlannerDeliverable(incoming);

  let record = findExtensionPlannerCommitmentRecord(incoming.id);
  if (!record) {
    const newCommit = {
      id: uuid(),
      title: incoming.title,
      deliverable: targetDeliverable,
      nextAction: "",
      estHours: 1,
      dayIndex: targetDayIndex,
      done: false,
      stat: "INT",
      color: colorForStat("INT"),
      externalSource: EXTENSION_PLANNER_SOURCE,
      externalTaskId: incoming.id,
      externalEventKey: `${EXTENSION_PLANNER_SOURCE}:${incoming.id}`,
      externalPlan: incoming.plan,
      externalNotes: incoming.notes,
      externalReminderMins: incoming.reminderMins,
      externalDueTs: incoming.dueTs,
      externalLastSyncTs: now
    };
    if (incoming.dueTs) {
      newCommit.dateISO = targetDateISO;
      newCommit.startTime = targetStartTime;
      newCommit.durationMins = 60;
    }
    setCommitDoneStatus(newCommit, incoming.done, targetWeekISO);
    target.sprint.commitments.push(newCommit);
    return { action: "created", commitmentId: newCommit.id };
  }

  const commit = record.commitment;
  commit.title = incoming.title;
  commit.deliverable = targetDeliverable;
  commit.estHours = Number(commit.estHours) > 0 ? Number(commit.estHours) : 1;
  commit.stat = commit.stat || "INT";
  commit.color = normalizeHexColor(commit.color) || colorForStat(commit.stat);
  commit.dayIndex = targetDayIndex;
  commit.externalSource = EXTENSION_PLANNER_SOURCE;
  commit.externalTaskId = incoming.id;
  commit.externalEventKey = `${EXTENSION_PLANNER_SOURCE}:${incoming.id}`;
  commit.externalPlan = incoming.plan;
  commit.externalNotes = incoming.notes;
  commit.externalReminderMins = incoming.reminderMins;
  commit.externalDueTs = incoming.dueTs;
  commit.externalLastSyncTs = now;

  if (incoming.dueTs) {
    commit.dateISO = targetDateISO;
    commit.startTime = targetStartTime;
    commit.durationMins = Number(commit.durationMins) > 0 ? Number(commit.durationMins) : 60;
  } else {
    delete commit.dateISO;
    delete commit.startTime;
    delete commit.durationMins;
  }

  let finalWeekISO = record.weekStartISO;
  let moved = false;
  if (record.weekStartISO !== targetWeekISO) {
    record.sprint.commitments.splice(record.index, 1);
    target.sprint.commitments.push(commit);
    finalWeekISO = targetWeekISO;
    moved = true;
  }
  setCommitDoneStatus(commit, incoming.done, finalWeekISO);
  return { action: moved ? "moved" : "updated", commitmentId: commit.id };
}

function removeStaleExtensionPlannerCommitments(allowedTaskIds) {
  const allow = allowedTaskIds instanceof Set ? allowedTaskIds : new Set();
  let removed = 0;
  Object.values(state.sprints || {}).forEach(sprint => {
    if (!sprint || !Array.isArray(sprint.commitments)) return;
    const before = sprint.commitments.length;
    sprint.commitments = sprint.commitments.filter(c => {
      if (!c || String(c.externalSource || "").trim().toLowerCase() !== EXTENSION_PLANNER_SOURCE) return true;
      const taskId = String(c.externalTaskId || "").trim();
      return taskId && allow.has(taskId);
    });
    removed += Math.max(0, before - sprint.commitments.length);
  });
  return removed;
}

function applyExtensionPlannerPayload(payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  const replace = src.replace !== false;
  const rawTasks = Array.isArray(src.tasks)
    ? src.tasks
    : (src.planner && Array.isArray(src.planner.tasks) ? src.planner.tasks : []);

  const byId = new Map();
  rawTasks.forEach(raw => {
    const task = normalizeExtensionPlannerTaskPayload(raw);
    if (task) byId.set(task.id, task);
  });
  const tasks = Array.from(byId.values());
  const incomingIds = new Set(tasks.map(t => t.id));

  let created = 0;
  let updated = 0;
  let moved = 0;
  let skipped = 0;

  tasks.forEach(task => {
    const result = upsertExtensionPlannerTask(task);
    if (!result || result.action === "skipped") {
      skipped += 1;
      return;
    }
    if (result.action === "created") created += 1;
    else if (result.action === "moved") moved += 1;
    else updated += 1;
  });

  const removed = replace ? removeStaleExtensionPlannerCommitments(incomingIds) : 0;
  saveState();
  render();
  return {
    ok: true,
    stats: { created, updated, moved, removed, skipped, totalIncoming: tasks.length, replace }
  };
}

function applyCanvasItemToCommitment(commitment, item) {
  if (!commitment || !item) return;
  const dueDate = fromISO(item.dueISO);
  const dueWeekStartISO = toISO(getWeekStart(dueDate));
  const classColor = getCanvasFeedColorById(item.sourceId);
  commitment.title = String(item.title || "Canvas assignment");
  commitment.deliverable = String(item.description || "").slice(0, 240);
  commitment.nextAction = "Open assignment and submit before due time.";
  commitment.stat = commitment.stat || "INT";
  commitment.color = classColor;
  commitment.dateISO = item.dueISO;
  commitment.dayIndex = clampDay(dayIndexForDate(fromISO(dueWeekStartISO), dueDate));
  if (item.startTime) {
    commitment.startTime = item.startTime;
    commitment.durationMins = Number(commitment.durationMins) > 0 ? Number(commitment.durationMins) : 60;
  } else {
    delete commitment.startTime;
    delete commitment.durationMins;
  }
  commitment.externalSource = "canvas";
  commitment.externalSourceId = item.sourceId;
  commitment.externalEventKey = item.key;
  commitment.externalUid = item.uid || "";
  commitment.externalUrl = item.url || "";
  commitment.externalLastSyncTs = Date.now();
  if (!Array.isArray(commitment.tags)) commitment.tags = [];
  if (!commitment.tags.includes("canvas")) commitment.tags.push("canvas");
}

function upsertCanvasItem(item) {
  ensureCanvasSyncStateShape();
  if (!item || !item.key || !item.dueISO) return { action: "skipped", reason: "invalid-item" };

  const target = getOrCreateSprintForISO(item.dueISO);
  const targetSprint = target.sprint;
  const map = state.canvasSync.importedByKey || (state.canvasSync.importedByKey = {});
  const mappedCommitId = String(map[item.key] || "");
  let record = mappedCommitId ? findCommitmentRecordById(mappedCommitId) : null;

  if (!record) {
    // Recovery path if map got stale: find by external event key.
    Object.entries(state.sprints || {}).some(([weekStartISO, sprint]) => {
      const idx = (sprint.commitments || []).findIndex(c => c && c.externalEventKey === item.key);
      if (idx === -1) return false;
      record = {
        weekStartISO,
        sprint,
        index: idx,
        commitment: sprint.commitments[idx]
      };
      return true;
    });
  }

  if (record) {
    // Move commitment between week buckets if due date changed.
    if (record.weekStartISO !== target.weekStartISO) {
      record.sprint.commitments.splice(record.index, 1);
      targetSprint.commitments.push(record.commitment);
      record = {
        weekStartISO: target.weekStartISO,
        sprint: targetSprint,
        index: targetSprint.commitments.length - 1,
        commitment: targetSprint.commitments[targetSprint.commitments.length - 1]
      };
    }
    applyCanvasItemToCommitment(record.commitment, item);
    map[item.key] = record.commitment.id;
    return { action: "updated", id: record.commitment.id };
  }

  const newCommit = {
    id: uuid(),
    title: String(item.title || "Canvas assignment"),
    deliverable: "",
    estHours: 1,
    dayIndex: clampDay(dayIndexForDate(fromISO(target.weekStartISO), fromISO(item.dueISO))),
    nextAction: "",
    done: false,
    stat: "INT",
    color: colorForStat("INT"),
    isFocus: false,
    dateISO: item.dueISO
  };
  applyCanvasItemToCommitment(newCommit, item);
  targetSprint.commitments.push(newCommit);
  map[item.key] = newCommit.id;
  return { action: "created", id: newCommit.id };
}

async function syncCanvasFeeds({ manual = false } = {}) {
  ensureCanvasSyncStateShape();
  const cfg = state.canvasSync;
  if (_canvasSyncTickBusy) {
    return {
      ok: false,
      message: "Canvas sync already running.",
      created: 0,
      updated: 0,
      skipped: 0
    };
  }
  _canvasSyncTickBusy = true;
  try {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];
    let configuredFeedCount = 0;
    const nowTs = Date.now();
    const importedAssignments = [];

    for (const feed of cfg.feeds) {
      if (!feed.enabled) continue;
      const rawUrl = String(feed.url || "").trim();
      if (!rawUrl) continue;
      configuredFeedCount += 1;
      if (isLikelyCanvasCalendarPageUrl(rawUrl)) {
        const msg = `${feed.label}: that looks like the calendar page. Use "Open Calendar", then copy the Calendar Feed link and paste it here.`;
        feed.lastError = msg;
        errors.push(msg);
        continue;
      }

      try {
        const text = await fetchTextFromUrl(rawUrl);
        const events = parseIcsEvents(text)
          .map(ev => normalizeCanvasIcsEvent(ev, feed.id))
          .filter(Boolean);
        const candidates = cfg.assignmentsOnly
          ? events.filter(isLikelyCanvasAssignment)
          : events;
        const assignmentItemsForAutopilot = candidates.filter(isLikelyCanvasAssignment);

        let feedChanges = 0;
        candidates.forEach(item => {
          const result = upsertCanvasItem(item);
          if (result.action === "created") { created += 1; feedChanges += 1; }
          else if (result.action === "updated") { updated += 1; feedChanges += 1; }
          else skipped += 1;
        });
        assignmentItemsForAutopilot.forEach(it => importedAssignments.push(it));

        feed.lastSyncTs = nowTs;
        feed.lastImported = feedChanges;
        feed.lastError = "";
      } catch (err) {
        const msg = `${feed.label}: ${String(err && err.message ? err.message : err || "Unknown error")}`;
        feed.lastError = msg;
        errors.push(msg);
      }
    }

    cfg.lastSyncTs = nowTs;
    cfg.lastSummary = configuredFeedCount
      ? `Created ${created}, updated ${updated}, skipped ${skipped}.`
      : "No school sync links set yet. Use Open Calendar, copy Calendar Feed, then paste.";
    cfg.lastError = errors.join(" | ");
    try {
      runCanvasAutopilot({ importedItems: importedAssignments, manual: false, save: false, rerender: false });
    } catch (err) {
      if (cfg.autopilot && typeof cfg.autopilot === "object") {
        cfg.autopilot.lastError = String(err && err.message ? err.message : err || "autopilot-failed");
      }
    }
    saveState();
    if (manual) render();
    return {
      ok: errors.length === 0,
      message: cfg.lastSummary + (cfg.lastError ? ` Errors: ${cfg.lastError}` : ""),
      created,
      updated,
      skipped
    };
  } finally {
    _canvasSyncTickBusy = false;
  }
}

function ensureCanvasSyncTicker() {
  ensureCanvasSyncStateShape();
  const cfg = state.canvasSync;
  if (!cfg.enabled) {
    if (_canvasSyncTimerId) {
      clearInterval(_canvasSyncTimerId);
      _canvasSyncTimerId = null;
      _canvasSyncTimerMs = 0;
    }
    return;
  }
  const intervalMs = toBoundedInt(cfg.autoSyncMins, CANVAS_SYNC_MIN_MINS, CANVAS_SYNC_MAX_MINS, 120) * 60 * 1000;
  if (_canvasSyncTimerId && _canvasSyncTimerMs !== intervalMs) {
    clearInterval(_canvasSyncTimerId);
    _canvasSyncTimerId = null;
    _canvasSyncTimerMs = 0;
  }
  if (!_canvasSyncTimerId) {
    _canvasSyncTimerMs = intervalMs;
    _canvasSyncTimerId = setInterval(() => {
      void syncCanvasFeeds({ manual: false });
    }, intervalMs);
    if (!cfg.lastSyncTs || (Date.now() - cfg.lastSyncTs) > Math.min(intervalMs, 30 * 60 * 1000)) {
      void syncCanvasFeeds({ manual: false });
    }
  }
}

function collectCanvasItemsFromImportedCommitmentsForAutopilot() {
  // Use the existing Canvas-imported commitments as a source of truth for manual runs.
  // These commitments are the "due markers" created by upsertCanvasItem().
  const items = [];
  Object.values(state.sprints || {}).forEach(sp => {
    (sp.commitments || []).forEach(c => {
      if (!c) return;
      if (String(c.externalSource || "").trim().toLowerCase() !== "canvas") return;
      const key = String(c.externalEventKey || "").trim();
      const dueISO = String(c.dateISO || "").trim();
      if (!key || !dueISO) return;
      items.push({
        key,
        sourceId: String(c.externalSourceId || "").trim(),
        uid: String(c.externalUid || "").trim(),
        title: String(c.title || "").trim(),
        description: String(c.deliverable || "").trim(),
        url: String(c.externalUrl || "").trim(),
        dueISO,
        startTime: String(c.startTime || "").trim()
      });
    });
  });
  return items;
}

function computeCanvasAutopilotDesiredBlocks(item, apCfg) {
  const dueISO = String(item && item.dueISO ? item.dueISO : "").trim();
  if (!dueISO) return { ok: false, reason: "missing-due" };

  const todayISO = toISO(new Date());
  const daysUntilDue = Math.floor((fromISO(dueISO).getTime() - fromISO(todayISO).getTime()) / (24 * 60 * 60 * 1000));
  if (!Number.isFinite(daysUntilDue)) return { ok: false, reason: "bad-due" };
  if (daysUntilDue < 0) return { ok: false, reason: "past-due" };
  if (daysUntilDue > Number(apCfg.leadWindowDays || 7)) return { ok: false, reason: "outside-window" };

  let blockCount = 1;
  if (daysUntilDue <= 1) blockCount = 1;
  else if (daysUntilDue <= 3) blockCount = 2;
  else if (daysUntilDue <= 6) blockCount = 3;
  else blockCount = 4;

  const blob = `${item && item.title ? item.title : ""}\n${item && item.description ? item.description : ""}`.toLowerCase();
  let durationMins = toBoundedInt(apCfg.blockMins, CANVAS_AUTOPILOT_MIN_BLOCK_MINS, CANVAS_AUTOPILOT_MAX_BLOCK_MINS, 60);

  if (blob.includes("discussion")) {
    blockCount = 1;
    durationMins = 30;
  } else if (/(final|midterm|exam|test|project|paper|essay)/i.test(blob)) {
    blockCount = Math.max(blockCount, 2);
  }

  blockCount = toBoundedInt(blockCount, 1, toBoundedInt(apCfg.maxBlocksPerAssignment, CANVAS_AUTOPILOT_MIN_BLOCKS, CANVAS_AUTOPILOT_MAX_BLOCKS, 4), 1);
  return { ok: true, daysUntilDue, blockCount, durationMins };
}

function computeAutopilotTargetDates({ dueISO, leadWindowDays, blockCount }) {
  const todayISO = toISO(new Date());
  const dueDate = fromISO(dueISO);
  const startCandidateISO = toISO(addDays(dueDate, -toBoundedInt(leadWindowDays, 0, 60, 7)));
  let startISO = startCandidateISO < todayISO ? todayISO : startCandidateISO;
  if (startISO > dueISO) startISO = dueISO;

  const startDate = fromISO(startISO);
  const dateCount = Math.max(1, Math.floor((fromISO(dueISO).getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const out = [];
  for (let i = 0; i < blockCount; i++) {
    const dateIndex = Math.floor((i * dateCount) / Math.max(1, blockCount));
    const d = addDays(startDate, dateIndex);
    const iso = toISO(d);
    out.push(iso > dueISO ? dueISO : iso);
  }
  return out;
}

function getScheduledBlocksForDateExcludingCommit(dateISO, excludeCommitId) {
  const day = computePlanDayItems(dateISO);
  return (day.scheduled || [])
    .filter(entry => {
      const c = entry && entry.c;
      if (!c) return false;
      if (c.__isOccurrence) return true;
      return String(c.id || "") !== String(excludeCommitId || "");
    })
    .map(entry => ({
      startMins: Number(entry.startMins),
      durationMins: Math.max(PLAN_MIN_DURATION_MINS, Number(entry.durationMins || 0))
    }))
    .filter(entry => Number.isFinite(entry.startMins) && Number.isFinite(entry.durationMins))
    .sort((a, b) => a.startMins - b.startMins);
}

function findNextAvailableStartAfterWindow(scheduled, durationMins, minStartMins, quietEndMins) {
  const dur = Math.max(PLAN_MIN_DURATION_MINS, Number(durationMins || 0));
  const end = clampMinutes(Number(quietEndMins || 0), 0, 24 * 60);
  let cursor = clampMinutes(Number(minStartMins || 0), 0, Math.max(0, 1440 - dur));
  cursor = Math.max(cursor, PLAN_DEFAULT_START_MINS);
  if (cursor + dur > end) return null;
  const blocks = (scheduled || []).slice().sort((a, b) => a.startMins - b.startMins);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (cursor + dur <= b.startMins) break;
    cursor = Math.max(cursor, b.startMins + b.durationMins);
    if (cursor + dur > end) return null;
  }
  if (cursor + dur > end) return null;
  return clampMinutes(cursor, 0, Math.max(0, 1440 - dur));
}

function moveCommitmentRecordToDateISO(record, dateISO) {
  if (!record || !record.commitment || !dateISO) return record;
  const target = getOrCreateSprintForISO(dateISO);
  if (record.weekStartISO === target.weekStartISO) return record;
  try {
    record.sprint.commitments.splice(record.index, 1);
    target.sprint.commitments.push(record.commitment);
    return {
      weekStartISO: target.weekStartISO,
      sprint: target.sprint,
      index: target.sprint.commitments.length - 1,
      commitment: target.sprint.commitments[target.sprint.commitments.length - 1]
    };
  } catch (_) {
    return record;
  }
}

function scheduleAutopilotCommitment({ commitId, dateISO, startMins, durationMins }) {
  if (!commitId || !dateISO || !Number.isFinite(Number(startMins))) return false;
  const record = findCommitmentRecordById(commitId);
  if (!record) return false;
  const moved = moveCommitmentRecordToDateISO(record, dateISO);
  return scheduleCalendarItemAtTime(moved.commitment, dateISO, Number(startMins), Number(durationMins || 0));
}

function setAutopilotCommitmentUnscheduled({ commitId, dateISO }) {
  if (!commitId || !dateISO) return false;
  const record = findCommitmentRecordById(commitId);
  if (!record) return false;
  const moved = moveCommitmentRecordToDateISO(record, dateISO);
  const c = moved.commitment;
  c.dateISO = dateISO;
  c.dayIndex = clampDay(dayIndexForDate(getWeekStart(fromISO(dateISO)), fromISO(dateISO)));
  delete c.startTime;
  delete c.durationMins;
  return true;
}

function runCanvasAutopilot({ importedItems = null, manual = false, save = true, rerender = true } = {}) {
  ensureCanvasSyncStateShape();
  const cfg = state.canvasSync;
  const ap = cfg.autopilot;
  if (!ap || !ap.enabled) {
    if (ap) {
      ap.lastRunTs = Date.now();
      ap.lastSummary = "School autopilot disabled.";
      ap.lastError = "";
    }
    if (save) saveState();
    if (manual && rerender) render();
    return { ok: false, message: "Autopilot disabled." };
  }

  const candidates = (Array.isArray(importedItems) && importedItems.length
    ? importedItems
    : collectCanvasItemsFromImportedCommitmentsForAutopilot()
  )
    .filter(Boolean)
    .filter(it => it && it.key && it.dueISO)
    .filter(it => isLikelyCanvasAssignment(it)); // autopilot is for assignments only

  const blocksByKey = ap.blocksByKey && typeof ap.blocksByKey === "object" ? ap.blocksByKey : (ap.blocksByKey = {});

  // Recovery index: if blocksByKey got stale, find existing work blocks via canvasParentKey.
  const recoveredByKey = new Map();
  Object.values(state.sprints || {}).forEach(sp => {
    (sp.commitments || []).forEach(c => {
      if (!c || !c.canvasAutopilot) return;
      const key = String(c.canvasParentKey || "").trim();
      if (!key) return;
      if (!recoveredByKey.has(key)) recoveredByKey.set(key, []);
      recoveredByKey.get(key).push(String(c.id || ""));
    });
  });

  let created = 0;
  let removed = 0;
  let scheduled = 0;
  let leftUnscheduled = 0;
  let updated = 0;
  const errors = [];

  candidates.forEach(item => {
    const key = String(item.key || "").trim();
    const dueISO = String(item.dueISO || "").trim();
    if (!key || !dueISO) return;

    const plan = computeCanvasAutopilotDesiredBlocks(item, ap);
    if (!plan.ok) return;

    const classColor = getCanvasFeedColorById(item.sourceId);
    const desiredCount = plan.blockCount;
    const durationMins = plan.durationMins;
    const targetDates = computeAutopilotTargetDates({ dueISO, leadWindowDays: ap.leadWindowDays, blockCount: desiredCount });

    const mapped = Array.isArray(blocksByKey[key]) ? blocksByKey[key].map(String) : [];
    const recovered = recoveredByKey.get(key) || [];
    const combined = Array.from(new Set(mapped.concat(recovered).filter(Boolean)));

    // Filter to existing commitments; also normalize metadata.
    const existing = [];
    combined.forEach(id => {
      const c = findCommitmentById(id);
      if (!c) return;
      if (!c.canvasAutopilot || String(c.canvasParentKey || "") !== key) {
        // If it exists but doesn't look like ours, don't adopt it.
        return;
      }
      existing.push(id);
      // update minimal metadata (safe + keeps things consistent)
      try {
        const expectedTitle = `Work — ${String(item.title || "assignment").trim()}`;
        if (expectedTitle && c.title !== expectedTitle) { c.title = expectedTitle; updated += 1; }
        c.canvasDueISO = dueISO;
        if (classColor) c.color = classColor;
        c.estHours = Math.max(0.25, Number(durationMins || 60) / 60);
        c.durationMins = Number(c.durationMins) > 0 ? Number(c.durationMins) : durationMins;
      } catch (_) {}
    });

    // Create missing blocks.
    while (existing.length < desiredCount) {
      const commitId = uuid();
      const dueDate = fromISO(dueISO);
      const wkStartISO = toISO(getWeekStart(dueDate));
      const newCommit = {
        id: commitId,
        title: `Work — ${String(item.title || "assignment").trim()}`,
        deliverable: "",
        nextAction: "Start work now.",
        estHours: Math.max(0.25, Number(durationMins || 60) / 60),
        dayIndex: clampDay(dayIndexForDate(fromISO(wkStartISO), dueDate)),
        done: false,
        stat: "INT",
        color: classColor || colorForStat("INT"),
        isFocus: false,
        dateISO: dueISO,
        durationMins: durationMins,
        canvasAutopilot: true,
        canvasParentKey: key,
        canvasDueISO: dueISO,
        autopilotPinned: false,
        autopilotLastBumpTs: 0
      };
      const target = getOrCreateSprintForISO(dueISO);
      target.sprint.commitments.push(newCommit);
      existing.push(commitId);
      created += 1;
    }

    // Remove extra blocks beyond desiredCount (only if not pinned and not done).
    if (existing.length > desiredCount) {
      const keep = [];
      const removable = [];
      existing.forEach(id => {
        const c = findCommitmentById(id);
        if (!c) return;
        if (c.autopilotPinned || c.done) keep.push(id);
        else removable.push(id);
      });
      // Prefer keeping earlier blocks (stable) and drop newest removables.
      const targetTotal = Math.max(desiredCount, keep.length);
      const trimmed = keep.concat(removable.slice(0, Math.max(0, targetTotal - keep.length)));
      const toDelete = existing.filter(id => !trimmed.includes(id));
      toDelete.forEach(id => {
        if (deleteCommitById(id)) { removed += 1; }
      });
      existing.length = 0;
      trimmed.forEach(id => existing.push(id));
    }

    blocksByKey[key] = existing.slice();

    // Schedule blocks (non-pinned, not done), spreading them over the window.
    existing.forEach((commitId, idx) => {
      const c = findCommitmentById(commitId);
      if (!c) return;
      if (c.done || c.autopilotPinned) return;
      const assignedISO = targetDates[idx] || targetDates[targetDates.length - 1] || dueISO;
      let placed = false;
      for (let offset = 0; offset <= 30; offset++) {
        const dateISO = toISO(addDays(fromISO(assignedISO), offset));
        if (dateISO > dueISO) break;
        const blocks = getScheduledBlocksForDateExcludingCommit(dateISO, commitId);
        const startMins = findNextAvailableStartAfterWindow(blocks, durationMins, PLAN_DEFAULT_START_MINS, ap.quietEndMins);
        if (startMins === null) continue;
        if (!scheduleAutopilotCommitment({ commitId, dateISO, startMins, durationMins })) continue;
        scheduled += 1;
        placed = true;
        break;
      }
      if (!placed) {
        setAutopilotCommitmentUnscheduled({ commitId, dateISO: assignedISO });
        leftUnscheduled += 1;
      }
    });
  });

  ap.lastRunTs = Date.now();
  ap.lastSummary = `Autopilot: created ${created}, scheduled ${scheduled}, removed ${removed}${leftUnscheduled ? `, left unscheduled ${leftUnscheduled}` : ""}.`;
  ap.lastError = errors.join(" | ");

  if (save) saveState();
  if (manual && rerender) render();
  return { ok: errors.length === 0, message: ap.lastSummary + (ap.lastError ? ` Errors: ${ap.lastError}` : ""), created, scheduled, removed, leftUnscheduled, updated };
}

function showAutopilotNotification(message) {
  const nowTs = Date.now();
  if (nowTs - _canvasAutopilotLastInterruptTs < 8000) return;
  _canvasAutopilotLastInterruptTs = nowTs;
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification("Trajectory Autopilot", { body: String(message || "") });
      return;
    }
    if (Notification.permission !== "denied") {
      Notification.requestPermission().then(p => {
        if (p === "granted") new Notification("Trajectory Autopilot", { body: String(message || "") });
      }).catch(() => {});
    }
  } catch (_) {}
}

function focusTrajectoryToPlanView() {
  try {
    if (ipcRendererSafe && typeof ipcRendererSafe.send === "function") {
      ipcRendererSafe.send("app:focus", { reason: "autopilot" });
    }
  } catch (_) {}
  try {
    state.view = "plan";
    saveState();
    render();
  } catch (_) {}
}

function ensureCanvasAutopilotTicker() {
  ensureCanvasSyncStateShape();
  const cfg = state.canvasSync;
  const ap = cfg.autopilot;
  if (!ap || !ap.enabled) {
    if (_canvasAutopilotTimerId) {
      clearInterval(_canvasAutopilotTimerId);
      _canvasAutopilotTimerId = null;
    }
    return;
  }
  if (_canvasAutopilotTimerId) return;
  _canvasAutopilotTimerId = setInterval(() => {
    try { tickCanvasAutopilotLoop(); } catch (e) { console.warn("autopilot tick failed", e); }
  }, CANVAS_AUTOPILOT_TICK_MS);
}

function tickCanvasAutopilotLoop() {
  if (_canvasAutopilotTickBusy) return;
  _canvasAutopilotTickBusy = true;
  try {
    ensureCanvasSyncStateShape();
    const ap = state.canvasSync && state.canvasSync.autopilot ? state.canvasSync.autopilot : null;
    if (!ap || !ap.enabled) return;

    const now = new Date();
    const nowTs = now.getTime();
    const todayISO = toISO(now);
    const nowMins = (now.getHours() * 60) + now.getMinutes();
    const quietEndMins = toBoundedInt(ap.quietEndMins, 0, 24 * 60, CANVAS_AUTOPILOT_DEFAULT_QUIET_END_MINS);

    let movedCount = 0;
    const bumped = [];

    Object.values(state.sprints || {}).forEach(sp => {
      (sp.commitments || []).forEach(c => {
        if (!c || !c.canvasAutopilot) return;
        if (c.done || c.autopilotPinned) return;
        if (!c.dateISO || !c.startTime) return;
        const dueISO = String(c.canvasDueISO || "").trim();
        if (dueISO && todayISO > dueISO) return;

        const durationMins = getDurationMinsForItem(c);
        const startMins = timeToMinutes(c.startTime);
        if (!Number.isFinite(startMins)) return;
        const startD = fromISO(c.dateISO);
        startD.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0);
        const endTs = startD.getTime() + (durationMins * 60 * 1000);
        if (nowTs <= (endTs + CANVAS_AUTOPILOT_MISSED_GRACE_MS)) return;

        const lastBumpTs = Number(c.autopilotLastBumpTs || 0);
        if (lastBumpTs && (nowTs - lastBumpTs) < CANVAS_AUTOPILOT_BUMP_COOLDOWN_MS) return;

        const commitId = String(c.id || "");
        const minStartToday = clampMinutes(nowMins + 10, 0, 24 * 60);
        let placed = false;
        const tryPlace = (dateISO, minStartMins) => {
          const blocks = getScheduledBlocksForDateExcludingCommit(dateISO, commitId);
          const start = findNextAvailableStartAfterWindow(blocks, durationMins, minStartMins, quietEndMins);
          if (start === null) return null;
          if (!scheduleAutopilotCommitment({ commitId, dateISO, startMins: start, durationMins })) return null;
          return start;
        };

        // Try later today.
        const startToday = tryPlace(todayISO, minStartToday);
        if (startToday !== null) {
          c.autopilotLastBumpTs = nowTs;
          movedCount += 1;
          placed = true;
          bumped.push({ title: c.title, when: `Moved to ${minutesToTime(startToday)} today.` });
          return;
        }

        // Else try tomorrow (if not past due).
        const tomorrowISO = toISO(addDays(fromISO(todayISO), 1));
        if (dueISO && tomorrowISO > dueISO) {
          // Can't move beyond due date: unschedule and nag.
          setAutopilotCommitmentUnscheduled({ commitId, dateISO: dueISO || todayISO });
          c.autopilotLastBumpTs = nowTs;
          movedCount += 1;
          bumped.push({ title: c.title, when: "Urgent: no room before due date." });
          showAutopilotNotification(`Urgent: missed "${c.title}". No room before due date.`);
          focusTrajectoryToPlanView();
          return;
        }
        const startTomorrow = tryPlace(tomorrowISO, PLAN_DEFAULT_START_MINS);
        if (startTomorrow !== null) {
          c.autopilotLastBumpTs = nowTs;
          movedCount += 1;
          placed = true;
          bumped.push({ title: c.title, when: `Moved to ${minutesToTime(startTomorrow)} tomorrow.` });
        }

        if (!placed) {
          // No room tomorrow either -> keep it unscheduled for tomorrow.
          setAutopilotCommitmentUnscheduled({ commitId, dateISO: tomorrowISO });
          c.autopilotLastBumpTs = nowTs;
          movedCount += 1;
          bumped.push({ title: c.title, when: "Moved (unscheduled) to tomorrow." });
        }
      });
    });

    if (movedCount > 0) {
      saveState();
      if (document.visibilityState === "visible") render();
      const first = bumped[0];
      if (first) {
        showAutopilotNotification(`Missed: ${first.title}. ${first.when}`);
        focusTrajectoryToPlanView();
      }
    }
  } finally {
    _canvasAutopilotTickBusy = false;
  }
}

function isMorningGateModalOpen() {
  const modal = $("#morningGateModal");
  return !!(modal && !modal.hidden);
}

function setMorningGateStatus(text) {
  const el = $("#mgStatus");
  if (el) el.textContent = String(text || "");
}

function showMorningGateModal({ dayKey, goals = [] } = {}) {
  const modal = $("#morningGateModal");
  if (!modal) return false;
  const goal1 = $("#mgGoal1");
  const goal2 = $("#mgGoal2");
  const goal3 = $("#mgGoal3");
  const arr = Array.isArray(goals) ? goals : [];
  if (goal1) goal1.value = String(arr[0] || "");
  if (goal2) goal2.value = String(arr[1] || "");
  if (goal3) goal3.value = String(arr[2] || "");
  setMorningGateStatus("");
  modal.hidden = false;
  try { enableModalFocusTrap(modal); } catch (_) {}
  try {
    const first = goal1 || modal.querySelector("input,textarea,select,button");
    if (first && first.focus) first.focus();
  } catch (_) {}
  return true;
}

function hideMorningGateModal() {
  const modal = $("#morningGateModal");
  if (!modal) return;
  modal.hidden = true;
  setMorningGateStatus("");
  try { disableModalFocusTrap(modal); } catch (_) {}
}

function triggerMorningGate(dayKey, snapshot) {
  ensureMorningGateStateShape();
  const mg = state.morningGate;
  const key = String(dayKey || "").trim();
  if (!key) return false;
  if (mg.lastCompletedDayKey === key) return false;
  mg.activeDayKey = key;
  mg.days = mg.days && typeof mg.days === "object" ? mg.days : {};
  mg.days[key] = mg.days[key] && typeof mg.days[key] === "object" ? mg.days[key] : { goals: [], commitIds: [], completedAtTs: 0 };

  setFullscreenLock("morningGate", true);
  try {
    if (ipcRendererSafe && typeof ipcRendererSafe.send === "function") {
      ipcRendererSafe.send("app:focus", { reason: "morning-gate", dayKey: key });
    }
  } catch (_) {}

  const existingGoals = Array.isArray(mg.days[key].goals) ? mg.days[key].goals : [];
  showMorningGateModal({ dayKey: key, goals: existingGoals });
  saveState();
  return true;
}

function collectMorningGateCommitmentsForDay(dayKey) {
  const key = String(dayKey || "").trim();
  const out = [];
  if (!key) return out;
  Object.entries(state.sprints || {}).forEach(([weekStartISO, sp]) => {
    (sp.commitments || []).forEach((c, idx) => {
      if (!c || String(c.morningGateDayKey || "") !== key) return;
      out.push({ weekStartISO, sprint: sp, index: idx, commitment: c });
    });
  });
  return out;
}

function upsertMorningGateSkeletonForDay(dayKey, goals) {
  ensureMorningGateStateShape();
  const mg = state.morningGate;
  const key = String(dayKey || "").trim();
  if (!key) return [];
  const goalList = Array.isArray(goals) ? goals.map(g => String(g || "").trim()) : [];
  while (goalList.length < 3) goalList.push("");

  mg.days = mg.days && typeof mg.days === "object" ? mg.days : {};
  mg.days[key] = mg.days[key] && typeof mg.days[key] === "object" ? mg.days[key] : { goals: [], commitIds: [], completedAtTs: 0 };
  mg.days[key].goals = goalList.slice(0, 3);

  const existing = collectMorningGateCommitmentsForDay(key);
  const bySlot = new Map();
  existing.forEach(rec => {
    const c = rec.commitment || {};
    const kind = String(c.morningGateKind || "").trim().toLowerCase();
    const idx = Number(c.morningGateGoalIndex);
    const slot = kind === "goal" && Number.isFinite(idx) ? `goal:${idx}` : kind;
    if (slot && !bySlot.has(slot)) bySlot.set(slot, rec);
  });

  const commitIds = [];
  const ensureCommit = ({ slot, title, stat, color, dateISO, startTime = "", durationMins, isFocus = false, goalIndex = null }) => {
    let rec = bySlot.get(slot) || null;
    const target = getOrCreateSprintForISO(dateISO);
    if (!rec) {
      const newCommit = {
        id: uuid(),
        title: String(title || "Untitled"),
        deliverable: "",
        nextAction: "",
        estHours: Math.max(0.25, Number(durationMins || 60) / 60),
        dayIndex: clampDay(dayIndexForDate(fromISO(target.weekStartISO), fromISO(dateISO))),
        done: false,
        stat: stat || "DISC",
        color: color || colorForStat(stat || "DISC"),
        isFocus: !!isFocus,
        dateISO: dateISO,
        durationMins: Number(durationMins || 60),
        morningGateDayKey: key,
        morningGateKind: slot.startsWith("goal:") ? "goal" : slot,
        morningGateGoalIndex: slot.startsWith("goal:") ? Number(goalIndex) : undefined
      };
      if (startTime) newCommit.startTime = startTime;
      target.sprint.commitments.push(newCommit);
      commitIds.push(newCommit.id);
      return newCommit.id;
    }

    // Move between week buckets if needed.
    try {
      const moved = moveCommitmentRecordToDateISO(rec, dateISO);
      rec = moved || rec;
    } catch (_) {}

    const c = rec.commitment;
    c.title = String(title || c.title || "Untitled");
    c.stat = stat || c.stat || "DISC";
    c.color = color || normalizeHexColor(c.color) || colorForStat(c.stat);
    c.isFocus = !!isFocus;
    c.dateISO = dateISO;
    c.dayIndex = clampDay(dayIndexForDate(getWeekStart(fromISO(dateISO)), fromISO(dateISO)));
    c.durationMins = Number(durationMins || c.durationMins || 60);
    c.estHours = Math.max(0.25, Number(c.durationMins || 60) / 60);
    c.morningGateDayKey = key;
    c.morningGateKind = slot.startsWith("goal:") ? "goal" : slot;
    if (slot.startsWith("goal:")) c.morningGateGoalIndex = Number(goalIndex);

    if (startTime) c.startTime = startTime;
    else delete c.startTime;

    commitIds.push(c.id);
    return c.id;
  };

  // Fixed anchors.
  ensureCommit({ slot: "wake", title: "Wake", stat: "DISC", color: colorForStat("DISC"), dateISO: key, startTime: "09:00", durationMins: 15, isFocus: false });
  ensureCommit({ slot: "gym", title: "Gym", stat: "STR", color: colorForStat("STR"), dateISO: key, startTime: "", durationMins: 90, isFocus: false });
  ensureCommit({ slot: "bed", title: "Bedtime", stat: "DISC", color: colorForStat("DISC"), dateISO: key, startTime: "23:45", durationMins: 15, isFocus: false });

  // 3 goal blocks.
  for (let i = 0; i < 3; i++) {
    const g = goalList[i] ? goalList[i] : `Goal ${i + 1}`;
    ensureCommit({
      slot: `goal:${i}`,
      title: `Work — ${g}`,
      stat: "DISC",
      color: colorForStat("DISC"),
      dateISO: key,
      startTime: "",
      durationMins: 60,
      isFocus: true,
      goalIndex: i
    });
  }

  mg.days[key].commitIds = Array.from(new Set(commitIds.filter(Boolean)));
  return mg.days[key].commitIds.slice();
}

function generateDayPlanForISO(dateISO, { quietEndMins = 22 * 60 } = {}) {
  const key = String(dateISO || "").trim();
  if (!key) return { scheduledCount: 0, reason: "missing-date" };

  const now = new Date();
  const todayISO = toISO(now);
  const isToday = key === todayISO;
  const nowMins = (now.getHours() * 60) + now.getMinutes();
  const minStart = Math.max(10 * 60, isToday ? (nowMins + 10) : (10 * 60));
  const endMins = toBoundedInt(quietEndMins, 0, 24 * 60, 22 * 60);

  // Collect scheduled blocks for the date.
  const scheduledBlocks = getScheduledBlocksForDate(key);

  const day = computePlanDayItems(key);
  const unscheduled = (day.unscheduled || []).filter(it => it && !it.isDone && it.c);

  const isGateGoal = it => it && it.c && String(it.c.morningGateDayKey || "") === key && String(it.c.morningGateKind || "") === "goal";
  const isGateGym = it => it && it.c && String(it.c.morningGateDayKey || "") === key && String(it.c.morningGateKind || "") === "gym";

  const goalBlocks = unscheduled
    .filter(isGateGoal)
    .slice()
    .sort((a, b) => Number(a.c.morningGateGoalIndex || 0) - Number(b.c.morningGateGoalIndex || 0));
  const gymBlocks = unscheduled.filter(isGateGym);
  const rest = unscheduled.filter(it => !isGateGoal(it) && !isGateGym(it));
  const queue = goalBlocks.concat(gymBlocks).concat(rest);

  let scheduledCount = 0;

  queue.forEach(entry => {
    const c0 = entry.c;
    if (!c0) return;
    const durationMins = getDurationMinsForItem(c0);
    const startMins = findNextAvailableStartAfterWindow(scheduledBlocks, durationMins, minStart, endMins);
    if (startMins === null) return;

    let targetItem = c0;
    if (!c0.__isOccurrence && c0.id) {
      const rec = findCommitmentRecordById(c0.id);
      if (rec) {
        const moved = moveCommitmentRecordToDateISO(rec, key);
        if (moved && moved.commitment) targetItem = moved.commitment;
      }
    }
    if (!scheduleCalendarItemAtTime(targetItem, key, startMins, durationMins)) return;
    scheduledBlocks.push({ startMins, durationMins });
    scheduledBlocks.sort((a, b) => a.startMins - b.startMins);
    scheduledCount += 1;
  });

  return { scheduledCount, reason: scheduledCount ? "" : "no-room" };
}

async function completeMorningGate(dayKey, goals) {
  ensureMorningGateStateShape();
  ensureCanvasSyncStateShape();
  ensureWorkoutStateShape();

  const mg = state.morningGate;
  const key = String(dayKey || "").trim();
  const goalList = Array.isArray(goals) ? goals.map(g => String(g || "").trim()) : [];
  if (!key) throw new Error("Missing day key");
  if (goalList.filter(Boolean).length < 3) throw new Error("3 goals required");

  mg.days = mg.days && typeof mg.days === "object" ? mg.days : {};
  mg.days[key] = mg.days[key] && typeof mg.days[key] === "object" ? mg.days[key] : { goals: [], commitIds: [], completedAtTs: 0 };
  mg.days[key].goals = goalList.slice(0, 3);

  // Create/update daily skeleton first.
  upsertMorningGateSkeletonForDay(key, goalList);
  saveState();

  // Boot scripts.
  const anyCanvasLinks = (state.canvasSync.feeds || []).some(f => f && f.enabled && String(f.url || "").trim());
  if (anyCanvasLinks) {
    setMorningGateStatus("Syncing school...");
    try { await syncCanvasFeeds({ manual: false }); } catch (_) { /* keep going */ }
  }

  setMorningGateStatus("Running autopilot...");
  try { runCanvasAutopilot({ manual: false, save: false, rerender: false }); } catch (_) {}

  const ws = state.settings && state.settings.workoutSync ? state.settings.workoutSync : null;
  const canWorkoutSync = ws && String(ws.url || "").trim() && String(ws.token || "").trim();
  if (canWorkoutSync) {
    setMorningGateStatus("Syncing workouts...");
    try { await runWorkoutSyncNow({ showAlert: false, rerender: false }); } catch (_) { /* optional */ }
  }

  setMorningGateStatus("Generating day plan...");
  generateDayPlanForISO(key, { quietEndMins: 22 * 60 });

  // Mark complete.
  mg.lastCompletedDayKey = key;
  mg.activeDayKey = "";
  mg.days[key].completedAtTs = Date.now();

  // Jump to plan view for the day.
  state.view = "plan";
  state.planTimelineDate = key;
  state.weekStartISO = toISO(getWeekStart(fromISO(key)));

  saveState();
  render();
  hideMorningGateModal();
  setFullscreenLock("morningGate", false);
  setMorningGateStatus("");
}

function ensureMorningGateTicker() {
  ensureMorningGateStateShape();
  const mg = state.morningGate;
  if (!mg.enabled) {
    if (_morningGateTimerId) {
      clearInterval(_morningGateTimerId);
      _morningGateTimerId = null;
    }
    return;
  }
  if (_morningGateTimerId) return;
  _morningGateTimerId = setInterval(() => {
    void tickMorningGateLoop();
  }, MORNING_GATE_TICK_MS);
  void tickMorningGateLoop();
}

async function tickMorningGateLoop() {
  if (_morningGateTickBusy) return;
  _morningGateTickBusy = true;
  try {
    ensureMorningGateStateShape();
    const mg = state.morningGate;
    if (!mg.enabled) return;

    const now = new Date();
    const baseHour = toBoundedInt(mg.baselineHour, 0, 23, 6);
    if (Number(now.getHours()) < baseHour) return;

    const dayKey = getBaselineDayKeyISO(now, baseHour);
    if (!dayKey) return;
    if (mg.lastCompletedDayKey === dayKey) return;
    if (mg.activeDayKey === dayKey) {
      // Gate already armed for this baseline day; make sure the modal stays visible.
      setFullscreenLock("morningGate", true);
      if (!isMorningGateModalOpen()) {
        const existingGoals =
          mg.days && mg.days[dayKey] && Array.isArray(mg.days[dayKey].goals)
            ? mg.days[dayKey].goals
            : [];
        showMorningGateModal({ dayKey, goals: existingGoals });
      }
      return;
    }

    const snapshot = await getForegroundWindowSnapshot();
    if (!snapshot) return;
    if (normalizeProcessName(snapshot.process) !== "chrome") return;

    // Trigger once for this baseline day key.
    if (mg.lastCompletedDayKey !== dayKey && mg.activeDayKey !== dayKey) {
      triggerMorningGate(dayKey, snapshot);
    }
  } catch (err) {
    console.warn("tickMorningGateLoop failed", err);
  } finally {
    _morningGateTickBusy = false;
  }
}

function saveCanvasSyncSettingsFromUi({ rerender = true } = {}) {
  ensureCanvasSyncStateShape();
  const cfg = state.canvasSync;
  const enabledEl = $("#canvasSyncEnabled");
  const minsEl = $("#canvasSyncAutoMins");
  const assignmentsOnlyEl = $("#canvasSyncAssignmentsOnly");
  const autopilotEnabledEl = $("#canvasAutopilotEnabled");
  const autopilotLeadEl = $("#canvasAutopilotLeadDays");
  const autopilotBlockEl = $("#canvasAutopilotBlockMins");
  const autopilotMaxEl = $("#canvasAutopilotMaxBlocks");

  if (enabledEl) cfg.enabled = !!enabledEl.checked;
  cfg.autoSyncMins = toBoundedInt(minsEl ? minsEl.value : cfg.autoSyncMins, CANVAS_SYNC_MIN_MINS, CANVAS_SYNC_MAX_MINS, cfg.autoSyncMins || 120);
  if (assignmentsOnlyEl) cfg.assignmentsOnly = !!assignmentsOnlyEl.checked;

  if (cfg.autopilot && typeof cfg.autopilot === "object") {
    if (autopilotEnabledEl) cfg.autopilot.enabled = !!autopilotEnabledEl.checked;
    cfg.autopilot.leadWindowDays = toBoundedInt(autopilotLeadEl ? autopilotLeadEl.value : cfg.autopilot.leadWindowDays, CANVAS_AUTOPILOT_MIN_LEAD_DAYS, CANVAS_AUTOPILOT_MAX_LEAD_DAYS, cfg.autopilot.leadWindowDays || 7);
    cfg.autopilot.blockMins = toBoundedInt(autopilotBlockEl ? autopilotBlockEl.value : cfg.autopilot.blockMins, CANVAS_AUTOPILOT_MIN_BLOCK_MINS, CANVAS_AUTOPILOT_MAX_BLOCK_MINS, cfg.autopilot.blockMins || 60);
    cfg.autopilot.maxBlocksPerAssignment = toBoundedInt(autopilotMaxEl ? autopilotMaxEl.value : cfg.autopilot.maxBlocksPerAssignment, CANVAS_AUTOPILOT_MIN_BLOCKS, CANVAS_AUTOPILOT_MAX_BLOCKS, cfg.autopilot.maxBlocksPerAssignment || 4);
  }

  cfg.feeds.forEach(feed => {
    const urlEl = $(`#canvasFeedUrl_${feed.id}`);
    const enabledFeedEl = $(`#canvasFeedEnabled_${feed.id}`);
    const colorEl = $(`#canvasFeedColor_${feed.id}`);
    if (urlEl) feed.url = String(urlEl.value || "").trim();
    if (enabledFeedEl) feed.enabled = !!enabledFeedEl.checked;
    if (colorEl) {
      const picked = normalizeHexColor(colorEl.value) || getCanvasFeedDefaultColor(feed.id);
      feed.color = picked;
      applyCanvasFeedColorToImportedCommitments(feed.id, picked);
    }
  });

  saveState();
  ensureCanvasSyncTicker();
  ensureCanvasAutopilotTicker();
  if (rerender) render();
  return true;
}

function openUrlInSystemBrowser(url) {
  const v = String(url || "").trim();
  if (!v) return;
  try {
    const parsed = new URL(v);
    if (shellSafe && typeof shellSafe.openExternal === "function") {
      shellSafe.openExternal(parsed.toString());
    } else if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(parsed.toString(), "_blank", "noopener");
    }
  } catch (_) {
    // ignore bad URLs
  }
}

function buildUrlWithParams(baseUrl, params = {}) {
  const v = String(baseUrl || "").trim();
  if (!v) return "";
  try {
    const u = new URL(v);
    Object.entries(params || {}).forEach(([k, val]) => {
      if (typeof val === "undefined" || val === null) return;
      u.searchParams.set(String(k), String(val));
    });
    return u.toString();
  } catch (_) {
    return "";
  }
}

function normalizeWorkoutExecUrl(rawUrl) {
  const v = String(rawUrl || "").trim();
  if (!v) return "";
  try {
    const u = new URL(v);
    // If the user pasted the logger link (e.g. /exec?page=logger), strip query/hash.
    u.search = "";
    u.hash = "";
    // If the user pasted the /dev URL, switch to /exec (dev often returns HTML auth pages).
    if (String(u.pathname || "").endsWith("/dev")) {
      u.pathname = u.pathname.replace(/\/dev$/, "/exec");
    }
    return u.toString();
  } catch (_) {
    // If it's not a valid URL, keep what the user typed.
    return v;
  }
}

function fetchJsonFromUrl(url, {
  method = "GET",
  body = null,
  headers = {},
  timeoutMs = 15000,
  maxRedirects = 4
} = {}) {
  const target = String(url || "").trim();
  if (!target) return Promise.reject(new Error("Empty URL"));
  let parsed = null;
  try {
    parsed = new URL(target);
  } catch (err) {
    return Promise.reject(new Error("Invalid URL"));
  }
  const proto = String(parsed.protocol || "").toLowerCase();
  const requestImpl = proto === "https:" ? httpsRequestSafe : proto === "http:" ? httpRequestSafe : null;
  if (!requestImpl) return Promise.reject(new Error("Unsupported URL protocol"));

  const verb = String(method || "GET").toUpperCase();
  const payload = body === null || typeof body === "undefined" ? null : String(body);

  return new Promise((resolve, reject) => {
    let req = null;
    try {
      const baseHeaders = {
        "User-Agent": "Trajectory-WorkoutSync/1.0",
        "Accept": "application/json,text/plain,*/*"
      };
      const merged = { ...baseHeaders, ...(headers || {}) };
      if (payload !== null && verb !== "GET" && verb !== "HEAD") {
        if (!merged["Content-Type"]) merged["Content-Type"] = "application/json; charset=utf-8";
        merged["Content-Length"] = Buffer.byteLength(payload, "utf8");
      }

      req = requestImpl(target, {
        method: verb,
        headers: merged
      }, res => {
        const status = Number(res.statusCode || 0);
        const location = res.headers && res.headers.location ? String(res.headers.location) : "";
        if (status >= 300 && status < 400 && location && maxRedirects > 0) {
          const nextUrl = new URL(location, parsed).toString();
          res.resume();
          const switchToGet = status === 303;
          fetchJsonFromUrl(nextUrl, {
            method: switchToGet ? "GET" : verb,
            body: switchToGet ? null : payload,
            headers: switchToGet ? {} : headers,
            timeoutMs,
            maxRedirects: maxRedirects - 1
          }).then(resolve).catch(reject);
          return;
        }

        let raw = "";
        try { res.setEncoding("utf8"); } catch (_) {}
        res.on("data", chunk => { raw += String(chunk || ""); });
        res.on("end", () => {
          if (status < 200 || status >= 300) {
            const detail = raw ? ` ${raw.slice(0, 240)}` : "";
            reject(new Error(`HTTP ${status}.${detail}`));
            return;
          }
          if (!raw.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            const trimmed = String(raw || "").trim();
            const lower = trimmed.slice(0, 400).toLowerCase();
            const looksHtml = lower.includes("<html") || lower.includes("<!doctype html") || lower.includes("<head");
            if (looksHtml) {
              reject(new Error(
                "Invalid JSON response (received HTML). Make sure you're using the deployed Web App /exec URL (not /dev or ?page=logger), and set access to 'Anyone with the link'."
              ));
              return;
            }
            reject(new Error("Invalid JSON response"));
          }
        });
      });
    } catch (err) {
      reject(err);
      return;
    }
    req.on("error", err => reject(err));
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(new Error("Request timeout")); } catch (_) {}
    });
    if (payload !== null && verb !== "GET" && verb !== "HEAD") {
      req.write(payload);
    }
    req.end();
  });
}

function postJsonToUrl(url, payload, { timeoutMs = 15000, maxRedirects = 4 } = {}) {
  const body = JSON.stringify(payload || {});
  return fetchJsonFromUrl(url, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    timeoutMs,
    maxRedirects
  });
}

function getWorkoutLoggerUrl(execUrl) {
  return buildUrlWithParams(normalizeWorkoutExecUrl(execUrl), { page: "logger" });
}

async function workoutSyncHealth() {
  ensureWorkoutStateShape();
  const ws = state.settings.workoutSync;
  const baseUrl = normalizeWorkoutExecUrl(ws.url);
  const url = buildUrlWithParams(baseUrl, { action: "health" });
  if (!url) throw new Error("Missing Workout Sync URL");
  return await fetchJsonFromUrl(url, { timeoutMs: 12000, maxRedirects: 4 });
}

async function workoutSyncExport({ sinceISO = "" } = {}) {
  ensureWorkoutStateShape();
  const ws = state.settings.workoutSync;
  const url = normalizeWorkoutExecUrl(ws.url);
  const token = String(ws.token || "").trim();
  if (!url) throw new Error("Missing Workout Sync URL");
  if (!token) throw new Error("Missing Workout Sync token");

  const payload = {
    token,
    action: "export",
    payload: sinceISO ? { since: String(sinceISO) } : {}
  };

  try {
    return await postJsonToUrl(url, payload, { timeoutMs: 20000, maxRedirects: 4 });
  } catch (err) {
    // Fallback to GET (token in query) in case POST is blocked by the deploy config.
    const fallbackUrl = buildUrlWithParams(url, { action: "export", token, since: sinceISO || "" });
    return await fetchJsonFromUrl(fallbackUrl, { timeoutMs: 20000, maxRedirects: 4 });
  }
}

function mapArrayByKey(list, keyName) {
  const out = {};
  (Array.isArray(list) ? list : []).forEach(item => {
    if (!item || typeof item !== "object") return;
    const id = String(item[keyName] || "").trim();
    if (!id) return;
    out[id] = item;
  });
  return out;
}

function applyWorkoutExportToState(data) {
  ensureWorkoutStateShape();
  if (!data || typeof data !== "object") throw new Error("Invalid export response");
  if (data.ok === false) throw new Error(String(data.error || "export-failed"));

  const exercises = Array.isArray(data.exercises) ? data.exercises : [];
  const routines = Array.isArray(data.routines) ? data.routines : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const setsRaw = Array.isArray(data.sets) ? data.sets : [];
  const sets = setsRaw.map(s => {
    if (!s || typeof s !== "object") return s;
    // Back-compat: server used to store free-text notes in `rpe`.
    if ((!("note" in s) || String(s.note || "").trim() === "") && ("rpe" in s) && String(s.rpe || "").trim()) {
      s.note = String(s.rpe || "");
    }
    // Back-compat: convert plates -> lb for charts/PRs.
    const unit = String(s.unit || "").trim().toLowerCase();
    const weight = Number(s.weight);
    if (unit === "plates" && Number.isFinite(weight)) {
      const plates = weight;
      s.weight = plates * 90;
      s.unit = "lb";
      const suffix = `(${plates} plates)`;
      const cur = String(s.note || "").trim();
      s.note = cur ? `${cur} ${suffix}` : suffix;
    }
    return s;
  });

  state.workouts.exercisesById = mapArrayByKey(exercises, "exerciseId");
  state.workouts.routinesById = mapArrayByKey(routines, "routineId");
  state.workouts.sessionsById = mapArrayByKey(sessions, "sessionId");
  state.workouts.setsById = mapArrayByKey(sets, "setId");

  state.settings.workoutSync.lastSyncTs = Date.now();
  state.settings.workoutSync.lastError = "";
  saveState();
  return {
    exerciseCount: exercises.length,
    routineCount: routines.length,
    sessionCount: sessions.length,
    setCount: sets.length
  };
}

function clearWorkoutCache({ persist = true } = {}) {
  ensureWorkoutStateShape();
  state.workouts = getDefaultWorkoutCache();
  if (persist) saveState();
}

function parseIsoTs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

function estimateEpley1RM(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  return w * (1 + (r / 30));
}

function asBoolLoose(value) {
  if (value === true) return true;
  if (value === false) return false;
  const s = String(value || "").trim().toLowerCase();
  if (!s) return false;
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return false;
}

async function runWorkoutHealthTest({ showAlert = false } = {}) {
  ensureWorkoutStateShape();
  const ws = state.settings.workoutSync;
  try {
    const data = await workoutSyncHealth();
    ws.lastError = "";
    saveState();
    if (showAlert) alert(`Workout Sync health: OK${data && data.ts ? ` (${new Date(Number(data.ts)).toLocaleString()})` : ""}`);
    return true;
  } catch (err) {
    const msg = String((err && err.message) || err || "health-check-failed");
    ws.lastError = msg;
    saveState();
    if (showAlert) alert(`Workout Sync health failed: ${msg}`);
    return false;
  }
}

async function runWorkoutSyncNow({ showAlert = false, rerender = true } = {}) {
  ensureWorkoutStateShape();
  const ws = state.settings.workoutSync;
  try {
    const data = await workoutSyncExport();
    const summary = applyWorkoutExportToState(data);
    if (rerender) render();
    if (showAlert) {
      alert(`Workout sync complete: ${summary.sessionCount} sessions, ${summary.setCount} sets.`);
    }
    return true;
  } catch (err) {
    const msg = String((err && err.message) || err || "sync-failed");
    ws.lastError = msg;
    saveState();
    if (rerender) render();
    if (showAlert) alert(`Workout sync failed: ${msg}`);
    return false;
  }
}

function getExtensionManagerUrlForBrowser(browser) {
  const target = String(browser || "chrome").trim().toLowerCase();
  if (target === "edge") return "edge://extensions";
  if (target === "brave") return "brave://extensions";
  return "chrome://extensions";
}

function openBrowserExtensionsPage(browser) {
  const target = String(browser || "chrome").trim().toLowerCase();
  const extensionUrl = getExtensionManagerUrlForBrowser(target);
  if (!extensionUrl) return false;

  try {
    if (shellSafe && typeof shellSafe.openExternal === "function") {
      shellSafe.openExternal(extensionUrl);
      return true;
    }
  } catch (_) {}

  const browserCmd = target === "edge"
    ? "msedge"
    : target === "brave"
      ? "brave"
      : "chrome";
  try {
    if (execFileSafe) {
      execFileSafe(
        "cmd.exe",
        ["/c", "start", "", browserCmd, extensionUrl],
        { windowsHide: true },
        () => {}
      );
      return true;
    }
  } catch (_) {}

  openUrlInSystemBrowser(extensionUrl);
  return true;
}

function extractFirstUrlCandidate(input) {
  const src = String(input || "").trim();
  if (!src) return "";
  const direct = src.match(/https?:\/\/[^\s"'<>]+/i);
  return direct ? String(direct[0]) : "";
}

function readTextFromClipboardSafe() {
  try {
    if (clipboardSafe && typeof clipboardSafe.readText === "function") {
      return String(clipboardSafe.readText() || "");
    }
  } catch (_) {}
  return "";
}

function getBrowserBlockerExtensionDir() {
  if (!pathSafe) return "";
  try {
    // When packaged with ASAR, the extension must live on disk (Chrome "Load unpacked" can't read from app.asar).
    // electron-packager/electron-builder place unpacked assets under resources/app.asar.unpacked.
    const inAsar = typeof __dirname === "string" && __dirname.includes("app.asar");
    if (inAsar && typeof process === "object" && process && process.resourcesPath) {
      const unpacked = pathSafe.join(process.resourcesPath, "app.asar.unpacked", ...BROWSER_BLOCKER_EXTENSION_REL_DIR);
      if (fsSafe && typeof fsSafe.existsSync === "function" && fsSafe.existsSync(unpacked)) {
        return unpacked;
      }
      return unpacked;
    }
    return pathSafe.join(__dirname, ...BROWSER_BLOCKER_EXTENSION_REL_DIR);
  } catch (_) {
    return "";
  }
}

function openFolderPathSafe(folderPath) {
  const target = String(folderPath || "").trim();
  if (!target) return false;
  try {
    if (shellSafe && typeof shellSafe.openPath === "function") {
      shellSafe.openPath(target);
      return true;
    }
  } catch (_) {}
  try {
    if (execFileSafe) {
      execFileSafe("explorer.exe", [target], { windowsHide: true }, () => {});
      return true;
    }
  } catch (_) {}
  return false;
}

function buildBrowserBlockerProfile() {
  ensureEnforcementStateShape();
  const group = normalizePornGroupConfig(state.enforcement.pornGroup, state.enforcement.pornKeywords);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "trajectory",
    settings: {
      enabled: !!group.enabled,
      closeTabOnBlock: true,
      blockedDomains: uniqLowerList(group.blockedDomains || []),
      blockedKeywords: uniqLowerList(group.blockedKeywords || []),
      blockedSearchTerms: uniqLowerList(group.blockedSearchTerms || []),
      customKeywords: uniqLowerList(group.customKeywords || []),
      searchHosts: uniqLowerList(BROWSER_BLOCKER_SEARCH_HOSTS)
    }
  };
}

function exportBrowserBlockerProfileToDisk() {
  if (!fsSafe || !pathSafe) {
    return { ok: false, error: "File system APIs are not available in this runtime." };
  }
  try {
    const profile = buildBrowserBlockerProfile();
    const home = osSafe && typeof osSafe.homedir === "function" ? osSafe.homedir() : "";
    const baseDir = home ? pathSafe.join(home, "Downloads", "Trajectory") : pathSafe.join(__dirname, "exports");
    fsSafe.mkdirSync(baseDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = pathSafe.join(baseDir, `trajectory-browser-blocker-profile-${ts}.json`);
    fsSafe.writeFileSync(outPath, JSON.stringify(profile, null, 2), "utf8");
    return { ok: true, path: outPath };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err || "export-failed")
    };
  }
}

function renderCanvasSyncCard() {
  ensureCanvasSyncStateShape();
  const cfg = state.canvasSync;
  const ap = cfg.autopilot || {};
  const syncStamp = cfg.lastSyncTs ? new Date(cfg.lastSyncTs).toLocaleString() : "Never";
  const autopilotStamp = ap.lastRunTs ? new Date(ap.lastRunTs).toLocaleString() : "Never";
  const feedRows = cfg.feeds.map(feed => {
    const feedStamp = feed.lastSyncTs ? new Date(feed.lastSyncTs).toLocaleString() : "Never";
    const feedError = String(feed.lastError || "");
    const feedColor = normalizeHexColor(feed.color) || getCanvasFeedDefaultColor(feed.id);
    return `
      <div class="canvas-sync-feed">
        <div class="canvas-sync-feed__head">
          <label class="field field--inline">
            <span class="field__label">${escapeHtml(feed.label)} Sync Link</span>
            <div class="toggle">
              <input id="canvasFeedEnabled_${escapeHtml(feed.id)}" type="checkbox" ${feed.enabled ? "checked" : ""} />
              <span class="toggle__ui"></span>
            </div>
          </label>
          <div class="canvas-sync-feed__actions">
            <button class="smallbtn" type="button" data-canvas-open-page="${escapeHtml(feed.id)}">Open Calendar</button>
            <button class="smallbtn" type="button" data-canvas-paste-link="${escapeHtml(feed.id)}">Paste Link</button>
          </div>
        </div>
        <div class="canvas-sync-feed__color-row">
          <span class="field__label">Class Color</span>
          <div class="canvas-sync-feed__color">
            <input id="canvasFeedColor_${escapeHtml(feed.id)}" class="color-input" type="color" value="${escapeHtml(feedColor)}" />
            <span class="meta">${escapeHtml(feedColor)}</span>
          </div>
        </div>
        <input id="canvasFeedUrl_${escapeHtml(feed.id)}" class="input" type="url" placeholder="Paste copied Canvas calendar link here" value="${escapeHtml(feed.url || "")}" />
        <div class="meta">Last sync: ${escapeHtml(feedStamp)} · Imported: ${Number(feed.lastImported || 0)}</div>
        ${feedError ? `<div class="field__error">${escapeHtml(feedError)}</div>` : ""}
      </div>
    `;
  }).join("");

  return `
    <div class="card">
      <div class="card__title">
        <h2>School Assignment Sync</h2>
        <div class="meta">${cfg.enabled ? "Auto Sync On" : "Manual"}</div>
      </div>
      <div class="stack stack--tight">
        <label class="field field--inline">
          <span class="field__label">Enable auto sync</span>
          <div class="toggle">
            <input id="canvasSyncEnabled" type="checkbox" ${cfg.enabled ? "checked" : ""} />
            <span class="toggle__ui"></span>
          </div>
        </label>
        <label class="field">
          <span class="field__label">Auto sync interval (minutes)</span>
          <input id="canvasSyncAutoMins" class="input" type="number" min="${CANVAS_SYNC_MIN_MINS}" max="${CANVAS_SYNC_MAX_MINS}" step="5" value="${Number(cfg.autoSyncMins || 120)}" />
        </label>
        <label class="field field--inline">
          <span class="field__label">Assignments only</span>
          <div class="toggle">
            <input id="canvasSyncAssignmentsOnly" type="checkbox" ${cfg.assignmentsOnly ? "checked" : ""} />
            <span class="toggle__ui"></span>
          </div>
        </label>
        <div class="canvas-sync-note">
          1) Click Open Calendar for your school.<br/>
          2) In Canvas Calendar, click Calendar Feed and copy that link.<br/>
          3) Click Paste Link, then Sync Now.
        </div>
        <div class="canvas-sync-feed">
          <div class="canvas-sync-feed__head">
            <label class="field field--inline">
              <span class="field__label">School Autopilot</span>
              <div class="toggle">
                <input id="canvasAutopilotEnabled" type="checkbox" ${ap.enabled ? "checked" : ""} />
                <span class="toggle__ui"></span>
              </div>
            </label>
            <div class="canvas-sync-feed__actions">
              <button class="smallbtn" type="button" id="canvasAutopilotRunNowBtn">Run Autopilot Now</button>
            </div>
          </div>
          <div class="row row--3">
            <label class="field">
              <span class="field__label">Lead window (days)</span>
              <input id="canvasAutopilotLeadDays" class="input" type="number" min="${CANVAS_AUTOPILOT_MIN_LEAD_DAYS}" max="${CANVAS_AUTOPILOT_MAX_LEAD_DAYS}" step="1" value="${Number(ap.leadWindowDays || 7)}" />
            </label>
            <label class="field">
              <span class="field__label">Block minutes</span>
              <input id="canvasAutopilotBlockMins" class="input" type="number" min="${CANVAS_AUTOPILOT_MIN_BLOCK_MINS}" max="${CANVAS_AUTOPILOT_MAX_BLOCK_MINS}" step="5" value="${Number(ap.blockMins || 60)}" />
            </label>
            <label class="field">
              <span class="field__label">Max blocks per assignment</span>
              <input id="canvasAutopilotMaxBlocks" class="input" type="number" min="${CANVAS_AUTOPILOT_MIN_BLOCKS}" max="${CANVAS_AUTOPILOT_MAX_BLOCKS}" step="1" value="${Number(ap.maxBlocksPerAssignment || 4)}" />
            </label>
          </div>
          <div class="meta">Creates work blocks for assignments due soon and auto-schedules them before the due date. Missed blocks get bumped forward automatically.</div>
          <div class="meta">Last autopilot run: ${escapeHtml(autopilotStamp)}</div>
          ${ap.lastSummary ? `<div class="meta">${escapeHtml(ap.lastSummary)}</div>` : ""}
          ${ap.lastError ? `<div class="field__error">${escapeHtml(ap.lastError)}</div>` : ""}
        </div>
        ${feedRows}
        <div class="enforce-actions" style="margin-top:2px">
          <button class="btn btn--ghost" type="button" id="canvasSyncSaveBtn">Save Sync Settings</button>
          <button class="btn btn--primary" type="button" id="canvasSyncNowBtn">Sync Now</button>
        </div>
        <div class="meta">Last global sync: ${escapeHtml(syncStamp)}</div>
        ${cfg.lastSummary ? `<div class="meta">${escapeHtml(cfg.lastSummary)}</div>` : ""}
        ${cfg.lastError ? `<div class="field__error">${escapeHtml(cfg.lastError)}</div>` : ""}
      </div>
    </div>
  `;
}

function resolvePrompt(stage) {
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const tone = cfg.tone === "normal" ? "normal" : "hard";
  const pack = cfg.prompts && cfg.prompts[tone] ? cfg.prompts[tone] : null;
  if (!pack) return "Back to focus.";
  if (stage === "block") return pack.block || "Hard block active.";
  if (stage === "lockout") return pack.lockout || "Lockout active.";
  return pack.nudge || "Back to focus.";
}

function showEnforcementNotification(message, stage) {
  const nowTs = Date.now();
  if (nowTs - _enforcementLastNoticeTs < 10000) return;
  _enforcementLastNoticeTs = nowTs;
  const title = stage === "block"
    ? "Trajectory Hard Block"
    : stage === "lockout"
      ? "Trajectory Lockout"
      : "Trajectory Nudge";
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(title, { body: String(message || "") });
      return;
    }
    if (Notification.permission !== "denied") {
      Notification.requestPermission().then(p => {
        if (p === "granted") new Notification(title, { body: String(message || "") });
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("Notification failed", err);
  }
}

function showSystemInterruptionPopup(message, { title = "Trajectory Blocker", seconds = 4, force = false } = {}) {
  if (!execFileSafe) return;
  const nowTs = Date.now();
  if (!force && (nowTs - _enforcementLastSystemPopupTs) < 8000) return;
  _enforcementLastSystemPopupTs = nowTs;

  const safeMessage = String(message || "").replace(/'/g, "''");
  const safeTitle = String(title || "Trajectory Blocker").replace(/'/g, "''");
  const timeoutSecs = toBoundedInt(seconds, 1, 20, 4);
  const script = `$ws = New-Object -ComObject WScript.Shell; $null = $ws.Popup('${safeMessage}', ${timeoutSecs}, '${safeTitle}', 4144)`;
  execFileSafe(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script],
    { windowsHide: true, timeout: 3500, maxBuffer: 64 * 1024 },
    () => {}
  );
}

function setMainFullscreenLock(enabled) {
  if (!ipcRendererSafe) return;
  try {
    ipcRendererSafe.send("blocker:set-fullscreen-lock", { enabled: !!enabled });
  } catch (err) {
    console.warn("setMainFullscreenLock failed", err);
  }
}

const _fullscreenLockReasons = new Set();
function setFullscreenLock(reason, enabled) {
  const key = String(reason || "").trim() || "unknown";
  const before = _fullscreenLockReasons.size;
  if (enabled) _fullscreenLockReasons.add(key);
  else _fullscreenLockReasons.delete(key);
  if (_fullscreenLockReasons.size === before) return;
  setMainFullscreenLock(_fullscreenLockReasons.size > 0);
}

function resetHardBlockState() {
  hardBlockState.active = false;
  hardBlockState.fingerprint = "";
  hardBlockState.process = "";
  hardBlockState.pid = 0;
  hardBlockState.reason = "";
  hardBlockState.bgImage = "";
  hardBlockState.deadlineTs = 0;
  hardBlockState.cycles = 0;
  hardBlockState.isBrowser = false;
}

function startHardBlockTimer() {
  if (_hardBlockTimerId) return;
  _hardBlockTimerId = setInterval(() => {
    void tickHardBlockLoop();
  }, 1000);
}

function stopHardBlockTimer() {
  if (_hardBlockTimerId) {
    clearInterval(_hardBlockTimerId);
    _hardBlockTimerId = null;
  }
}

function getHardCountdownLabel(deadlineTs, nowTs = Date.now()) {
  const secs = Math.max(0, Math.ceil((Number(deadlineTs || 0) - nowTs) / 1000));
  return `${secs}s`;
}

function evaluatePornGroupViolation(snapshot, cfgInput = null) {
  const cfg = cfgInput || state.enforcement;
  if (!snapshot || !cfg) return null;
  const processName = normalizeProcessName(snapshot.process);
  const titleLower = String(snapshot.title || "").toLowerCase();
  if (!processName && !titleLower) return null;
  if (processName.includes("trajectory")) return null;
  if (processName === "electron" && titleLower.includes("trajectory")) return null;

  const group = (cfg.pornGroup && typeof cfg.pornGroup === "object")
    ? cfg.pornGroup
    : normalizePornGroupConfig(cfg.pornGroup, cfg.pornKeywords);
  if (!group || !group.enabled) return null;
  const match = findPornMatchInTitle(titleLower, group);
  if (!match) return null;
  const reasonMap = {
    domain: `Private group domain "${match.token}" matched.`,
    custom: `Private custom term "${match.token}" matched.`,
    keyword: `Private group keyword "${match.token}" matched.`,
    search: `Private search term "${match.token}" matched.`
  };
  return {
    type: "porn",
    reason: reasonMap[match.type] || `Private group signal "${match.token}" matched.`,
    forceStage: "block",
    severity: "hard",
    noStrike: true,
    killProcess: true
  };
}

function evaluateDirectHardViolation(snapshot, { pornOnly = false } = {}) {
  ensureEnforcementStateShape();
  if (!snapshot) return null;
  const cfg = state.enforcement;
  const processName = normalizeProcessName(snapshot.process);
  const titleLower = String(snapshot.title || "").toLowerCase();
  const hardProcessList = Array.isArray(cfg.hardBlockedProcesses) ? cfg.hardBlockedProcesses : [];

  if (!processName && !titleLower) return null;
  if (processName.includes("trajectory")) return null;
  if (processName === "electron" && titleLower.includes("trajectory")) return null;

  const pornViolation = evaluatePornGroupViolation(snapshot, cfg);
  if (pornViolation) return pornViolation;
  if (pornOnly) return null;

  if (hardProcessList.includes(processName)) {
    return {
      type: "hard-process",
      reason: `${processDisplayName(snapshot.process)} is hard-blocked.`,
      forceStage: "block",
      severity: "hard",
      noStrike: true,
      killProcess: true
    };
  }

  const hardKeywordMatch = firstMatchInLowerText(titleLower, cfg.hardBlockedKeywords || []);
  if (hardKeywordMatch) {
    return {
      type: "hard-keyword",
      reason: `Hard keyword "${hardKeywordMatch}" matched.`,
      forceStage: "block",
      severity: "hard",
      noStrike: true,
      killProcess: true
    };
  }

  return null;
}

function closeActiveBrowserTabByPid(pid, { attempts = 1, hwnd = 0 } = {}) {
  if (!execFileSafe || (!pid && !hwnd)) return Promise.resolve(false);
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
  return new Promise(resolve => {
    execFileSafe(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script],
      { windowsHide: true, timeout: 4200, maxBuffer: 128 * 1024 },
      (err, stdout) => {
        if (err) { resolve(false); return; }
        resolve(String(stdout || "").trim() === "1");
      }
    );
  });
}

function isProcessRunningByPid(pid) {
  if (!execFileSafe || !pid) return Promise.resolve(false);
  const script = `if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { '1' } else { '0' }`;
  return new Promise(resolve => {
    execFileSafe(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) { resolve(false); return; }
        resolve(String(stdout || "").trim() === "1");
      }
    );
  });
}

function buildHardBlockMessage(reason, cycles, deadlineTs) {
  const timer = getHardCountdownLabel(deadlineTs);
  return `Hard block triggered. Close blocked app in ${timer}. Cycle ${cycles}.`;
}

function updateHardBlockOverlay() {
  if (!hardBlockState.active) return;
  const msg = buildHardBlockMessage(hardBlockState.reason, hardBlockState.cycles, hardBlockState.deadlineTs);
  setFullscreenLock("blocker", true);
  setEnforcementOverlay({
    visible: true,
    stage: "block",
    reason: hardBlockState.reason || "",
    message: msg,
    bgImage: hardBlockState.bgImage || "",
    processName: hardBlockState.process || "",
    title: "",
    lockUntilTs: 0,
    hardDeadlineTs: hardBlockState.deadlineTs,
    hardCycle: hardBlockState.cycles,
    hardMode: true,
    requiresIntent: false,
    error: ""
  });
}

async function endHardBlockSession() {
  if (!hardBlockState.active) return;
  resetHardBlockState();
  stopHardBlockTimer();
  setFullscreenLock("blocker", false);
  clearEnforcementOverlay();
}

async function advanceHardBlockCycle(snapshot, violation, fingerprint, nowTs) {
  const processName = processDisplayName(snapshot.process || "");
  const normalizedProcess = normalizeProcessName(snapshot.process || "");
  const isBrowser = isBrowserProcess(normalizedProcess);

  if (!hardBlockState.active || hardBlockState.fingerprint !== fingerprint) {
    hardBlockState.cycles = 0;
  }
  hardBlockState.active = true;
  hardBlockState.fingerprint = fingerprint;
  hardBlockState.process = processName;
  hardBlockState.pid = Number(snapshot.pid || 0);
  hardBlockState.reason = violation.reason || "Hard block triggered.";
  hardBlockState.bgImage = pickBlockerBackgroundImage();
  hardBlockState.deadlineTs = nowTs + (HARD_BLOCK_SECONDS * 1000);
  hardBlockState.isBrowser = isBrowser;
  hardBlockState.cycles += 1;

  let tabClosed = false;
  let rendererKilled = false;
  if (isBrowser) {
    const tabAttempts = violation.type === "porn" || violation.type === "hard-keyword" ? 3 : 2;
    tabClosed = await closeActiveBrowserTabByPid(snapshot.pid, {
      attempts: tabAttempts,
      hwnd: snapshot.hwnd
    });
    if (!tabClosed) {
      const focusPid = Number(snapshot.focusPid || 0);
      const browserPid = Number(snapshot.pid || 0);
      if (focusPid && browserPid && focusPid !== browserPid) {
        rendererKilled = await killProcessByPid(focusPid);
      }
    }
  }

  const msg = buildHardBlockMessage(hardBlockState.reason, hardBlockState.cycles, hardBlockState.deadlineTs);
  setFullscreenLock("blocker", true);
  updateHardBlockOverlay();
  showSystemInterruptionPopup(msg, { title: "Trajectory Blocker", seconds: 8, force: true });
  showEnforcementNotification(msg, "block");
  pushEnforcementLog({
    stage: "hard",
    reason: hardBlockState.reason,
    process: processName,
    title: "",
    action: rendererKilled
      ? `hard-cycle-${hardBlockState.cycles}-kill-renderer`
      : `hard-cycle-${hardBlockState.cycles}`
  });

  if (isBrowser) {
    // For browser content violations, stay tab-only. For browser process-level hard blocks, app kill is still allowed.
    const browserProcessLevelHard = violation.type === "hard-process";
    if (browserProcessLevelHard) {
      const shouldKillNow = !tabClosed || hardBlockState.cycles >= 1;
      if (shouldKillNow) {
        const killed = await killProcessByPid(snapshot.pid);
        if (!killed) await killProcessByName(snapshot.process);
      }
    }
  } else {
    const killed = await killProcessByPid(snapshot.pid);
    if (!killed) await killProcessByName(snapshot.process);
  }

  startHardBlockTimer();
}

async function tickHardBlockLoop({ forceRecheck = false } = {}) {
  if (_hardBlockTickBusy || !hardBlockState.active) return;
  _hardBlockTickBusy = true;
  try {
    const nowTs = Date.now();
    if (!forceRecheck && nowTs < hardBlockState.deadlineTs) {
      updateHardBlockOverlay();
      return;
    }

    const current = await getForegroundWindowSnapshot();
    const directHard = evaluateDirectHardViolation(current);
    let unresolved = !!directHard;
    if (!unresolved && hardBlockState.pid && !hardBlockState.isBrowser) {
      unresolved = await isProcessRunningByPid(hardBlockState.pid);
    }

    if (!unresolved) {
      await endHardBlockSession();
      return;
    }

    const snapshot = current || {
      process: hardBlockState.process,
      pid: hardBlockState.pid,
      focusPid: 0,
      hwnd: 0,
      title: ""
    };
    const violation = directHard || {
      type: "hard-still-open",
      reason: hardBlockState.reason || "Hard blocked target still open.",
      severity: "hard",
      killProcess: true,
      forceStage: "block"
    };
    const nextFingerprint = hardBlockState.fingerprint || [
      violation.type || "hard",
      normalizeProcessName(snapshot.process),
      String(snapshot.title || "").toLowerCase().slice(0, 140)
    ].join("|");
    await advanceHardBlockCycle(snapshot, violation, nextFingerprint, nowTs);
  } finally {
    _hardBlockTickBusy = false;
  }
}

function pushEnforcementLog(entry) {
  if (!entry || typeof entry !== "object") return;
  if (!Array.isArray(state.enforcementLog)) state.enforcementLog = [];
  state.enforcementLog.unshift({
    id: uuid(),
    ts: Date.now(),
    stage: entry.stage || "nudge",
    reason: entry.reason || "",
    process: entry.process || "",
    title: entry.title || "",
    action: entry.action || ""
  });
  if (state.enforcementLog.length > 120) {
    state.enforcementLog.length = 120;
  }
}

function getEnforcementPresets() {
  return [
    {
      id: "study-hard",
      label: "Study Lock",
      description: "Blocks games + entertainment by default. Keeps school/research terms allowed.",
      patch: {
        enabled: true,
        alwaysOn: true,
        tone: "hard",
        websiteMode: "allowlist",
        blockedProcesses: [
          "robloxplayerbeta",
          "discord",
          "steam",
          "epicgameslauncher",
          "battlenet"
        ],
        blockedTitleKeywords: [
          "roblox",
          "twitch",
          "netflix",
          "instagram",
          "x.com"
        ],
        allowlistedTitleKeywords: [
          "homework",
          "assignment",
          "lecture",
          "tutorial",
          "course",
          "docs",
          "research",
          "class"
        ]
      }
    },
    {
      id: "dopamine-cut",
      label: "No Entertainment",
      description: "Aggressive anti-distraction setup for deep work.",
      patch: {
        enabled: true,
        alwaysOn: true,
        tone: "hard",
        websiteMode: "blocklist",
        blockedProcesses: [
          "robloxplayerbeta",
          "discord",
          "steam",
          "epicgameslauncher",
          "spotify"
        ],
        blockedTitleKeywords: [
          "youtube",
          "twitch",
          "netflix",
          "hulu",
          "disney+",
          "reddit"
        ]
      }
    },
    {
      id: "safe-net",
      label: "Private Hard Block",
      description: "Turns on the strict private-content block group and keeps other settings.",
      patch: {
        enabled: true,
        alwaysOn: true,
        pornGroup: {
          enabled: true,
          alwaysOn: true
        },
        tone: "hard"
      }
    }
  ];
}

function mergeEnforcementPatch(patch) {
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  if (patch.enabled !== undefined) cfg.enabled = !!patch.enabled;
  if (patch.alwaysOn !== undefined) cfg.alwaysOn = !!patch.alwaysOn;
  if (patch.softNudgeEverySecs !== undefined) cfg.softNudgeEverySecs = toBoundedInt(patch.softNudgeEverySecs, 10, 600, cfg.softNudgeEverySecs || 45);
  if (patch.tone !== undefined) cfg.tone = patch.tone === "normal" ? "normal" : "hard";
  if (patch.websiteMode !== undefined) cfg.websiteMode = patch.websiteMode === "allowlist" ? "allowlist" : "blocklist";
  if (patch.blockedProcesses) cfg.blockedProcesses = uniqLowerList(patch.blockedProcesses).map(normalizeProcessName).filter(Boolean);
  if (patch.blockedTitleKeywords) cfg.blockedTitleKeywords = uniqLowerList(patch.blockedTitleKeywords);
  if (patch.hardBlockedProcesses) cfg.hardBlockedProcesses = uniqLowerList(patch.hardBlockedProcesses).map(normalizeProcessName).filter(Boolean);
  if (patch.hardBlockedKeywords) cfg.hardBlockedKeywords = uniqLowerList(patch.hardBlockedKeywords);
  if (patch.allowlistedTitleKeywords) cfg.allowlistedTitleKeywords = uniqLowerList(patch.allowlistedTitleKeywords);
  if (patch.allowlistedProcesses) cfg.allowlistedProcesses = uniqLowerList(patch.allowlistedProcesses).map(normalizeProcessName).filter(Boolean);
  if (patch.pornGroup && typeof patch.pornGroup === "object") {
    cfg.pornGroup = normalizePornGroupConfig(
      Object.assign({}, cfg.pornGroup || {}, patch.pornGroup),
      cfg.pornKeywords
    );
    cfg.pornBlockEnabled = !!cfg.pornGroup.enabled;
    cfg.pornKeywords = uniqLowerList(cfg.pornGroup.customKeywords || []);
  }
  if (patch.pornBlockEnabled !== undefined) {
    cfg.pornBlockEnabled = !!patch.pornBlockEnabled;
    cfg.pornGroup = normalizePornGroupConfig(
      Object.assign({}, cfg.pornGroup || {}, { enabled: cfg.pornBlockEnabled }),
      cfg.pornKeywords
    );
  }
}

function isFrozenNow(nowTs = Date.now()) {
  ensureEnforcementStateShape();
  return Number(state.enforcement.runtime.frozenUntilTs || 0) > nowTs;
}

function unfreezeEnforcementNow() {
  ensureEnforcementStateShape();
  if (isFrozenNow()) return false;
  state.enforcement.runtime.frozenUntilTs = 0;
  saveState();
  render();
  return true;
}

function ensureEnforcementTicker() {
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const shouldRun = !!cfg.enabled || isPornGroupAlwaysOn(cfg);
  if (!shouldRun) {
    if (_enforcementTickerId) {
      clearInterval(_enforcementTickerId);
      _enforcementTickerId = null;
      _enforcementTickerMs = 0;
    }
    try { stopForegroundSnapshotWorker(); } catch (_) {}
    if (hardBlockState.active) {
      void endHardBlockSession();
    }
    if (enforcementOverlay.visible) clearEnforcementOverlay();
    return;
  }
  const intervalMs = Math.max(
    ENFORCEMENT_MIN_POLL_SECS * 1000,
    Math.min(ENFORCEMENT_MAX_POLL_SECS * 1000, Number(cfg.pollEverySecs || 6) * 1000)
  );
  if (_enforcementTickerId && _enforcementTickerMs !== intervalMs) {
    clearInterval(_enforcementTickerId);
    _enforcementTickerId = null;
    _enforcementTickerMs = 0;
  }
  if (!_enforcementTickerId) {
    _enforcementTickerMs = intervalMs;
    _enforcementTickerId = setInterval(() => {
      void runEnforcementTick();
    }, intervalMs);
    void runEnforcementTick();
  }
}

function isBrowserProcess(name) {
  const normalized = normalizeProcessName(name);
  return ENFORCEMENT_BROWSER_PROCESSES.includes(normalized);
}

function getForegroundWindowSnapshotLegacy() {
  if (!execFileSafe) return Promise.resolve(null);
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
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowTextLength(IntPtr hWnd);
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

  return new Promise(resolve => {
    execFileSafe(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        psScript
      ],
      { windowsHide: true, timeout: 2500, maxBuffer: 256 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        const raw = String(stdout || "").trim();
        if (!raw) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          resolve({
            process: String(parsed.process || ""),
            pid: Number(parsed.pid || 0),
            focusPid: Number(parsed.focusPid || 0),
            hwnd: Number(parsed.hwnd || 0),
            title: String(parsed.title || "")
          });
        } catch (parseErr) {
          resolve(null);
        }
      }
    );
  });
}

// Persistent PowerShell worker to avoid spawning a new powershell.exe per enforcement tick.
let _foregroundSnapshotWorker = null;
let _foregroundSnapshotWorkerStdout = "";
let _foregroundSnapshotWorkerQueue = [];

function stopForegroundSnapshotWorker() {
  const worker = _foregroundSnapshotWorker;
  if (!worker) {
    _foregroundSnapshotWorkerStdout = "";
    _foregroundSnapshotWorkerQueue = [];
    return;
  }
  _foregroundSnapshotWorker = null;

  const err = new Error("foreground snapshot worker stopped");
  const pending = _foregroundSnapshotWorkerQueue.splice(0);
  pending.forEach(entry => {
    if (entry && entry.timeoutId) clearTimeout(entry.timeoutId);
    try { entry.reject(err); } catch (_) {}
  });
  _foregroundSnapshotWorkerStdout = "";

  try { worker.stdout && worker.stdout.removeAllListeners(); } catch (_) {}
  try { worker.stderr && worker.stderr.removeAllListeners(); } catch (_) {}
  try { worker.removeAllListeners(); } catch (_) {}

  try { worker.stdin && worker.stdin.write("exit\n"); } catch (_) {}
  try { worker.stdin && worker.stdin.end(); } catch (_) {}
  try { worker.kill(); } catch (_) {}
}

function encodePowerShellCommand(script) {
  try {
    if (typeof Buffer === "undefined") return "";
    return Buffer.from(String(script || ""), "utf16le").toString("base64");
  } catch (_) {
    return "";
  }
}

function ensureForegroundSnapshotWorker() {
  if (_foregroundSnapshotWorker && !_foregroundSnapshotWorker.killed) return true;
  stopForegroundSnapshotWorker();
  if (!spawnSafe) return false;

  const workerScript = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

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

function Esc([string]$s) {
  if ($null -eq $s) { return "" }
  $s = $s.Replace('\\', '\\\\').Replace('"', '\\"')
  $s = $s.Replace([string][char]13, '\\r').Replace([string][char]10, '\\n').Replace([string][char]9, '\\t')
  return $s
}

while ($true) {
  $line = [Console]::ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'exit') { break }
  try {
    $h = [ActiveWin]::GetForegroundWindow()
    if ($h -eq [IntPtr]::Zero) { [Console]::WriteLine(''); continue }
    [IntPtr]$target = $h
    $root = [ActiveWin]::GetAncestor($h, 2)
    if ($root -ne [IntPtr]::Zero) { $target = $root }
    [uint32]$focusPid = 0
    [ActiveWin]::GetWindowThreadProcessId($h, [ref]$focusPid) | Out-Null
    [uint32]$procId = 0
    [ActiveWin]::GetWindowThreadProcessId($target, [ref]$procId) | Out-Null
    $proc = $null
    try { $proc = [System.Diagnostics.Process]::GetProcessById($procId) } catch { $proc = $null }
    if ($null -eq $proc) { [Console]::WriteLine(''); continue }
    $sb = New-Object System.Text.StringBuilder 2048
    [void][ActiveWin]::GetWindowText($target, $sb, $sb.Capacity)
    $title = $sb.ToString()
    if ([string]::IsNullOrWhiteSpace($title)) { $title = $proc.MainWindowTitle }
    if ($null -eq $title) { $title = "" }
    $json = '{"process":"' + (Esc $proc.ProcessName) + '","pid":' + $procId + ',"focusPid":' + $focusPid + ',"hwnd":' + ([Int64]$target) + ',"title":"' + (Esc $title) + '"}'
    [Console]::WriteLine($json)
    [Console]::Out.Flush()
  } catch {
    [Console]::WriteLine('')
    [Console]::Out.Flush()
  }
}
`;

  let child = null;
  try {
    const encoded = encodePowerShellCommand(workerScript);
    const args = encoded
      ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", encoded]
      : ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", workerScript];
    child = spawnSafe("powershell.exe", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    stopForegroundSnapshotWorker();
    return false;
  }

  _foregroundSnapshotWorker = child;
  _foregroundSnapshotWorkerStdout = "";
  _foregroundSnapshotWorkerQueue = [];

  try { child.stdout && child.stdout.setEncoding && child.stdout.setEncoding("utf8"); } catch (_) {}
  child.stdout && child.stdout.on("data", (chunk) => {
    _foregroundSnapshotWorkerStdout += String(chunk || "");
    while (true) {
      const idx = _foregroundSnapshotWorkerStdout.indexOf("\n");
      if (idx < 0) break;
      const line = _foregroundSnapshotWorkerStdout.slice(0, idx);
      _foregroundSnapshotWorkerStdout = _foregroundSnapshotWorkerStdout.slice(idx + 1);
      const entry = _foregroundSnapshotWorkerQueue.shift();
      if (!entry) continue;
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      const raw = String(line || "").trim();
      if (!raw) {
        entry.resolve(null);
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        entry.resolve({
          process: String(parsed.process || ""),
          pid: Number(parsed.pid || 0),
          focusPid: Number(parsed.focusPid || 0),
          hwnd: Number(parsed.hwnd || 0),
          title: String(parsed.title || "")
        });
      } catch (_) {
        entry.resolve(null);
      }
    }
  });

  // Drain stderr to avoid backpressure if PowerShell writes warnings/errors.
  child.stderr && child.stderr.on("data", () => {});

  child.on("error", () => {
    stopForegroundSnapshotWorker();
  });
  child.on("close", () => {
    stopForegroundSnapshotWorker();
  });

  return true;
}

function requestForegroundSnapshotFromWorker({ timeoutMs = 900 } = {}) {
  const worker = _foregroundSnapshotWorker;
  if (!worker || worker.killed || !worker.stdin) return Promise.reject(new Error("foreground snapshot worker not ready"));
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, timeoutId: null };
    const ms = Math.max(100, Number(timeoutMs || 0) || 900);
    entry.timeoutId = setTimeout(() => {
      const i = _foregroundSnapshotWorkerQueue.indexOf(entry);
      if (i >= 0) _foregroundSnapshotWorkerQueue.splice(i, 1);
      reject(new Error("foreground snapshot worker timeout"));
      try { stopForegroundSnapshotWorker(); } catch (_) {}
    }, ms);
    _foregroundSnapshotWorkerQueue.push(entry);
    try {
      worker.stdin.write("snap\n");
    } catch (err) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      const i = _foregroundSnapshotWorkerQueue.indexOf(entry);
      if (i >= 0) _foregroundSnapshotWorkerQueue.splice(i, 1);
      reject(err);
      try { stopForegroundSnapshotWorker(); } catch (_) {}
    }
  });
}

function getForegroundWindowSnapshot() {
  // Prefer the persistent worker when available; fallback to one-shot execFile.
  if (spawnSafe && ensureForegroundSnapshotWorker()) {
    return requestForegroundSnapshotFromWorker({ timeoutMs: 900 }).catch(() => getForegroundWindowSnapshotLegacy());
  }
  return getForegroundWindowSnapshotLegacy();
}

function resolveViolationStage(strikeCount, violation) {
  const cfg = state.enforcement;
  if (violation && violation.forceStage) return violation.forceStage;
  if (strikeCount >= Number(cfg.escalation.blockAfter || 3)) return "block";
  if (strikeCount >= Number(cfg.escalation.lockoutAfter || 2)) return "lockout";
  return "nudge";
}

function evaluateViolation(snapshot, nowTs) {
  ensureEnforcementStateShape();
  if (!snapshot) return null;
  const cfg = state.enforcement;
  const processName = normalizeProcessName(snapshot.process);
  const titleLower = String(snapshot.title || "").toLowerCase();
  const allowlistedProcesses = Array.isArray(cfg.allowlistedProcesses) ? cfg.allowlistedProcesses : [];

  if (!processName && !titleLower) return null;
  if (processName.includes("trajectory")) return null;
  if (processName === "electron" && titleLower.includes("trajectory")) return null;

  const directHard = evaluateDirectHardViolation(snapshot);
  if (directHard) return directHard;

  if (allowlistedProcesses.includes(processName)) return null;

  if (cfg.youtube.enabled && titleLower.includes("youtube")) {
    if (Number(cfg.youtube.lastIntentUntilTs) > nowTs) return null;
    const allowMatch = firstMatchInLowerText(titleLower, cfg.youtube.allowKeywords || []);
    if (!allowMatch) {
      return {
        type: "youtube",
        reason: "YouTube opened during a focus window.",
        severity: "soft",
        noStrike: true,
        killProcess: false,
        requiresIntent: !!cfg.youtube.requireIntentCheck
      };
    }
  }

  if (cfg.websiteMode === "allowlist" && isBrowserProcess(processName)) {
    const allowKeyword = firstMatchInLowerText(titleLower, cfg.allowlistedTitleKeywords || []);
    const youtubeIntentOpen = (
      cfg.youtube.enabled &&
      titleLower.includes("youtube") &&
      Number(cfg.youtube.lastIntentUntilTs) > nowTs
    );
    if (!allowKeyword && !youtubeIntentOpen) {
      return {
        type: "allowlist-miss",
        reason: "Browser window does not match your allowlist keywords.",
        severity: "soft",
        noStrike: true,
        killProcess: false
      };
    }
  }

  const blockedProcesses = Array.isArray(cfg.blockedProcesses) ? cfg.blockedProcesses : [];
  const processBlocked = blockedProcesses.includes(processName);
  if (processBlocked) {
    return {
      type: "blocked-process",
      reason: `${processDisplayName(snapshot.process)} is blocked during focus.`,
      severity: "soft",
      noStrike: true,
      killProcess: false
    };
  }

  const keywordMatch = firstMatchInLowerText(titleLower, cfg.blockedTitleKeywords || []);
  if (keywordMatch) {
    return {
      type: "blocked-keyword",
      reason: `Blocked keyword "${keywordMatch}" matched.`,
      severity: "soft",
      noStrike: true,
      killProcess: false
    };
  }

  return null;
}

function killProcessByPid(pid) {
  if (!execFileSafe || !pid) return Promise.resolve(false);
  return new Promise(resolve => {
    execFileSafe(
      "taskkill.exe",
      ["/PID", String(pid), "/F", "/T"],
      { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024 },
      err => resolve(!err)
    );
  });
}

function killProcessByName(name) {
  if (!execFileSafe || !name) return Promise.resolve(false);
  const image = processDisplayName(name);
  if (!image) return Promise.resolve(false);
  return new Promise(resolve => {
    execFileSafe(
      "taskkill.exe",
      ["/IM", image, "/F", "/T"],
      { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024 },
      err => resolve(!err)
    );
  });
}

async function applyViolation(snapshot, violation, nowTs) {
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const rt = cfg.runtime || {};
  const beforeRuntime = JSON.stringify(rt);
  const beforeLogLen = Array.isArray(state.enforcementLog) ? state.enforcementLog.length : 0;
  const severity = violation && violation.severity === "hard" ? "hard" : "soft";

  const softFingerprint = [
    violation.type || "",
    normalizeProcessName(snapshot.process),
    String(snapshot.title || "").toLowerCase().slice(0, 140)
  ].join("|");
  const hardFingerprint = [
    violation.type || "",
    normalizeProcessName(snapshot.process)
  ].join("|");
  const fingerprint = severity === "hard" ? hardFingerprint : softFingerprint;
  const isRecentRepeat = (
    fingerprint === _enforcementLastFingerprint &&
    (nowTs - _enforcementLastFingerprintTs) < ENFORCEMENT_REPEAT_GRACE_MS
  );
  if (isRecentRepeat && severity === "soft") return;
  _enforcementLastFingerprint = fingerprint;
  _enforcementLastFingerprintTs = nowTs;

  // Keep hard-cycle timing stable: don't reset the 8s deadline on every poll for the same active violation.
  if (severity === "hard" && hardBlockState.active && hardBlockState.fingerprint === fingerprint) {
    if (nowTs < Number(hardBlockState.deadlineTs || 0)) {
      updateHardBlockOverlay();
    } else {
      await tickHardBlockLoop({ forceRecheck: true });
    }
    return;
  }

  if (severity === "hard") {
    rt.lastDetectionTs = nowTs;
    rt.lastAction = "hard-block";
    rt.lastReason = String(violation.reason || "");
    rt.lastTitle = String(snapshot.title || "");
    rt.lastProcess = processDisplayName(snapshot.process || "");
    await advanceHardBlockCycle(snapshot, violation, fingerprint, nowTs);
    const afterHardLogLen = Array.isArray(state.enforcementLog) ? state.enforcementLog.length : 0;
    if (beforeRuntime !== JSON.stringify(rt) || beforeLogLen !== afterHardLogLen) saveState();
    return;
  }

  if (severity === "soft") {
    const intervalMs = Math.max(10, Number(cfg.softNudgeEverySecs || 45)) * 1000;
    if ((nowTs - Number(rt.lastSoftNudgeTs || 0)) < intervalMs) return;
    rt.lastSoftNudgeTs = nowTs;
    rt.lastDetectionTs = nowTs;
    rt.lastAction = "soft-nudge";
    rt.lastReason = String(violation.reason || "");
    rt.lastTitle = String(snapshot.title || "");
    rt.lastProcess = processDisplayName(snapshot.process || "");
    const message = resolvePrompt("nudge");
    showEnforcementNotification(message, "nudge");
    showSystemInterruptionPopup(message, { title: "Trajectory Blocker", seconds: 4, force: false });
    pushEnforcementLog({
      stage: "soft",
      reason: violation.reason || "",
      process: processDisplayName(snapshot.process),
      title: String(snapshot.title || ""),
      action: violation.type || "soft"
    });
    const afterSoftLogLen = Array.isArray(state.enforcementLog) ? state.enforcementLog.length : 0;
    if (beforeRuntime !== JSON.stringify(rt) || beforeLogLen !== afterSoftLogLen) saveState();
    return;
  }
}

async function runEnforcementTick() {
  if (_enforcementTickBusy) return;
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const pornOnlyMode = !cfg.enabled && isPornGroupAlwaysOn(cfg);
  if (!cfg.enabled && !pornOnlyMode) {
    if (hardBlockState.active) await endHardBlockSession();
    return;
  }

  _enforcementTickBusy = true;
  try {
    const nowTs = Date.now();
    const rt = cfg.runtime || {};
    let runtimeDirty = false;

    const cooldownMs = Math.max(1, Number(cfg.escalation.cooldownMins || 30)) * 60 * 1000;
    if (Number(rt.strikeCount || 0) > 0 && (nowTs - Number(rt.lastStrikeTs || 0)) > cooldownMs) {
      rt.strikeCount = 0;
      runtimeDirty = true;
    }
    if (Number(cfg.sessionUntilTs || 0) > 0 && Number(cfg.sessionUntilTs || 0) <= nowTs) {
      cfg.sessionUntilTs = 0;
      runtimeDirty = true;
    }
    if (Number(rt.lockoutUntilTs || 0) > 0 && Number(rt.lockoutUntilTs || 0) <= nowTs) {
      rt.lockoutUntilTs = 0;
      runtimeDirty = true;
    }
    if (Number(rt.blockedUntilTs || 0) > 0 && Number(rt.blockedUntilTs || 0) <= nowTs) {
      rt.blockedUntilTs = 0;
      runtimeDirty = true;
    }
    if (Number(rt.frozenUntilTs || 0) > 0 && Number(rt.frozenUntilTs || 0) <= nowTs) {
      rt.frozenUntilTs = 0;
      runtimeDirty = true;
    }
    if (runtimeDirty) saveState();

    const status = getEnforcementStatus(nowTs);
    if (!status.active) {
      try { stopForegroundSnapshotWorker(); } catch (_) {}
      if (hardBlockState.active) await endHardBlockSession();
      else if (enforcementOverlay.visible) clearEnforcementOverlay();
      return;
    }

    const snapshot = await getForegroundWindowSnapshot();
    if (!snapshot) {
      if (hardBlockState.active) await tickHardBlockLoop({ forceRecheck: false });
      return;
    }
    const violation = pornOnlyMode
      ? evaluateDirectHardViolation(snapshot, { pornOnly: true })
      : evaluateViolation(snapshot, nowTs);
    if (!violation) {
      if (hardBlockState.active) {
        await tickHardBlockLoop({ forceRecheck: false });
        return;
      }
      if (
        enforcementOverlay.visible &&
        !enforcementOverlay.requiresIntent &&
        !enforcementOverlay.hardMode &&
        Number(cfg.runtime.blockedUntilTs || 0) <= nowTs &&
        Number(cfg.runtime.lockoutUntilTs || 0) <= nowTs
      ) {
        clearEnforcementOverlay();
      }
      return;
    }
    await applyViolation(snapshot, violation, nowTs);
  } catch (err) {
    console.error("runEnforcementTick failed", err);
  } finally {
    _enforcementTickBusy = false;
  }
}

function startManualEnforcementSession() {
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const mins = Math.max(5, Number(cfg.sessionDurationMins || 60));
  const untilTs = Date.now() + (mins * 60 * 1000);
  cfg.enabled = true;
  cfg.sessionUntilTs = untilTs;
  if (cfg.strictMode) {
    cfg.runtime.frozenUntilTs = Math.max(Number(cfg.runtime.frozenUntilTs || 0), untilTs);
  }
  pushEnforcementLog({
    stage: "session",
    reason: `Manual session started for ${mins} minutes.`,
    process: "trajectory",
    title: "",
    action: cfg.strictMode ? "session-frozen" : "session"
  });
  saveState();
  ensureEnforcementTicker();
  render();
}

function stopManualEnforcementSession() {
  ensureEnforcementStateShape();
  if (state.enforcement.strictMode && isFrozenNow()) {
    alert("Frozen mode is active. Session cannot be stopped until the freeze timer ends.");
    return;
  }
  state.enforcement.sessionUntilTs = 0;
  saveState();
  render();
}

function resetEnforcementRuntime() {
  ensureEnforcementStateShape();
  if (state.enforcement.strictMode && isFrozenNow()) {
    alert("Frozen mode is active. Runtime cannot be reset until freeze ends.");
    return;
  }
  const rt = state.enforcement.runtime || {};
  rt.strikeCount = 0;
  rt.lastStrikeTs = 0;
  rt.lockoutUntilTs = 0;
  rt.blockedUntilTs = 0;
  rt.frozenUntilTs = 0;
  rt.lastSoftNudgeTs = 0;
  rt.lastAction = "idle";
  rt.lastReason = "";
  rt.lastTitle = "";
  rt.lastProcess = "";
  _enforcementLastFingerprint = "";
  _enforcementLastFingerprintTs = 0;
  void endHardBlockSession();
  clearEnforcementOverlay();
  saveState();
}

function submitYouTubeIntentFromOverlay() {
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const input = $("#enfIntentInput");
  const text = input ? String(input.value || "").trim() : "";
  if (text.length < 12) {
    setEnforcementOverlay({
      visible: true,
      error: "Write at least one concrete sentence before unblocking YouTube."
    });
    return;
  }
  cfg.youtube.lastIntentText = text;
  cfg.youtube.lastIntentUntilTs = Date.now() + (Math.max(1, Number(cfg.youtube.allowMinutes || 12)) * 60 * 1000);
  if (cfg.runtime) {
    cfg.runtime.strikeCount = Math.max(0, Number(cfg.runtime.strikeCount || 0) - 1);
    cfg.runtime.lastAction = "youtube-allowed";
    cfg.runtime.lastReason = "Intent accepted for temporary learning window.";
  }
  pushEnforcementLog({
    stage: "allow",
    reason: "YouTube intent accepted.",
    process: "browser",
    title: text,
    action: "youtube-intent"
  });
  clearEnforcementOverlay();
  saveState();
}

function saveEnforcementSettingsFromUi({
  rerender = true,
  allowDuringFrozen = false,
  allowHardListClear = false
} = {}) {
  const enabledEl = $("#enfEnabled");
  if (!enabledEl) return false;
  ensureEnforcementStateShape();
  const cfg = state.enforcement;
  const frozenNow = isFrozenNow();
  if (frozenNow && cfg.strictMode && !allowDuringFrozen) {
    if (rerender) {
      alert("Frozen mode is active. Blocker settings are locked until the timer ends.");
      render();
    }
    return false;
  }
  const desiredEnabled = !!enabledEl.checked;
  if (frozenNow && cfg.strictMode && !desiredEnabled) {
    cfg.enabled = true;
    if (enabledEl) enabledEl.checked = true;
    alert("Frozen mode is active. You cannot disable blocker settings until the timer ends.");
  } else {
    cfg.enabled = desiredEnabled;
  }
  cfg.alwaysOn = !!($("#enfAlwaysOn") && $("#enfAlwaysOn").checked);
  const strictDesired = !!($("#enfStrictMode") && $("#enfStrictMode").checked);
  if (frozenNow && cfg.strictMode && !strictDesired) {
    cfg.strictMode = true;
    const strictEl = $("#enfStrictMode");
    if (strictEl) strictEl.checked = true;
  } else {
    cfg.strictMode = strictDesired;
  }
  cfg.tone = ($("#enfTone") && $("#enfTone").value === "normal") ? "normal" : "hard";
  cfg.websiteMode = ($("#enfWebsiteMode") && $("#enfWebsiteMode").value === "allowlist") ? "allowlist" : "blocklist";
  cfg.pollEverySecs = toBoundedInt(
    $("#enfPollSecs") ? $("#enfPollSecs").value : cfg.pollEverySecs,
    ENFORCEMENT_MIN_POLL_SECS,
    ENFORCEMENT_MAX_POLL_SECS,
    cfg.pollEverySecs
  );
  cfg.softNudgeEverySecs = toBoundedInt(
    $("#enfSoftNudgeSecs") ? $("#enfSoftNudgeSecs").value : cfg.softNudgeEverySecs,
    10,
    600,
    cfg.softNudgeEverySecs
  );

  cfg.schedule.startTime = normalizeTimeValue(
    $("#enfStartTime") ? $("#enfStartTime").value : cfg.schedule.startTime,
    cfg.schedule.startTime
  );
  cfg.schedule.endTime = normalizeTimeValue(
    $("#enfEndTime") ? $("#enfEndTime").value : cfg.schedule.endTime,
    cfg.schedule.endTime
  );
  const selectedDays = Array.from(document.querySelectorAll("[data-enf-day]:checked"))
    .map(el => Number(el.getAttribute("data-enf-day")))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  cfg.schedule.days = selectedDays.length ? Array.from(new Set(selectedDays)).sort((a, b) => a - b) : [1, 2, 3, 4, 5];

  cfg.sessionDurationMins = toBoundedInt(
    $("#enfSessionMins") ? $("#enfSessionMins").value : cfg.sessionDurationMins,
    5,
    600,
    cfg.sessionDurationMins
  );
  cfg.freezeDurationMins = toBoundedInt(
    $("#enfFreezeMins") ? $("#enfFreezeMins").value : cfg.freezeDurationMins,
    5,
    600,
    cfg.freezeDurationMins
  );

  cfg.youtube.enabled = !!($("#enfYoutubeEnabled") && $("#enfYoutubeEnabled").checked);
  cfg.youtube.requireIntentCheck = !!($("#enfYoutubeIntentEnabled") && $("#enfYoutubeIntentEnabled").checked);
  cfg.youtube.allowMinutes = toBoundedInt(
    $("#enfYoutubeAllowMins") ? $("#enfYoutubeAllowMins").value : cfg.youtube.allowMinutes,
    1,
    180,
    cfg.youtube.allowMinutes
  );
  cfg.youtube.allowKeywords = uniqLowerList(
    $("#enfYoutubeAllowKeywords") ? $("#enfYoutubeAllowKeywords").value : cfg.youtube.allowKeywords
  );

  const incomingPornGroup = normalizePornGroupConfig(cfg.pornGroup, cfg.pornKeywords);
  incomingPornGroup.enabled = !!($("#enfPornGroupEnabled") && $("#enfPornGroupEnabled").checked);
  incomingPornGroup.alwaysOn = !!($("#enfPornGroupAlwaysOn") && $("#enfPornGroupAlwaysOn").checked);
  incomingPornGroup.blockedDomains = uniqLowerList(
    $("#enfPornDomains") ? $("#enfPornDomains").value : incomingPornGroup.blockedDomains
  );
  incomingPornGroup.blockedKeywords = uniqLowerList(
    $("#enfPornBlockedKeywords") ? $("#enfPornBlockedKeywords").value : incomingPornGroup.blockedKeywords
  );
  incomingPornGroup.blockedSearchTerms = uniqLowerList(
    $("#enfPornSearchTerms") ? $("#enfPornSearchTerms").value : incomingPornGroup.blockedSearchTerms
  );
  incomingPornGroup.customKeywords = uniqLowerList(
    $("#enfPornCustomKeywords") ? $("#enfPornCustomKeywords").value : incomingPornGroup.customKeywords
  );
  cfg.pornGroup = normalizePornGroupConfig(incomingPornGroup, incomingPornGroup.customKeywords);
  cfg.pornBlockEnabled = !!cfg.pornGroup.enabled;
  cfg.pornKeywords = uniqLowerList(cfg.pornGroup.customKeywords || []);
  cfg.extensionGuard = cfg.extensionGuard && typeof cfg.extensionGuard === "object"
    ? cfg.extensionGuard
    : cloneJson(getDefaultEnforcementState().extensionGuard);
  const nextGuardBrowser = String(
    ($("#enfExtensionGuardBrowser") && $("#enfExtensionGuardBrowser").value)
    || cfg.extensionGuard.browser
    || "chrome"
  ).toLowerCase();
  cfg.extensionGuard.enabled = !!($("#enfExtensionGuardEnabled") && $("#enfExtensionGuardEnabled").checked);
  cfg.extensionGuard.browser = EXTENSION_GUARD_BROWSERS.includes(nextGuardBrowser) ? nextGuardBrowser : "chrome";
  cfg.extensionGuard.requireInstalled = !!($("#enfExtensionGuardRequireInstalled") && $("#enfExtensionGuardRequireInstalled").checked);
  cfg.extensionGuard.checkEverySecs = toBoundedInt(
    $("#enfExtensionGuardCheckSecs") ? $("#enfExtensionGuardCheckSecs").value : cfg.extensionGuard.checkEverySecs,
    EXTENSION_GUARD_MIN_CHECK_SECS,
    EXTENSION_GUARD_MAX_CHECK_SECS,
    3
  );
  cfg.extensionGuard.extensionPath = String(
    getBrowserBlockerExtensionDir()
    || cfg.extensionGuard.extensionPath
    || ""
  ).trim();
  cfg.blockedProcesses = uniqLowerList(
    $("#enfBlockedProcesses") ? $("#enfBlockedProcesses").value : cfg.blockedProcesses
  ).map(normalizeProcessName).filter(Boolean);
  cfg.blockedTitleKeywords = uniqLowerList(
    $("#enfBlockedKeywords") ? $("#enfBlockedKeywords").value : cfg.blockedTitleKeywords
  );
  const nextHardBlockedProcesses = uniqLowerList(
    $("#enfHardBlockedProcesses") ? $("#enfHardBlockedProcesses").value : cfg.hardBlockedProcesses
  ).map(normalizeProcessName).filter(Boolean);
  // Guard against transient empty UI snapshots during aggressive hard-block rerenders.
  // Clearing these lists requires an explicit save action.
  if (
    allowHardListClear ||
    nextHardBlockedProcesses.length ||
    !Array.isArray(cfg.hardBlockedProcesses) ||
    !cfg.hardBlockedProcesses.length
  ) {
    cfg.hardBlockedProcesses = nextHardBlockedProcesses;
  }

  const nextHardBlockedKeywords = uniqLowerList(
    $("#enfHardBlockedKeywords") ? $("#enfHardBlockedKeywords").value : cfg.hardBlockedKeywords
  );
  if (
    allowHardListClear ||
    nextHardBlockedKeywords.length ||
    !Array.isArray(cfg.hardBlockedKeywords) ||
    !cfg.hardBlockedKeywords.length
  ) {
    cfg.hardBlockedKeywords = nextHardBlockedKeywords;
  }
  cfg.allowlistedTitleKeywords = uniqLowerList(
    $("#enfAllowlistKeywords") ? $("#enfAllowlistKeywords").value : cfg.allowlistedTitleKeywords
  );
  cfg.allowlistedProcesses = uniqLowerList(
    $("#enfAllowlistProcesses") ? $("#enfAllowlistProcesses").value : cfg.allowlistedProcesses
  ).map(normalizeProcessName).filter(Boolean);

  cfg.escalation.nudgeAfter = toBoundedInt(
    $("#enfNudgeAfter") ? $("#enfNudgeAfter").value : cfg.escalation.nudgeAfter,
    1,
    20,
    cfg.escalation.nudgeAfter
  );
  cfg.escalation.lockoutAfter = toBoundedInt(
    $("#enfLockoutAfter") ? $("#enfLockoutAfter").value : cfg.escalation.lockoutAfter,
    cfg.escalation.nudgeAfter,
    30,
    cfg.escalation.lockoutAfter
  );
  cfg.escalation.blockAfter = toBoundedInt(
    $("#enfBlockAfter") ? $("#enfBlockAfter").value : cfg.escalation.blockAfter,
    cfg.escalation.lockoutAfter,
    60,
    cfg.escalation.blockAfter
  );
  cfg.escalation.cooldownMins = toBoundedInt(
    $("#enfCooldownMins") ? $("#enfCooldownMins").value : cfg.escalation.cooldownMins,
    1,
    240,
    cfg.escalation.cooldownMins
  );
  cfg.escalation.lockoutMins = toBoundedInt(
    $("#enfLockoutMins") ? $("#enfLockoutMins").value : cfg.escalation.lockoutMins,
    1,
    240,
    cfg.escalation.lockoutMins
  );
  cfg.escalation.blockMins = toBoundedInt(
    $("#enfBlockMins") ? $("#enfBlockMins").value : cfg.escalation.blockMins,
    1,
    720,
    cfg.escalation.blockMins
  );
  cfg.escalation.killProcessOnBlock = !!($("#enfKillOnBlock") && $("#enfKillOnBlock").checked);

  cfg.prompts.youtubeIntentQuestion = String(
    ($("#enfPromptYoutubeQuestion") && $("#enfPromptYoutubeQuestion").value) || cfg.prompts.youtubeIntentQuestion
  ).trim() || getDefaultEnforcementState().prompts.youtubeIntentQuestion;
  cfg.prompts.normal.nudge = String(
    ($("#enfPromptNormalNudge") && $("#enfPromptNormalNudge").value) || cfg.prompts.normal.nudge
  ).trim() || getDefaultEnforcementState().prompts.normal.nudge;
  cfg.prompts.normal.lockout = String(
    ($("#enfPromptNormalLockout") && $("#enfPromptNormalLockout").value) || cfg.prompts.normal.lockout
  ).trim() || getDefaultEnforcementState().prompts.normal.lockout;
  cfg.prompts.normal.block = String(
    ($("#enfPromptNormalBlock") && $("#enfPromptNormalBlock").value) || cfg.prompts.normal.block
  ).trim() || getDefaultEnforcementState().prompts.normal.block;
  cfg.prompts.hard.nudge = String(
    ($("#enfPromptHardNudge") && $("#enfPromptHardNudge").value) || cfg.prompts.hard.nudge
  ).trim() || getDefaultEnforcementState().prompts.hard.nudge;
  cfg.prompts.hard.lockout = String(
    ($("#enfPromptHardLockout") && $("#enfPromptHardLockout").value) || cfg.prompts.hard.lockout
  ).trim() || getDefaultEnforcementState().prompts.hard.lockout;
  cfg.prompts.hard.block = String(
    ($("#enfPromptHardBlock") && $("#enfPromptHardBlock").value) || cfg.prompts.hard.block
  ).trim() || getDefaultEnforcementState().prompts.hard.block;

  ensureEnforcementStateShape();
  saveState();
  ensureEnforcementTicker();
  if (rerender) render();
  return true;
}

// ---------- Render ----------
function render() {
  const app = $("#app");
  applyTheme(getThemeFromState());
  if (state.view === "week") state.view = "month";
  const weekStartDate = fromISO(state.weekStartISO);
  const monthStartDateForHeader = state.monthStartISO ? fromISO(state.monthStartISO) : getMonthStart(new Date());
  const { sprint, plannedHours, doneHours, remainingBudget, total, doneCount, pct, overbooked, todayFocus } = compute();

  // Header label
  $("#weekLabel").textContent = state.view === "month"
    ? `${monthStartDateForHeader.toLocaleDateString(undefined, { month: "long", year: "numeric" })} · Calendar`
    : state.view === "workout"
      ? `Workout · Progress`
    : `${formatRange(weekStartDate)} · ${state.weekStartISO}`;

  // Tabs
  $("#tabHome").setAttribute("aria-pressed", String(state.view === "home"));
  $("#tabMonth").setAttribute("aria-pressed", String(state.view === "month"));
  $("#tabPlan").setAttribute("aria-pressed", String(state.view === "plan"));
  $("#tabStats").setAttribute("aria-pressed", String(state.view === "stats"));
  const workoutTab = $("#tabWorkout");
  if (workoutTab) workoutTab.setAttribute("aria-pressed", String(state.view === "workout"));
  const blockerTab = $("#tabBlocker");
  if (blockerTab) blockerTab.setAttribute("aria-pressed", String(state.view === "blocker"));
  const settingsTab = $("#tabSettings");
  if (settingsTab) settingsTab.setAttribute("aria-pressed", String(state.view === "settings"));

  const summaryCard = `
    <div class="card">
      <div class="card__title">
        <h2>This Week</h2>
        <div class="meta">${escapeHtml(sprint.title)}</div>
      </div>

      <div class="big">${escapeHtml(sprint.objective || "Set a sprint objective.")}</div>

      <div class="stats-grid">
        <div class="kv__item">
          <div class="kv__label">Time budget</div>
          <div class="kv__value">${Number(sprint.timeBudgetHours)}h</div>
        </div>
        <div class="kv__item">
          <div class="kv__label">Planned</div>
          <div class="kv__value">${plannedHours}h</div>
        </div>
        <div class="kv__item">
          <div class="kv__label">Done</div>
          <div class="kv__value">${doneHours}h</div>
        </div>
        <div class="kv__item">
          <div class="kv__label">Remaining (budget)</div>
          <div class="kv__value">${remainingBudget}h</div>
        </div>
      </div>

      <div class="bar" aria-label="Progress bar">
        <div class="bar__fill" style="width:${Math.min(pct,100)}%"></div>
      </div>

      <div style="margin-top:var(--space);display:flex;gap:var(--space);flex-wrap:wrap;justify-content:space-between;">
        <div class="badge">
          <span class="pill ${overbooked ? "pill--bad" : "pill--good"}">${overbooked ? "Overbooked" : "Within budget"}</span>
          <span class="faint">${doneCount}/${total} commitments (${pct}%)</span>
        </div>
        <div class="badge">
          <span class="pill">Guideline</span>
          <span class="faint">Aim for ≤ 7 commitments/week</span>
        </div>
      </div>
    </div>
  `;

  const focusCard = `
    <div class="card card--focus">
      <div class="card__title">
        <h2>Today’s Focus</h2>
        <div class="meta">${todayFocus ? pillFor(todayFocus) : `<span class="pill pill--good">All done</span>`}</div>
      </div>
      ${
        todayFocus
          ? `
            <div class="card__section">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1">
                  <div class="big">${escapeHtml(todayFocus.title)}</div>
                  <div class="muted" style="margin-top:6px;font-size:13px">${escapeHtml(todayFocus.nextAction || "Start by opening the project and doing the smallest step.")}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
                  <button class="btn ${todayFocus.started ? 'btn--ghost' : 'btn--primary'}" type="button" data-start-id="${escapeHtml(todayFocus.id)}">${todayFocus.started ? 'Stop' : 'Start'}</button>
                  ${todayFocus.started ? `<div class="muted">In progress · ${formatElapsed(Date.now() - Number(todayFocus.started))}</div>` : `<button class="smallbtn" type="button" id="pickNextBtn">Pick next best</button>`}
                </div>
              </div>
            </div>
          `
          : `
            <div class="card__section">
              <div class="big">You cleared the board.</div>
              <div class="muted" style="margin-top:6px">Add or schedule your next commitment.</div>
            </div>
          `
      }
    </div>
  `;

  ensureUiStateShape();
  const requestedClassFilter = getCalendarClassFilterKey();

  // Inbox / Backlog card (quick capture)
  const inboxItems = (state.inbox || []).map(it => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;">
      <div>
        <div style="font-weight:900">${escapeHtml(it.title)}</div>
        ${it.deliverable ? `<div class="muted" style="font-size:12px;margin-top:4px;">Notes: ${escapeHtml(it.deliverable)}</div>` : ``}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        <button class="smallbtn" type="button" data-assign-inbox="${escapeHtml(it.id)}">Assign</button>
        <button class="smallbtn" type="button" data-delete-inbox="${escapeHtml(it.id)}">Delete</button>
      </div>
    </div>
  `).join('');

  const inboxCard = `
    <div class="card">
      <div class="card__title">
        <h2>Inbox</h2>
        <div class="meta">Quick capture</div>
      </div>
      ${inboxItems || `<div class="faint">No inbox items yet.</div>`}
    </div>
  `;

  let viewHtml = "";
  if (state.view === "month") {
    const monthStartDate = state.monthStartISO ? fromISO(state.monthStartISO) : getMonthStart(new Date());
    const firstShown = getWeekStart(monthStartDate);
    const lastShown = addDays(getWeekStart(new Date(monthStartDate.getFullYear(), monthStartDate.getMonth() + 1, 0)), 6);
    const monthClassOptions = collectCalendarClassOptionsForRange(toISO(firstShown), toISO(lastShown));
    const monthClassFilter = requestedClassFilter === "all" || monthClassOptions.some(opt => opt.key === requestedClassFilter)
      ? requestedClassFilter
      : "all";
    viewHtml = renderMonthView(monthStartDate, { classFilterKey: monthClassFilter, classOptions: monthClassOptions });
  }
  else if (state.view === "home") viewHtml = renderHomeView(summaryCard, focusCard, inboxCard);
  else if (state.view === "stats") viewHtml = renderStatsView();
  else if (state.view === "workout") viewHtml = renderWorkoutView();
  else if (state.view === "blocker") viewHtml = renderBlockerView();
  else if (state.view === "settings") viewHtml = renderSettingsView();
  else viewHtml = renderPlanView(sprint, weekStartDate);
  app.innerHTML = `${viewHtml}${renderGlobalDrawer()}${renderEnforcementOverlay()}`;

  wireHandlers();
  // Update timeline now-line when plan view is active
  if (state.view === "plan") {
    try { startNowLineUpdater(); } catch (e) { console.error('startNowLineUpdater failed', e); }
  } else {
    try { stopNowLineUpdater(); } catch (e) { console.error('stopNowLineUpdater failed', e); }
  }
  syncCommitmentDayOptions();
  // ensure periodic render for live timers (minutes) when needed
  try { ensureRenderTicker(); } catch (e) { console.error('ensureRenderTicker failed', e); }
  try { ensureEnforcementTicker(); } catch (e) { console.error('ensureEnforcementTicker failed', e); }
  try { ensureCanvasSyncTicker(); } catch (e) { console.error('ensureCanvasSyncTicker failed', e); }
  try { ensureCanvasAutopilotTicker(); } catch (e) { console.error('ensureCanvasAutopilotTicker failed', e); }
  try { ensureMorningGateTicker(); } catch (e) { console.error('ensureMorningGateTicker failed', e); }
}

function getMonthStart(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0,0,0,0);
  return x;
}

function getCalendarOccurrenceKey(c) {
  if (!c || !c.__isOccurrence) return "";
  if (c.occurrenceId) return String(c.occurrenceId);
  if (c.templateId && c.dateISO) return `${c.templateId}:${c.dateISO}`;
  return "";
}

function isCalendarItemDone(c) {
  if (!c) return false;
  const occKey = getCalendarOccurrenceKey(c);
  if (occKey) return !!(state.occurrenceDone && state.occurrenceDone[occKey]);
  return !!c.done;
}

function sortCalendarItems(items) {
  const list = Array.isArray(items) ? items.slice() : [];
  const score = item => {
    const doneRank = isCalendarItemDone(item) ? 1 : 0;
    const start = timeToMinutes(item && item.startTime ? String(item.startTime) : "");
    const timeRank = Number.isFinite(start) ? start : 24 * 60 + 1;
    const title = String(item && item.title ? item.title : "").toLowerCase();
    return { doneRank, timeRank, title };
  };
  list.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa.doneRank !== sb.doneRank) return sa.doneRank - sb.doneRank;
    if (sa.timeRank !== sb.timeRank) return sa.timeRank - sb.timeRank;
    return sa.title.localeCompare(sb.title);
  });
  return list;
}

function formatCalendarTimeLabel(c) {
  if (!c || !c.startTime) return "";
  const raw = String(c.startTime || "").trim();
  const mins = timeToMinutes(raw);
  if (mins === null) return raw;
  return minutesToTime(mins);
}

function getCalendarClassFilterKey() {
  ensureUiStateShape();
  const raw = String(state.ui.calendarClassFilter || "all").trim();
  return raw || "all";
}

function setCalendarClassFilterKey(nextKey, { persist = true, rerender = true } = {}) {
  ensureUiStateShape();
  const key = String(nextKey || "all").trim() || "all";
  state.ui.calendarClassFilter = key;
  if (persist) saveState();
  if (rerender) render();
}

function getCanvasFeedLabelById(sourceId) {
  ensureCanvasSyncStateShape();
  const id = String(sourceId || "").trim().toLowerCase();
  if (!id) return "Canvas";
  const feed = (state.canvasSync.feeds || []).find(f => String(f.id || "").trim().toLowerCase() === id);
  return feed ? String(feed.label || id) : id.toUpperCase();
}

function getGoalTitleById(goalId) {
  const id = String(goalId || "").trim();
  if (!id) return "";
  const goal = (state.longPlans || []).find(g => String(g && g.id ? g.id : "").trim() === id);
  return goal ? String(goal.title || "").trim() : "";
}

function getCalendarClassMetaForItem(item) {
  if (!item) return { key: "general", label: "General", color: "#64748B", kind: "general" };

  if (String(item.externalSource || "").trim().toLowerCase() === "canvas") {
    const feedId = String(item.externalSourceId || "").trim().toLowerCase();
    const label = getCanvasFeedLabelById(feedId);
    return {
      key: feedId ? `feed:${feedId}` : "feed:canvas",
      label,
      color: getCanvasFeedColorById(feedId) || getCommitColor(item),
      kind: "feed"
    };
  }

  const linkedGoalId = String(
    item.goalId ||
    (Array.isArray(item.linkedPlanIds) && item.linkedPlanIds.length ? item.linkedPlanIds[0] : "") ||
    ""
  ).trim();
  if (linkedGoalId) {
    const label = getGoalTitleById(linkedGoalId) || "Goal-linked";
    return {
      key: `goal:${linkedGoalId}`,
      label,
      color: getCommitColor(item),
      kind: "goal"
    };
  }

  return {
    key: "general",
    label: "General",
    color: getCommitColor(item),
    kind: "general"
  };
}

function calendarItemMatchesClassFilter(item, classFilterKey) {
  const key = String(classFilterKey || "all").trim() || "all";
  if (key === "all") return true;
  const meta = getCalendarClassMetaForItem(item);
  return meta.key === key;
}

function collectCalendarClassOptionsForRange(startISO, endISO) {
  const from = String(startISO || "");
  const to = String(endISO || "");
  if (!from || !to) return [];

  const map = new Map();
  const pushItem = (item) => {
    if (!item) return;
    const meta = getCalendarClassMetaForItem(item);
    const current = map.get(meta.key) || {
      key: meta.key,
      label: meta.label,
      color: meta.color,
      kind: meta.kind,
      count: 0,
      hours: 0
    };
    current.count += 1;
    current.hours += Number(item.estHours) || 0;
    map.set(meta.key, current);
  };

  Object.entries(state.sprints || {}).forEach(([wkISO, sp]) => {
    (sp.commitments || []).forEach(c => {
      const cDate = c.dateISO ? c.dateISO : toISO(addDays(fromISO(wkISO), clampDay(Number(c.dayIndex || 0))));
      if (cDate < from || cDate > to) return;
      pushItem(c);
    });
  });

  try {
    const occs = getOccurrencesForRange(from, to);
    occs.forEach(o => {
      pushItem(Object.assign({}, o, {
        __isOccurrence: true,
        templateId: o.templateId,
        occurrenceId: o.occurrenceId
      }));
    });
  } catch (_) {}

  return Array.from(map.values()).sort((a, b) => {
    if (a.kind !== b.kind) {
      const rank = { feed: 0, goal: 1, general: 2 };
      return (rank[a.kind] || 9) - (rank[b.kind] || 9);
    }
    return String(a.label || "").localeCompare(String(b.label || ""));
  });
}

function renderCalendarClassControls(classOptions, classFilterKey) {
  const options = Array.isArray(classOptions) ? classOptions : [];
  const activeKey = String(classFilterKey || "all").trim() || "all";
  const totalCount = options.reduce((sum, opt) => sum + (Number(opt.count) || 0), 0);
  const selectHtml = `
    <label class="calendar-filter">
      <span class="calendar-filter__label">Class View</span>
      <select id="calendarClassFilter" class="select calendar-filter__select">
        <option value="all"${activeKey === "all" ? " selected" : ""}>All classes (${totalCount})</option>
        ${options.map(opt => `<option value="${escapeHtml(opt.key)}"${activeKey === opt.key ? " selected" : ""}>${escapeHtml(opt.label)} (${Number(opt.count || 0)})</option>`).join("")}
      </select>
    </label>
  `;
  const chipsHtml = options.length
    ? options.map(opt => `
      <button class="calendar-class-chip${activeKey === opt.key ? " is-active" : ""}" type="button" data-calendar-class="${escapeHtml(opt.key)}" aria-pressed="${activeKey === opt.key}">
        <span class="calendar-class-chip__dot" style="--chip-color:${escapeHtml(opt.color || "#0EA5E9")}"></span>
        <span class="calendar-class-chip__label">${escapeHtml(opt.label)}</span>
        <span class="calendar-class-chip__count">${Number(opt.count || 0)}</span>
      </button>
    `).join("")
    : `<span class="meta">No class groups in this range.</span>`;

  return `
    <div class="calendar-toolbar__actions">
      ${selectHtml}
    </div>
    <div class="calendar-class-strip">
      <button class="calendar-class-chip${activeKey === "all" ? " is-active" : ""}" type="button" data-calendar-class="all" aria-pressed="${activeKey === "all"}">
        <span class="calendar-class-chip__label">All</span>
        <span class="calendar-class-chip__count">${totalCount}</span>
      </button>
      ${chipsHtml}
    </div>
  `;
}

function renderMonthView(monthStartDate, { classFilterKey = "all", classOptions = [] } = {}) {
  const monthStart = new Date(monthStartDate);
  monthStart.setHours(0,0,0,0);
  const month = monthStart.getMonth();
  const year = monthStart.getFullYear();

  // find first day shown: the Monday on-or-before the 1st of month
  const firstShown = getWeekStart(monthStart);
  const lastOfMonth = new Date(year, month + 1, 0);
  const lastShown = addDays(getWeekStart(lastOfMonth), 6);
  const rangeStartISO = toISO(firstShown);
  const rangeEndISO = toISO(lastShown);
  const resolvedClassOptions = Array.isArray(classOptions) && classOptions.length
    ? classOptions
    : collectCalendarClassOptionsForRange(rangeStartISO, rangeEndISO);
  const requestedFilter = String(classFilterKey || "all").trim() || "all";
  const effectiveFilterKey = requestedFilter === "all" || resolvedClassOptions.some(opt => opt.key === requestedFilter)
    ? requestedFilter
    : "all";
  const days = [];
  for (let d = new Date(firstShown); d <= lastShown; d = addDays(d, 1)) {
    days.push(new Date(d));
  }

  // Precompute items for the visible range once; month view otherwise becomes
  // O(days * totalCommitments) + O(days * totalOccurrences).
  const itemsByDateISO = new Map();
  const pushItem = (dateISO, item) => {
    if (!dateISO) return;
    if (dateISO < rangeStartISO || dateISO > rangeEndISO) return;
    let list = itemsByDateISO.get(dateISO);
    if (!list) {
      list = [];
      itemsByDateISO.set(dateISO, list);
    }
    list.push(item);
  };
  Object.entries(state.sprints || {}).forEach(([wkISO, sp]) => {
    (sp.commitments || []).forEach(c => {
      const cDate = c.dateISO
        ? c.dateISO
        : toISO(addDays(fromISO(wkISO), clampDay(Number(c.dayIndex || 0))));
      pushItem(cDate, c);
    });
  });
  try {
    const occs = getOccurrencesForRange(rangeStartISO, rangeEndISO);
    occs.forEach(o => {
      pushItem(o.dateISO, Object.assign({}, o, { __isOccurrence: true, templateId: o.templateId }));
    });
  } catch (_) {}

  function filteredItemsForDate(dateISO) {
    const all = itemsByDateISO.get(dateISO) || [];
    if (effectiveFilterKey === "all") return all;
    return all.filter(c => calendarItemMatchesClassFilter(c, effectiveFilterKey));
  }

  const head = `
    <div class="cal__head">
      ${DAY_NAMES.map(name => `
        <div class="dayhead">
          <div class="dayname">${name}</div>
        </div>
      `).join("")}
    </div>
  `;

  const todayISO = toISO(new Date());
  const grid = `
    <div class="cal__grid cal__grid--month">
      ${days.map(d => {
        const iso = toISO(d);
        const filtered = filteredItemsForDate(iso);
        const items = sortCalendarItems(filtered);
        const visible = items.slice(0, 4);
        const hidden = Math.max(0, items.length - visible.length);
        const isToday = iso === todayISO;
        const plannedHours = filtered.reduce((s, c) => s + (Number(c.estHours) || 0), 0);
        const isWarn = plannedHours > DAILY_WARN_HOURS;
        const outMonth = d.getMonth() !== month;
        return `
          <div class="daycol daycol--month${isToday ? " daycol--today" : ""}${isWarn ? " daycol--warn" : ""}${outMonth ? " daycol--outmonth" : ""}">
            <div class="daycol__top daycol__top--month">
              <div class="daycol__date${isToday ? " daycol__date--today" : ""}${outMonth ? " daycol__date--outmonth" : ""}">${d.getDate()}</div>
              <button class="smallbtn smallbtn--add" type="button" data-add-date="${iso}" aria-label="Add task to ${iso}">+</button>
            </div>
            <div class="daylist daylist--month">
              ${visible.length
                ? visible.map(c => renderCalendarItem(c, { density: "month" })).join("")
                : `<div class="daylist__empty">No tasks</div>`}
              ${hidden > 0 ? `<div class="cal-more">+${hidden} more</div>` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  const title = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const integrationsCollapsed = getUiCollapsed("calendar.integrations", true);
  const integrationsSection = `
    <section class="card ui-section${integrationsCollapsed ? " is-collapsed" : ""}">
      <button class="ui-section__header" type="button" data-ui-collapse="calendar.integrations" aria-expanded="${integrationsCollapsed ? "false" : "true"}">
        <div class="ui-section__titlewrap">
          <h3 class="ui-section__title">Integrations</h3>
          <div class="ui-section__meta">School assignment sync</div>
        </div>
        <div class="ui-section__head-actions">
          <span class="ui-section__chevron" aria-hidden="true">${renderCollapseChevron(integrationsCollapsed)}</span>
        </div>
      </button>
      <div class="ui-section__body"${integrationsCollapsed ? ` hidden` : ``}>
        ${renderCanvasSyncCard()}
      </div>
    </section>
  `;

  return `
    <section class="stack">
      <div class="calendar-toolbar">
        <div class="calendar-toolbar__nav">
          <button class="btn btn--ghost" id="btnPrevMonth_page" type="button" title="Previous month">◂</button>
          <button class="btn btn--ghost" id="btnThisMonth_page" type="button" title="This month">This Month</button>
          <button class="btn btn--ghost" id="btnNextMonth_page" type="button" title="Next month">▸</button>
        </div>
        <div class="calendar-toolbar__title">
          <h2>${escapeHtml(title)}</h2>
          <div class="meta">Calendar</div>
        </div>
      </div>
      ${renderCalendarClassControls(resolvedClassOptions, effectiveFilterKey)}
      ${integrationsSection}
      <div class="card calendar-card">
        <div class="calendar calendar--month">
          ${head}
          ${grid}
        </div>
      </div>
    </section>
  `;
}

// Render a single-day horizontal tracker for `selectedDateISO` (YYYY-MM-DD)
function renderDayTracker(selectedDateISO) {
  const dateISO = selectedDateISO || toISO(new Date());
  // collect commitments for the day across sprints
  const items = [];
  Object.entries(state.sprints).forEach(([wkISO, sp]) => {
    sp.commitments.forEach(c => {
      const cDate = c.dateISO ? c.dateISO : toISO(addDays(fromISO(wkISO), Number(c.dayIndex || 0)));
      if (cDate === dateISO) items.push({ c, wkISO });
    });
  });

  // markers: compute left% from startTime (HH:MM) or mark as floating
  const markers = [];
  const floating = [];
  // also include occurrences (from templates) for this date
  const occs = getOccurrencesForRange(dateISO, dateISO);
  occs.forEach(o => {
    // convert occurrence to a temporary commitment-like shape and mark as occurrence
    const temp = Object.assign({}, o, { __isOccurrence: true, templateId: o.templateId });
    // attach to items list so they render like scheduled commitments
    items.push({ c: temp, wkISO: null });
  });
  items.forEach(it => {
    const c = it.c;
    const color = getCommitColor(c);
    // support either: c.startTime = "HH:MM" or c.startISO = "YYYY-MM-DDTHH:MM"
    let minutes = null;
    if (c.startTime && typeof c.startTime === 'string') {
      const [hh, mm] = c.startTime.split(':').map(Number);
      if (Number.isFinite(hh) && Number.isFinite(mm)) minutes = hh * 60 + mm;
    } else if (c.startISO && typeof c.startISO === 'string') {
      try {
        const d = new Date(c.startISO);
        if (!isNaN(d)) minutes = d.getHours() * 60 + d.getMinutes();
      } catch (e) {}
    }
    if (minutes === null) {
      floating.push(c);
    } else {
      const left = (minutes / 1440) * 100;
      const width = (c.durationMins && Number.isFinite(Number(c.durationMins))) ? Math.max(1, (Number(c.durationMins) / 1440) * 100) : 1.5;
      markers.push({ c, left, width, color });
    }
  });

  // build marker HTML
  const markersHtml = markers.map(m => {
    const title = escapeHtml(m.c.title || '');
    const label = escapeHtml(String(m.c.estHours || '') + 'h');
    const iconKey = getTaskIconKey(m.c);
    const iconHtml = iconKey
      ? `<span class="marker__icon">${renderTaskIconSvg(iconKey, { className: "task-icon--marker" })}</span>`
      : `<span class="marker__icon"><span class="marker__dot" aria-hidden="true"></span></span>`;
    // support occurrence markers (no c.id but has occurrenceId or occurrenceId in c)
    const occId = m.c.occurrenceId || m.c.occurrenceId || (m.c.templateId && m.c.dateISO ? `${m.c.templateId}:${m.c.dateISO}` : null);
    if (occId) {
      return `<div class="marker marker--occurrence" data-occurrence-id="${escapeHtml(occId)}" title="${title} · ${label}" style="left:${m.left}%; width:${m.width}%; background:${m.color}">${iconHtml}</div>`;
    }
    return `<div class="marker" data-commit-id="${escapeHtml(m.c.id)}" title="${title} · ${label}" style="left:${m.left}%; width:${m.width}%; background:${m.color}">${iconHtml}</div>`;
  }).join('');

  const floatingHtml = floating.length ? floating.map(c => {
    const color = getCommitColor(c);
    const notes = c.deliverable ? ` · ${escapeHtml(c.deliverable || '')}` : '';
    const iconKey = getTaskIconKey(c);
    const iconHtml = iconKey ? `<span class="task-icon-wrap">${renderTaskIconSvg(iconKey)}</span>` : '';
    if (c.occurrenceId || (c.templateId && c.dateISO)) {
      const occId = c.occurrenceId || `${c.templateId}:${c.dateISO}`;
      return `<div class="item item--occurrence" data-occurrence-id="${escapeHtml(occId)}" style="--item-color:${color}"><div style="font-weight:800;display:flex;align-items:center;gap:10px"><span class="color-dot" style="--dot-color:${color}"></span>${iconHtml}<span>${escapeHtml(c.title)}</span></div><div class="muted" style="font-size:12px">${Number(c.estHours||0)}h${notes}</div></div>`;
    }
    return `<div class="item" data-commit-id="${escapeHtml(c.id)}" style="--item-color:${color}"><div style="font-weight:800;display:flex;align-items:center;gap:10px"><span class="color-dot" style="--dot-color:${color}"></span>${iconHtml}<span>${escapeHtml(c.title)}</span></div><div class="muted" style="font-size:12px">${Number(c.estHours||0)}h${notes}</div></div>`;
  }).join('') : `<div class="day-tracker__empty">No undated items for this day.</div>`;

  // if nothing scheduled at all, show placeholder time-blocks
  let placeholderHtml = '';
  if (!markers.length && !floating.length) {
    placeholderHtml = `
      <div class="day-tracker__placeholder">
        <div class="block">Morning</div>
        <div class="block">Afternoon</div>
        <div class="block">Evening</div>
      </div>
    `;
  }

  // now-line for current day only
  let nowLineHtml = '';
  const todayISO = toISO(new Date());
  if (dateISO === todayISO) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const left = (nowMinutes / 1440) * 100;
    nowLineHtml = `<div class="now-line" id="dayTrackerNow" style="left:${left}%;"></div>`;
  }

  // hour ticks (every hour) overlay
  const ticks = Array.from({length:24}, (_, i) => {
    const left = (i * 60 / 1440) * 100;
    return `<div class="tick tick--hour" style="left:${left}%;"></div>`;
  }).join('');

  return `
    <div id="dayTracker" class="day-tracker" data-date="${escapeHtml(dateISO)}">
      <div class="day-tracker__header">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn btn--ghost" id="btnPrevDay_home" type="button">◂</button>
          <button class="btn btn--ghost" id="btnTodayDay_home" type="button">Today</button>
          <button class="btn btn--ghost" id="btnNextDay_home" type="button">▸</button>
          <div class="meta" style="margin-left:8px">${escapeHtml(fromISO(dateISO).toLocaleDateString())}</div>
        </div>
        <div class="day-tracker__controls">
          <div class="faint" style="font-size:13px">24‑hour timeline</div>
        </div>
      </div>

      <div class="timeline" data-date="${escapeHtml(dateISO)}" aria-label="Day timeline (00:00–24:00)">
        <div class="ruler">${ticks}</div>
        ${markersHtml}
        ${nowLineHtml}
      </div>

      <div class="day-tracker__floating-list">
        ${floatingHtml}
        ${placeholderHtml}
      </div>
    </div>
  `;
}

function renderCalendar(sprint, weekStartDate, { classFilterKey = "all" } = {}) {
  const requestedFilter = String(classFilterKey || "all").trim() || "all";
  const weekItems = Array.from({ length: 7 }, () => []);
  const plannedHours = Array.from({ length: 7 }, () => 0);
  Object.entries(state.sprints || {}).forEach(([wkISO, sp]) => {
    (sp.commitments || []).forEach(c => {
      const dateISO = c.dateISO ? c.dateISO : toISO(addDays(fromISO(wkISO), clampDay(Number(c.dayIndex || 0))));
      const d = fromISO(dateISO);
      const idx = dayIndexForDate(weekStartDate, d);
      if (idx < 0 || idx > 6) return;
      weekItems[idx].push(c);
    });
  });

  try {
    const weekStartISO = toISO(weekStartDate);
    const weekEndISO = toISO(addDays(weekStartDate, 6));
    const occs = getOccurrencesForRange(weekStartISO, weekEndISO);
    occs.forEach(o => {
      const idx = dayIndexForDate(weekStartDate, fromISO(o.dateISO));
      if (idx < 0 || idx > 6) return;
      weekItems[idx].push(Object.assign({}, o, {
        __isOccurrence: true,
        templateId: o.templateId,
        occurrenceId: o.occurrenceId
      }));
    });
  } catch (e) {}

  weekItems.forEach((list, i) => {
    const filtered = requestedFilter === "all"
      ? list
      : list.filter(item => calendarItemMatchesClassFilter(item, requestedFilter));
    weekItems[i] = sortCalendarItems(filtered);
    plannedHours[i] = weekItems[i].reduce((sum, item) => sum + (Number(item.estHours) || 0), 0);
  });

  const itemCounts = weekItems.map(list => list.length);
  const todayISO = toISO(new Date());

  const head = `
    <div class="cal__head">
      ${DAY_NAMES.map((name, i) => {
        const d = addDays(weekStartDate, i);
        const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const isToday = toISO(d) === todayISO;
        const ph = Math.round(plannedHours[i] || 0);
        const isWarn = ph > DAILY_WARN_HOURS;
        return `
          <div class="dayhead${isToday ? " dayhead--today" : ""}${isWarn ? " dayhead--warn" : ""}" ${isToday ? "aria-current=\"date\"" : ""}>
            <div class="dayname">${name}</div>
            <div class="daydate">${dateLabel}</div>
            <div class="daymeta">${ph}h · ${itemCounts[i] || 0} items</div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  const grid = `
    <div class="cal__grid cal__grid--week">
      ${weekItems.map((list, dayIndex) => {
        const dayISO = toISO(addDays(weekStartDate, dayIndex));
        const isToday = dayISO === todayISO;
        const isWarn = (plannedHours[dayIndex] || 0) > DAILY_WARN_HOURS;
        const visible = list.slice(0, 8);
        const hidden = Math.max(0, list.length - visible.length);
        return `
          <div class="daycol daycol--week${isToday ? " daycol--today" : ""}${isWarn ? " daycol--warn" : ""}">
            <div class="daycol__top daycol__top--week">
              <div class="daycol__date${isToday ? " daycol__date--today" : ""}">${addDays(weekStartDate, dayIndex).getDate()}</div>
              <button class="smallbtn smallbtn--add" type="button" data-add-day="${dayIndex}" aria-label="Add task to ${dayISO}">+</button>
            </div>
            <div class="daylist daylist--week">
              ${visible.length
                ? visible.map(c => renderCalendarItem(c, { density: "week" })).join("")
                : `<div class="daylist__empty">No tasks</div>`}
              ${hidden > 0 ? `<div class="cal-more">+${hidden} more</div>` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  return `<div class="calendar calendar--week">${head}${grid}</div>`;
}

function renderCalendarItem(c, { density = "week" } = {}) {
  const color = getCommitColor(c);
  const notes = String(c.deliverable || "").trim();
  const occurrenceKey = getCalendarOccurrenceKey(c);
  const isDone = isCalendarItemDone(c);
  const timeLabel = formatCalendarTimeLabel(c);
  const densityClass = density === "month" ? " calitem--month" : " calitem--week";
  const recurringLabel = occurrenceKey ? "Recurring" : "";
  const tooltipBits = [
    `Title: ${String(c.title || "")}`,
    timeLabel ? `Time: ${timeLabel}` : "",
    recurringLabel ? `Type: ${recurringLabel}` : "",
    notes ? `Notes: ${notes}` : "",
    isDone ? "Status: done" : "Status: pending",
    occurrenceKey ? "Click to open and edit this occurrence." : "Click to open task details."
  ].filter(Boolean);
  const tooltipText = tooltipBits.join(" | ");
  const openAttr = occurrenceKey
    ? `data-open-occurrence="${escapeHtml(occurrenceKey)}"`
    : `data-open-commit="${escapeHtml(c.id)}"`;

  return `
    <div class="calitem calitem--compact${densityClass}${isDone ? " is-done" : ""}" style="--item-color:${color}" title="${escapeHtml(tooltipText)}">
      <button class="calitem__linebtn" type="button" ${openAttr}>
        <span class="color-dot" style="--dot-color:${color}"></span>
        ${timeLabel ? `<span class="calitem__line-time">${escapeHtml(timeLabel)}</span>` : ""}
        <span class="calitem__line-title">${escapeHtml(c.title)}</span>
      </button>
    </div>
  `;
}

function getPlanItemsForDate(dateISO) {
  const items = [];
  if (!dateISO) return items;
  const weekISO = toISO(getWeekStart(fromISO(dateISO)));
  const dayIdx = dayIndexForDate(fromISO(weekISO), fromISO(dateISO));

  Object.entries(state.sprints || {}).forEach(([wkISO, sp]) => {
    (sp.commitments || []).forEach(c => {
      if (c.dateISO) {
        if (c.dateISO === dateISO) items.push({ c, wkISO });
        return;
      }
      if (wkISO === weekISO && clampDay(c.dayIndex) === clampDay(dayIdx)) {
        items.push({ c, wkISO });
      }
    });
  });

  try {
    const occs = getOccurrencesForRange(dateISO, dateISO);
    occs.forEach(o => {
      const temp = Object.assign({}, o, { __isOccurrence: true, templateId: o.templateId });
      items.push({ c: temp, wkISO: null });
    });
  } catch (e) { /* no-op */ }

  return items;
}

function computePlanDayItems(dateISO) {
  const items = getPlanItemsForDate(dateISO);
  const scheduled = [];
  const unscheduled = [];

  items.forEach(({ c }) => {
    const startMins = timeToMinutes(c.startTime);
    const durationMins = getDurationMinsForItem(c);
    const isDone = !!(c.done || (c.__isOccurrence && c.done));
    const entry = { c, startMins, durationMins, isDone };
    if (Number.isFinite(startMins)) scheduled.push(entry);
    else unscheduled.push(entry);
  });

  scheduled.sort((a,b) => a.startMins - b.startMins);
  return { scheduled, unscheduled };
}

function getFocusItemsForDate(dateISO) {
  const items = getPlanItemsForDate(dateISO);
  return items
    .map(it => it.c)
    .filter(c => !!c.isFocus);
}

function getPlanMetricsForDate(dateISO) {
  const day = computePlanDayItems(dateISO);
  const scheduledMins = day.scheduled.reduce((s, it) => s + (Number(it.durationMins) || 0), 0);
  const doneMins = day.scheduled.reduce((s, it) => s + (it.isDone ? (Number(it.durationMins) || 0) : 0), 0);
  return { scheduledMins, doneMins };
}

function getRitualsForDate(dateISO) {
  if (!state.rituals) state.rituals = {};
  if (!state.rituals[dateISO]) state.rituals[dateISO] = { morning: false, evening: false };
  return state.rituals[dateISO];
}

function setRitualForDate(dateISO, key, val) {
  if (!state.rituals) state.rituals = {};
  if (!state.rituals[dateISO]) state.rituals[dateISO] = { morning: false, evening: false };
  state.rituals[dateISO][key] = !!val;
}

function findCommitmentById(id) {
  if (!id) return null;
  let found = null;
  Object.values(state.sprints || {}).some(sp => {
    const c = (sp.commitments || []).find(x => x.id === id);
    if (c) { found = c; return true; }
    return false;
  });
  return found;
}
function deleteCommitById(id) {
  if (!id) return false;
  let removed = false;
  Object.values(state.sprints || {}).forEach(sp => {
    const before = sp.commitments.length;
    sp.commitments = sp.commitments.filter(c => c.id !== id);
    if (sp.commitments.length !== before) removed = true;
  });
  return removed;
}
function setFocusForCommit(id, val) {
  const c = findCommitmentById(id);
  if (!c) return false;
  c.isFocus = !!val;
  return true;
}

function findOccurrenceById(occId) {
  if (!occId) return null;
  const parts = occId.split(':');
  const tmplId = parts[0];
  const dateISO = parts.slice(1).join(':');
  const occs = getOccurrencesForRange(dateISO, dateISO);
  return occs.find(o => o.occurrenceId === occId || (o.templateId === tmplId && o.dateISO === dateISO)) || null;
}

function openOccurrenceModalById(occId) {
  if (!occId) return false;
  const parts = occId.split(':');
  const tmplId = parts[0] || "";
  const occ = findOccurrenceById(occId);
  if (!occ) return false;
  openCommitModal({
    prefill: {
      title: occ.title,
      deliverable: occ.deliverable,
      estHours: 0,
      dateISO: occ.dateISO,
      startTime: occ.startTime,
      durationMins: occ.durationMins || null,
      done: !!occ.done,
      occurrenceId: occId,
      templateId: tmplId
    }
  });
  return true;
}

function updateOccurrenceOverride(occId, updates) {
  if (!occId) return;
  state.occurrenceOverrides = state.occurrenceOverrides || {};
  state.occurrenceOverrides[occId] = Object.assign({}, state.occurrenceOverrides[occId] || {}, updates || {});
}
function deleteOccurrenceById(occId) {
  if (!occId) return false;
  updateOccurrenceOverride(occId, { deleted: true });
  return true;
}

function findNextAvailableStart(scheduled, durationMins) {
  const dur = Math.max(PLAN_MIN_DURATION_MINS, Number(durationMins || 0));
  let cursor = PLAN_DEFAULT_START_MINS;
  const blocks = (scheduled || []).slice().sort((a,b) => a.startMins - b.startMins);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (cursor + dur <= b.startMins) break;
    cursor = Math.max(cursor, b.startMins + b.durationMins);
  }
  return clampMinutes(cursor, 0, Math.max(0, 1440 - dur));
}

function scheduleCommitOnTimeline(commitId, dateISO) {
  const c = findCommitmentById(commitId);
  if (!c || !dateISO) return;
  const day = computePlanDayItems(dateISO);
  const durationMins = getDurationMinsForItem(c);
  const startMins = findNextAvailableStart(day.scheduled, durationMins);
  c.startTime = minutesToTime(startMins);
  c.durationMins = durationMins;
  c.dateISO = dateISO;
  saveState();
  render();
}

function scheduleOccurrenceOnTimeline(occId, dateISO) {
  if (!occId || !dateISO) return;
  const occ = findOccurrenceById(occId);
  if (!occ) return;
  const day = computePlanDayItems(dateISO);
  const durationMins = getDurationMinsForItem(occ);
  const startMins = findNextAvailableStart(day.scheduled, durationMins);
  updateOccurrenceOverride(occId, { startTime: minutesToTime(startMins), durationMins });
  saveState();
  render();
}

function scheduleCommitAtTime(commitId, dateISO, startMins) {
  const c = findCommitmentById(commitId);
  if (!c || !dateISO) return;
  const durationMins = getDurationMinsForItem(c);
  const start = clampMinutes(startMins, 0, Math.max(0, 1440 - durationMins));
  c.startTime = minutesToTime(start);
  c.durationMins = durationMins;
  c.dateISO = dateISO;
  saveState();
  render();
}

function scheduleOccurrenceAtTime(occId, dateISO, startMins) {
  if (!occId || !dateISO) return;
  const occ = findOccurrenceById(occId);
  if (!occ) return;
  const durationMins = getDurationMinsForItem(occ);
  const start = clampMinutes(startMins, 0, Math.max(0, 1440 - durationMins));
  updateOccurrenceOverride(occId, { startTime: minutesToTime(start), durationMins });
  saveState();
  render();
}

function scheduleCalendarItemAtTime(item, dateISO, startMins, durationMins) {
  if (!item || !dateISO) return false;
  const duration = Math.max(PLAN_MIN_DURATION_MINS, Number(durationMins || 0));
  const start = clampMinutes(startMins, 0, Math.max(0, 1440 - duration));
  if (item.__isOccurrence) {
    const occId = getCalendarOccurrenceKey(item);
    if (!occId) return false;
    const patch = { startTime: minutesToTime(start), durationMins: duration };
    if (item.dateISO && item.dateISO !== dateISO) patch.dateISO = dateISO;
    updateOccurrenceOverride(occId, patch);
    return true;
  }
  item.startTime = minutesToTime(start);
  item.durationMins = duration;
  item.dateISO = dateISO;
  item.dayIndex = clampDay(dayIndexForDate(getWeekStart(fromISO(dateISO)), fromISO(dateISO)));
  return true;
}

function getScheduledBlocksForDate(dateISO) {
  const day = computePlanDayItems(dateISO);
  return (day.scheduled || [])
    .map(entry => ({
      startMins: Number(entry.startMins),
      durationMins: Math.max(PLAN_MIN_DURATION_MINS, Number(entry.durationMins || 0))
    }))
    .filter(entry => Number.isFinite(entry.startMins) && Number.isFinite(entry.durationMins))
    .sort((a, b) => a.startMins - b.startMins);
}

function autoScheduleWeek() {
  const weekStartDate = fromISO(state.weekStartISO);
  let scheduledCount = 0;
  const changedDates = new Set();

  for (let i = 0; i < 7; i++) {
    const dateISO = toISO(addDays(weekStartDate, i));
    const scheduledBlocks = getScheduledBlocksForDate(dateISO);
    const day = computePlanDayItems(dateISO);
    const queue = (day.unscheduled || [])
      .filter(entry => entry && !entry.isDone)
      .sort((a, b) => {
        const aFocus = a.c && a.c.isFocus ? 0 : 1;
        const bFocus = b.c && b.c.isFocus ? 0 : 1;
        if (aFocus !== bFocus) return aFocus - bFocus;
        const aDur = getDurationMinsForItem(a.c);
        const bDur = getDurationMinsForItem(b.c);
        if (aDur !== bDur) return aDur - bDur;
        return String(a.c && a.c.title ? a.c.title : "").localeCompare(String(b.c && b.c.title ? b.c.title : ""));
      });

    queue.forEach(entry => {
      const c = entry.c;
      if (!c) return;
      const durationMins = getDurationMinsForItem(c);
      const startMins = findNextAvailableStart(scheduledBlocks, durationMins);
      if (!scheduleCalendarItemAtTime(c, dateISO, startMins, durationMins)) return;
      scheduledBlocks.push({ startMins, durationMins });
      scheduledBlocks.sort((a, b) => a.startMins - b.startMins);
      scheduledCount += 1;
      changedDates.add(dateISO);
    });
  }

  if (scheduledCount > 0) {
    saveState();
    render();
  }
  return {
    scheduledCount,
    changedDates: Array.from(changedDates)
  };
}

function generateTodayPlan() {
  const todayDate = new Date();
  const todayISO = toISO(todayDate);
  const todayWeekStart = getWeekStart(todayDate);
  const todayDayIndex = dayIndexForDate(todayWeekStart, todayDate);
  const todayScheduledBlocks = getScheduledBlocksForDate(todayISO);
  const existingMins = todayScheduledBlocks.reduce((sum, b) => sum + (Number(b.durationMins) || 0), 0);

  if (existingMins >= TODAY_PLAN_TARGET_MINS) {
    return {
      scheduledCount: 0,
      movedFromOtherDays: 0,
      scheduledMins: 0,
      reason: "today-full"
    };
  }

  const seen = new Set();
  const candidates = [];
  const addCandidate = (entry, rank) => {
    if (!entry || !entry.c || entry.isDone) return;
    const c = entry.c;
    const key = c.__isOccurrence ? `occ:${getCalendarOccurrenceKey(c)}` : `commit:${c.id}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push({ entry, rank });
  };

  const todayItems = computePlanDayItems(todayISO);
  (todayItems.unscheduled || []).forEach((entry, idx) => addCandidate(entry, idx));

  for (let i = 0; i < 7; i++) {
    const dateISO = toISO(addDays(todayWeekStart, i));
    if (dateISO === todayISO) continue;
    const day = computePlanDayItems(dateISO);
    const distance = Math.abs(i - todayDayIndex);
    (day.unscheduled || []).forEach((entry, idx) => {
      if (entry && entry.c && entry.c.__isOccurrence) return;
      addCandidate(entry, 100 + (distance * 10) + idx);
    });
  }

  candidates.sort((a, b) => {
    const aFocus = a.entry.c && a.entry.c.isFocus ? 0 : 1;
    const bFocus = b.entry.c && b.entry.c.isFocus ? 0 : 1;
    if (aFocus !== bFocus) return aFocus - bFocus;
    if (a.rank !== b.rank) return a.rank - b.rank;
    const aDur = getDurationMinsForItem(a.entry.c);
    const bDur = getDurationMinsForItem(b.entry.c);
    if (aDur !== bDur) return aDur - bDur;
    return String(a.entry.c && a.entry.c.title ? a.entry.c.title : "").localeCompare(String(b.entry.c && b.entry.c.title ? b.entry.c.title : ""));
  });

  let scheduledCount = 0;
  let scheduledMins = 0;
  let movedFromOtherDays = 0;
  const targetMins = Math.max(TODAY_PLAN_TARGET_MINS, existingMins + PLAN_MIN_DURATION_MINS);

  for (const cand of candidates) {
    const c = cand.entry.c;
    if (!c) continue;
    if ((existingMins + scheduledMins) >= targetMins && scheduledCount > 0) break;
    const durationMins = getDurationMinsForItem(c);
    const startMins = findNextAvailableStart(todayScheduledBlocks, durationMins);
    const prevDateISO = String(c.dateISO || "");
    if (!scheduleCalendarItemAtTime(c, todayISO, startMins, durationMins)) continue;
    todayScheduledBlocks.push({ startMins, durationMins });
    todayScheduledBlocks.sort((a, b) => a.startMins - b.startMins);
    scheduledCount += 1;
    scheduledMins += durationMins;
    if (prevDateISO && prevDateISO !== todayISO) movedFromOtherDays += 1;
  }

  if (scheduledCount > 0) {
    saveState();
    render();
  }
  return {
    scheduledCount,
    movedFromOtherDays,
    scheduledMins,
    reason: scheduledCount > 0 ? "" : "no-candidates"
  };
}

function setPlanBlockPosition(blockEl, startMins, durationMins) {
  if (!blockEl) return;
  const topPercent = (startMins / 1440) * 100;
  const heightPercent = (durationMins / 1440) * 100;
  blockEl.style.top = `${topPercent}%`;
  blockEl.style.height = `${heightPercent}%`;
  blockEl.setAttribute('data-start-mins', String(startMins));
  blockEl.setAttribute('data-duration-mins', String(durationMins));
  const timeEl = blockEl.querySelector('.timeline__block-time');
  if (timeEl) timeEl.textContent = formatTimeRange(startMins, durationMins);
}

function renderPlanView(sprint, weekStartDate) {
  const ui = state.ui || (state.ui = {});
  const plannedCount = sprint.commitments.length;
  const plannedHours = sprint.commitments.reduce((sum, c) => sum + (Number(c.estHours) || 0), 0);
  const budgetHours = Number(sprint.timeBudgetHours || 40);
  const budgetPct = budgetHours > 0 ? Math.round((plannedHours / budgetHours) * 100) : 0;
  const overByHours = Math.max(0, plannedHours - budgetHours);
  const planMode = state.planMode || 'day';

  let timelineDate = new Date();
  if (state.planTimelineDate) timelineDate = new Date(state.planTimelineDate);
  else if (state.view === 'plan') timelineDate = new Date(weekStartDate);
  const timelineDateISO = toISO(timelineDate);
  const timelineLabel = timelineDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const todayISO = toISO(new Date());
  const isToday = timelineDateISO === todayISO;

  const dayData = computePlanDayItems(timelineDateISO);
  const scheduled = dayData.scheduled;
  const unscheduled = dayData.unscheduled.filter(i => !i.isDone);
  const metrics = getPlanMetricsForDate(timelineDateISO);
  const focusItems = getFocusItemsForDate(timelineDateISO).filter(c => !c.__isOccurrence);
  const unscheduledMins = unscheduled.reduce((sum, it) => sum + (Number(it.durationMins) || 0), 0);
  const scheduledCount = scheduled.length;
  const doneCount = scheduled.filter(it => it.isDone).length;
  const completionPct = metrics.scheduledMins > 0
    ? Math.round((metrics.doneMins / metrics.scheduledMins) * 100)
    : 0;
  const remainingScheduledMins = Math.max(0, metrics.scheduledMins - metrics.doneMins);
  const pendingScheduled = scheduled.filter(it => !it.isDone);
  const now = new Date();
  const nowMins = (now.getHours() * 60) + now.getMinutes();
  const nextBlock = isToday
    ? (pendingScheduled.find(it => Number(it.startMins) >= nowMins) || pendingScheduled[0] || null)
    : (pendingScheduled[0] || null);
  const nextBlockText = nextBlock
    ? `${nextBlock.c && nextBlock.c.title ? nextBlock.c.title : 'Untitled'} · ${formatTimeRange(nextBlock.startMins, nextBlock.durationMins)}`
    : (isToday ? 'No remaining scheduled blocks today.' : 'No scheduled blocks for this day.');
  const overBudgetMins = Math.max(0, Math.round(overByHours * 60));

  const bands = [
    { label: 'Morning', start: 6 * 60, end: 12 * 60, cls: 'morning' },
    { label: 'Afternoon', start: 12 * 60, end: 18 * 60, cls: 'afternoon' },
    { label: 'Evening', start: 18 * 60, end: 23 * 60, cls: 'evening' }
  ];
  const bandsHtml = bands.map(b => {
    const top = (b.start / 1440) * 100;
    const height = ((b.end - b.start) / 1440) * 100;
    return `<div class="timeline__band band--${b.cls}" style="top:${top}%;height:${height}%"><span>${b.label}</span></div>`;
  }).join('');

  const timelineBlocksHTML = scheduled.length ? scheduled.map(item => {
    const c = item.c;
    const startMins = item.startMins;
    const durationMins = item.durationMins;
    const topPercent = (startMins / 1440) * 100;
    const heightPercent = (durationMins / 1440) * 100;
    const statColor = getCommitColor(c);
    const doneClass = item.isDone ? ' timeline__block--done' : '';
    const occClass = c.__isOccurrence ? ' timeline__block--occurrence' : '';
    const occId = c.__isOccurrence ? (c.occurrenceId || (c.templateId && c.dateISO ? `${c.templateId}:${c.dateISO}` : '')) : '';
    const commitAttr = c.__isOccurrence ? '' : `data-commit-id="${escapeHtml(c.id)}"`;
    const occAttr = occId ? `data-occurrence-id="${escapeHtml(occId)}"` : '';
    const deleteAttr = c.__isOccurrence ? `data-plan-delete-occ="${escapeHtml(occId)}"` : `data-plan-delete-id="${escapeHtml(c.id)}"`;
    const focusAttr = c.__isOccurrence ? '' : `data-plan-focus-id="${escapeHtml(c.id)}"`;
    const focusClass = c.isFocus ? ' is-on' : '';
    const timeLabel = formatTimeRange(startMins, durationMins);
    const tip = `${timeLabel}${c.deliverable ? ' · ' + c.deliverable : ''}`;
    return `
      <div class="timeline__block${doneClass}${occClass}" data-plan-block="1" ${commitAttr} ${occAttr}
        data-start-mins="${startMins}" data-duration-mins="${durationMins}"
        style="top:${topPercent}%;height:${heightPercent}%;background:${statColor};"
        title="${escapeHtml(tip)}">
        ${focusAttr ? `<button class="timeline__block-focus${focusClass}" type="button" ${focusAttr} title="Focus">★</button>` : ``}
        <button class="timeline__block-delete" type="button" ${deleteAttr} title="Delete">✕</button>
        <div class="timeline__block-time">${escapeHtml(timeLabel)}</div>
        <div class="timeline__block-label">${escapeHtml(c.title || 'Untitled')}</div>
        <div class="timeline__resize" title="Drag to resize"></div>
      </div>
    `;
  }).join("") : `<div class="faint" style="padding:16px;">No scheduled blocks for this day.</div>`;

  const chipsHtml = unscheduled.length ? unscheduled.map(item => {
    const c = item.c;
    const isOcc = !!c.__isOccurrence;
    const occId = isOcc ? (c.occurrenceId || (c.templateId && c.dateISO ? `${c.templateId}:${c.dateISO}` : '')) : '';
    const title = escapeHtml(c.title || 'Untitled');
    const notes = c.deliverable ? ` · ${escapeHtml(c.deliverable)}` : '';
    const dur = formatMinutesCompact(getDurationMinsForItem(c));
    const meta = `${dur}${notes}`;
    const editAttr = isOcc ? `data-plan-edit-occ="${escapeHtml(occId)}"` : `data-plan-edit-id="${escapeHtml(c.id)}"`;
    const scheduleAttr = isOcc ? `data-plan-schedule-occ="${escapeHtml(occId)}"` : `data-plan-schedule-id="${escapeHtml(c.id)}"`;
    const deleteAttr = isOcc ? `data-plan-delete-occ="${escapeHtml(occId)}"` : `data-plan-delete-id="${escapeHtml(c.id)}"`;
    const focusAttr = (!isOcc) ? `data-plan-focus-id="${escapeHtml(c.id)}"` : '';
    const focusClass = c.isFocus ? ' is-on' : '';
    const color = getCommitColor(c);
    return `
      <div class="plan-chip" draggable="true" ${editAttr} style="--item-color:${color}" ${isOcc ? `data-plan-chip-occ="${escapeHtml(occId)}"` : `data-plan-chip-id="${escapeHtml(c.id)}"`}>
        <span class="color-dot" style="--dot-color:${color}"></span>
        <span class="plan-chip__title">${title}</span>
        <span class="plan-chip__meta">${meta}</span>
        <div class="plan-chip__actions">
          <button class="chip-btn" type="button" ${scheduleAttr} data-plan-date="${timelineDateISO}" title="Auto schedule">↳</button>
          ${focusAttr ? `<button class="chip-btn${focusClass}" type="button" ${focusAttr} title="Focus">★</button>` : ``}
          <button class="chip-btn chip-btn--danger" type="button" ${deleteAttr} title="Delete">✕</button>
        </div>
      </div>
    `;
  }).join('') : `<div class="faint">No unscheduled tasks for this day.</div>`;

  const focusHtml = focusItems.length ? focusItems.slice(0, 3).map(c => {
    const time = c.startTime ? c.startTime : 'Anytime';
    const color = getCommitColor(c);
    return `
      <div class="plan-focus__item" style="--item-color:${color}">
        <div class="plan-focus__title"><span class="color-dot" style="--dot-color:${color}"></span>${escapeHtml(c.title || 'Untitled')}</div>
        <div class="plan-focus__meta">${escapeHtml(time)}</div>
        <button class="chip-btn is-on" type="button" data-plan-focus-id="${escapeHtml(c.id)}" title="Unfocus">★</button>
      </div>
    `;
  }).join('') : `<div class="faint">Pin 1–3 focus tasks for today.</div>`;

  const rituals = getRitualsForDate(timelineDateISO);
  const ritualsHtml = `
    <div class="plan-panel plan-rituals">
      <div class="plan-panel__head">
        <div class="plan-panel__title">Rituals</div>
        <div class="meta">Start + close with intent</div>
      </div>
      <div class="plan-rituals__checks">
        <label class="ritual">
          <input type="checkbox" data-ritual="morning" data-ritual-date="${timelineDateISO}" ${rituals.morning ? 'checked' : ''}/>
          Morning plan
        </label>
        <label class="ritual">
          <input type="checkbox" data-ritual="evening" data-ritual-date="${timelineDateISO}" ${rituals.evening ? 'checked' : ''}/>
          Evening review
        </label>
      </div>
    </div>
  `;

  const trimCandidates = (sprint.commitments || []).filter(c => !c.done).sort((a,b) => (Number(b.estHours)||0) - (Number(a.estHours)||0)).slice(0,3);
  const trimOpen = !!ui.planTrimOpen;
  const trimHtml = trimOpen ? `
    <div class="plan-trim">
      ${(trimCandidates.length ? trimCandidates : []).map(c => `
        <div class="plan-trim__row">
          <div>${escapeHtml(c.title || 'Untitled')} · ${Number(c.estHours||0)}h</div>
          <button class="chip-btn chip-btn--danger" type="button" data-plan-delete-id="${escapeHtml(c.id)}">Delete</button>
        </div>
      `).join('') || `<div class="faint">No trim suggestions.</div>`}
    </div>
  ` : '';

  const guardrailHtml = overByHours > 0 ? `
    <div class="plan-guardrail">
      <div class="plan-guardrail__text">Over budget by ${formatMinutesCompact(overBudgetMins)}. Trim before adding more work.</div>
      <div class="plan-guardrail__actions">
        <button class="btn btn--ghost" type="button" data-plan-trim-toggle>${trimOpen ? 'Hide' : 'Trim suggestions'}</button>
      </div>
    </div>
    ${trimHtml}
  ` : '';

  const kpiItems = [
    {
      label: 'Planned',
      value: formatMinutesCompact(metrics.scheduledMins),
      meta: `${scheduledCount} block${scheduledCount === 1 ? '' : 's'} on timeline`
    },
    {
      label: 'Completed',
      value: formatMinutesCompact(metrics.doneMins),
      meta: metrics.scheduledMins > 0 ? `${completionPct}% of scheduled work` : 'No completed blocks yet'
    },
    {
      label: 'Queue',
      value: formatMinutesCompact(unscheduledMins),
      meta: `${unscheduled.length} unscheduled task${unscheduled.length === 1 ? '' : 's'}`
    },
    {
      label: 'Focus',
      value: `${focusItems.length}/3`,
      meta: focusItems.length > 0 ? 'Pinned high-priority tasks' : 'Pin tasks to lock attention'
    }
  ];
  const kpiHtml = kpiItems.map(item => `
    <div class="plan-kpi">
      <div class="plan-kpi__label">${escapeHtml(item.label)}</div>
      <div class="plan-kpi__value">${escapeHtml(item.value)}</div>
      <div class="plan-kpi__meta">${escapeHtml(item.meta)}</div>
    </div>
  `).join('');

  const dayBriefHtml = `
    <div class="plan-panel plan-day-brief">
      <div class="plan-panel__head">
        <div class="plan-panel__title">Today Snapshot</div>
        <div class="meta">${escapeHtml(timelineLabel)}</div>
      </div>
      <div class="plan-day-brief__row">
        <div class="plan-day-brief__label">Completed</div>
        <div class="plan-day-brief__value">${formatMinutesCompact(metrics.doneMins)}</div>
      </div>
      <div class="plan-day-brief__row">
        <div class="plan-day-brief__label">Remaining</div>
        <div class="plan-day-brief__value">${formatMinutesCompact(remainingScheduledMins)}</div>
      </div>
      <div class="plan-day-brief__bar" aria-hidden="true">
        <span style="width:${Math.max(4, Math.min(100, completionPct))}%"></span>
      </div>
      <div class="plan-day-brief__next${nextBlock ? '' : ' is-empty'}">
        <span class="plan-day-brief__next-label">Next up</span>
        <span class="plan-day-brief__next-text">${escapeHtml(nextBlockText)}</span>
      </div>
    </div>
  `;

  const dayContent = `
    <div class="plan-workspace">
      <div class="plan-workspace__main">
        <div class="card plan-card plan-card--timeline">
          <div class="card__title plan-card__title">
            <h2>Day Timeline</h2>
            <div class="meta">${escapeHtml(timelineLabel)} · ${doneCount}/${scheduledCount} done</div>
          </div>
          <div class="card__body">
            <div class="timeline plan-timeline" data-date="${escapeHtml(timelineDateISO)}">
              <div class="timeline__hours">
                ${Array.from({length: 24}, (_, i) => `<div class="timeline__hour" style="height:${100/24}%"><span>${String(i).padStart(2, '0')}:00</span></div>`).join("")}
              </div>
              <div class="timeline__grid">
                ${bandsHtml}
                ${Array.from({length: 24}, (_, i) => `<div class="timeline__hour-line" style="top:${(i/24)*100}%"></div>`).join("")}
                <div class="timeline__now-line" id="timelineNowLine"></div>
                <div class="timeline__blocks">
                  ${timelineBlocksHTML}
                </div>
              </div>
            </div>
            <div class="plan-timeline__hint muted">Drag blocks to move. Drag the handle to resize. Drag chips into the timeline to schedule.</div>
          </div>
        </div>
      </div>

      <aside class="plan-workspace__side">
        ${dayBriefHtml}

        <div class="plan-panel plan-focus">
          <div class="plan-panel__head plan-focus__titlebar">
            <div class="plan-panel__title">Focus Lane</div>
            <div class="meta">${focusItems.length}/3 pinned</div>
          </div>
          <div class="plan-focus__list">${focusHtml}</div>
        </div>

        <div class="plan-panel plan-chips">
          <div class="plan-panel__head">
            <div class="plan-panel__title">Unscheduled Queue</div>
            <div class="meta">${unscheduled.length} task${unscheduled.length === 1 ? '' : 's'}</div>
          </div>
          <div class="plan-chips__list">${chipsHtml}</div>
        </div>

        ${ritualsHtml}
      </aside>
    </div>
  `;

  const weekContent = `
    <div class="card plan-card">
      <div class="card__title plan-card__title">
        <h2>Week Overview</h2>
        <div class="meta">${formatRange(weekStartDate)} · ${plannedCount} commitment${plannedCount === 1 ? '' : 's'}</div>
      </div>
      <div class="card__body">
        ${renderCalendar(sprint, weekStartDate)}
      </div>
    </div>
  `;
  const compactViewport = (typeof window !== "undefined" && Number(window.innerWidth || 0) > 0 && Number(window.innerWidth || 0) <= 1100);
  const kpiCollapsed = getUiCollapsed("plan.kpi", compactViewport);
  const settingsCollapsed = getUiCollapsed("plan.settings", true);
  const kpiSection = `
    <section class="card ui-section${kpiCollapsed ? " is-collapsed" : ""}">
      <button class="ui-section__header" type="button" data-ui-collapse="plan.kpi" aria-expanded="${kpiCollapsed ? "false" : "true"}">
        <div class="ui-section__titlewrap">
          <h3 class="ui-section__title">Day Metrics</h3>
          <div class="ui-section__meta">Planned, completed, queue, focus</div>
        </div>
        <div class="ui-section__head-actions">
          <span class="ui-section__chevron" aria-hidden="true">${renderCollapseChevron(kpiCollapsed)}</span>
        </div>
      </button>
      <div class="ui-section__body"${kpiCollapsed ? ` hidden` : ``}>
        <div class="plan-kpi-grid">${kpiHtml}</div>
      </div>
    </section>
  `;
  const settingsSection = `
    <section class="card ui-section${settingsCollapsed ? " is-collapsed" : ""}">
      <button class="ui-section__header" type="button" data-ui-collapse="plan.settings" aria-expanded="${settingsCollapsed ? "false" : "true"}">
        <div class="ui-section__titlewrap">
          <h3 class="ui-section__title">Sprint Settings</h3>
          <div class="ui-section__meta">Objective and budget controls</div>
        </div>
        <div class="ui-section__head-actions">
          <span class="ui-section__chevron" aria-hidden="true">${renderCollapseChevron(settingsCollapsed)}</span>
        </div>
      </button>
      <div class="ui-section__body"${settingsCollapsed ? ` hidden` : ``}>
        <div class="plan-settings-wrap">
          <div class="plan-settings">
            <label class="field plan-setting">
              <span class="field__label">Sprint objective</span>
              <input class="input" id="inpObjective" type="text" maxlength="120"
                value="${escapeHtml(sprint.objective)}"
                placeholder="What does a good week look like?" />
            </label>
            <label class="field plan-setting">
              <span class="field__label">Budget (hours)</span>
              <input class="input" id="inpBudget" type="number" min="0" step="0.5" value="${Number(sprint.timeBudgetHours)}" />
            </label>
            <div class="plan-setting plan-budget-inline">
              <div class="plan-budget__bar"><div style="width:${Math.min(100, budgetPct)}%"></div></div>
              <div class="meta">${plannedHours}h planned of ${budgetHours}h · ${plannedCount} commitment${plannedCount === 1 ? '' : 's'}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  return `
    <section class="plan-section plan-section--full">
      <div class="plan-shell">
        <div class="plan-header">
          <div class="plan-header__left">
            <div class="plan-title">
              <div class="plan-title__main">Plan Workspace</div>
              <div class="plan-title__sub">${formatRange(weekStartDate)}</div>
            </div>
            <div class="plan-header__signal">${isToday ? 'Today' : 'Selected Day'} · ${escapeHtml(timelineLabel)}</div>
          </div>
          <div class="plan-header__right">
            <div class="plan-header__headline">
              ${completionPct}% complete
            </div>
            <div class="plan-header__sub">
              ${formatMinutesCompact(metrics.doneMins)} done of ${formatMinutesCompact(metrics.scheduledMins)} scheduled
            </div>
          </div>
        </div>

        <div class="plan-commandbar">
          <div class="plan-commandbar__nav">
            <button class="smallbtn" id="planPrevDay" type="button">← Prev</button>
            <input id="planDatePicker" class="input plan-date-input" type="date" value="${timelineDateISO}" />
            <button class="smallbtn" id="planNextDay" type="button">Next →</button>
            <button class="smallbtn" id="planJumpToday" type="button">Today</button>
          </div>

          <div class="plan-commandbar__actions">
            <button class="btn btn--ghost" id="planQuickAddTask" type="button">Quick Add</button>
            <button class="btn btn--ghost" id="btnGenerateTodayPlan" type="button">Generate Day</button>
            <button class="btn btn--ghost" id="btnAutoScheduleWeek" type="button">Auto-Schedule Week</button>
          </div>

          <div class="plan-mode">
            <button class="btn btn--ghost plan-mode-btn ${planMode === 'day' ? 'is-active' : ''}" data-plan-mode="day" aria-pressed="${planMode === 'day'}">Day</button>
            <button class="btn btn--ghost plan-mode-btn ${planMode === 'week' ? 'is-active' : ''}" data-plan-mode="week" aria-pressed="${planMode === 'week'}">Week</button>
          </div>
        </div>

        ${kpiSection}

        ${guardrailHtml}

        ${settingsSection}

        ${planMode === 'week' ? weekContent : dayContent}
      </div>
    </section>
  `;
}

function renderHomeView(summaryHTML, focusHTML, inboxHTML) {
  if (!state.dayViewDateISO) state.dayViewDateISO = toISO(new Date());
  const dayTrackerHTML = renderDayTracker(state.dayViewDateISO);
  const blockerStatus = getEnforcementStatus(Date.now());
  const goalCount = Number((state.longPlans || []).length);
  const inboxCount = Number((state.inbox || []).length);
  const openGoals = (state.longPlans || []).slice(0, 2).map(g => escapeHtml(g.title || "Untitled")).join(" · ");
  const openInbox = (state.inbox || []).slice(0, 2).map(it => escapeHtml(it.title || "Untitled")).join(" · ");
  const weekSnapshotCollapsed = getUiCollapsed("home.weekSnapshot", true);
  const inboxSectionCollapsed = getUiCollapsed("home.inboxLegacy", true);

  return `
    <section class="stack home-cleanup">
      <div class="card home-command-card">
        <div class="card__title">
          <h2>Command Center</h2>
          <div class="meta">Today first. Everything else on demand.</div>
        </div>
        <div class="home-command-card__focus">${focusHTML}</div>
        <div class="home-command-card__timeline">${dayTrackerHTML}</div>
      </div>

      <div class="home-quick-grid">
        <div class="card home-mini-card">
          <div class="card__title">
            <h2>Goals</h2>
            <div class="meta">${goalCount} total</div>
          </div>
          <div class="muted">${openGoals || "No goals yet."}</div>
          <div class="home-mini-card__actions">
            <button class="btn btn--ghost" type="button" data-ui-open-drawer="home-goals">Manage</button>
          </div>
        </div>

        <div class="card home-mini-card">
          <div class="card__title">
            <h2>Inbox</h2>
            <div class="meta">${inboxCount} item${inboxCount === 1 ? "" : "s"}</div>
          </div>
          <div class="muted">${openInbox || "No inbox items."}</div>
          <div class="home-mini-card__actions">
            <button class="btn btn--ghost" type="button" data-ui-open-drawer="home-inbox">Review</button>
          </div>
        </div>

        <div class="card home-mini-card">
          <div class="card__title">
            <h2>Blocker</h2>
            <div class="meta">${blockerStatus.active ? "Active" : "Standby"}</div>
          </div>
          <div class="muted">${escapeHtml(blockerStatus.headline)}</div>
          <div class="meta" style="margin-top:4px">${escapeHtml(blockerStatus.detail)}</div>
          <div class="home-mini-card__actions">
            <button class="btn btn--ghost" type="button" id="homeOpenBlockerBtn">Open Blocker</button>
          </div>
        </div>
      </div>

      <section class="card ui-section${weekSnapshotCollapsed ? " is-collapsed" : ""}">
        <button class="ui-section__header" type="button" data-ui-collapse="home.weekSnapshot" aria-expanded="${weekSnapshotCollapsed ? "false" : "true"}">
          <div class="ui-section__titlewrap">
            <h3 class="ui-section__title">Week Snapshot</h3>
            <div class="ui-section__meta">Budget, progress, and sprint objective</div>
          </div>
          <div class="ui-section__head-actions">
            <span class="ui-section__chevron" aria-hidden="true">${renderCollapseChevron(weekSnapshotCollapsed)}</span>
          </div>
        </button>
        <div class="ui-section__body"${weekSnapshotCollapsed ? ` hidden` : ``}>
          ${summaryHTML}
        </div>
      </section>

      <section class="card ui-section${inboxSectionCollapsed ? " is-collapsed" : ""}">
        <button class="ui-section__header" type="button" data-ui-collapse="home.inboxLegacy" aria-expanded="${inboxSectionCollapsed ? "false" : "true"}">
          <div class="ui-section__titlewrap">
            <h3 class="ui-section__title">Inbox Details</h3>
            <div class="ui-section__meta">Legacy detailed view</div>
          </div>
          <div class="ui-section__head-actions">
            <span class="ui-section__chevron" aria-hidden="true">${renderCollapseChevron(inboxSectionCollapsed)}</span>
          </div>
        </button>
        <div class="ui-section__body"${inboxSectionCollapsed ? ` hidden` : ``}>
          <div style="margin-bottom:10px">
            <button class="btn btn--ghost" type="button" data-ui-open-drawer="home-inbox">Open Inbox Drawer</button>
          </div>
          ${inboxHTML}
        </div>
      </section>
    </section>
  `;
}

function renderBlockerView() {
  ensureEnforcementStateShape();
  ensureUiStateShape();
  const cfg = state.enforcement;
  const status = getEnforcementStatus(Date.now());
  const presets = getEnforcementPresets();
  const logs = (state.enforcementLog || []).slice(0, 24);
  const enforcementCard = renderEnforcementCard();
  const subtab = BLOCKER_SUBTABS.has(String(state.ui.blockerSubtab || "").toLowerCase())
    ? String(state.ui.blockerSubtab || "").toLowerCase()
    : "overview";
  state.ui.blockerSubtab = subtab;

  const presetHtml = presets.map(p => `
    <div class="blocker-preset">
      <div>
        <div class="blocker-preset__title">${escapeHtml(p.label)}</div>
        <div class="blocker-preset__desc">${escapeHtml(p.description)}</div>
      </div>
      <button class="btn btn--ghost" type="button" data-enf-preset="${escapeHtml(p.id)}">Apply</button>
    </div>
  `).join("");

  const historyHtml = logs.length
    ? logs.map(item => {
      const stamp = item.ts ? new Date(item.ts).toLocaleString() : "";
      return `
        <div class="blocker-log-item">
          <div class="blocker-log-item__head">
            <span class="badge">${escapeHtml(item.stage || "nudge")}</span>
            <span class="meta">${escapeHtml(stamp)}</span>
          </div>
          <div class="blocker-log-item__reason">${escapeHtml(item.reason || "")}</div>
          <div class="meta">${escapeHtml(item.process || "")}${item.title ? ` · ${escapeHtml(item.title)}` : ""}</div>
        </div>
      `;
    }).join("")
    : `<div class="faint">No enforcement events yet.</div>`;

  return `
    <section class="stack blocker-shell blocker-shell--ct blocker-shell--subtab-${escapeHtml(subtab)}">
      <div class="card blocker-hero blocker-hero--ct">
          <div class="blocker-hero__main">
            <div class="blocker-hero__label">Trajectory</div>
            <div class="blocker-hero__title">Blocker Control Center</div>
          <div class="blocker-hero__sub">Distraction-blocker layout: presets on one side, grouped rules in one workspace, and event history pinned for review.</div>
        </div>
        <div class="blocker-hero__chips">
          <span class="badge">${status.active ? "Active" : "Standby"}</span>
          <span class="badge">${status.alwaysOnActive ? "Always On" : "Scheduled"}</span>
          <span class="badge">${status.frozenActive ? "Frozen" : "Mutable"}</span>
          <span class="badge">${cfg.websiteMode === "allowlist" ? "Allowlist" : "Blocklist"}</span>
        </div>
      </div>

      <div class="blocker-ct-layout">
        <aside class="stack blocker-ct-side">
          <div class="card blocker-ct-sidecard">
            <div class="card__title">
              <h2>Block Sets</h2>
              <div class="meta">${status.frozenActive ? "Frozen" : "Ready"}</div>
            </div>
            <div class="stack stack--tight">
              ${presetHtml}
            </div>
          </div>

          <div class="card blocker-ct-sidecard">
            <div class="card__title">
              <h2>Enforcement Feed</h2>
              <div class="meta">Latest 24 events</div>
            </div>
            <div class="stack stack--tight blocker-ct-log">
              ${historyHtml}
            </div>
            <div class="enforce-actions" style="margin-top:10px">
              <button class="btn btn--ghost" type="button" id="enfClearLogBtn">Clear Log</button>
            </div>
          </div>
        </aside>

        <div class="blocker-ct-work">
          ${enforcementCard}
        </div>
      </div>
    </section>
  `;
}

function renderWorkoutView() {
  ensureWorkoutStateShape();
  ensureUiStateShape();
  const ws = state.settings.workoutSync;
  const hasUrl = !!String(ws.url || "").trim();
  const hasToken = !!String(ws.token || "").trim();
  const canSync = hasUrl && hasToken;
  const lastSyncLabel = ws.lastSyncTs ? new Date(ws.lastSyncTs).toLocaleString() : "Never";

  const w = state.workouts || getDefaultWorkoutCache();
  const exercises = Object.values(w.exercisesById || {}).filter(ex => ex && typeof ex === "object" && !asBoolLoose(ex.archived));
  exercises.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const sessions = Object.values(w.sessionsById || {}).filter(s => s && typeof s === "object");
  sessions.sort((a, b) => parseIsoTs(b.startedAt) - parseIsoTs(a.startedAt));

  const setsAll = Object.values(w.setsById || {}).filter(s => s && typeof s === "object" && !asBoolLoose(s.deleted));
  const setsBySessionId = {};
  setsAll.forEach(s => {
    const sid = String(s.sessionId || "").trim();
    if (!sid) return;
    if (!setsBySessionId[sid]) setsBySessionId[sid] = [];
    setsBySessionId[sid].push(s);
  });

  const activeSession = sessions.find(s => !String(s.endedAt || "").trim());

  const ui = state.ui && typeof state.ui === "object" ? state.ui : {};
  const workoutUi = ui.workout && typeof ui.workout === "object" ? ui.workout : { selectedExerciseId: "", showWarmups: false };
  const selectedExerciseId = String(workoutUi.selectedExerciseId || "");
  const showWarmups = !!workoutUi.showWarmups;

  const selectedExercise = selectedExerciseId ? (w.exercisesById || {})[selectedExerciseId] : null;

  const selectedSets = selectedExerciseId
    ? setsAll
      .filter(s => String(s.exerciseId || "") === selectedExerciseId)
      .filter(s => showWarmups || !asBoolLoose(s.isWarmup))
      .sort((a, b) => parseIsoTs(b.createdAt) - parseIsoTs(a.createdAt))
      .slice(0, 20)
    : [];

  const exerciseTrend = [];
  if (selectedExerciseId) {
    const validTrendUnits = new Set(["lb", "kg"]);
    const entries = sessions
      .map(sess => {
        const sid = String(sess.sessionId || "");
        const these = (setsBySessionId[sid] || [])
          .filter(s => String(s.exerciseId || "") === selectedExerciseId)
          .filter(s => showWarmups || !asBoolLoose(s.isWarmup))
          .filter(s => validTrendUnits.has(String(s.unit || "lb").trim().toLowerCase()));
        let best = 0;
        these.forEach(s => {
          const est = estimateEpley1RM(s.weight, s.reps);
          if (est > best) best = est;
        });
        return { startedAt: parseIsoTs(sess.startedAt), best };
      })
      .filter(e => e.startedAt > 0 && e.best > 0)
      .sort((a, b) => a.startedAt - b.startedAt);
    entries.slice(-14).forEach(e => exerciseTrend.push(e.best));
  }

  function renderSparkline(values, { width = 260, height = 56 } = {}) {
    const nums = (Array.isArray(values) ? values : []).map(Number).filter(n => Number.isFinite(n));
    if (nums.length < 2) return `<div class="faint">Not enough data yet.</div>`;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = (max - min) || 1;
    const pad = 6;
    const pts = nums.map((v, i) => {
      const x = pad + (i * (width - pad * 2)) / (nums.length - 1);
      const y = pad + (height - pad * 2) * (1 - ((v - min) / span));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `
      <svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Trend">
        <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
      <div class="meta" style="display:flex;justify-content:space-between;margin-top:6px">
        <span>min ${min.toFixed(1)}</span>
        <span>max ${max.toFixed(1)}</span>
      </div>
    `;
  }

  const prsByExercise = new Map();
  const validPrUnits = new Set(["lb", "kg"]);
  setsAll.forEach(s => {
    if (asBoolLoose(s.isWarmup)) return;
    if (!validPrUnits.has(String(s.unit || "lb").trim().toLowerCase())) return;
    const exId = String(s.exerciseId || "").trim();
    if (!exId) return;
    const score = estimateEpley1RM(s.weight, s.reps);
    if (!(score > 0)) return;
    const name = String(
      s.exerciseName
      || ((w.exercisesById || {})[exId] || {}).name
      || "Exercise"
    ).trim() || "Exercise";
    const ts = parseIsoTs(s.createdAt) || 0;
    const current = prsByExercise.get(exId);
    if (!current || score > current.score) {
      prsByExercise.set(exId, {
        exId,
        name,
        score,
        weight: Number(s.weight),
        reps: Number(s.reps),
        unit: String(s.unit || "lb"),
        ts
      });
    }
  });
  const prRows = Array.from(prsByExercise.values()).sort((a, b) => b.score - a.score).slice(0, 10);

  const recentSessions = sessions.slice(0, 10);
  const sessionsHtml = recentSessions.length ? recentSessions.map(sess => {
    const sid = String(sess.sessionId || "");
    const startedTs = parseIsoTs(sess.startedAt);
    const endedTs = parseIsoTs(sess.endedAt);
    const dur = (startedTs && endedTs) ? formatElapsed(endedTs - startedTs) : (startedTs ? formatElapsed(Date.now() - startedTs) : "");
    const durLabel = endedTs ? dur : (dur ? `In progress · ${dur}` : "In progress");
    const setCount = (setsBySessionId[sid] || []).filter(s => showWarmups || !asBoolLoose(s.isWarmup)).length;
    const payload = escapeHtml(JSON.stringify({ sessionId: sid }));
    return `
      <button class="workout-session-item" type="button" data-ui-open-drawer="workout-session" data-ui-drawer-payload="${payload}">
        <div class="workout-session-item__main">
          <div class="workout-session-item__title">${escapeHtml(sess.routineName || "Workout")}</div>
          <div class="meta">${startedTs ? escapeHtml(new Date(startedTs).toLocaleDateString()) : ""}${durLabel ? ` · ${escapeHtml(durLabel)}` : ""} · ${setCount} sets</div>
        </div>
        <div class="workout-session-item__cta">${endedTs ? "Open" : "Active"}</div>
      </button>
    `;
  }).join("") : `<div class="faint">No sessions synced yet.</div>`;

  const exerciseOptionsHtml = exercises.map(ex => {
    const exId = String(ex.exerciseId || "");
    const selectedAttr = exId && exId === selectedExerciseId ? " selected" : "";
    return `<option value="${escapeHtml(exId)}"${selectedAttr}>${escapeHtml(ex.name || "Exercise")}</option>`;
  }).join("");

  const selectedSetsHtml = selectedSets.length ? selectedSets.map(s => {
    const ts = parseIsoTs(s.createdAt);
    const weight = Number(s.weight);
    const reps = Number(s.reps);
    const unit = String(s.unit || "lb");
    const warm = asBoolLoose(s.isWarmup) ? ` <span class="pill pill--good">Warmup</span>` : "";
    const label = (Number.isFinite(weight) && weight > 0 && Number.isFinite(reps) && reps > 0)
      ? `${weight} ${unit} × ${reps}`
      : `${String(s.weight || "")} ${unit} × ${String(s.reps || "")}`;
    return `
      <div class="workout-setrow">
        <div class="meta">${ts ? escapeHtml(new Date(ts).toLocaleDateString()) : ""}</div>
        <div class="workout-setrow__main">${escapeHtml(label)}${warm}</div>
      </div>
    `;
  }).join("") : `<div class="faint">Pick an exercise to see recent sets.</div>`;

  const prHtml = prRows.length ? prRows.map(pr => `
    <div class="workout-prrow">
      <div class="workout-prrow__name">${escapeHtml(pr.name)}</div>
      <div class="workout-prrow__meta">${escapeHtml(pr.score.toFixed(1))} est 1RM · ${escapeHtml(`${pr.weight} ${pr.unit} × ${pr.reps}`)}${pr.ts ? ` · ${escapeHtml(new Date(pr.ts).toLocaleDateString())}` : ""}</div>
    </div>
  `).join("") : `<div class="faint">No PRs yet.</div>`;

  const setupCard = !hasUrl ? `
    <div class="card card--focus">
      <div class="card__title">
        <h2>Connect Workout Sync</h2>
        <div class="meta">Google Sheets + Apps Script</div>
      </div>
      <div class="muted">Add your Apps Script <code>/exec</code> URL and token in Settings, then sync.</div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn--primary" type="button" id="btnWorkoutGoSettings">Open Settings</button>
      </div>
    </div>
  ` : "";

  return `
    <section class="stack workout-shell">
      ${setupCard}

      <div class="card workout-hero">
        <div class="card__title">
          <h2>Workout</h2>
          <div class="meta">${canSync ? "Connected" : "Not connected"}</div>
        </div>
        <div class="workout-hero__row">
          <div class="meta">${exercises.length} exercises · ${sessions.length} sessions · ${setsAll.length} sets${activeSession ? " · Active session running" : ""}</div>
          <div class="workout-hero__actions">
            <button class="btn btn--ghost" id="btnWorkoutOpenLogger" type="button" ${hasUrl ? "" : "disabled"}>Open Logger</button>
            <button class="btn btn--primary" id="btnWorkoutSyncNow" type="button" ${canSync ? "" : "disabled"}>Sync Now</button>
          </div>
        </div>
        <div class="meta">Last sync: ${escapeHtml(lastSyncLabel)}</div>
        ${ws.lastError ? `<div class="settings-error" style="margin-top:10px">${escapeHtml(ws.lastError)}</div>` : ``}
      </div>

      <div class="workout-grid">
        <div class="card">
          <div class="card__title">
            <h2>Recent Sessions</h2>
            <div class="meta">Last 10</div>
          </div>
          <div class="workout-session-list">
            ${sessionsHtml}
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card__title">
              <h2>Exercise Explorer</h2>
              <div class="meta">Trend + recent sets</div>
            </div>
            <div class="stack stack--tight">
              <div class="row row--3" style="align-items:end">
                <label class="field" style="min-width:220px;flex:1">
                  <span class="field__label">Exercise</span>
                  <select id="workoutExerciseSelect" class="input">
                    <option value="">(pick one)</option>
                    ${exerciseOptionsHtml}
                  </select>
                </label>
                <label class="check" style="margin:0 0 6px 0">
                  <input id="workoutShowWarmups" type="checkbox" ${showWarmups ? "checked" : ""} />
                  Include warmups
                </label>
                <div class="meta" style="margin-bottom:6px">${selectedExercise ? escapeHtml(selectedExercise.primaryMuscle || selectedExercise.equipment || "") : ""}</div>
              </div>

              <div class="card card--subtle">
                <div class="card__title">
                  <h3>Trend (est 1RM)</h3>
                  <div class="meta">${selectedExercise ? escapeHtml(selectedExercise.name || "") : "Select an exercise"}</div>
                </div>
                ${selectedExerciseId ? renderSparkline(exerciseTrend) : `<div class="faint">Pick an exercise to view trend.</div>`}
              </div>

              <div class="card card--subtle">
                <div class="card__title">
                  <h3>Recent Sets</h3>
                  <div class="meta">Latest 20</div>
                </div>
                <div class="stack stack--tight">
                  ${selectedSetsHtml}
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__title">
              <h2>PRs</h2>
              <div class="meta">Estimated 1RM</div>
            </div>
            <div class="stack stack--tight">
              ${prHtml}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSettingsView() {
  const theme = getThemeFromState();
  const isDark = theme === "dark";
  const isLight = theme === "light";
  ensureEnforcementStateShape();
  ensureWorkoutStateShape();
  const ws = state.settings.workoutSync;
  const hasUrl = !!String(ws.url || "").trim();
  const hasToken = !!String(ws.token || "").trim();
  const canSync = hasUrl && hasToken;
  const lastSyncLabel = ws.lastSyncTs ? new Date(ws.lastSyncTs).toLocaleString() : "Never";
  const extDir = getBrowserBlockerExtensionDir();
  const extReady = !!(extDir && fsSafe && typeof fsSafe.existsSync === "function" && fsSafe.existsSync(extDir));
  return `
    <section class="stack settings-shell">
      <div class="card">
        <div class="card__title">
          <h2>Settings</h2>
          <div class="meta">Personalization</div>
        </div>
        <div class="stack stack--tight">
          <div class="settings-note">Choose the look you want across the entire app.</div>
          <div class="theme-grid">
            <button class="theme-option${isDark ? " is-active" : ""}" type="button" data-theme-set="dark" aria-pressed="${isDark}">
              <div class="theme-option__head">
                <div class="theme-option__name">Dark Mode</div>
                <div class="theme-option__state">${isDark ? "Active" : "Select"}</div>
              </div>
              <div class="theme-preview theme-preview--dark">
                <div class="theme-preview__bar"></div>
                <div class="theme-preview__card"></div>
                <div class="theme-preview__card"></div>
              </div>
            </button>
            <button class="theme-option${isLight ? " is-active" : ""}" type="button" data-theme-set="light" aria-pressed="${isLight}">
              <div class="theme-option__head">
                <div class="theme-option__name">Light Mode</div>
                <div class="theme-option__state">${isLight ? "Active" : "Select"}</div>
              </div>
              <div class="theme-preview theme-preview--light">
                <div class="theme-preview__bar"></div>
                <div class="theme-preview__card"></div>
                <div class="theme-preview__card"></div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__title">
          <h2>Workout Sync</h2>
          <div class="meta">Google Sheets + Apps Script</div>
        </div>
        <div class="stack stack--tight">
          <div class="settings-note">Sheets is your database. The Apps Script web app is your API and iPhone logger.</div>
          <label class="field">
            <span class="field__label">Web App URL (/exec)</span>
            <input id="workoutSyncUrl" class="input" type="url" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(ws.url || "")}" />
          </label>
          <label class="field">
            <span class="field__label">Token</span>
            <input id="workoutSyncToken" class="input" type="password" placeholder="WORKOUT_SYNC_TOKEN" value="${escapeHtml(ws.token || "")}" />
          </label>
          <div class="row workout-sync-actions">
            <button class="btn btn--ghost" id="btnWorkoutOpenLogger" type="button" ${hasUrl ? "" : "disabled"}>Open Logger</button>
            <button class="btn btn--ghost" id="btnWorkoutTest" type="button" ${hasUrl ? "" : "disabled"}>Test Connection</button>
            <button class="btn btn--primary" id="btnWorkoutSyncNow" type="button" ${canSync ? "" : "disabled"}>Sync Now</button>
            <button class="btn btn--ghost" id="btnWorkoutClearCache" type="button">Clear Local Cache</button>
            <button class="btn btn--ghost" id="btnWorkoutGoToTab" type="button">Open Workout Tab</button>
          </div>
          <div class="meta">Last sync: ${escapeHtml(lastSyncLabel)}</div>
          ${ws.lastError ? `<div class="settings-error">${escapeHtml(ws.lastError)}</div>` : ``}
          <details class="settings-details">
            <summary>Setup instructions</summary>
            <ol class="settings-steps">
              <li>Create a Google Sheet (example: "Trajectory Workouts").</li>
              <li>Extensions → Apps Script → paste <code>workout-sync-appscript/Code.gs</code> and <code>Logger.html</code>.</li>
              <li>Project Settings → Script Properties → set <code>WORKOUT_SYNC_TOKEN</code>.</li>
              <li>Deploy → New deployment → Web app → copy the <code>/exec</code> URL.</li>
            </ol>
          </details>
        </div>
      </div>

      <div class="card">
        <div class="card__title">
          <h2>Browser Extension</h2>
          <div class="meta">Chrome / Edge</div>
        </div>
        <div class="stack stack--tight">
          <div class="settings-note">Optional, but recommended for tab-level blocking, faster hard blocks, and planner reminders.</div>
          <div class="meta">${extReady ? `Folder: <code>${escapeHtml(extDir)}</code>` : "Extension folder not found in app files."}</div>
          <div class="enforce-actions">
            <button class="btn btn--primary" id="settingsOpenBrowserExtensionsPageBtn" type="button">Open Extensions Page</button>
            <button class="btn btn--primary" id="settingsOpenBrowserExtensionFolderBtn" type="button">Open Extension Folder</button>
            <button class="btn btn--ghost" id="settingsExportBrowserExtensionProfileBtn" type="button">Export Profile JSON</button>
          </div>
          <details class="settings-details">
            <summary>Setup instructions</summary>
            <ol class="settings-steps">
              <li>Click <b>Open Extensions Page</b>.</li>
              <li>Enable <b>Developer mode</b>.</li>
              <li>Click <b>Load unpacked</b> and choose the folder shown above.</li>
              <li>Keep the extension enabled. (Optional: pin it to the toolbar.)</li>
              <li>Use <b>Export Profile JSON</b>, then open the extension’s Options page to import your rules.</li>
            </ol>
          </details>
        </div>
      </div>
    </section>
  `;
}

// ---------- Rule-based planner (free) ----------
function generatePlanFromGoals() {
  const sprint = getActiveSprint();
  // compute current planned hours and remaining budget
  const plannedHours = sprint.commitments.reduce((s,c) => s + (Number(c.estHours)||0), 0);
  const budget = Math.max(Number(sprint.timeBudgetHours) - plannedHours, 0);
  if (budget <= 0) { alert('No remaining budget this week. Adjust your sprint budget or clear some commitments.'); return; }

  // Build candidate tasks from goals. For degree goals, create per-class tasks for incomplete classes.
  const candidates = [];
  (state.longPlans || []).forEach(g => {
    if (!g) return;
    if (g.category === 'degree' && g.degree && Array.isArray(g.degree.classes)) {
      g.degree.classes.forEach(cl => {
        if (!cl) return;
        if (!cl.completed) {
          candidates.push({ title: `Study: ${cl.name}`, deliverable: `Pass ${cl.name}`, estHours: 2, linkedPlanId: g.id });
        }
      });
    } else {
      // generic goal: create one or two chunks
      candidates.push({ title: `Work on: ${g.title}`, deliverable: g.notes || g.title, estHours: 2, linkedPlanId: g.id });
    }
  });

  if (!candidates.length) { alert('No candidate tasks found from goals. Add goals or degree classes first.'); return; }

  // Prepare per-day planned hours (for this sprint week)
  const plannedByDay = Array.from({length:7}, () => 0);
  sprint.commitments.forEach(c => {
    const idx = clampDay(Number(c.dayIndex));
    plannedByDay[idx] += Number(c.estHours) || 0;
  });

  // schedule loop: pick smallest-loaded day and assign candidate chunks until budget or 7-commit limit reached
  let remaining = budget;
  let added = 0;
  const maxPerChunk = 3; // cap chunk size
  for (let i = 0; i < candidates.length && remaining > 0; i++) {
    const cand = candidates[i];
    // find best day (min planned hours)
    let bestDay = 0; let bestLoad = plannedByDay[0];
    for (let d=1; d<7; d++) { if (plannedByDay[d] < bestLoad) { bestLoad = plannedByDay[d]; bestDay = d; } }

    const take = Math.min(maxPerChunk, remaining);
    // ensure not exceeding 7 commitments rule
    if (sprint.commitments.length + 1 > 7) break;

    const newC = {
      id: uuid(),
      title: cand.title,
      deliverable: cand.deliverable || '',
      estHours: take,
      dayIndex: bestDay,
      nextAction: '',
      done: false,
      stat: 'INT',
      color: colorForStat('INT')
    };
    if (cand.linkedPlanId) newC.linkedPlanIds = [cand.linkedPlanId];

    sprint.commitments.push(newC);
    plannedByDay[bestDay] += take;
    remaining -= take;
    added++;
  }

  saveState();
  render();
  alert(`Generated ${added} commitment(s). Remaining budget: ${remaining}h`);
}


// ---------- Goals modal helpers ----------
function openGoalModal({ editId = null } = {}) {
  const modal = $("#goalModal");
  const form = $("#goalForm");
  if (editId) {
    const g = (state.longPlans || []).find(x => x.id === editId);
    if (!g) return;
    $("#goalTitle").textContent = "Edit Goal";
    $("#gTitle").value = g.title;
    $("#gHorizon").value = String(g.horizonYears || 1);
    $("#gNotes").value = g.notes || "";
    $("#gCategory").value = g.category || "";
    // degree-specific
    const degreeFields = $("#degreeFields");
    if (g.category === 'degree' && g.degree) {
      degreeFields.hidden = false;
      $("#gDegreeReq").value = String(g.degree.requiredCredits || 120);
      const list = $("#gClassesList");
      list.innerHTML = '';
      (g.degree.classes || []).forEach(cl => {
        const id = cl.id || uuid();
        const row = document.createElement('div');
        row.className = 'class-row';
        row.setAttribute('data-class-id', id);
        row.innerHTML = `
          <input class="input g-class-name" placeholder="Course name" value="${escapeHtml(cl.name || '')}" />
          <input class="input g-class-credits" type="number" min="0" step="0.5" value="${Number(cl.credits || 0)}" />
          <label class="check"><input type="checkbox" class="g-class-completed" ${cl.completed ? 'checked' : ''}/>Done</label>
          <button class="smallbtn" type="button" data-remove-class="${id}">Remove</button>
        `;
        list.appendChild(row);
      });
    } else {
      degreeFields.hidden = true;
      $("#gDegreeReq").value = "120";
      $("#gClassesList").innerHTML = '';
    }
    // health-specific
    const healthFields = $("#healthFields");
    if (g.category === 'health' && g.health) {
      if (healthFields) healthFields.hidden = false;
      $("#gHealthSubtype").value = g.health.subtype || 'general';
      $("#gHealthUnit").value = g.health.unit || 'kg';
      $("#gHealthCurrent").value = (typeof g.health.currentValue !== 'undefined') ? String(g.health.currentValue) : '';
      $("#gHealthTarget").value = (typeof g.health.targetValue !== 'undefined') ? String(g.health.targetValue) : '';
      $("#gHealthStart").value = (typeof g.health.startValue !== 'undefined') ? String(g.health.startValue) : '';
      const mlist = $("#gHealthMeasurementsList");
      mlist.innerHTML = '';
      (g.health.measurements || []).forEach(m => {
        const id = m.id || uuid();
        const row = document.createElement('div');
        row.className = 'measurement-row';
        row.setAttribute('data-measure-id', id);
        row.innerHTML = `
          <input class="input g-measure-date" type="date" value="${escapeHtml(m.dateISO || '')}" />
          <input class="input g-measure-value" type="number" step="0.1" value="${Number(m.value || 0)}" />
          <button class="smallbtn" type="button" data-remove-measurement="${id}">Remove</button>
        `;
        mlist.appendChild(row);
      });
    } else {
      if (healthFields) healthFields.hidden = true;
      $("#gHealthMeasurementsList").innerHTML = '';
      $("#gHealthCurrent").value = '';
      $("#gHealthTarget").value = '';
      $("#gHealthStart").value = '';
      $("#gHealthSubtype").value = 'general';
      $("#gHealthUnit").value = 'kg';
    }
    form.setAttribute("data-editing-id", editId);
  } else {
    $("#goalTitle").textContent = "Add Goal";
    $("#gTitle").value = "";
    $("#gHorizon").value = "1";
    $("#gNotes").value = "";
    $("#gCategory").value = "";
    $("#degreeFields").hidden = true;
    $("#gDegreeReq").value = "120";
    $("#gClassesList").innerHTML = '';
    form.removeAttribute("data-editing-id");
  }
  modal.hidden = false;
  $("#gTitle").focus();
  try { enableModalFocusTrap(modal); } catch (e) {}
}

function closeGoalModal() {
  const modal = $("#goalModal");
  modal.hidden = true;
  $("#goalForm").removeAttribute("data-editing-id");
  try { disableModalFocusTrap(modal); } catch (e) {}
}

// ---------- Timeline "Now Line" ----------
// Update the position of the real-time "now" indicator line on the timeline
function updateTimelineNowLine() {
  const nowLine = $("#timelineNowLine");
  if (!nowLine) return;
  const timeline = nowLine.closest('.plan-timeline');
  const dateISO = timeline ? timeline.getAttribute('data-date') : null;
  const todayISO = toISO(new Date());
  if (dateISO && dateISO !== todayISO) {
    nowLine.style.display = 'none';
    return;
  }
  nowLine.style.display = '';
  const now = new Date();
  const hour = now.getHours();
  const minutes = now.getMinutes();
  const hourPercent = (hour + minutes / 60) / 24 * 100;
  
  nowLine.style.top = hourPercent + '%';
}

// Start updating the now-line every minute
let _nowLineInterval = null;
function startNowLineUpdater() {
  if (_nowLineInterval) return; // already running
  updateTimelineNowLine(); // initial update
  _nowLineInterval = setInterval(updateTimelineNowLine, 60000); // update every 60 seconds
}

function stopNowLineUpdater() {
  if (_nowLineInterval) {
    clearInterval(_nowLineInterval);
    _nowLineInterval = null;
  }
}

// ---------- Wiring ----------
function wireHandlers() {
  // Week nav (page-local buttons)
  const prevW = $("#btnPrevWeek_page");
  const nextW = $("#btnNextWeek_page");
  const todayW = $("#btnToday_page");
  if (prevW) prevW.onclick = () => {
    const d = addDays(fromISO(state.weekStartISO), -7);
    state.weekStartISO = toISO(d);
    saveState();
    render();
  };
  if (nextW) nextW.onclick = () => {
    const d = addDays(fromISO(state.weekStartISO), 7);
    state.weekStartISO = toISO(d);
    saveState();
    render();
  };
  if (todayW) todayW.onclick = () => {
    state.weekStartISO = toISO(getWeekStart(new Date()));
    saveState();
    render();
  };

  const classFilter = $("#calendarClassFilter");
  if (classFilter) {
    classFilter.onchange = () => {
      const next = classFilter.value || "all";
      setCalendarClassFilterKey(next, { persist: true, rerender: true });
    };
  }
  document.querySelectorAll("[data-calendar-class]").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-calendar-class") || "all";
      setCalendarClassFilterKey(next, { persist: true, rerender: true });
    });
  });
  const autoScheduleBtn = $("#btnAutoScheduleWeek");
  if (autoScheduleBtn) {
    autoScheduleBtn.onclick = () => {
      const result = autoScheduleWeek();
      if (result.scheduledCount > 0) {
        alert(`Auto-scheduled ${result.scheduledCount} task(s) this week.`);
      } else {
        alert("No unscheduled tasks found for this week.");
      }
    };
  }
  const generateTodayBtn = $("#btnGenerateTodayPlan");
  if (generateTodayBtn) {
    generateTodayBtn.onclick = () => {
      const result = generateTodayPlan();
      if (result.scheduledCount > 0) {
        const movedText = result.movedFromOtherDays > 0
          ? ` Moved ${result.movedFromOtherDays} from other days.`
          : "";
        alert(`Generated today's plan: ${result.scheduledCount} task(s), ${formatMinutesCompact(result.scheduledMins)} scheduled.${movedText}`);
      } else if (result.reason === "today-full") {
        alert("Today already has enough scheduled time. No new tasks were added.");
      } else {
        alert("No unscheduled tasks available to generate a today plan.");
      }
    };
  }

  // Tabs
  $("#tabHome").onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "home"; saveState(); render(); };
  $("#tabMonth").onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "month"; state.monthStartISO = toISO(getMonthStart(new Date())); saveState(); render(); };
  $("#tabPlan").onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "plan"; saveState(); render(); };
  $("#tabStats").onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "stats"; saveState(); render(); };
  const tabWorkout = $("#tabWorkout");
  if (tabWorkout) tabWorkout.onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "workout"; saveState(); render(); };
  const tabBlocker = $("#tabBlocker");
  if (tabBlocker) tabBlocker.onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "blocker"; saveState(); render(); };
  const tabSettings = $("#tabSettings");
  if (tabSettings) tabSettings.onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "settings"; saveState(); render(); };
  const homeOpenBlockerBtn = $("#homeOpenBlockerBtn");
  if (homeOpenBlockerBtn) homeOpenBlockerBtn.onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "blocker"; saveState(); render(); };

  // Workout: view + sync controls
  const workoutGoSettingsBtn = $("#btnWorkoutGoSettings");
  if (workoutGoSettingsBtn) workoutGoSettingsBtn.onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "settings"; saveState(); render(); };
  const workoutGoToTabBtn = $("#btnWorkoutGoToTab");
  if (workoutGoToTabBtn) workoutGoToTabBtn.onclick = () => { closeUiDrawer({ persist: false, rerender: false }); state.view = "workout"; saveState(); render(); };

  const workoutUrlEl = $("#workoutSyncUrl");
  if (workoutUrlEl) workoutUrlEl.onblur = () => {
    ensureWorkoutStateShape();
    state.settings.workoutSync.url = normalizeWorkoutExecUrl(workoutUrlEl.value);
    saveState();
    render();
  };
  const workoutTokenEl = $("#workoutSyncToken");
  if (workoutTokenEl) workoutTokenEl.onblur = () => {
    ensureWorkoutStateShape();
    state.settings.workoutSync.token = String(workoutTokenEl.value || "").trim();
    saveState();
    render();
  };

  const workoutOpenLoggerBtn = $("#btnWorkoutOpenLogger");
  if (workoutOpenLoggerBtn) workoutOpenLoggerBtn.onclick = () => {
    ensureWorkoutStateShape();
    const loggerUrl = getWorkoutLoggerUrl(state.settings.workoutSync.url);
    if (!loggerUrl) { alert("Set Workout Sync URL first."); return; }
    openUrlInSystemBrowser(loggerUrl);
  };
  const workoutTestBtn = $("#btnWorkoutTest");
  if (workoutTestBtn) workoutTestBtn.onclick = () => { void runWorkoutHealthTest({ showAlert: true }); };
  const workoutSyncNowBtn = $("#btnWorkoutSyncNow");
  if (workoutSyncNowBtn) workoutSyncNowBtn.onclick = () => { void runWorkoutSyncNow({ showAlert: true, rerender: true }); };
  const workoutClearCacheBtn = $("#btnWorkoutClearCache");
  if (workoutClearCacheBtn) workoutClearCacheBtn.onclick = () => {
    if (!confirm("Clear local workout cache? This does not delete your Google Sheet data.")) return;
    clearWorkoutCache({ persist: true });
    render();
  };

  const workoutExerciseSelect = $("#workoutExerciseSelect");
  if (workoutExerciseSelect) workoutExerciseSelect.onchange = () => {
    ensureUiStateShape();
    state.ui.workout.selectedExerciseId = String(workoutExerciseSelect.value || "");
    saveState();
    render();
  };
  const workoutShowWarmupsEl = $("#workoutShowWarmups");
  if (workoutShowWarmupsEl) workoutShowWarmupsEl.onchange = () => {
    ensureUiStateShape();
    state.ui.workout.showWarmups = !!workoutShowWarmupsEl.checked;
    saveState();
    render();
  };

  // Repeat options UI in commit modal
  const repeatFreqEl = $('#cRepeatFreq');
  const repeatIntervalEl = $('#cRepeatInterval');
  const repeatWeeklyOpts = $('#repeatWeeklyOpts');
  const repeatMonthlyOpts = $('#repeatMonthlyOpts');
  const repeatUntilOpt = $('#repeatUntilOpt');
  function updateRepeatVisibility() {
    const v = repeatFreqEl ? repeatFreqEl.value : 'once';
    if (repeatWeeklyOpts) repeatWeeklyOpts.style.display = (v === 'weekly') ? '' : 'none';
    if (repeatMonthlyOpts) repeatMonthlyOpts.style.display = (v === 'monthly') ? '' : 'none';
    if (repeatUntilOpt) repeatUntilOpt.style.display = (v === 'daily' || v === 'weekly' || v === 'monthly' || v === 'custom') ? '' : 'none';
  }
  if (repeatFreqEl) repeatFreqEl.addEventListener('change', updateRepeatVisibility);
  // ensure initial state
  try { updateRepeatVisibility(); } catch (e) {}

  // Add global
  $("#btnAddCommitment").onclick = () => { closeUiDrawer({ persist: false, rerender: false }); openCommitModal({ dayIndex: clampDayIndexForDefault() }); };

  // Pick-next handler (button rendered in focus card)
  const pickNext = $("#pickNextBtn");
  if (pickNext) pickNext.onclick = () => {
    const sprint = getActiveSprint();
    const next = pickTodayFocus(sprint);
    if (next) {
      next.started = Date.now();
      saveState(); render();
    } else alert('No next action found.');
  };

  // Collapsible Quality Check toggle
  const tq = $("#toggleQualityCheck");
  if (tq) tq.onclick = () => {
    state.ui = state.ui || {};
    state.ui.qualityCollapsed = !state.ui.qualityCollapsed;
    saveState(); render();
  };

  // Month nav (page-local buttons)
  const prevM = $("#btnPrevMonth_page");
  const nextM = $("#btnNextMonth_page");
  const thisM = $("#btnThisMonth_page");
  if (prevM) prevM.onclick = () => {
    const d = addMonths(fromISO(state.monthStartISO), -1);
    state.monthStartISO = toISO(getMonthStart(d)); state.view = "month"; saveState(); render();
  };
  if (nextM) nextM.onclick = () => {
    const d = addMonths(fromISO(state.monthStartISO), 1);
    state.monthStartISO = toISO(getMonthStart(d)); state.view = "month"; saveState(); render();
  };
  if (thisM) thisM.onclick = () => {
    state.monthStartISO = toISO(getMonthStart(new Date())); state.view = "month"; saveState(); render();
  };

  // Calendar add buttons
  document.querySelectorAll("[data-add-day]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dayIndex = Number(btn.getAttribute("data-add-day"));
      openCommitModal({ dayIndex });
    });
  });

  // Month add buttons (by date)
  document.querySelectorAll("[data-add-date]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dateISO = btn.getAttribute("data-add-date");
      openCommitModal({ dateISO });
    });
  });

  // Toggle done
  document.querySelectorAll("[data-toggle-done]").forEach(chk => {
    chk.addEventListener("change", () => {
      const id = chk.getAttribute("data-toggle-done");
      const sprint = getActiveSprint();
      const c = sprint.commitments.find(x => x.id === id);
      if (!c) return;
      setCommitDoneStatus(c, chk.checked, state.weekStartISO);
      saveState();
      render();
    });
  });

  // Toggle done for occurrences (repeating templates)
  document.querySelectorAll('[data-toggle-occurrence]').forEach(chk => {
    chk.addEventListener('change', () => {
      const occId = chk.getAttribute('data-toggle-occurrence');
      if (!occId) return;
      setOccurrenceDoneStatus(occId, chk.checked, state.weekStartISO);
      saveState();
      render();
    });
  });

  // Stats CTA
  const coachBtn = document.getElementById('coachActionBtn');
  if (coachBtn) {
    coachBtn.onclick = () => { try { openCommitModal({ dayIndex: clampDayIndexForDefault() }); } catch (e) { console.error('coachActionBtn failed', e); } };
  }

  // Move day
  document.querySelectorAll("[data-move-day]").forEach(sel => {
    sel.addEventListener("change", () => {
      const id = sel.getAttribute("data-move-day");
      const newDay = Number(sel.value);
      const sprint = getActiveSprint();
      const c = sprint.commitments.find(x => x.id === id);
      if (!c) return;
      c.dayIndex = clampDay(newDay);
      saveState();
      render();
    });
  });

  // Compact calendar row: click opens details/edit modal
  // (handled via delegated click handler in initDayTracker)

  // Edit
  document.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const sprint = getActiveSprint();
      const c = sprint.commitments.find(x => x.id === id);
      if (!c) return;
      openCommitModal({ editId: id });
    });
  });

  // Edit occurrence (open modal to edit only that instance)
  document.querySelectorAll('[data-edit-occurrence]').forEach(btn => {
    btn.addEventListener('click', () => {
      const occId = btn.getAttribute('data-edit-occurrence');
      if (!occId) return;
      openOccurrenceModalById(occId);
    });
  });

  // Delete occurrence (create an override marking deletion)
  document.querySelectorAll('[data-delete-occurrence]').forEach(btn => {
    btn.addEventListener('click', () => {
      const occId = btn.getAttribute('data-delete-occurrence');
      if (!occId) return;
      state.occurrenceOverrides = state.occurrenceOverrides || {};
      state.occurrenceOverrides[occId] = Object.assign({}, state.occurrenceOverrides[occId] || {}, { deleted: true });
      saveState(); render();
    });
  });

  // Delete
  document.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete");
      deleteCommitById(id);
      saveState();
      render();
    });
  });

  // Plan inputs
  const obj = $("#inpObjective");
  const bud = $("#inpBudget");
  if (obj) {
    obj.addEventListener("input", () => {
      const sprint = getActiveSprint();
      sprint.objective = obj.value;
      queueSaveState();
    });
    obj.addEventListener("blur", () => flushQueuedSaveState());
  }
  if (bud) {
    bud.addEventListener("input", () => {
      const sprint = getActiveSprint();
      sprint.timeBudgetHours = Number(bud.value || 0);
      queueSaveState();
      // avoid rerender spam; only rerender on blur
    });
    bud.addEventListener("blur", () => { flushQueuedSaveState(); render(); });
  }

  // Modal close
  $("#commitModal").addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute("data-close") === "true") closeCommitModal();
  });

  // Morning Gate (forced) submit
  const mgForm = $("#morningGateForm");
  if (mgForm) {
    mgForm.onsubmit = (e) => {
      e.preventDefault();
      if (mgForm.getAttribute("data-working") === "true") return;
      mgForm.setAttribute("data-working", "true");
      try {
        ensureMorningGateStateShape();
        const mg = state.morningGate;
        const dayKey = String(mg.activeDayKey || getBaselineDayKeyISO(new Date(), mg.baselineHour || 6)).trim();

        const goals = [
          $("#mgGoal1") ? String($("#mgGoal1").value || "").trim() : "",
          $("#mgGoal2") ? String($("#mgGoal2").value || "").trim() : "",
          $("#mgGoal3") ? String($("#mgGoal3").value || "").trim() : ""
        ];

        if (!dayKey) {
          setMorningGateStatus("Missing day key. Try Refresh.");
          return;
        }
        if (goals.some(g => !g)) {
          setMorningGateStatus("Enter 3 goals.");
          return;
        }

        const btn = $("#mgStartDayBtn");
        if (btn) btn.disabled = true;

        setMorningGateStatus("Starting...");
        (async () => {
          try {
            await completeMorningGate(dayKey, goals);
          } catch (err) {
            console.warn("Morning gate failed", err);
            setFullscreenLock("morningGate", true);
            setMorningGateStatus(String((err && err.message) || err || "Failed to start day"));
          } finally {
            try { mgForm.setAttribute("data-working", "false"); } catch (_) {}
            try { if (btn) btn.disabled = false; } catch (_) {}
          }
        })();
      } finally {
        // keep data-working until async completes
      }
    };
  }

  // Modal submit
  $("#commitForm").onsubmit = (e) => {
    e.preventDefault();
    const formEl = $("#commitForm");
    const autoMode = !!(formEl && formEl.getAttribute("data-auto-save") === "true");
    const finishCommitSubmit = ({ keepOpen = autoMode } = {}) => {
      saveState();
      if (keepOpen) return;
      closeCommitModal();
      render();
    };
    const title = $("#cTitle").value.trim();
    const deliverable = $("#cDeliverable").value.trim();
    const estHours = Number($("#cHours").value || 0);
    const dayIndex = clampDay(Number($("#cDay").value));
    const nextAction = $("#cNext").value.trim();
    const dateISO = $("#cDate").value || null;
    const time = $("#cTime") ? $("#cTime").value || '' : '';
    const proof = $("#cProof") ? $("#cProof").value.trim() || '' : '';
    const duration = $("#cDuration") ? normalizeDurationMins($("#cDuration").value) : null;
    const linkGoal = $("#cLinkGoal").value || null;
    const stat = $("#cStat").value || "STR";
    const isFocus = $("#cFocus") ? !!$("#cFocus").checked : false;
    const done = $("#cDone") ? !!$("#cDone").checked : false;
    const autopilotPinned = $("#cAutopilotPin") ? !!$("#cAutopilotPin").checked : false;
    const colorHex = $("#cColorHex") ? $("#cColorHex").value : '';
    const colorRaw = $("#cColor") ? $("#cColor").value : '';
    const color = normalizeHexColor(colorHex) || normalizeHexColor(colorRaw) || colorForStat(stat);
    const iconPick = normalizeIconPickerValue($("#cIcon") ? $("#cIcon").value : "auto");
    const repeatFreq = $("#cRepeatFreq") ? $("#cRepeatFreq").value : 'once';
    const repeatInterval = $("#cRepeatInterval") ? Math.max(1, Number($("#cRepeatInterval").value || 1)) : 1;
    const repeatUntil = $("#cRepeatUntil") ? ($("#cRepeatUntil").value || null) : null;
    const repeatMonthDay = $("#cRepeatMonthDay") ? Number($("#cRepeatMonthDay").value || 0) : 0;
    const repeatWeekdays = [];
    document.querySelectorAll('.repeat-wd').forEach(el => { if (el.checked) repeatWeekdays.push(el.value); });

    if (!title) return;

    const editingId = formEl.getAttribute("data-editing-id");
    const isEditing = Boolean(editingId);
    const editOccId = formEl.getAttribute('data-edit-occurrence-id');

    // If repeating, create a template instead of a one-off commitment (unless editing an occurrence).
    if (!isEditing && !editOccId && repeatFreq && repeatFreq !== 'once') {
      const repeatStartISO = dateISO || toISO(addDays(fromISO(state.weekStartISO), dayIndex));
      const tmpl = {
        id: uuid(),
        title,
        deliverable,
        goalId: linkGoal || null,
        startDate: repeatStartISO,
        startTime: time || null,
        durationMins: duration || null,
        estHours,
        color,
        stat,
        repeat: {
          enabled: true,
          freq: repeatFreq,
          interval: repeatInterval,
          byWeekday: repeatWeekdays.length ? repeatWeekdays : undefined,
          byMonthDay: repeatMonthDay || undefined,
          untilISO: repeatUntil || undefined
        }
      };
      if (iconPick === "none") tmpl.icon = "";
      else if (iconPick !== "auto") tmpl.icon = iconPick;
      state.taskTemplates = state.taskTemplates || [];
      state.taskTemplates.push(tmpl);
      saveState();
      closeCommitModal();
      render();
      return;
    }

    // determine target sprint (if dateISO provided, create/get that sprint)
    let targetSprint, targetWeekISO;
    if (dateISO) {
      const res = getOrCreateSprintForISO(dateISO);
      targetSprint = res.sprint;
      targetWeekISO = res.weekStartISO;
    } else {
      targetSprint = getActiveSprint();
      targetWeekISO = state.weekStartISO;
    }

    if (!isEditing && !editOccId && targetSprint.commitments.length >= 7) {
      const n = targetSprint.commitments.length;
      const ok = confirm(`This week is already heavy (${n} tasks). Add anyway?`);
      if (!ok) return;
    }

    if (isEditing) {
      // locate existing commitment across sprints
      const editingIdVal = editingId;
      let found = null;
      Object.values(state.sprints).forEach(sp => {
        const idx = sp.commitments.findIndex(x => x.id === editingIdVal);
        if (idx >= 0) found = { sp, idx };
      });
      if (!found) return;
      const c = found.sp.commitments[found.idx];
      c.title = title;
      c.deliverable = deliverable;
      c.estHours = estHours;
      c.dayIndex = dayIndex;
      c.nextAction = nextAction;
      c.isFocus = isFocus;
      c.color = color;
      if (iconPick === "auto") delete c.icon;
      else if (iconPick === "none") c.icon = "";
      else c.icon = iconPick;
      if (c.canvasAutopilot) c.autopilotPinned = autopilotPinned;
      setCommitDoneStatus(c, done, targetWeekISO);
      if (time) c.startTime = time; else delete c.startTime;
      if (duration) c.durationMins = duration; else delete c.durationMins;
      if (proof) c.proofUrl = proof; else delete c.proofUrl;
      if (dateISO) c.dateISO = dateISO; else delete c.dateISO;
      if (linkGoal) c.linkedPlanIds = [linkGoal]; else c.linkedPlanIds = [];
      c.stat = stat;
      // if moved to a different sprint, move the object
      if (found.sp !== targetSprint) {
        found.sp.commitments.splice(found.idx, 1);
        targetSprint.commitments.push(c);
      }
      // if editing an occurrence override, persist override instead of moving stored commitment
      if (editOccId) {
        // write override for this occurrence
        state.occurrenceOverrides = state.occurrenceOverrides || {};
        state.occurrenceOverrides[editOccId] = state.occurrenceOverrides[editOccId] || {};
        state.occurrenceOverrides[editOccId].title = c.title;
        state.occurrenceOverrides[editOccId].deliverable = c.deliverable;
        state.occurrenceOverrides[editOccId].startTime = c.startTime || null;
        state.occurrenceOverrides[editOccId].durationMins = c.durationMins || null;
        state.occurrenceOverrides[editOccId].color = c.color;
        state.occurrenceOverrides[editOccId].stat = c.stat || "INT";
        if (iconPick === "auto") delete state.occurrenceOverrides[editOccId].icon;
        else if (iconPick === "none") state.occurrenceOverrides[editOccId].icon = "";
        else state.occurrenceOverrides[editOccId].icon = iconPick;
        setOccurrenceDoneStatus(editOccId, done, targetWeekISO);
      }
    } else if (editOccId) {
      const occPatch = {
        title,
        deliverable,
        startTime: time || null,
        durationMins: duration || null,
        color,
        stat
      };
      if (iconPick !== "auto") occPatch.icon = iconPick === "none" ? "" : iconPick;
      else {
        // Clear any existing icon override to fall back to template/inference.
        state.occurrenceOverrides = state.occurrenceOverrides || {};
        if (state.occurrenceOverrides[editOccId]) delete state.occurrenceOverrides[editOccId].icon;
      }
      if (dateISO) occPatch.dateISO = dateISO;
      updateOccurrenceOverride(editOccId, occPatch);
      setOccurrenceDoneStatus(editOccId, done, targetWeekISO);
      finishCommitSubmit({ keepOpen: autoMode });
      return;
    } else {
      const newCommit = {
        id: uuid(),
        title,
        deliverable,
        estHours,
        dayIndex,
        nextAction,
        done: false,
        isFocus,
        color,
        stat
      };
      if (iconPick === "none") newCommit.icon = "";
      else if (iconPick !== "auto") newCommit.icon = iconPick;
      setCommitDoneStatus(newCommit, done, targetWeekISO);
      if (time) newCommit.startTime = time;
      if (duration) newCommit.durationMins = duration;
      if (proof) newCommit.proofUrl = proof;
      if (dateISO) newCommit.dateISO = dateISO;
      if (linkGoal) newCommit.linkedPlanIds = [linkGoal];
      targetSprint.commitments.push(newCommit);
      // if this came from inbox, remove it
      const inboxId = formEl.getAttribute("data-inbox-id");
      if (inboxId) {
        state.inbox = (state.inbox || []).filter(x => x.id !== inboxId);
        formEl.removeAttribute("data-inbox-id");
      }
    }

    finishCommitSubmit({ keepOpen: autoMode });
  };

  // Goal modal close
  const goalModalEl = $("#goalModal");
  if (goalModalEl) {
    goalModalEl.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-close") === "true") closeGoalModal();
    });
  }

  // Goal form submit
  const goalForm = $("#goalForm");
  if (goalForm) {
    goalForm.onsubmit = (e) => {
      e.preventDefault();
      const title = $("#gTitle").value.trim();
      const rawHorizon = String($("#gHorizon").value || '1').trim();
      const horizon = Number(rawHorizon === '' ? 1 : rawHorizon);
      // simple validation: horizon must be an integer >= 0
      const horizonEl = $("#gHorizon");
      const errId = 'gHorizonError';
      const prevErr = document.getElementById(errId);
      if (prevErr && prevErr.parentNode) prevErr.parentNode.removeChild(prevErr);
      if (!Number.isFinite(horizon) || !Number.isInteger(horizon) || horizon < 0) {
        const err = document.createElement('div');
        err.id = errId; err.className = 'field__error'; err.textContent = 'Please enter a whole number of years (0+).';
        horizonEl.parentNode.appendChild(err);
        horizonEl.focus();
        return;
      }
      const notes = $("#gNotes").value.trim();
      const category = $("#gCategory").value || "";
      // collect degree details if applicable
      let degree = null;
      if (category === 'degree') {
        const req = Number($("#gDegreeReq").value || 0);
        const classes = [];
        document.querySelectorAll('#gClassesList .class-row').forEach(row => {
          const nameEl = row.querySelector('.g-class-name');
          const creditsEl = row.querySelector('.g-class-credits');
          const doneEl = row.querySelector('.g-class-completed');
          const name = nameEl ? nameEl.value.trim() : '';
          const credits = creditsEl ? Number(creditsEl.value || 0) : 0;
          const completed = doneEl ? !!doneEl.checked : false;
          if (name || credits) classes.push({ id: row.getAttribute('data-class-id') || uuid(), name, credits, completed });
        });
        degree = { requiredCredits: req, classes };
      }

      // collect health details if applicable
      let health = null;
      if (category === 'health') {
        const subtype = $("#gHealthSubtype").value || 'general';
        const unit = $("#gHealthUnit").value || 'kg';
        const currentValue = Number($("#gHealthCurrent").value || 0);
        const targetValue = Number($("#gHealthTarget").value || 0);
          const measurements = [];
          document.querySelectorAll('#gHealthMeasurementsList .measurement-row').forEach(row => {
            const dateEl = row.querySelector('.g-measure-date');
            const valEl = row.querySelector('.g-measure-value');
            const dateISO = dateEl ? dateEl.value || '' : '';
            const value = valEl ? Number(valEl.value || 0) : 0;
            if (dateISO || value) measurements.push({ id: row.getAttribute('data-measure-id') || uuid(), dateISO, value });
          });
          // derive startValue from earliest measurement if available, otherwise use currentValue
              // allow explicit override from the Start input
              const startRaw = (typeof document !== 'undefined' && document.querySelector) ? String((document.querySelector('#gHealthStart') || {}).value || '').trim() : '';
              let startValue = currentValue;
              if (startRaw !== '') {
                const parsed = Number(startRaw);
                if (Number.isFinite(parsed)) startValue = parsed;
              } else if (measurements.length) {
                // find earliest by dateISO (fallback to first if dates missing)
                const withDates = measurements.filter(m => m.dateISO);
                if (withDates.length) {
                  withDates.sort((a,b) => a.dateISO.localeCompare(b.dateISO));
                  startValue = Number(withDates[0].value || startValue);
                } else {
                  startValue = Number(measurements[0].value || startValue);
                }
              }
              health = { subtype, unit, currentValue, targetValue, measurements, startValue };
      }
      if (!title) return;

      const editingId = $("#goalForm").getAttribute("data-editing-id");
      if (editingId) {
        const idx = (state.longPlans || []).findIndex(x => x.id === editingId);
        if (idx >= 0) {
          state.longPlans[idx].title = title;
          state.longPlans[idx].horizonYears = horizon;
          state.longPlans[idx].notes = notes;
          state.longPlans[idx].category = category;
          if (degree) state.longPlans[idx].degree = degree; else delete state.longPlans[idx].degree;
          if (health) state.longPlans[idx].health = health; else delete state.longPlans[idx].health;
        }
      } else {
        const g = { id: uuid(), title, horizonYears: horizon, notes, category };
        if (degree) g.degree = degree;
        if (health) g.health = health;
        if (!state.longPlans) state.longPlans = [];
        state.longPlans.push(g);
      }
      saveState();
      closeGoalModal();
      render();
    };
  }

  // Add / edit / delete goals
  document.querySelectorAll("[data-add-goal]").forEach(btn => {
    btn.addEventListener("click", () => {
      closeUiDrawer({ persist: false, rerender: false });
      openGoalModal({});
    });
  });
  document.querySelectorAll("[data-edit-goal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit-goal");
      closeUiDrawer({ persist: false, rerender: false });
      openGoalModal({ editId: id });
    });
  });
  document.querySelectorAll("[data-delete-goal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete-goal");
      state.longPlans = (state.longPlans || []).filter(x => x.id !== id);
      // also remove references from commitments
      Object.values(state.sprints).forEach(sp => {
        sp.commitments.forEach(c => {
          if (c.linkedPlanIds) c.linkedPlanIds = c.linkedPlanIds.filter(pid => pid !== id);
        });
      });
      saveState();
      render();
    });
  });

  // Generate plan (rule-based) handler
  document.querySelectorAll('[data-generate-plan]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Generate a lightweight plan from your goals within this sprint budget? This will add commitments to the current week.')) return;
      generatePlanFromGoals();
    });
  });

  // Goal modal helpers: category toggle, add/remove class rows
  const gCat = $("#gCategory");
  if (gCat) {
    gCat.onchange = () => {
      const val = gCat.value;
      const df = $("#degreeFields");
      if (df) df.hidden = val !== 'degree';
      const hf = $("#healthFields");
      if (hf) hf.hidden = val !== 'health';
    };
  }

  const gAdd = $("#gAddClass");
  if (gAdd) {
    gAdd.onclick = () => {
      const list = $("#gClassesList");
      if (!list) return;
      const id = uuid();
      const row = document.createElement('div');
      row.className = 'class-row';
      row.setAttribute('data-class-id', id);
      row.innerHTML = `
        <input class="input g-class-name" placeholder="Course name" value="" />
        <input class="input g-class-credits" type="number" min="0" step="0.5" value="0" />
        <label class="check"><input type="checkbox" class="g-class-completed" />Done</label>
        <button class="smallbtn" type="button" data-remove-class="${id}">Remove</button>
      `;
      list.appendChild(row);
    };
  }

  const gAddMeasure = $("#gAddMeasurement");
  if (gAddMeasure) {
    gAddMeasure.onclick = () => {
      const list = $("#gHealthMeasurementsList");
      if (!list) return;
      const id = uuid();
      const row = document.createElement('div');
      row.className = 'measurement-row';
      row.setAttribute('data-measure-id', id);
      row.innerHTML = `
        <input class="input g-measure-date" type="date" value="" />
        <input class="input g-measure-value" type="number" step="0.1" value="0" />
        <button class="smallbtn" type="button" data-remove-measurement="${id}">Remove</button>
      `;
      list.appendChild(row);
    };
  }

  // One-time delegated handlers for goal modal row removal.
  if (!_goalModalDelegatesAdded) {
    _goalModalDelegatesAdded = true;
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;
      const rmMeasureBtn = t.closest && t.closest('[data-remove-measurement]');
      if (rmMeasureBtn) {
        const id = rmMeasureBtn.getAttribute('data-remove-measurement');
        const row = document.querySelector(`#gHealthMeasurementsList .measurement-row[data-measure-id="${id}"]`);
        if (row && row.parentNode) row.parentNode.removeChild(row);
        return;
      }
      const rmClassBtn = t.closest && t.closest('[data-remove-class]');
      if (rmClassBtn) {
        const id = rmClassBtn.getAttribute('data-remove-class');
        const row = document.querySelector(`#gClassesList .class-row[data-class-id="${id}"]`);
        if (row && row.parentNode) row.parentNode.removeChild(row);
      }
    });
  }

  // Inbox assign/delete handlers (rendered items)
  document.querySelectorAll('[data-assign-inbox]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-assign-inbox');
      const it = (state.inbox || []).find(x => x.id === id);
      if (!it) return;
      // open commit modal prefilled, default to today if current week
      closeUiDrawer({ persist: false, rerender: false });
      openCommitModal({ prefill: { title: it.title, deliverable: it.deliverable || '', estHours: it.estHours || 0, inboxId: it.id, dayIndex: clampDayIndexForDefault() } });
    });
  });
  document.querySelectorAll('[data-delete-inbox]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-inbox');
      state.inbox = (state.inbox || []).filter(x => x.id !== id);
      saveState();
      render();
    });
  });

  // Today's focus start button
  document.querySelectorAll('[data-start-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-start-id');
      const sprint = getActiveSprint();
      const c = sprint.commitments.find(x => x.id === id);
      if (!c) return;
      // toggle start / stop
      if (c.started) delete c.started; else c.started = Date.now();
      saveState();
      render();
    });
  });

  // Plan timeline navigation (prev day, next day, date picker)
  const planPrevBtn = $("#planPrevDay");
  if (planPrevBtn) {
    planPrevBtn.onclick = () => {
      const picker = $("#planDatePicker");
      const currentDateISO = (picker && picker.value) || state.planTimelineDate || state.weekStartISO || toISO(getWeekStart(new Date()));
      const d = addDays(fromISO(currentDateISO), -1);
      state.planTimelineDate = toISO(d);
      saveState();
      render();
    };
  }

  const planNextBtn = $("#planNextDay");
  if (planNextBtn) {
    planNextBtn.onclick = () => {
      const picker = $("#planDatePicker");
      const currentDateISO = (picker && picker.value) || state.planTimelineDate || state.weekStartISO || toISO(getWeekStart(new Date()));
      const d = addDays(fromISO(currentDateISO), 1);
      state.planTimelineDate = toISO(d);
      saveState();
      render();
    };
  }

  const planDatePicker = $("#planDatePicker");
  if (planDatePicker) {
    planDatePicker.addEventListener("change", () => {
      const dateISO = planDatePicker.value;
      if (dateISO) {
        state.planTimelineDate = dateISO;
        saveState();
        render();
      }
    });
  }
  const planTodayBtn = $("#planJumpToday");
  if (planTodayBtn) {
    planTodayBtn.onclick = () => {
      const today = new Date();
      state.planTimelineDate = toISO(today);
      state.weekStartISO = toISO(getWeekStart(today));
      saveState();
      render();
    };
  }
  const planQuickAddBtn = $("#planQuickAddTask");
  if (planQuickAddBtn) {
    planQuickAddBtn.onclick = () => {
      const picker = $("#planDatePicker");
      const dateISO = (picker && picker.value) || state.planTimelineDate || toISO(new Date());
      let dayIndex = clampDayIndexForDefault();
      try {
        const weekStartISO = state.weekStartISO || toISO(getWeekStart(new Date()));
        dayIndex = clampDay(dayIndexForDate(fromISO(weekStartISO), fromISO(dateISO)));
      } catch (_) { /* fallback to default day */ }
      openCommitModal({ dayIndex, prefill: { dateISO } });
    };
  }

  // Plan mode toggle
  document.querySelectorAll('[data-plan-mode]').forEach(btn => {
    btn.onclick = () => {
      const mode = btn.getAttribute('data-plan-mode');
      if (!mode) return;
      state.planMode = mode;
      saveState();
      render();
    };
  });

  // Enforcement panel (Home)
  const enfSaveBtn = $("#enfSaveBtn");
  if (enfSaveBtn) {
    enfSaveBtn.onclick = () => {
      saveEnforcementSettingsFromUi({ rerender: true, allowHardListClear: true });
    };
  }
  const enfStartSessionBtn = $("#enfStartSessionBtn");
  if (enfStartSessionBtn) {
    enfStartSessionBtn.onclick = () => {
      const ok = saveEnforcementSettingsFromUi({ rerender: false });
      if (!ok) return;
      startManualEnforcementSession();
    };
  }
  const enfFreezeSessionBtn = $("#enfFreezeSessionBtn");
  if (enfFreezeSessionBtn) {
    enfFreezeSessionBtn.onclick = () => {
      const ok = saveEnforcementSettingsFromUi({ rerender: false, allowDuringFrozen: true });
      if (!ok) return;
      const mins = Number(state.enforcement.freezeDurationMins || state.enforcement.sessionDurationMins || 60);
      const sessionMins = Number(state.enforcement.sessionDurationMins || mins);
      const untilTs = Date.now() + (sessionMins * 60 * 1000);
      state.enforcement.enabled = true;
      state.enforcement.sessionUntilTs = untilTs;
      state.enforcement.runtime.frozenUntilTs = Date.now() + (Math.max(mins, sessionMins) * 60 * 1000);
      pushEnforcementLog({
        stage: "freeze",
        reason: `Frozen session started (${Math.max(mins, sessionMins)}m).`,
        process: "trajectory",
        title: "",
        action: "freeze-start"
      });
      saveState();
      ensureEnforcementTicker();
      render();
    };
  }
  const enfStopSessionBtn = $("#enfStopSessionBtn");
  if (enfStopSessionBtn) {
    enfStopSessionBtn.onclick = () => {
      stopManualEnforcementSession();
    };
  }
  const enfUnfreezeBtn = $("#enfUnfreezeBtn");
  if (enfUnfreezeBtn) {
    enfUnfreezeBtn.onclick = () => {
      if (!unfreezeEnforcementNow()) {
        alert("Frozen timer is still running. You can unfreeze after it ends.");
      }
    };
  }
  const enfResetRuntimeBtn = $("#enfResetRuntimeBtn");
  if (enfResetRuntimeBtn) {
    enfResetRuntimeBtn.onclick = () => {
      if (!confirm("Reset Hard Mode strikes, lockout timer, and block timer?")) return;
      resetEnforcementRuntime();
      render();
    };
  }
  const enfClearLogBtn = $("#enfClearLogBtn");
  if (enfClearLogBtn) {
    enfClearLogBtn.onclick = () => {
      if (!confirm("Clear blocker history log?")) return;
      state.enforcementLog = [];
      saveState();
      render();
    };
  }
  const enfOpenBrowserExtensionsPageBtn = $("#enfOpenBrowserExtensionsPageBtn");
  if (enfOpenBrowserExtensionsPageBtn) {
    enfOpenBrowserExtensionsPageBtn.onclick = () => {
      const selectedBrowser = String(
        ($("#enfExtensionGuardBrowser") && $("#enfExtensionGuardBrowser").value)
        || (state.enforcement && state.enforcement.extensionGuard && state.enforcement.extensionGuard.browser)
        || "chrome"
      ).toLowerCase();
      const opened = openBrowserExtensionsPage(selectedBrowser);
      if (!opened) alert("Could not open the browser extensions manager automatically.");
    };
  }
  const enfOpenBrowserExtensionFolderBtn = $("#enfOpenBrowserExtensionFolderBtn");
  if (enfOpenBrowserExtensionFolderBtn) {
    enfOpenBrowserExtensionFolderBtn.onclick = () => {
      const dir = getBrowserBlockerExtensionDir();
      if (!dir || !fsSafe || !fsSafe.existsSync(dir)) {
        alert("Extension folder not found in app files.");
        return;
      }
      const opened = openFolderPathSafe(dir);
      if (!opened) alert("Could not open extension folder automatically.");
    };
  }
  const enfExportBrowserExtensionProfileBtn = $("#enfExportBrowserExtensionProfileBtn");
  if (enfExportBrowserExtensionProfileBtn) {
    enfExportBrowserExtensionProfileBtn.onclick = () => {
      saveEnforcementSettingsFromUi({ rerender: false, allowDuringFrozen: true, allowHardListClear: true });
      const result = exportBrowserBlockerProfileToDisk();
      if (!result.ok) {
        alert(`Profile export failed: ${result.error || "Unknown error"}`);
        return;
      }
      openFolderPathSafe(pathSafe && pathSafe.dirname ? pathSafe.dirname(result.path) : "");
      alert(`Extension profile exported:\n${result.path}`);
    };
  }

  const settingsOpenBrowserExtensionsPageBtn = $("#settingsOpenBrowserExtensionsPageBtn");
  if (settingsOpenBrowserExtensionsPageBtn) {
    settingsOpenBrowserExtensionsPageBtn.onclick = () => {
      ensureEnforcementStateShape();
      const selectedBrowser = String(
        (state.enforcement && state.enforcement.extensionGuard && state.enforcement.extensionGuard.browser) || "chrome"
      ).toLowerCase();
      const opened = openBrowserExtensionsPage(selectedBrowser);
      if (!opened) alert("Could not open the browser extensions manager automatically.");
    };
  }
  const settingsOpenBrowserExtensionFolderBtn = $("#settingsOpenBrowserExtensionFolderBtn");
  if (settingsOpenBrowserExtensionFolderBtn) {
    settingsOpenBrowserExtensionFolderBtn.onclick = () => {
      const dir = getBrowserBlockerExtensionDir();
      if (!dir || !fsSafe || !fsSafe.existsSync(dir)) {
        alert("Extension folder not found in app files.");
        return;
      }
      const opened = openFolderPathSafe(dir);
      if (!opened) alert("Could not open extension folder automatically.");
    };
  }
  const settingsExportBrowserExtensionProfileBtn = $("#settingsExportBrowserExtensionProfileBtn");
  if (settingsExportBrowserExtensionProfileBtn) {
    settingsExportBrowserExtensionProfileBtn.onclick = () => {
      const result = exportBrowserBlockerProfileToDisk();
      if (!result.ok) {
        alert(`Profile export failed: ${result.error || "Unknown error"}`);
        return;
      }
      openFolderPathSafe(pathSafe && pathSafe.dirname ? pathSafe.dirname(result.path) : "");
      alert(`Extension profile exported:\n${result.path}`);
    };
  }
  document.querySelectorAll("[data-enf-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.enforcement && state.enforcement.strictMode && isFrozenNow()) {
        alert("Frozen mode is active. Presets are locked until freeze ends.");
        return;
      }
      const id = btn.getAttribute("data-enf-preset");
      const preset = getEnforcementPresets().find(p => p.id === id);
      if (!preset) return;
      mergeEnforcementPatch(preset.patch || {});
      pushEnforcementLog({
        stage: "preset",
        reason: `Preset applied: ${preset.label}`,
        process: "trajectory",
        title: "",
        action: "preset"
      });
      saveState();
      ensureEnforcementTicker();
      render();
    });
  });

  const canvasSyncSaveBtn = $("#canvasSyncSaveBtn");
  if (canvasSyncSaveBtn) {
    canvasSyncSaveBtn.onclick = () => {
      saveCanvasSyncSettingsFromUi({ rerender: true });
    };
  }
  const canvasSyncNowBtn = $("#canvasSyncNowBtn");
  if (canvasSyncNowBtn) {
    canvasSyncNowBtn.onclick = async () => {
      saveCanvasSyncSettingsFromUi({ rerender: false });
      canvasSyncNowBtn.disabled = true;
      const prevText = canvasSyncNowBtn.textContent;
      canvasSyncNowBtn.textContent = "Syncing...";
      try {
        const result = await syncCanvasFeeds({ manual: true });
        const message = result && result.message ? result.message : "Canvas sync finished.";
        alert(message);
      } catch (err) {
        alert(`Canvas sync failed: ${String(err && err.message ? err.message : err || "Unknown error")}`);
      } finally {
        canvasSyncNowBtn.disabled = false;
        canvasSyncNowBtn.textContent = prevText || "Sync Now";
      }
    };
  }
  const canvasAutopilotRunBtn = $("#canvasAutopilotRunNowBtn");
  if (canvasAutopilotRunBtn) {
    canvasAutopilotRunBtn.onclick = async () => {
      saveCanvasSyncSettingsFromUi({ rerender: false });
      canvasAutopilotRunBtn.disabled = true;
      const prevText = canvasAutopilotRunBtn.textContent;
      canvasAutopilotRunBtn.textContent = "Running...";
      try {
        const result = runCanvasAutopilot({ manual: true, save: true, rerender: true });
        const message = result && result.message ? result.message : "Autopilot run finished.";
        alert(message);
      } catch (err) {
        alert(`Autopilot failed: ${String(err && err.message ? err.message : err || "Unknown error")}`);
      } finally {
        canvasAutopilotRunBtn.disabled = false;
        canvasAutopilotRunBtn.textContent = prevText || "Run Autopilot Now";
      }
    };
  }
  [
    "#canvasSyncEnabled",
    "#canvasSyncAutoMins",
    "#canvasSyncAssignmentsOnly",
    "#canvasAutopilotEnabled",
    "#canvasAutopilotLeadDays",
    "#canvasAutopilotBlockMins",
    "#canvasAutopilotMaxBlocks",
    "#canvasFeedEnabled_alamo",
    "#canvasFeedEnabled_utsa",
    "#canvasFeedColor_alamo",
    "#canvasFeedColor_utsa"
  ].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener("change", () => {
      saveCanvasSyncSettingsFromUi({ rerender: sel.includes("FeedColor") });
    });
  });
  [
    "#canvasFeedUrl_alamo",
    "#canvasFeedUrl_utsa"
  ].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener("blur", () => {
      saveCanvasSyncSettingsFromUi({ rerender: false });
    });
  });
  document.querySelectorAll("[data-canvas-open-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      ensureCanvasSyncStateShape();
      const id = String(btn.getAttribute("data-canvas-open-page") || "").trim().toLowerCase();
      if (!id) return;
      const feed = (state.canvasSync.feeds || []).find(f => String(f.id || "").toLowerCase() === id);
      if (!feed || !feed.pageUrl) return;
      openUrlInSystemBrowser(feed.pageUrl);
    });
  });
  document.querySelectorAll("[data-canvas-paste-link]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = String(btn.getAttribute("data-canvas-paste-link") || "").trim().toLowerCase();
      if (!id) return;
      const input = $(`#canvasFeedUrl_${id}`);
      if (!input) return;
      const clipboardText = readTextFromClipboardSafe();
      const candidate = extractFirstUrlCandidate(clipboardText);
      if (!candidate) {
        alert("Clipboard does not contain a link. Copy your Canvas Calendar Feed link, then click Paste Link.");
        return;
      }
      input.value = candidate;
      saveCanvasSyncSettingsFromUi({ rerender: false });
    });
  });

  const drawerSavePrivateGroup = $("#drawerSavePrivateGroup");
  if (drawerSavePrivateGroup) {
    drawerSavePrivateGroup.onclick = () => {
      ensureEnforcementStateShape();
      const cfg = state.enforcement;
      if (cfg.strictMode && isFrozenNow()) {
        alert("Frozen mode is active. These rules are locked until freeze ends.");
        return;
      }
      const incoming = normalizePornGroupConfig(cfg.pornGroup, cfg.pornKeywords);
      incoming.enabled = !!($("#drawerPornGroupEnabled") && $("#drawerPornGroupEnabled").checked);
      incoming.alwaysOn = !!($("#drawerPornGroupAlwaysOn") && $("#drawerPornGroupAlwaysOn").checked);
      incoming.blockedDomains = uniqLowerList($("#drawerPornDomains") ? $("#drawerPornDomains").value : incoming.blockedDomains);
      incoming.blockedKeywords = uniqLowerList($("#drawerPornBlockedKeywords") ? $("#drawerPornBlockedKeywords").value : incoming.blockedKeywords);
      incoming.blockedSearchTerms = uniqLowerList($("#drawerPornSearchTerms") ? $("#drawerPornSearchTerms").value : incoming.blockedSearchTerms);
      incoming.customKeywords = uniqLowerList($("#drawerPornCustomKeywords") ? $("#drawerPornCustomKeywords").value : incoming.customKeywords);
      cfg.pornGroup = normalizePornGroupConfig(incoming, incoming.customKeywords);
      cfg.pornBlockEnabled = !!cfg.pornGroup.enabled;
      cfg.pornKeywords = uniqLowerList(cfg.pornGroup.customKeywords || []);
      saveState();
      ensureEnforcementTicker();
      closeUiDrawer({ persist: false, rerender: false });
      render();
    };
  }

  const drawerSaveSoftHardRules = $("#drawerSaveSoftHardRules");
  if (drawerSaveSoftHardRules) {
    drawerSaveSoftHardRules.onclick = () => {
      ensureEnforcementStateShape();
      const cfg = state.enforcement;
      if (cfg.strictMode && isFrozenNow()) {
        alert("Frozen mode is active. These rules are locked until freeze ends.");
        return;
      }
      cfg.blockedProcesses = uniqLowerList($("#drawerBlockedProcesses") ? $("#drawerBlockedProcesses").value : cfg.blockedProcesses)
        .map(normalizeProcessName)
        .filter(Boolean);
      cfg.blockedTitleKeywords = uniqLowerList($("#drawerBlockedKeywords") ? $("#drawerBlockedKeywords").value : cfg.blockedTitleKeywords);
      cfg.hardBlockedProcesses = uniqLowerList($("#drawerHardBlockedProcesses") ? $("#drawerHardBlockedProcesses").value : cfg.hardBlockedProcesses)
        .map(normalizeProcessName)
        .filter(Boolean);
      cfg.hardBlockedKeywords = uniqLowerList($("#drawerHardBlockedKeywords") ? $("#drawerHardBlockedKeywords").value : cfg.hardBlockedKeywords);
      cfg.allowlistedTitleKeywords = uniqLowerList($("#drawerAllowlistKeywords") ? $("#drawerAllowlistKeywords").value : cfg.allowlistedTitleKeywords);
      cfg.allowlistedProcesses = uniqLowerList($("#drawerAllowlistProcesses") ? $("#drawerAllowlistProcesses").value : cfg.allowlistedProcesses)
        .map(normalizeProcessName)
        .filter(Boolean);
      saveState();
      ensureEnforcementTicker();
      closeUiDrawer({ persist: false, rerender: false });
      render();
    };
  }

  const drawerSaveYoutubeRules = $("#drawerSaveYoutubeRules");
  if (drawerSaveYoutubeRules) {
    drawerSaveYoutubeRules.onclick = () => {
      ensureEnforcementStateShape();
      const cfg = state.enforcement;
      if (cfg.strictMode && isFrozenNow()) {
        alert("Frozen mode is active. These rules are locked until freeze ends.");
        return;
      }
      cfg.youtube = cfg.youtube || cloneJson(getDefaultEnforcementState().youtube);
      cfg.prompts = cfg.prompts || cloneJson(getDefaultEnforcementState().prompts);
      cfg.youtube.enabled = !!($("#drawerYoutubeEnabled") && $("#drawerYoutubeEnabled").checked);
      cfg.youtube.requireIntentCheck = !!($("#drawerYoutubeIntent") && $("#drawerYoutubeIntent").checked);
      cfg.youtube.allowMinutes = toBoundedInt(
        $("#drawerYoutubeAllowMins") ? $("#drawerYoutubeAllowMins").value : cfg.youtube.allowMinutes,
        1,
        180,
        cfg.youtube.allowMinutes
      );
      cfg.youtube.allowKeywords = uniqLowerList(
        $("#drawerYoutubeAllowKeywords") ? $("#drawerYoutubeAllowKeywords").value : cfg.youtube.allowKeywords
      );
      cfg.prompts.youtubeIntentQuestion = String(
        ($("#drawerYoutubeIntentQuestion") && $("#drawerYoutubeIntentQuestion").value) || cfg.prompts.youtubeIntentQuestion
      ).trim() || getDefaultEnforcementState().prompts.youtubeIntentQuestion;
      saveState();
      ensureEnforcementTicker();
      closeUiDrawer({ persist: false, rerender: false });
      render();
    };
  }

  document.querySelectorAll("[data-theme-set]").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = String(btn.getAttribute("data-theme-set") || "").toLowerCase();
      if (!THEME_OPTIONS.has(next)) return;
      setTheme(next, { persist: true, rerender: true });
    });
  });

  [
    "#enfEnabled",
    "#enfAlwaysOn",
    "#enfStrictMode",
    "#enfTone",
    "#enfWebsiteMode",
    "#enfPollSecs",
    "#enfSoftNudgeSecs",
    "#enfStartTime",
    "#enfEndTime",
    "#enfSessionMins",
    "#enfFreezeMins",
    "#enfYoutubeEnabled",
    "#enfYoutubeIntentEnabled",
    "#enfYoutubeAllowMins",
    "#enfPornGroupEnabled",
    "#enfPornGroupAlwaysOn",
    "#enfExtensionGuardEnabled",
    "#enfExtensionGuardBrowser",
    "#enfExtensionGuardRequireInstalled",
    "#enfExtensionGuardCheckSecs",
    "#enfNudgeAfter",
    "#enfLockoutAfter",
    "#enfBlockAfter",
    "#enfCooldownMins",
    "#enfLockoutMins",
    "#enfBlockMins",
    "#enfKillOnBlock"
  ].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener("change", () => {
      saveEnforcementSettingsFromUi({ rerender: true });
    });
  });
  [
    "#enfYoutubeAllowKeywords",
    "#enfPornDomains",
    "#enfPornBlockedKeywords",
    "#enfPornSearchTerms",
    "#enfPornCustomKeywords",
    "#enfBlockedProcesses",
    "#enfBlockedKeywords",
    "#enfAllowlistKeywords",
    "#enfAllowlistProcesses",
    "#enfPromptYoutubeQuestion",
    "#enfPromptNormalNudge",
    "#enfPromptNormalLockout",
    "#enfPromptNormalBlock",
    "#enfPromptHardNudge",
    "#enfPromptHardLockout",
    "#enfPromptHardBlock"
  ].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener("blur", () => {
      saveEnforcementSettingsFromUi({ rerender: false });
    });
  });
  document.querySelectorAll("[data-enf-day]").forEach(chk => {
    chk.addEventListener("change", () => {
      saveEnforcementSettingsFromUi({ rerender: true });
    });
  });
  let _enfDraftSaveTimer = null;
  function scheduleEnfDraftSave() {
    if (state.enforcement && state.enforcement.strictMode && isFrozenNow()) return;
    if (_enfDraftSaveTimer) clearTimeout(_enfDraftSaveTimer);
    _enfDraftSaveTimer = setTimeout(() => {
      saveEnforcementSettingsFromUi({ rerender: false, allowDuringFrozen: true });
    }, 260);
  }
  [
    "#enfBlockedProcesses",
    "#enfBlockedKeywords",
    "#enfPornDomains",
    "#enfPornBlockedKeywords",
    "#enfPornSearchTerms",
    "#enfPornCustomKeywords",
    "#enfAllowlistKeywords",
    "#enfAllowlistProcesses"
  ].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener("input", scheduleEnfDraftSave);
  });

  [
    "#enfHardBlockedProcesses",
    "#enfHardBlockedKeywords"
  ].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener("input", () => {
      saveEnforcementSettingsFromUi({ rerender: false, allowDuringFrozen: true });
    });
    el.addEventListener("blur", () => {
      saveEnforcementSettingsFromUi({ rerender: false });
    });
  });

  // Enforcement overlay actions
  const enfIntentBtn = $("#enfSubmitIntentBtn");
  if (enfIntentBtn) {
    enfIntentBtn.onclick = () => {
      submitYouTubeIntentFromOverlay();
      render();
    };
  }
  const enfIntentInput = $("#enfIntentInput");
  if (enfIntentInput) {
    enfIntentInput.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submitYouTubeIntentFromOverlay();
        render();
      }
    });
  }
  const enfAckBtn = $("#enfAcknowledgeBtn");
  if (enfAckBtn) {
    enfAckBtn.onclick = () => {
      clearEnforcementOverlay();
    };
  }
  const enfHardRecheckBtn = $("#enfHardRecheckBtn");
  if (enfHardRecheckBtn) {
    enfHardRecheckBtn.onclick = () => {
      void tickHardBlockLoop({ forceRecheck: true });
    };
  }
  const enfDismissBtn = $("#enfDismissOverlayBtn");
  if (enfDismissBtn) {
    enfDismissBtn.onclick = () => {
      clearEnforcementOverlay();
    };
  }

  // Keyboard shortcuts: only bind once (wireHandlers runs on every render).
  if (!_globalShortcutHandlersAdded) {
    _globalShortcutHandlersAdded = true;
    document.addEventListener('keydown', (e) => {
      const key = e.key && e.key.toLowerCase && e.key.toLowerCase();
      if (key === 'tab') {
        ensureUiStateShape();
        if (state.ui.drawer && state.ui.drawer.open) {
          const anyModalOpen = document.querySelector && document.querySelector('.modal:not([hidden])');
          if (!anyModalOpen) {
            const panel = document.querySelector('#uiDrawerRoot .ui-drawer__panel');
            if (panel) {
              const focusable = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex=\"-1\"])';
              const nodes = Array.from(panel.querySelectorAll(focusable)).filter(n => n.offsetParent !== null && !n.disabled);
              if (nodes.length) {
                const first = nodes[0];
                const last = nodes[nodes.length - 1];
                const active = document.activeElement;
                const isInside = active && panel.contains(active);
                if (e.shiftKey) {
                  if (!isInside || active === first) { e.preventDefault(); last.focus(); }
                } else {
                  if (!isInside || active === last) { e.preventDefault(); first.focus(); }
                }
              }
            }
          }
        }
      }
      if (key === 'escape') {
        ensureUiStateShape();
        if (state.ui.drawer && state.ui.drawer.open) {
          e.preventDefault();
          closeUiDrawer();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'a') {
        e.preventDefault();
        ensureUiStateShape();
        if (state.ui.drawer && state.ui.drawer.open) {
          closeUiDrawer();
          setTimeout(() => openCommitModal({ dayIndex: clampDayIndexForDefault() }), 0);
          return;
        }
        openCommitModal({ dayIndex: clampDayIndexForDefault() });
      }
    });
  }

  // Drawer autofocus (only on open/kind change)
  ensureUiStateShape();
  const drawer = state.ui.drawer || { open: false, kind: "" };
  const kind = String(drawer.kind || "");
  if (drawer.open) {
    if (!_lastDrawerOpen || _lastDrawerKind !== kind) {
      setTimeout(() => {
        const closeBtn = document.querySelector('#uiDrawerRoot .ui-drawer__header [data-ui-close-drawer]');
        if (closeBtn && closeBtn.focus) closeBtn.focus();
      }, 0);
    }
    _lastDrawerOpen = true;
    _lastDrawerKind = kind;
  } else {
    _lastDrawerOpen = false;
    _lastDrawerKind = "";
  }
}

// Initialize Day Tracker handlers (delegation + now-line clock)
function initDayTracker() {
  if (_dayTrackerHandlersAdded) return;
  _dayTrackerHandlersAdded = true;

  // Delegated click handling for day tracker controls and markers
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    if (_planDragSuppressClick) { _planDragSuppressClick = false; return; }

    const uiDrawerCloseBtn = t.closest && t.closest('[data-ui-close-drawer]');
    if (uiDrawerCloseBtn) {
      closeUiDrawer();
      return;
    }
    const uiDrawerOpenBtn = t.closest && t.closest('[data-ui-open-drawer]');
    if (uiDrawerOpenBtn) {
      const kind = uiDrawerOpenBtn.getAttribute('data-ui-open-drawer');
      if (!kind) return;
      let payload = null;
      const rawPayload = uiDrawerOpenBtn.getAttribute('data-ui-drawer-payload');
      if (rawPayload) {
        try { payload = JSON.parse(rawPayload); } catch (_) { payload = { raw: rawPayload }; }
      }
      openUiDrawer(kind, payload);
      return;
    }
    const uiCollapseBtn = t.closest && t.closest('[data-ui-collapse]');
    if (uiCollapseBtn) {
      const key = uiCollapseBtn.getAttribute('data-ui-collapse');
      const current = getUiCollapsed(key, false);
      setUiCollapsed(key, !current);
      render();
      return;
    }
    const blockerSubtabBtn = t.closest && t.closest('[data-blocker-subtab]');
    if (blockerSubtabBtn) {
      const tab = String(blockerSubtabBtn.getAttribute('data-blocker-subtab') || '').toLowerCase();
      if (!BLOCKER_SUBTABS.has(tab)) return;
      ensureUiStateShape();
      state.ui.blockerSubtab = tab;
      saveState();
      render();
      return;
    }

    const planDeleteBtn = t.closest && t.closest('[data-plan-delete-id]');
    if (planDeleteBtn) {
      const id = planDeleteBtn.getAttribute('data-plan-delete-id');
      if (!id) return;
      if (!confirm('Delete this task?')) return;
      if (deleteCommitById(id)) {
        saveState();
        render();
      }
      return;
    }
    const planDeleteOccBtn = t.closest && t.closest('[data-plan-delete-occ]');
    if (planDeleteOccBtn) {
      const occId = planDeleteOccBtn.getAttribute('data-plan-delete-occ');
      if (!occId) return;
      if (!confirm('Delete this occurrence?')) return;
      deleteOccurrenceById(occId);
      saveState();
      render();
      return;
    }
    const planFocusBtn = t.closest && t.closest('[data-plan-focus-id]');
    if (planFocusBtn) {
      const id = planFocusBtn.getAttribute('data-plan-focus-id');
      if (!id) return;
      const c = findCommitmentById(id);
      if (c) {
        c.isFocus = !c.isFocus;
        saveState();
        render();
      }
      return;
    }
    const planTrimToggle = t.closest && t.closest('[data-plan-trim-toggle]');
    if (planTrimToggle) {
      state.ui = state.ui || {};
      state.ui.planTrimOpen = !state.ui.planTrimOpen;
      saveState();
      render();
      return;
    }
    const planScheduleBtn = t.closest && t.closest('[data-plan-schedule-id]');
    if (planScheduleBtn) {
      const id = planScheduleBtn.getAttribute('data-plan-schedule-id');
      const dateISO = planScheduleBtn.getAttribute('data-plan-date');
      scheduleCommitOnTimeline(id, dateISO);
      return;
    }
    const planScheduleOccBtn = t.closest && t.closest('[data-plan-schedule-occ]');
    if (planScheduleOccBtn) {
      const occId = planScheduleOccBtn.getAttribute('data-plan-schedule-occ');
      const dateISO = planScheduleOccBtn.getAttribute('data-plan-date');
      scheduleOccurrenceOnTimeline(occId, dateISO);
      return;
    }
    const planEditBtn = t.closest && t.closest('[data-plan-edit-id]');
    if (planEditBtn) {
      const id = planEditBtn.getAttribute('data-plan-edit-id');
      if (id) openCommitModal({ editId: id });
      return;
    }
    const planEditOccBtn = t.closest && t.closest('[data-plan-edit-occ]');
    if (planEditOccBtn) {
      const occId = planEditOccBtn.getAttribute('data-plan-edit-occ');
      if (occId) {
        const parts = occId.split(':');
        const tmplId = parts[0];
        const dateISO = parts.slice(1).join(':');
        const occs = getOccurrencesForRange(dateISO, dateISO);
        const o = occs.find(x => x.occurrenceId === occId || (x.templateId === tmplId && x.dateISO === dateISO));
        if (o) openCommitModal({ prefill: { title: o.title, deliverable: o.deliverable, estHours: 0, dateISO: o.dateISO, startTime: o.startTime, durationMins: o.durationMins || null, occurrenceId: occId, templateId: tmplId } });
      }
      return;
    }

    const planBlock = t.closest && t.closest('.timeline__block');
    if (planBlock && planBlock.closest && planBlock.closest('.plan-timeline')) {
      const occId = planBlock.getAttribute('data-occurrence-id');
      if (occId) {
        const parts = occId.split(':');
        const tmplId = parts[0];
        const dateISO = parts.slice(1).join(':');
        const occs = getOccurrencesForRange(dateISO, dateISO);
        const o = occs.find(x => x.occurrenceId === occId || (x.templateId === tmplId && x.dateISO === dateISO));
        if (o) openCommitModal({ prefill: { title: o.title, deliverable: o.deliverable, estHours: 0, dateISO: o.dateISO, startTime: o.startTime, durationMins: o.durationMins || null, occurrenceId: occId, templateId: tmplId } });
        return;
      }
      const commitId = planBlock.getAttribute('data-commit-id');
      if (commitId) openCommitModal({ editId: commitId });
      return;
    }

    if (t.id === 'btnPrevDay_home') {
      const d = addDays(fromISO(state.dayViewDateISO || toISO(new Date())), -1);
      state.dayViewDateISO = toISO(d); saveState(); render(); return;
    }
    if (t.id === 'btnNextDay_home') {
      const d = addDays(fromISO(state.dayViewDateISO || toISO(new Date())), 1);
      state.dayViewDateISO = toISO(d); saveState(); render(); return;
    }
    if (t.id === 'btnTodayDay_home') {
      state.dayViewDateISO = toISO(new Date()); saveState(); render(); return;
    }

    const openCommitBtn = t.closest && t.closest('[data-open-commit]');
    if (openCommitBtn) {
      const id = openCommitBtn.getAttribute('data-open-commit');
      if (id) openCommitModal({ editId: id });
      return;
    }
    const openOccBtn = t.closest && t.closest('[data-open-occurrence]');
    if (openOccBtn) {
      const occId = openOccBtn.getAttribute('data-open-occurrence');
      if (occId) openOccurrenceModalById(occId);
      return;
    }

    const occElem = t.closest && t.closest('[data-occurrence-id]');
    if (occElem) {
      const occId = occElem.getAttribute('data-occurrence-id');
      if (occId) {
        const parts = occId.split(':');
        const tmplId = parts[0];
        const dateISO = parts.slice(1).join(':');
        const occs = getOccurrencesForRange(dateISO, dateISO);
        const o = occs.find(x => x.occurrenceId === occId || (x.templateId === tmplId && x.dateISO === dateISO));
        if (o) openCommitModal({ prefill: { title: o.title, deliverable: o.deliverable, estHours: 0, dateISO: o.dateISO, startTime: o.startTime, durationMins: o.durationMins || null, occurrenceId: occId, templateId: tmplId } });
        return;
      }
    }
    const marker = t.closest && t.closest('.marker');
    if (marker) {
      const occId = marker.getAttribute('data-occurrence-id');
      if (occId) {
        const parts = occId.split(':');
        const tmplId = parts[0];
        const dateISO = parts.slice(1).join(':');
        const occs = getOccurrencesForRange(dateISO, dateISO);
        const o = occs.find(x => x.occurrenceId === occId || (x.templateId === tmplId && x.dateISO === dateISO));
        if (o) openCommitModal({ prefill: { title: o.title, deliverable: o.deliverable, estHours: 0, dateISO: o.dateISO, startTime: o.startTime, durationMins: o.durationMins || null, occurrenceId: occId, templateId: tmplId } });
        return;
      }
      const commitId = marker.getAttribute('data-commit-id');
      if (commitId) openCommitModal({ editId: commitId });
      return;
    }

    const timeline = t.closest && t.closest('.timeline');
    if (timeline) {
      const isPlan = timeline.classList && timeline.classList.contains('plan-timeline');
      const rect = timeline.getBoundingClientRect();
      const pct = isPlan
        ? Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        : Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const minutes = Math.round(pct * 1440);
      const hh = String(Math.floor(minutes / 60)).padStart(2,'0');
      const mm = String(minutes % 60).padStart(2,'0');
      const selectedDate = timeline.getAttribute('data-date') || state.dayViewDateISO || toISO(new Date());
      // open commit modal with date prefilled
      openCommitModal({ prefill: { title: '', deliverable: '', estHours: 2, dateISO: selectedDate, startTime: `${hh}:${mm}` } });
      return;
    }
  });

  // Now-line updater
  function updateNowLine() {
    const el = document.querySelector('#dayTrackerNow');
    if (!el) return;
    const parentDate = document.querySelector('#dayTracker')?.getAttribute('data-date');
    const todayISO = toISO(new Date());
    if (parentDate !== todayISO) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    el.style.left = ((minutes / 1440) * 100) + '%';
  }

  // manage clock lifecycle via visibilitychange and render calls
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.view === 'home') {
      if (!_dayTrackerClockId) {
        updateNowLine();
        _dayTrackerClockId = setInterval(updateNowLine, 60 * 1000);
      }
    } else {
      if (_dayTrackerClockId) { clearInterval(_dayTrackerClockId); _dayTrackerClockId = null; }
    }
  });

  // Trigger immediate update when initialized
  if (state.view === 'home') {
    updateNowLine();
    if (!_dayTrackerClockId) _dayTrackerClockId = setInterval(updateNowLine, 60 * 1000);
  }
}

// Plan timeline drag + resize (structured-like)
function initPlanTimelineHandlers() {
  if (_planTimelineHandlersAdded) return;
  _planTimelineHandlersAdded = true;

  const minutesFromPointer = (clientY, rect) => {
    const pct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return clampMinutes(pct * 1440, 0, 1440);
  };

  document.addEventListener('pointerdown', (e) => {
    const block = e.target && e.target.closest ? e.target.closest('.timeline__block') : null;
    if (!block || !block.closest || !block.closest('.plan-timeline')) return;
    if (e.target && e.target.closest && e.target.closest('.timeline__block-delete')) return;
    if (e.target && e.target.closest && e.target.closest('.timeline__block-focus')) return;
    const grid = block.closest('.timeline__grid');
    if (!grid) return;

    const rect = grid.getBoundingClientRect();
    const pointerMins = minutesFromPointer(e.clientY, rect);
    const startMins = Number(block.getAttribute('data-start-mins')) || 0;
    const durationMins = Number(block.getAttribute('data-duration-mins')) || PLAN_MIN_DURATION_MINS;
    const isResize = !!(e.target.closest && e.target.closest('.timeline__resize'));

    _planDragState = {
      type: isResize ? 'resize' : 'move',
      block,
      rect,
      startMins,
      durationMins,
      offsetMins: pointerMins - startMins
    };
    try { block.setPointerCapture(e.pointerId); } catch (err) {}
    block.classList.add('is-dragging');
    e.preventDefault();
  });

  document.addEventListener('pointermove', (e) => {
    if (!_planDragState) return;
    const block = _planDragState.block;
    const rect = _planDragState.rect;
    const pointerMinsRaw = minutesFromPointer(e.clientY, rect);
    const pointerMins = snapMinutes(pointerMinsRaw, PLAN_TIME_STEP_MINS);

    if (_planDragState.type === 'move') {
      let newStart = pointerMins - _planDragState.offsetMins;
      newStart = snapMinutes(newStart, PLAN_TIME_STEP_MINS);
      newStart = clampMinutes(newStart, 0, 1440 - _planDragState.durationMins);
      setPlanBlockPosition(block, newStart, _planDragState.durationMins);
    } else {
      let newDur = pointerMins - _planDragState.startMins;
      newDur = snapMinutes(newDur, PLAN_TIME_STEP_MINS);
      newDur = Math.max(PLAN_MIN_DURATION_MINS, newDur);
      newDur = Math.min(newDur, 1440 - _planDragState.startMins);
      _planDragState.durationMins = newDur;
      setPlanBlockPosition(block, _planDragState.startMins, newDur);
    }
  });

  // Ritual toggles
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    const ritualKey = t.getAttribute('data-ritual');
    const ritualDate = t.getAttribute('data-ritual-date');
    if (ritualKey && ritualDate) {
      setRitualForDate(ritualDate, ritualKey, !!t.checked);
      saveState();
    }
  });

  document.addEventListener('pointerup', (e) => {
    if (!_planDragState) return;
    const block = _planDragState.block;
    try { block.releasePointerCapture(e.pointerId); } catch (err) {}
    block.classList.remove('is-dragging');

    const newStart = Number(block.getAttribute('data-start-mins')) || _planDragState.startMins;
    const newDuration = Number(block.getAttribute('data-duration-mins')) || _planDragState.durationMins;
    const commitId = block.getAttribute('data-commit-id');
    const occId = block.getAttribute('data-occurrence-id');

    if (commitId) {
      const c = findCommitmentById(commitId);
      if (c) {
        c.startTime = minutesToTime(newStart);
        c.durationMins = newDuration;
        saveState();
        render();
      }
    } else if (occId) {
      updateOccurrenceOverride(occId, { startTime: minutesToTime(newStart), durationMins: newDuration });
      saveState();
      render();
    }

    _planDragState = null;
    _planDragSuppressClick = true;
    setTimeout(() => { _planDragSuppressClick = false; }, 0);
  });

  // Drag chips into timeline to schedule at time
  document.addEventListener('dragstart', (e) => {
    const chip = e.target && e.target.closest ? e.target.closest('.plan-chip') : null;
    if (!chip) return;
    const commitId = chip.getAttribute('data-plan-chip-id');
    const occId = chip.getAttribute('data-plan-chip-occ');
    const payload = commitId ? { type: 'commit', id: commitId } : (occId ? { type: 'occ', id: occId } : null);
    if (!payload || !e.dataTransfer) return;
    try {
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
      chip.classList.add('is-dragging');
    } catch (err) {}
  });
  document.addEventListener('dragend', (e) => {
    const chip = e.target && e.target.closest ? e.target.closest('.plan-chip') : null;
    if (chip) chip.classList.remove('is-dragging');
  });
  document.addEventListener('dragover', (e) => {
    const grid = e.target && e.target.closest ? e.target.closest('.plan-timeline .timeline__grid') : null;
    if (!grid) return;
    e.preventDefault();
    e.dataTransfer && (e.dataTransfer.dropEffect = 'move');
  });
  document.addEventListener('drop', (e) => {
    const grid = e.target && e.target.closest ? e.target.closest('.plan-timeline .timeline__grid') : null;
    if (!grid) return;
    e.preventDefault();
    const timeline = grid.closest('.plan-timeline');
    const dateISO = timeline ? timeline.getAttribute('data-date') : null;
    if (!dateISO || !e.dataTransfer) return;
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (err) { payload = null; }
    if (!payload || !payload.id) return;
    const rect = grid.getBoundingClientRect();
    const minutes = minutesFromPointer(e.clientY, rect);
    const snapped = snapMinutes(minutes, PLAN_TIME_STEP_MINS);
    if (payload.type === 'commit') scheduleCommitAtTime(payload.id, dateISO, snapped);
    else if (payload.type === 'occ') scheduleOccurrenceAtTime(payload.id, dateISO, snapped);
  });
}

// ---------- Stats / XP helpers ----------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function computeStats(st) {
  const xpLog = (st.xpLog || []);
  const attrs = ['INT','STR','DISC','MONEY'];
  const xpByAttribute = { INT:0, STR:0, DISC:0, MONEY:0 };
  let totalXp = 0;
  const daily = {}; // dateISO -> xp
  xpLog.forEach(e => {
    const xp = Number(e.totalXp || e.xp || 0);
    totalXp += xp;
    const d = e.dateISO || toISO(new Date(e.ts || e.createdAt || Date.now()));
    daily[d] = (daily[d] || 0) + xp;
    const delta = e.delta || e.breakdown || {};
    attrs.forEach(a => { xpByAttribute[a] = (xpByAttribute[a] || 0) + (Number(delta[a]) || 0); });
  });

  // level heuristic
  const level = Math.floor(Math.sqrt(totalXp / 100));

  // last 7 days series (oldest -> newest)
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = toISO(addDays(new Date(), -i));
    last7.push(daily[d] || 0);
  }

  // weekly series (last 8 weeks, oldest -> newest)
  const weekly = [];
  const weekBuckets = {}; // weekISO -> xp
  xpLog.forEach(e => {
    const d = e.dateISO ? fromISO(e.dateISO) : new Date(e.ts || e.createdAt || Date.now());
    const wkStart = toISO(getWeekStart(d));
    weekBuckets[wkStart] = (weekBuckets[wkStart] || 0) + (Number(e.totalXp || e.xp || 0));
  });
  // build last 8 week keys
  const now = new Date();
  const curWeekStart = getWeekStart(now);
  for (let i = 7; i >= 0; i--) {
    const wk = addDays(curWeekStart, -7 * i);
    const wkISO = toISO(wk);
    weekly.push(weekBuckets[wkISO] || 0);
  }

  // total tracked hours computed from xpLog's commitment references where possible
  let totalTrackedHours = 0;
  xpLog.forEach(e => {
    const commitId = e.commitmentId || e.commitId || e.commitment || null;
    if (!commitId) return;
    // find in sprints
    let found = null;
    Object.values(st.sprints || {}).forEach(sp => { if (!found) found = sp.commitments && sp.commitments.find(c => c.id === commitId); });
    if (!found) {
      // maybe it's an occurrence id referencing template (templateId:date)
      if (commitId.indexOf && commitId.indexOf(':') > 0) {
        const tid = commitId.split(':')[0];
        found = (st.taskTemplates || []).find(t => t.id === tid) || null;
      }
    }
    if (found) {
      const hrs = Number(found.estHours) || (Number(found.durationMins) ? Number(found.durationMins)/60 : 0);
      totalTrackedHours += hrs;
    }
  });
  const xpPerHour = totalTrackedHours > 0 ? Math.round((totalXp / totalTrackedHours) * 10) / 10 : 0;

  // top goals by XP
  const xpByGoal = {};
  xpLog.forEach(e => {
    const g = e.goalId || e.goal || null;
    if (!g) return;
    xpByGoal[g] = (xpByGoal[g] || 0) + (Number(e.totalXp || e.xp || 0));
  });
  const topGoals = Object.entries(xpByGoal).map(([gid, val]) => ({ id: gid, xp: val, title: ((st.longPlans || []).find(lp => lp.id === gid) || {}).title || gid })).sort((a,b) => b.xp - a.xp).slice(0,3);

  return { totalXp, level, xpByAttribute, last7, weekly, xpPerHour, topGoals };
}

// Attribute progression helpers
function getAttrLevel(xp) {
  const v = Math.max(0, Number(xp) || 0);
  for (let i = ATTR_TIERS.length - 1; i >= 0; i--) {
    if (v >= ATTR_TIERS[i]) return i;
  }
  return 0;
}
function getAttrProgress(xp) {
  const level = getAttrLevel(xp);
  const maxLevel = ATTR_TIERS.length - 1;
  if (level >= maxLevel) {
    return { level, pct: 1, prev: ATTR_TIERS[maxLevel], next: null };
  }
  const prev = ATTR_TIERS[level];
  const next = ATTR_TIERS[level + 1];
  const pct = Math.max(0, Math.min(1, (Number(xp) - prev) / (next - prev)));
  return { level, pct, prev, next };
}
// Derive coach state from stats and sprint signals
function computeCoachState(stats, sprint) {
  // states: idle, focused, winning, overbooked, stalled
  // Focused: any commitment started
  const sprintObj = sprint || (state && state.sprints && state.sprints[state.weekStartISO]) || null;
  const anyStarted = sprintObj ? (sprintObj.commitments || []).some(c => !!c.started) : false;
  if (anyStarted) return 'focused';

  // Overbooked: sprint overbooked
  if (typeof sprintObj !== 'undefined' && sprintObj) {
    const plannedHours = (sprintObj.commitments || []).reduce((s, c) => s + (Number(c.estHours) || 0), 0);
    if (plannedHours > Number(sprintObj.timeBudgetHours || 0)) return 'overbooked';
  }

  // Winning: some XP today
  const last7 = stats.last7 || [];
  const today = last7.length ? Number(last7[last7.length - 1] || 0) : 0;
  if (today > 0) return 'winning';

  // Stalled: no progress in last 2 days but had earlier activity
  const yesterday = last7.length > 1 ? Number(last7[last7.length - 2] || 0) : 0;
  const twoAgo = last7.length > 2 ? Number(last7[last7.length - 3] || 0) : 0;
  const hadEarlier = last7.slice(0, last7.length - 3).some(v => v > 0);
  if (yesterday === 0 && twoAgo === 0 && hadEarlier) return 'stalled';

  // Idle: no activity at all
  if ((stats.totalXp || 0) === 0) return 'idle';

  return 'idle';
}

function awardXpForCommitCompletion(commit, sprintWeekISO) {
  if (!commit || !commit.id) return;
  if (!state.xpLog) state.xpLog = [];
  // idempotency: check if an entry exists for this commit
  if (state.xpLog.some(e => e.commitmentId === commit.id && e.type === 'commit_done')) return;

  // Check if linked to long-term goal for multiplier
  const linkedGoalId = (commit.linkedPlanIds && commit.linkedPlanIds[0]) || null;
  let isLongTermGoal = false;
  if (linkedGoalId) {
    const goal = (state.longPlans || []).find(x => x.id === linkedGoalId);
    isLongTermGoal = Boolean(goal);
  }

  // Award base DISC (always given for task completion) - smaller amount
  const discXP = 5;
  
  // Award primary stat XP (from commit.stat) - larger amount, multiplied if long-term
  const primaryStat = commit.stat || 'STR';
  let primaryStatXP = 20;
  if (isLongTermGoal) {
    primaryStatXP = Math.round(primaryStatXP * 1.5); // 1.5x multiplier for long-term goals
  }

  const breakdown = {};
  breakdown['DISC'] = discXP;
  breakdown[primaryStat] = primaryStatXP;

  const totalXp = discXP + primaryStatXP;

  const entry = {
    id: uuid(),
    type: 'commit_done',
    ts: Date.now(),
    dateISO: toISO(new Date()),
    commitmentId: commit.id,
    goalId: linkedGoalId,
    totalXp: totalXp,
    delta: breakdown
  };
  state.xpLog.push(entry);
  saveState();
}




function clampDay(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(6, Math.floor(n)));
}

function clampDayIndexForDefault() {
  // default to "today" if current week; otherwise Monday
  const now = new Date();
  const currentWeekISO = toISO(getWeekStart(now));
  if (currentWeekISO !== state.weekStartISO) return 0;
  const idx = dayIndexForDate(fromISO(state.weekStartISO), now);
  return clampDay(idx);
}

function renderStatsView() {
  ensureUiStateShape();
  const s = computeStats(state);
  const attrKeys = ['INT', 'STR', 'DISC', 'MONEY'];
  const attrs = attrKeys.map(k => ({ key: k, val: (s.xpByAttribute && s.xpByAttribute[k]) || 0 }));
  const maxLevel = ATTR_TIERS.length - 1;
  const attrRows = attrs.map(a => {
    const prog = getAttrProgress(a.val);
    const pct = Math.round(prog.pct * 100);
    const levelLabel = prog.level >= maxLevel ? `Lvl ${maxLevel} · MAX` : `Lvl ${prog.level} · ${pct}% → Lvl ${prog.level + 1}`;
    const xpLabel = prog.level >= maxLevel ? `${a.val} XP` : `${a.val} / ${prog.next} XP`;
    return `
      <div class="stats-attr-row">
        <div class="stats-attr-label">${escapeHtml(a.key)}</div>
        <div class="stats-attr-meter">
          <div class="bar"><div class="bar__fill" style="width:${pct}%"></div></div>
          <div class="stats-attr-meta">${escapeHtml(levelLabel)}</div>
        </div>
        <div class="stats-attr-value">${xpLabel}</div>
      </div>
    `;
  }).join('');

  const comp = compute();
  const coachState = computeCoachState(s, comp.sprint);
  const coachMoodLabel = ({ idle: 'Idle', focused: 'Focused', winning: 'Winning', overbooked: 'Overbooked', stalled: 'Stalled' })[coachState] || 'Idle';
  const coachNextHint = ({ idle: 'Create one task and start it.', focused: 'Keep this session running.', winning: 'Chain another focused block.', overbooked: 'Trim low-impact tasks first.', stalled: 'Do one 10-minute action now.' })[coachState] || 'Create one task and start it.';

  const weekly = (s.weekly || []);
  const sparkW = 240, sparkH = 48, pad = 6;
  const maxWk = Math.max(1, ...weekly);
  const points = weekly.map((v, i) => {
    const x = pad + (i / Math.max(1, weekly.length - 1)) * (sparkW - pad * 2 || 1);
    const y = pad + (1 - (v / maxWk)) * (sparkH - pad * 2 || 1);
    return `${x},${y}`;
  }).join(' ');

  const topGoalsHtml = (s.topGoals || []).map(g => `
    <div class="stats-goal-row">
      <div class="stats-goal-title">${escapeHtml(g.title || g.id)}</div>
      <div class="stats-goal-xp">${g.xp} XP</div>
    </div>
  `).join('') || `<div class="faint">No goal XP yet.</div>`;
  const topGoalsCollapsed = getUiCollapsed("stats.topGoals", true);

  return `
    <section class="stack">
      <div class="card stats-header-card">
        <div class="stats-header-card__title">
          <div class="stats-header-card__eyebrow">Trajectory Stats</div>
          <h2 class="stats-header-card__heading">Performance Snapshot</h2>
          <div class="meta">Clean trends, clear progress, no visual clutter.</div>
        </div>
        <div class="stats-summary-grid">
          <div class="stats-summary-item">
            <div class="stats-summary-item__label">Total XP</div>
            <div class="stats-summary-item__value">${s.totalXp}</div>
            <div class="meta">Level ${s.level}</div>
          </div>
          <div class="stats-summary-item">
            <div class="stats-summary-item__label">XP / Hour</div>
            <div class="stats-summary-item__value">${s.xpPerHour || 0}</div>
            <div class="meta">Across completed work</div>
          </div>
          <div class="stats-summary-item">
            <div class="stats-summary-item__label">Momentum</div>
            <div class="stats-summary-item__value">${escapeHtml(coachMoodLabel)}</div>
            <div class="meta">${escapeHtml(coachNextHint)}</div>
          </div>
        </div>
      </div>

      <div class="grid stats-layout-grid">
        <div class="card">
          <div class="card__title">
            <h2>Attribute Breakdown</h2>
            <div class="meta">Current level progress</div>
          </div>
          <div class="stats-attr-list">${attrRows}</div>
        </div>

        <div class="card">
          <div class="card__title">
            <h2>Weekly XP Trend</h2>
            <div class="meta">Last ${weekly.length} weeks</div>
          </div>
          <div class="stats-weekly-chart">
            <div class="stats-weekly-chart__line">
              <svg width="${sparkW}" height="${sparkH}" viewBox="0 0 ${sparkW} ${sparkH}" preserveAspectRatio="none" style="background:transparent">
                <polyline fill="none" stroke="var(--brand)" stroke-width="2" points="${points}" />
              </svg>
            </div>
            <div class="stats-momentum-card stats-momentum-card--${coachState}">
              <div class="stats-momentum-card__label">Focus Signal</div>
              <div class="stats-momentum-card__value">${escapeHtml(coachMoodLabel)}</div>
              <div class="meta">${escapeHtml(coachNextHint)}</div>
              <button class="btn btn--sharp" id="coachActionBtn" type="button">Schedule Next Task</button>
            </div>
          </div>
        </div>

        <section class="card ui-section${topGoalsCollapsed ? " is-collapsed" : ""}">
          <button class="ui-section__header" type="button" data-ui-collapse="stats.topGoals" aria-expanded="${topGoalsCollapsed ? "false" : "true"}">
            <div class="ui-section__titlewrap">
              <h3 class="ui-section__title">Top Goals</h3>
              <div class="ui-section__meta">Where XP is coming from</div>
            </div>
            <div class="ui-section__head-actions">
              <span class="ui-section__chevron" aria-hidden="true">${renderCollapseChevron(topGoalsCollapsed)}</span>
            </div>
          </button>
          <div class="ui-section__body"${topGoalsCollapsed ? ` hidden` : ``}>
            <div class="stats-goal-list">
              ${topGoalsHtml}
            </div>
          </div>
        </section>
      </div>
    </section>
  `;
}

// ---------- Modal control ----------
function clearCommitAutoSaveTimer() {
  if (_commitAutoSaveTimer) {
    clearTimeout(_commitAutoSaveTimer);
    _commitAutoSaveTimer = null;
  }
}

function queueCommitAutoSave(delayMs = 380) {
  clearCommitAutoSaveTimer();
  _commitAutoSaveTimer = setTimeout(() => {
    const modal = $("#commitModal");
    const form = $("#commitForm");
    if (!modal || !form || modal.hidden) return;
    if (form.getAttribute("data-auto-save") !== "true") return;
    const titleEl = $("#cTitle");
    if (titleEl && !String(titleEl.value || "").trim()) return;
    try {
      form.requestSubmit();
    } catch (_) {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  }, delayMs);
}

function configureCommitModalAutoSave(enabled) {
  const form = $("#commitForm");
  if (!form) return;
  const autoEnabled = !!enabled;
  form.setAttribute("data-auto-save", autoEnabled ? "true" : "false");

  const saveBtn = $("#btnCommitSave");
  const cancelBtn = $("#btnCommitCancel");
  if (saveBtn) saveBtn.hidden = autoEnabled;
  if (cancelBtn) cancelBtn.textContent = autoEnabled ? "Close" : "Cancel";

  if (form.__autoSaveInputHandler) {
    form.removeEventListener("input", form.__autoSaveInputHandler);
    form.removeEventListener("change", form.__autoSaveInputHandler);
    delete form.__autoSaveInputHandler;
  }
  clearCommitAutoSaveTimer();

  if (!autoEnabled) return;
  const scheduleSave = (ev) => {
    if (!ev || !ev.target) return;
    const target = ev.target;
    if (target.id === "cTitle" && !String(target.value || "").trim()) return;
    queueCommitAutoSave();
  };
  form.__autoSaveInputHandler = scheduleSave;
  form.addEventListener("input", scheduleSave);
  form.addEventListener("change", scheduleSave);
}

function openCommitModal({ dayIndex = 0, editId = null, prefill = null } = {}) {
  const sprint = getActiveSprint();
  const modal = $("#commitModal");
  const form = $("#commitForm");
  const doneInput = $("#cDone");
  const doneLabel = $("#cDoneLabel");
  const autoSaveMode = !!editId || !!(prefill && prefill.occurrenceId);
  let editingCommit = null;

  form.removeAttribute("data-editing-id");
  form.removeAttribute("data-edit-occurrence-id");
  form.removeAttribute("data-edit-template-id");
  form.removeAttribute("data-inbox-id");

  // day options (week of the current sprint view)
  const weekStart = fromISO(state.weekStartISO);
  $("#cDay").innerHTML = DAY_NAMES.map((dn, i) => {
    const d = addDays(weekStart, i);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `<option value="${i}">${dn} (${label})</option>`;
  }).join("");

  // populate goal select
  const goalSelect = $("#cLinkGoal");
  if (goalSelect) {
    goalSelect.innerHTML = `<option value="">(none)</option>` + (state.longPlans || []).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${p.horizonYears}y)</option>`).join("");
  }

  if (editId) {
    // find the sprint that contains this commitment
    let found = null;
    Object.entries(state.sprints).forEach(([wk, sp]) => {
      const c = sp.commitments.find(x => x.id === editId);
      if (c) found = { wk, sp, c };
    });
    if (!found) return;
    const c = found.c;
    editingCommit = c;
    $("#commitTitle").textContent = "Edit Commitment";
    $("#cTitle").value = c.title;
    $("#cDeliverable").value = c.deliverable;
    $("#cHours").value = Number(c.estHours || 0);
    $("#cDay").value = String(clampDay(c.dayIndex));
    $("#cNext").value = c.nextAction || "";
    $("#cDate").value = c.dateISO || "";
    $("#cStat").value = c.stat || "STR";
    $("#cLinkGoal").value = (c.linkedPlanIds && c.linkedPlanIds[0]) || "";
    $("#cTime").value = c.startTime || "";
    $("#cProof").value = c.proofUrl || "";
    $("#cDuration").value = durationInputValue(c.durationMins);
    if ($("#cFocus")) $("#cFocus").checked = !!c.isFocus;
    if (doneInput) doneInput.checked = !!c.done;
    form.setAttribute("data-editing-id", editId);
  } else {
    $("#commitTitle").textContent = "Add Commitment";
    // prefill if provided (useful for Inbox -> assign flow)
    $("#cTitle").value = prefill && prefill.title ? prefill.title : "";
    $("#cDeliverable").value = prefill && prefill.deliverable ? prefill.deliverable : "";
    $("#cHours").value = prefill && prefill.estHours ? String(prefill.estHours) : "2";
    $("#cDay").value = String(clampDay(prefill && typeof prefill.dayIndex !== 'undefined' ? prefill.dayIndex : dayIndex));
    $("#cNext").value = prefill && prefill.nextAction ? prefill.nextAction : "";
    $("#cDate").value = prefill && prefill.dateISO ? prefill.dateISO : "";
    $("#cStat").value = (prefill && prefill.stat) || "STR";
    $("#cLinkGoal").value = (prefill && prefill.linkGoal) || "";
    $("#cTime").value = prefill && prefill.startTime ? prefill.startTime : "";
    $("#cProof").value = prefill && prefill.proofUrl ? prefill.proofUrl : "";
    $("#cDuration").value = prefill ? durationInputValue(prefill.durationMins) : "";
    if ($("#cFocus")) $("#cFocus").checked = !!(prefill && prefill.isFocus);
    if (doneInput) doneInput.checked = !!(prefill && prefill.done);
    if (prefill && prefill.inboxId) form.setAttribute("data-inbox-id", prefill.inboxId);
  }

  // support prefill from an occurrence (template occurrence)
  if (prefill && prefill.occurrenceId) {
    // mark that we're editing an occurrence (not a sprint commitment)
    form.setAttribute('data-edit-occurrence-id', prefill.occurrenceId);
    form.setAttribute('data-edit-template-id', prefill.templateId || '');
    if (doneInput) doneInput.checked = !!prefill.done;
  }

  if (doneInput && doneLabel) {
    const syncDoneLabel = () => { doneLabel.textContent = doneInput.checked ? "Done" : "Pending"; };
    doneInput.onchange = syncDoneLabel;
    syncDoneLabel();
  }

  // Autopilot pin UI: only for Canvas autopilot work blocks.
  const pinRow = $("#cAutopilotPinRow");
  const pinHelp = $("#cAutopilotPinHelp");
  const pinEl = $("#cAutopilotPin");
  const isAutopilotBlock = !!(editingCommit && editingCommit.canvasAutopilot);
  if (pinRow) pinRow.hidden = !isAutopilotBlock;
  if (pinHelp) pinHelp.hidden = !isAutopilotBlock;
  if (pinEl) {
    pinEl.checked = isAutopilotBlock ? !!editingCommit.autopilotPinned : false;
  }

  // Initialize color picker UI
  let initialColor = null;
  if (editingCommit && editingCommit.color) {
    initialColor = editingCommit.color;
  } else if (prefill && prefill.color) {
    initialColor = prefill.color;
  } else if (prefill && prefill.occurrenceId) {
    const occ = findOccurrenceById(prefill.occurrenceId);
    if (occ && occ.color) initialColor = occ.color;
  }
  if (!initialColor) {
    const statVal = $("#cStat") ? $("#cStat").value : "INT";
    initialColor = colorForStat(statVal);
  }
  applyCommitColorUI(initialColor);
  const colorInput = $("#cColor");
  const hexInput = $("#cColorHex");
  if (colorInput) colorInput.oninput = () => applyCommitColorUI(colorInput.value);
  if (hexInput) {
    hexInput.oninput = () => {
      const hex = normalizeHexColor(hexInput.value);
      if (hex) applyCommitColorUI(hex);
    };
  }
  document.querySelectorAll('.color-swatch').forEach(btn => {
    btn.onclick = () => applyCommitColorUI(btn.getAttribute('data-color'));
  });

  // Initialize icon picker UI
  let initialIconPick = "auto";
  if (editingCommit && Object.prototype.hasOwnProperty.call(editingCommit, "icon")) {
    initialIconPick = normalizeTaskIconKey(editingCommit.icon) ? normalizeTaskIconKey(editingCommit.icon) : "none";
  } else if (prefill && Object.prototype.hasOwnProperty.call(prefill, "icon")) {
    initialIconPick = normalizeTaskIconKey(prefill.icon) ? normalizeTaskIconKey(prefill.icon) : "none";
  } else if (prefill && prefill.occurrenceId) {
    const occ = findOccurrenceById(prefill.occurrenceId);
    if (occ && Object.prototype.hasOwnProperty.call(occ, "icon")) {
      initialIconPick = normalizeTaskIconKey(occ.icon) ? normalizeTaskIconKey(occ.icon) : "none";
    }
  }
  applyCommitIconUI(initialIconPick);
  document.querySelectorAll("#cIconPicker .icon-choice").forEach(btn => {
    btn.onclick = () => applyCommitIconUI(btn.getAttribute("data-icon"));
  });

  // Delete button behavior
  const delBtn = $("#btnDeleteCommit");
  if (delBtn) {
    delBtn.hidden = true;
    delBtn.onclick = null;
    delBtn.removeAttribute('data-delete-id');
    delBtn.removeAttribute('data-delete-occ');
    if (editId) {
      delBtn.hidden = false;
      delBtn.textContent = "Delete task";
      delBtn.setAttribute('data-delete-id', editId);
      delBtn.onclick = () => {
        if (!confirm('Delete this task?')) return;
        if (deleteCommitById(editId)) {
          saveState();
          closeCommitModal();
          render();
        }
      };
    } else if (prefill && prefill.occurrenceId) {
      delBtn.hidden = false;
      delBtn.textContent = "Delete occurrence";
      delBtn.setAttribute('data-delete-occ', prefill.occurrenceId);
      delBtn.onclick = () => {
        if (!confirm('Delete this occurrence?')) return;
        deleteOccurrenceById(prefill.occurrenceId);
        saveState();
        closeCommitModal();
        render();
      };
    }
  }

  configureCommitModalAutoSave(autoSaveMode);
  modal.hidden = false;
  $("#cTitle").focus();
  // enable focus trap for this modal
  try { enableModalFocusTrap(modal); } catch (e) { /* ignore if unsupported */ }
}

function closeCommitModal() {
  const modal = $("#commitModal");
  const form = $("#commitForm");
  const wasAuto = !!(form && form.getAttribute("data-auto-save") === "true");
  clearCommitAutoSaveTimer();
  configureCommitModalAutoSave(false);
  modal.hidden = true;
  form.removeAttribute("data-editing-id");
  form.removeAttribute("data-edit-occurrence-id");
  form.removeAttribute("data-edit-template-id");
  form.removeAttribute("data-auto-save");
  form.removeAttribute("data-inbox-id");
  try { disableModalFocusTrap(modal); } catch (e) { /* ignore */ }
  if (wasAuto) render();
}

function syncCommitmentDayOptions() {
  // nothing needed; kept for future extension
}

// ---------- Recurrence engine ----------
function dateISOtoDate(iso) { return fromISO(iso); }
function dateCompareISO(a,b) { return a.localeCompare(b); }
function lastDayOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

function getOccurrencesForRange(startISO, endISO) {
  const out = [];
  if (!state.taskTemplates || !state.taskTemplates.length) return out;
  const startD = fromISO(startISO);
  const endD = fromISO(endISO);

  state.taskTemplates.forEach(t => {
    if (!t.repeat || !t.repeat.enabled) return;
    // template start date
    const tmplStart = t.startDate ? fromISO(t.startDate) : new Date();
    const until = t.repeat.untilISO ? fromISO(t.repeat.untilISO) : null;

    // helper to push occurrence if in range and not past until
    const pushIf = (d) => {
      const iso = toISO(d);
      if (iso < startISO || iso > endISO) return;
      if (until && iso > t.repeat.untilISO) return;
      // build occurrence
      const occId = `${t.id}:${iso}`;
      const override = (state.occurrenceOverrides || {})[occId] || null;
      if (override && override.deleted) return; // skip occurrences explicitly deleted via override
      const dateISO = override && override.dateISO ? override.dateISO : iso;
      const startTime = override && override.startTime ? override.startTime : (t.startTime || '00:00');
      const durationMins = override && typeof override.durationMins !== 'undefined'
        ? normalizeDurationMins(override.durationMins)
        : normalizeDurationMins(t.durationMins);
      const title = override && override.title ? override.title : t.title;
      const deliverable = override && override.deliverable ? override.deliverable : t.deliverable;
      const stat = override && override.stat ? override.stat : (t.stat || 'INT');
      const color = normalizeHexColor((override && override.color) ? override.color : t.color) || colorForStat(stat);
      const icon = normalizeTaskIconKey(
        override && typeof override.icon !== "undefined" ? override.icon : t.icon
      );
      const done = !!((state.occurrenceDone || {})[occId]);
      out.push({ occurrenceId: occId, templateId: t.id, dateISO, startTime, durationMins, title, deliverable, goalId: t.goalId || null, stat, color, icon, done });
    };

    const freq = t.repeat.freq || 'daily';
    const interval = Math.max(1, Number(t.repeat.interval || 1));

    if (freq === 'daily') {
      // step by days from template start
      let d = new Date(Math.max(tmplStart, startD));
      // align to the next matching day by interval
      while (d <= endD) { pushIf(d); d = addDays(d, interval); }
    } else if (freq === 'weekly') {
      // byWeekday optional e.g. ['MO','WE'] mapping to JS days 1..7 (Mon=1)
      const byWeekday = Array.isArray(t.repeat.byWeekday) && t.repeat.byWeekday.length ? t.repeat.byWeekday : null;
      // compute first week start at or before startD aligned to template start weekday
      // iterate weeks
      let wkStart = getWeekStart(tmplStart);
      // advance to be on/after startD
      while (wkStart <= endD) {
        // for each weekday
        const days = byWeekday ? byWeekday : [ ['MO','TU','WE','TH','FR','SA','SU'][tmplStart.getDay()-1] || ['MO'][0] ];
        (byWeekday || ['MO','TU','WE','TH','FR','SA','SU']).forEach(code => {
          const mapping = { MO:1, TU:2, WE:3, TH:4, FR:5, SA:6, SU:0 };
          const jsDay = mapping[code] !== undefined ? mapping[code] : tmplStart.getDay();
          const d = addDays(wkStart, (jsDay === 0 ? 6 : jsDay - 1));
          if (d >= startD && d <= endD) pushIf(d);
        });
        wkStart = addDays(wkStart, 7 * interval);
      }
    } else if (freq === 'monthly') {
      // repeat monthly on byMonthDay or on template start day
      const dayOfMonth = Number(t.repeat.byMonthDay || (tmplStart.getDate()));
      let cur = new Date(Math.max(tmplStart, startD));
      // set to first of month of cur
      cur.setDate(1);
      while (cur <= endD) {
        const y = cur.getFullYear(); const m = cur.getMonth();
        const clampDay = Math.min(dayOfMonth, lastDayOfMonth(y, m));
        const d = new Date(y, m, clampDay);
        if (d >= startD && d <= endD) pushIf(d);
        cur = addMonths(cur, interval);
      }
    }
  });

  // sort by date
  out.sort((a,b) => a.dateISO.localeCompare(b.dateISO));
  return out;
}

// Modal focus trap helpers
function enableModalFocusTrap(modalEl) {
  if (!modalEl) return;
  try {
    modalEl.__prevFocus = document.activeElement;
    const panel = modalEl.querySelector('.modal__panel') || modalEl;
    const focusable = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        // try to close modal using backdrop/close buttons
        const closer = modalEl.querySelector('[data-close="true"]');
        if (closer) closer.click();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panel.querySelectorAll(focusable)).filter(n => n.offsetParent !== null && !n.disabled);
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === modalEl) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keyHandler);
    modalEl.__keyHandler = keyHandler;
  } catch (e) { console.error('enableModalFocusTrap', e); }
}

function disableModalFocusTrap(modalEl) {
  if (!modalEl) return;
  try {
    if (modalEl.__keyHandler) { document.removeEventListener('keydown', modalEl.__keyHandler); delete modalEl.__keyHandler; }
    if (modalEl.__prevFocus && modalEl.__prevFocus.focus) modalEl.__prevFocus.focus();
    delete modalEl.__prevFocus;
  } catch (e) { console.error('disableModalFocusTrap', e); }
}

// ---------- Init ----------
// ensure longPlans exists in case loadState returned null
if (!state.longPlans) state.longPlans = [];
if (!state.rituals) state.rituals = {};
if (!state.planMode) state.planMode = 'day';
// initialize monthStartISO to current month if missing
if (!state.monthStartISO) state.monthStartISO = toISO(getMonthStart(fromISO(state.weekStartISO)));

// Always start in Home on app launch
state.view = 'home';

// initialize xpLog and stats if missing
if (!state.xpLog) state.xpLog = [];
if (!state.stats) state.stats = { attributes: ['INT','STR','DISC','MONEY'], byAttribute: { INT:0, STR:0, DISC:0, MONEY:0 }, totalXp: 0 };
ensureUiStateShape();
state.ui.theme = getThemeFromState();
applyTheme(state.ui.theme);

// Migration: map legacy 'CRAFT' attribute to 'MONEY' in saved state (xpLog deltas, stats, and goal weights)
function migrateCraftToMoney() {
  let changed = false;
  // migrate xpLog entries
  (state.xpLog || []).forEach(e => {
    const d = e.delta || e.breakdown || {};
    if (d && typeof d === 'object' && Object.prototype.hasOwnProperty.call(d, 'CRAFT')) {
      const v = d['CRAFT'];
      if (!d['MONEY']) d['MONEY'] = 0;
      d['MONEY'] = Number(d['MONEY'] || 0) + Number(v || 0);
      delete d['CRAFT'];
      changed = true;
    }
  });

  // migrate state.stats.byAttribute
  if (state.stats && state.stats.byAttribute && Object.prototype.hasOwnProperty.call(state.stats.byAttribute, 'CRAFT')) {
    state.stats.byAttribute['MONEY'] = (state.stats.byAttribute['MONEY'] || 0) + (state.stats.byAttribute['CRAFT'] || 0);
    delete state.stats.byAttribute['CRAFT'];
    // replace attributes array
    if (Array.isArray(state.stats.attributes)) {
      state.stats.attributes = state.stats.attributes.map(a => a === 'CRAFT' ? 'MONEY' : a);
    }
    changed = true;
  }

  // migrate goal attributeWeights if present
  (state.longPlans || []).forEach(g => {
    if (g && g.attributeWeights && Object.prototype.hasOwnProperty.call(g.attributeWeights, 'CRAFT')) {
      g.attributeWeights['MONEY'] = (g.attributeWeights['MONEY'] || 0) + (g.attributeWeights['CRAFT'] || 0);
      delete g.attributeWeights['CRAFT'];
      changed = true;
    }
  });

  if (changed) saveState();
}
try { migrateCraftToMoney(); } catch (e) { console.error('migrateCraftToMoney failed', e); }

// initialize templates + occurrence maps for repeating tasks
if (!state.taskTemplates) state.taskTemplates = [];
if (!state.occurrenceDone) state.occurrenceDone = {};
if (!state.occurrenceOverrides) state.occurrenceOverrides = {};
ensureCanvasSyncStateShape();
ensureWorkoutStateShape();
syncEnforcementConfigToMain();
ensureExtensionPlannerBridgeServer();

render();
// Initialize day tracker handlers and clock
initDayTracker();
// Initialize plan timeline drag handlers
initPlanTimelineHandlers();

try {
  window.addEventListener("beforeunload", () => {
    try { stopForegroundSnapshotWorker(); } catch (_) {}
    stopExtensionPlannerBridgeServer();
  });
} catch (_) {}
