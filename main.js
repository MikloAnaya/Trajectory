const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, clipboard, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");

const DAEMON_RESTART_BASE_MS = 1200;
const DAEMON_RESTART_MAX_MS = 8000;
const WATCHDOG_RESTART_BASE_MS = 1800;
const WATCHDOG_RESTART_MAX_MS = 10000;
const WATCHDOG_POLL_MS = 2500;
const WATCHDOG_RELAUNCH_COOLDOWN_MS = 9000;

let mainWindow = null;
let tray = null;
let isQuitting = false;

let daemonProcess = null;
let daemonRestartTimer = null;
let daemonShouldRun = true;
let daemonRestartCount = 0;
let watchdogProcess = null;
let watchdogRestartTimer = null;
let watchdogShouldRun = true;
let watchdogRestartCount = 0;

let daemonConfigPath = "";
let daemonConfig = {};

function installStandardAppMenu() {
  if (!Menu || typeof Menu.buildFromTemplate !== "function") return;
  try {
    const template = [
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "delete" },
          { type: "separator" },
          { role: "selectAll" }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } catch (err) {
    console.warn("installStandardAppMenu failed", err);
  }
}

function installStandardContextMenu(win) {
  if (!win || !win.webContents || !Menu || typeof Menu.buildFromTemplate !== "function") return;
  try {
    win.webContents.on("context-menu", (_event, params) => {
      const p = params || {};
      const editFlags = p.editFlags || {};
      const isEditable = !!p.isEditable;
      const hasSelection = !!String(p.selectionText || "").trim();
      const linkUrl = String(p.linkURL || "").trim();

      const template = [];

      if (linkUrl) {
        template.push(
          {
            label: "Open link",
            click: () => {
              try {
                if (shell && typeof shell.openExternal === "function") shell.openExternal(linkUrl);
              } catch (_) {}
            }
          },
          {
            label: "Copy link address",
            click: () => {
              try {
                if (clipboard && typeof clipboard.writeText === "function") clipboard.writeText(linkUrl);
              } catch (_) {}
            }
          },
          { type: "separator" }
        );
      }

      if (isEditable) {
        template.push(
          { role: "undo", enabled: !!editFlags.canUndo },
          { role: "redo", enabled: !!editFlags.canRedo },
          { type: "separator" },
          { role: "cut", enabled: !!editFlags.canCut },
          { role: "copy", enabled: !!editFlags.canCopy },
          { role: "paste", enabled: !!editFlags.canPaste },
          { type: "separator" },
          { role: "selectAll" }
        );
      } else {
        if (hasSelection) template.push({ role: "copy", enabled: true });
        template.push({ role: "selectAll" });
      }

      if (!template.length) return;
      try {
        Menu.buildFromTemplate(template).popup({ window: win });
      } catch (_) {}
    });
  } catch (err) {
    console.warn("installStandardContextMenu failed", err);
  }
}

function resolveBundledExtensionPath() {
  return path.join(__dirname, "browser-extension", "trajectory-browser-blocker");
}

function getDefaultDaemonConfig() {
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
    pornBlockEnabled: true, // legacy alias
    pornKeywords: [], // legacy alias
    pornGroup: {
      enabled: true,
      alwaysOn: true,
      blockedDomains: [
        "pornhub.com",
        "xvideos.com",
        "xnxx.com",
        "redtube.com",
        "youporn.com",
        "xhamster.com",
        "spankbang.com",
        "rule34.xxx"
      ],
      blockedKeywords: [
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
      ],
      blockedSearchTerms: [
        "porn",
        "porno",
        "pornography",
        "xxx",
        "hentai",
        "blowjob",
        "milf",
        "onlyfans",
        "camgirl"
      ],
      customKeywords: []
    },
    extensionGuard: {
      enabled: true,
      browser: "chrome",
      requireInstalled: true,
      checkEverySecs: 3,
      requiredExtensionPath: resolveBundledExtensionPath()
    },
    blockedProcesses: [],
    blockedTitleKeywords: [],
    hardBlockedProcesses: [],
    hardBlockedKeywords: [],
    escalation: {
      killProcessOnBlock: true
    }
  };
}

function asObject(v, fallback = {}) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
}

function sanitizeDaemonConfig(raw) {
  const defaults = getDefaultDaemonConfig();
  const incoming = asObject(raw, {});
  const incomingGuard = asObject(incoming.extensionGuard, {});
  const guardBrowser = String(incomingGuard.browser || defaults.extensionGuard.browser).toLowerCase();
  return {
    enabled: !!incoming.enabled,
    alwaysOn: typeof incoming.alwaysOn === "boolean" ? incoming.alwaysOn : defaults.alwaysOn,
    pollEverySecs: Number(incoming.pollEverySecs) || defaults.pollEverySecs,
    softNudgeEverySecs: Number(incoming.softNudgeEverySecs) || defaults.softNudgeEverySecs,
    schedule: {
      startTime: String(asObject(incoming.schedule, defaults.schedule).startTime || defaults.schedule.startTime),
      endTime: String(asObject(incoming.schedule, defaults.schedule).endTime || defaults.schedule.endTime),
      days: Array.isArray(asObject(incoming.schedule, defaults.schedule).days)
        ? asObject(incoming.schedule, defaults.schedule).days
        : defaults.schedule.days
    },
    sessionUntilTs: Number(incoming.sessionUntilTs) || 0,
    runtime: {
      blockedUntilTs: Number(asObject(incoming.runtime).blockedUntilTs) || 0,
      lockoutUntilTs: Number(asObject(incoming.runtime).lockoutUntilTs) || 0,
      frozenUntilTs: Number(asObject(incoming.runtime).frozenUntilTs) || 0
    },
    pornBlockEnabled: typeof incoming.pornBlockEnabled === "boolean" ? incoming.pornBlockEnabled : defaults.pornBlockEnabled,
    pornKeywords: Array.isArray(incoming.pornKeywords) ? incoming.pornKeywords : defaults.pornKeywords,
    pornGroup: {
      enabled: typeof asObject(incoming.pornGroup).enabled === "boolean"
        ? asObject(incoming.pornGroup).enabled
        : (typeof incoming.pornBlockEnabled === "boolean" ? incoming.pornBlockEnabled : defaults.pornGroup.enabled),
      alwaysOn: typeof asObject(incoming.pornGroup).alwaysOn === "boolean"
        ? asObject(incoming.pornGroup).alwaysOn
        : defaults.pornGroup.alwaysOn,
      blockedDomains: Array.isArray(asObject(incoming.pornGroup).blockedDomains)
        ? asObject(incoming.pornGroup).blockedDomains
        : defaults.pornGroup.blockedDomains,
      blockedKeywords: Array.isArray(asObject(incoming.pornGroup).blockedKeywords)
        ? asObject(incoming.pornGroup).blockedKeywords
        : defaults.pornGroup.blockedKeywords,
      blockedSearchTerms: Array.isArray(asObject(incoming.pornGroup).blockedSearchTerms)
        ? asObject(incoming.pornGroup).blockedSearchTerms
        : defaults.pornGroup.blockedSearchTerms,
      customKeywords: Array.isArray(asObject(incoming.pornGroup).customKeywords)
        ? asObject(incoming.pornGroup).customKeywords
        : (Array.isArray(incoming.pornKeywords) ? incoming.pornKeywords : defaults.pornGroup.customKeywords)
    },
    extensionGuard: {
      enabled: typeof incomingGuard.enabled === "boolean"
        ? incomingGuard.enabled
        : defaults.extensionGuard.enabled,
      browser: ["chrome", "edge", "brave"].includes(guardBrowser)
        ? guardBrowser
        : defaults.extensionGuard.browser,
      requireInstalled: typeof incomingGuard.requireInstalled === "boolean"
        ? incomingGuard.requireInstalled
        : defaults.extensionGuard.requireInstalled,
      checkEverySecs: Math.max(2, Math.min(30, Number(incomingGuard.checkEverySecs) || defaults.extensionGuard.checkEverySecs)),
      requiredExtensionPath: String(
        incomingGuard.requiredExtensionPath
        || incomingGuard.extensionPath
        || defaults.extensionGuard.requiredExtensionPath
      )
    },
    blockedProcesses: Array.isArray(incoming.blockedProcesses) ? incoming.blockedProcesses : defaults.blockedProcesses,
    blockedTitleKeywords: Array.isArray(incoming.blockedTitleKeywords) ? incoming.blockedTitleKeywords : defaults.blockedTitleKeywords,
    hardBlockedProcesses: Array.isArray(incoming.hardBlockedProcesses) ? incoming.hardBlockedProcesses : defaults.hardBlockedProcesses,
    hardBlockedKeywords: Array.isArray(incoming.hardBlockedKeywords) ? incoming.hardBlockedKeywords : defaults.hardBlockedKeywords,
    escalation: {
      killProcessOnBlock: typeof asObject(incoming.escalation).killProcessOnBlock === "boolean"
        ? asObject(incoming.escalation).killProcessOnBlock
        : defaults.escalation.killProcessOnBlock
    }
  };
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

function resolveDaemonConfigPath() {
  return path.join(app.getPath("userData"), "blocker-daemon-config.json");
}

function loadDaemonConfigFromDisk() {
  try {
    if (!daemonConfigPath || !fs.existsSync(daemonConfigPath)) return getDefaultDaemonConfig();
    const raw = fs.readFileSync(daemonConfigPath, "utf8");
    if (!raw) return getDefaultDaemonConfig();
    const parsed = JSON.parse(raw);
    return sanitizeDaemonConfig(parsed);
  } catch (err) {
    console.error("Failed to load daemon config:", err);
    return getDefaultDaemonConfig();
  }
}

function saveDaemonConfigToDisk() {
  try {
    if (!daemonConfigPath) return;
    const dir = path.dirname(daemonConfigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(daemonConfigPath, JSON.stringify(daemonConfig, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save daemon config:", err);
  }
}

function sendDaemonConfig() {
  if (!daemonProcess || !daemonProcess.connected) return;
  try {
    daemonProcess.send({ type: "config", config: daemonConfig });
  } catch (err) {
    console.error("Failed to send config to daemon:", err);
  }
}

function clearDaemonRestartTimer() {
  if (daemonRestartTimer) {
    clearTimeout(daemonRestartTimer);
    daemonRestartTimer = null;
  }
}

function scheduleDaemonRestart(reason = "unknown") {
  if (!daemonShouldRun || isQuitting || daemonRestartTimer) return;
  const delay = Math.min(
    DAEMON_RESTART_MAX_MS,
    DAEMON_RESTART_BASE_MS * Math.max(1, daemonRestartCount + 1)
  );
  daemonRestartTimer = setTimeout(() => {
    daemonRestartTimer = null;
    startDaemon(`watchdog:${reason}`);
  }, delay);
}

function handleDaemonMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "error") {
    console.error("Blocker daemon error:", msg.message || msg);
    return;
  }
  if (msg.type === "event") {
    console.log("Blocker daemon event:", msg.level || "info", msg.reason || "");
    return;
  }
  if (msg.type === "started") {
    console.log("Blocker daemon started:", msg.pid || "");
    return;
  }
}

function startDaemon(startReason = "initial") {
  if (!daemonShouldRun || isQuitting) return;
  if (daemonProcess) return;
  const daemonScript = path.join(__dirname, "blocker-daemon.js");
  if (!fs.existsSync(daemonScript)) {
    console.error("Blocker daemon script missing:", daemonScript);
    return;
  }
  try {
    daemonProcess = fork(daemonScript, [], {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
  } catch (err) {
    console.error("Failed to start blocker daemon:", err);
    scheduleDaemonRestart("spawn-failed");
    return;
  }

  daemonRestartCount = 0;
  clearDaemonRestartTimer();
  console.log("Blocker daemon launch reason:", startReason);

  if (daemonProcess.stdout) {
    daemonProcess.stdout.on("data", chunk => {
      const text = String(chunk || "").trim();
      if (text) console.log(`[blocker-daemon] ${text}`);
    });
  }
  if (daemonProcess.stderr) {
    daemonProcess.stderr.on("data", chunk => {
      const text = String(chunk || "").trim();
      if (text) console.error(`[blocker-daemon] ${text}`);
    });
  }

  daemonProcess.on("message", handleDaemonMessage);
  daemonProcess.on("exit", (code, signal) => {
    const shouldRestart = daemonShouldRun && !isQuitting;
    console.warn(`Blocker daemon exited (code=${code}, signal=${signal}). restart=${shouldRestart}`);
    daemonProcess = null;
    if (shouldRestart) {
      daemonRestartCount += 1;
      scheduleDaemonRestart("exit");
    }
  });

  sendDaemonConfig();
}

function stopDaemon() {
  daemonShouldRun = false;
  clearDaemonRestartTimer();
  const proc = daemonProcess;
  daemonProcess = null;
  if (!proc) return;
  try {
    if (proc.connected) proc.send({ type: "shutdown" });
  } catch (_) {}
  setTimeout(() => {
    try {
      proc.kill("SIGTERM");
    } catch (_) {}
  }, 1500);
}

function createWatchdogEnv() {
  const args = Array.isArray(process.argv) ? process.argv.slice(1) : [];
  return Object.assign({}, process.env, {
    TRAJECTORY_WATCHDOG_APP_PATH: process.execPath || "",
    TRAJECTORY_WATCHDOG_APP_ARGS_JSON: JSON.stringify(args),
    TRAJECTORY_WATCHDOG_CONFIG_PATH: daemonConfigPath || "",
    TRAJECTORY_WATCHDOG_OWNER_PID: String(process.pid || 0),
    TRAJECTORY_WATCHDOG_POLL_MS: String(WATCHDOG_POLL_MS),
    TRAJECTORY_WATCHDOG_RELAUNCH_COOLDOWN_MS: String(WATCHDOG_RELAUNCH_COOLDOWN_MS)
  });
}

function clearWatchdogRestartTimer() {
  if (watchdogRestartTimer) {
    clearTimeout(watchdogRestartTimer);
    watchdogRestartTimer = null;
  }
}

function scheduleWatchdogRestart(reason = "unknown") {
  if (!watchdogShouldRun || isQuitting || watchdogRestartTimer) return;
  const delay = Math.min(
    WATCHDOG_RESTART_MAX_MS,
    WATCHDOG_RESTART_BASE_MS * Math.max(1, watchdogRestartCount + 1)
  );
  watchdogRestartTimer = setTimeout(() => {
    watchdogRestartTimer = null;
    startWatchdog(`watchdog:${reason}`);
  }, delay);
}

function startWatchdog(startReason = "initial", options = {}) {
  const allowWhileQuitting = !!(options && options.allowWhileQuitting);
  if (!watchdogShouldRun || (isQuitting && !allowWhileQuitting)) return;
  if (watchdogProcess) return;
  const watchdogScript = path.join(__dirname, "blocker-watchdog.js");
  if (!fs.existsSync(watchdogScript)) {
    console.error("Blocker watchdog script missing:", watchdogScript);
    return;
  }
  try {
    watchdogProcess = fork(watchdogScript, [], {
      cwd: __dirname,
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: createWatchdogEnv()
    });
    watchdogProcess.unref();
  } catch (err) {
    console.error("Failed to start blocker watchdog:", err);
    scheduleWatchdogRestart("spawn-failed");
    return;
  }

  watchdogRestartCount = 0;
  clearWatchdogRestartTimer();
  console.log("Blocker watchdog launch reason:", startReason);

  watchdogProcess.on("exit", (code, signal) => {
    const shouldRestart = watchdogShouldRun && !isQuitting;
    console.warn(`Blocker watchdog exited (code=${code}, signal=${signal}). restart=${shouldRestart}`);
    watchdogProcess = null;
    if (shouldRestart) {
      watchdogRestartCount += 1;
      scheduleWatchdogRestart("exit");
    }
  });
}

function stopWatchdog() {
  watchdogShouldRun = false;
  clearWatchdogRestartTimer();
  const proc = watchdogProcess;
  watchdogProcess = null;
  if (!proc) return;
  try {
    if (proc.connected) proc.send({ type: "shutdown" });
  } catch (_) {}
  setTimeout(() => {
    try {
      proc.kill("SIGTERM");
    } catch (_) {}
  }, 1200);
}

function syncWatchdogState(reason = "config-sync", options = {}) {
  const keepIfArmedWhileQuitting = !!(options && options.keepIfArmedWhileQuitting);
  const armed = shouldArmWatchdog(daemonConfig);
  if (keepIfArmedWhileQuitting && isQuitting) {
    if (!armed) {
      stopWatchdog();
      return;
    }
    watchdogShouldRun = true;
    if (!watchdogProcess) {
      startWatchdog(reason, { allowWhileQuitting: true });
    }
    return;
  }
  watchdogShouldRun = armed;
  if (!armed) {
    stopWatchdog();
    return;
  }
  startWatchdog(reason);
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function resolveTrayIcon() {
  const iconCandidates = [
    path.join(__dirname, "build", "icon.ico"),
    process.execPath
  ];
  for (const p of iconCandidates) {
    try {
      const img = nativeImage.createFromPath(p);
      if (img && !img.isEmpty()) return img;
    } catch (_) {}
  }
  return nativeImage.createEmpty();
}

function createTray() {
  if (tray) return;
  tray = new Tray(resolveTrayIcon());
  tray.setToolTip("Trajectory");
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Trajectory",
      click: () => showMainWindow()
    },
    {
      type: "separator"
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        stopDaemon();
        if (mainWindow) {
          mainWindow.destroy();
          mainWindow = null;
        }
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => showMainWindow());
}

function createWindow() {
  if (mainWindow) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: true,
    resizable: true,
    autoHideMenuBar: true,
    title: "Trajectory",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  // Standard desktop behaviors:
  // - Enable native edit shortcuts (Ctrl+C, Ctrl+V, etc.)
  // - Show a right-click context menu with cut/copy/paste/select all.
  installStandardAppMenu();
  try { mainWindow.setMenuBarVisibility(false); } catch (_) {}
  installStandardContextMenu(mainWindow);

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

if (ipcMain && typeof ipcMain.on === "function") {
  ipcMain.on("app:focus", () => {
    try {
      showMainWindow();
    } catch (err) {
      console.error("app:focus failed", err);
    }
  });

  ipcMain.on("blocker:set-fullscreen-lock", (_event, payload) => {
    try {
      const enabled = !!(payload && payload.enabled);
      const win = mainWindow || BrowserWindow.getAllWindows()[0];
      if (!win) return;
      if (enabled) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        if (typeof win.setAlwaysOnTop === "function") {
          win.setAlwaysOnTop(true, "screen-saver");
        }
        win.setFullScreen(true);
        return;
      }
      if (win.isFullScreen()) win.setFullScreen(false);
      if (typeof win.setAlwaysOnTop === "function") {
        win.setAlwaysOnTop(false);
      }
    } catch (err) {
      console.error("blocker:set-fullscreen-lock failed", err);
    }
  });

  ipcMain.on("blocker:daemon-config", (_event, payload) => {
    try {
      if (!payload || typeof payload !== "object") return;
      daemonConfig = sanitizeDaemonConfig(payload.enforcement);
      saveDaemonConfigToDisk();
      sendDaemonConfig();
      syncWatchdogState("config-update");
    } catch (err) {
      console.error("blocker:daemon-config failed", err);
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    daemonConfigPath = resolveDaemonConfigPath();
    daemonConfig = loadDaemonConfigFromDisk();
    saveDaemonConfigToDisk();
    createWindow();
    createTray();
    daemonShouldRun = true;
    startDaemon("app-ready");
    syncWatchdogState("app-ready");
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  stopDaemon();
  syncWatchdogState("before-quit", { keepIfArmedWhileQuitting: true });
});

app.on("window-all-closed", () => {
  // Keep background process alive for blocker daemon.
});

app.on("activate", () => {
  showMainWindow();
});
