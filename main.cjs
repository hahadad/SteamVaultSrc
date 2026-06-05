/* eslint-disable */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const switcher = require("./switcher.cjs");
const { loadConfig } = require("./config.js");

// Loaded once the app is ready (loadConfig touches app.getPath()).
let CONFIG = { appUrl: "http://localhost:3000", windowTitle: "Library \\ SteamVault" };
let APP_URL = CONFIG.appUrl;

let mainWindow = null;
const startMinimized = process.argv.includes("--minimized");

function isExternalScheme(url) {
  return /^(steam|mailto|tel):/i.test(url);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: "#0b0d10",
    title: CONFIG.windowTitle,
    autoHideMenuBar: true,
    // Fully frameless - the app renders its own titlebar with drag region
    // and window controls (see src/components/desktop-titlebar.tsx).
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Drop the Electron menu bar entirely (File / Edit / View / Help).
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadURL(APP_URL);

  // Start maximized so the initial render fills the screen instead of
  // showing a window that's smaller than the app's natural layout (which
  // forced an ugly native scrollbar on first paint).
  mainWindow.once("ready-to-show", () => {
    if (startMinimized) {
      try {
        mainWindow.minimize();
      } catch (_e) {}
      // Don't call show() — keeps it off-screen in the taskbar/dock.
      return;
    }
    try {
      mainWindow.maximize();
    } catch (_e) {}
    mainWindow.show();
  });

  // Open external links (Steam store, GitHub, steam://, etc.) in the
  // user's default handler. NEVER let Electron try to open a non-http
  // URL inside a BrowserWindow - that loads about:blank and leaves the user
  // staring at an empty SteamVault window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") || isExternalScheme(url)) {
      shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  // Block any top-level navigation away from the app, and hand external
  // schemes off to the OS.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      const current = new URL(mainWindow.webContents.getURL() || APP_URL);
      if (target.origin === current.origin) return;
    } catch (_e) {
      // fall through and treat as external
    }
    event.preventDefault();
    if (url.startsWith("http") || isExternalScheme(url)) {
      shell.openExternal(url).catch(() => {});
    }
  });

  // Same protection for redirect chains.
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (isExternalScheme(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });
}

ipcMain.handle("steamvault:openExternal", async (_evt, url) => {
  if (typeof url !== "string") return { ok: false, error: "Invalid URL" };
  if (!/^(https?|steam|mailto):/i.test(url)) {
    return { ok: false, error: "Unsupported URL scheme" };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("steamvault:window", async (_evt, action) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win) return { ok: false };
  if (action === "minimize") win.minimize();
  else if (action === "maximize") {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else if (action === "close") win.close();
  return { ok: true };
});

ipcMain.handle("steamvault:getAutoStart", async () => {
  try {
    const settings = app.getLoginItemSettings();
    return { ok: true, enabled: !!settings.openAtLogin };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), enabled: false };
  }
});

ipcMain.handle("steamvault:setAutoStart", async (_evt, payload) => {
  const enabled = !!payload?.enabled;
  const minimized = !!payload?.minimized;
  try {
    if (!enabled) {
      app.setLoginItemSettings({ openAtLogin: false, args: [] });
      return { ok: true, enabled: false, openAsMinimized: false };
    }
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: minimized, // macOS hint
      args: minimized ? ["--minimized"] : [],
    });
    return { ok: true, enabled: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("steamvault:getInfo", async () => {
  try {
    return {
      platform: process.platform,
      steamPath: switcher.findSteamPath(),
      users: switcher.readLoginUsers(),
      version: app.getVersion(),
    };
  } catch (err) {
    return { platform: process.platform, error: String(err) };
  }
});

ipcMain.handle("steamvault:getInstalledApps", async () => {
  try {
    return { ok: true, apps: switcher.getInstalledApps() };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), apps: {} };
  }
});

ipcMain.handle("steamvault:getCurrentSteamId", async () => {
  try {
    return { ok: true, steamid64: switcher.getCurrentSteamId() };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), steamid64: null };
  }
});

function measureDirectorySize(dir, budgetBytes) {
  // Walk the folder, summing file sizes. Stop early once we cross
  // `budgetBytes` so a 200 GB game install doesn't take forever.
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) {
          total += fs.statSync(p).size;
          if (total >= budgetBytes) return total;
        }
      } catch (_e) {}
    }
  }
  return total;
}

ipcMain.handle("steamvault:pickFolder", async (_evt, payload) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const title = payload?.title || "Locate game install folder";
  const result = await dialog.showOpenDialog(win, {
    title,
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }
  const folder = result.filePaths[0];
  const MIN = 20 * 1024 * 1024;
  const size = measureDirectorySize(folder, MIN * 2);
  return {
    ok: true,
    folder,
    sizeOnDisk: size,
    installed: size >= MIN,
  };
});

ipcMain.handle("steamvault:switchAndLaunch", async (_evt, payload) => {
  const { steamid64, appid, dryRun } = payload || {};
  if (!steamid64 || !/^\d{17}$/.test(String(steamid64))) {
    return { ok: false, error: "Invalid SteamID64" };
  }
  try {
    const result = await switcher.switchAndLaunch({
      steamid64: String(steamid64),
      appid: appid != null ? Number(appid) : null,
      dryRun: Boolean(dryRun),
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

app.whenReady().then(() => {
  CONFIG = loadConfig();
  APP_URL = CONFIG.appUrl;
  createWindow();
});

// Remove the application menu before any window is created so the menu bar
// doesn't flash on launch.
app.whenReady().then(() => Menu.setApplicationMenu(null));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});