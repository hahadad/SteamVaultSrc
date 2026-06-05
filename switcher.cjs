/* eslint-disable */
/**
 * Native Steam account switcher.
 *
 * Mirrors what the SteamVault desktop switcher does:
 *   1. Locate the Steam install directory.
 *   2. Read <steam>/config/loginusers.vdf and find the target SteamID64.
 *   3. Kill any running Steam process (Steam refuses to honour a switch while
 *      it is already signed into another account).
 *   4. Rewrite loginusers.vdf so the target user has MostRecent "1" and every
 *      other user has MostRecent "0".
 *   5. On Windows, write HKCU\Software\Valve\Steam\AutoLoginUser to the
 *      target's AccountName plus RememberPassword=1 - without this Steam
 *      shows the login prompt instead of auto-signing in.
 *   6. Relaunch Steam with `-applaunch <appid>` so it logs in then boots the
 *      requested game.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function tryExec(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", windowsHide: true });
  } catch (_err) {
    return null;
  }
}

function findSteamPath() {
  if (process.platform === "win32") {
    const out = tryExec("reg", [
      "query",
      "HKCU\\Software\\Valve\\Steam",
      "/v",
      "SteamPath",
    ]);
    if (out) {
      const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (m) return m[1].trim().replace(/\//g, "\\");
    }
    const guesses = [
      "C:\\Program Files (x86)\\Steam",
      "C:\\Program Files\\Steam",
    ];
    for (const g of guesses) if (fs.existsSync(g)) return g;
  } else if (process.platform === "darwin") {
    const g = path.join(os.homedir(), "Library", "Application Support", "Steam");
    if (fs.existsSync(g)) return g;
  } else {
    const guesses = [
      path.join(os.homedir(), ".steam", "steam"),
      path.join(os.homedir(), ".local", "share", "Steam"),
      path.join(os.homedir(), ".var", "app", "com.valvesoftware.Steam", "data", "Steam"),
    ];
    for (const g of guesses) if (fs.existsSync(g)) return g;
  }
  throw new Error("Could not locate Steam install");
}

function loginUsersPath() {
  return path.join(findSteamPath(), "config", "loginusers.vdf");
}

/** Parse loginusers.vdf into a list of {steamid64, accountName, personaName, mostRecent}. */
function readLoginUsers() {
  const file = loginUsersPath();
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const users = [];
  const blockRe = /"(\d{17})"\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const body = m[2];
    const pull = (key) => {
      const r = new RegExp(`"${key}"\\s*"([^"]*)"`, "i");
      const mm = body.match(r);
      return mm ? mm[1] : null;
    };
    users.push({
      steamid64: m[1],
      accountName: pull("AccountName"),
      personaName: pull("PersonaName"),
      mostRecent: pull("MostRecent") === "1",
      rememberPassword: pull("RememberPassword") === "1",
      timestamp: Number(pull("Timestamp") || 0),
    });
  }
  return users;
}

/**
 * Return the SteamID64 of whichever account Steam will sign in as next time
 * it launches. Combines the MostRecent flag in loginusers.vdf with the
 * Windows registry AutoLoginUser value (if set) so we don't bother
 * killing/relaunching Steam when the target is already the active account.
 */
function getCurrentSteamId() {
  const users = readLoginUsers();
  let autoName = null;
  if (process.platform === "win32") {
    const out = tryExec("reg", [
      "query",
      "HKCU\\Software\\Valve\\Steam",
      "/v",
      "AutoLoginUser",
    ]);
    if (out) {
      const m = out.match(/AutoLoginUser\s+REG_SZ\s+(.+)/i);
      if (m) autoName = m[1].trim();
    }
  }
  if (autoName) {
    const hit = users.find(
      (u) => (u.accountName || "").toLowerCase() === autoName.toLowerCase(),
    );
    if (hit) return hit.steamid64;
  }
  const mr = users.find((u) => u.mostRecent);
  return mr ? mr.steamid64 : null;
}

/** Rewrite loginusers.vdf flipping MostRecent so only `targetSteamId` is "1". */
function writeMostRecent(targetSteamId) {
  const file = loginUsersPath();
  const original = fs.readFileSync(file, "utf8");
  // Back up once per day at most.
  const backup = `${file}.steamvault.bak`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);

  let found = false;
  const out = original.replace(
    /"(\d{17})"\s*\{([^}]*)\}/g,
    (whole, sid, body) => {
      const isTarget = sid === targetSteamId;
      if (isTarget) found = true;
      const desired = isTarget ? "1" : "0";
      let newBody = body;
      if (/"MostRecent"\s*"[01]"/i.test(newBody)) {
        newBody = newBody.replace(
          /"MostRecent"\s*"[01]"/i,
          `"MostRecent"\t\t"${desired}"`,
        );
      } else {
        // Insert before the closing brace if Steam ever omits it.
        newBody = newBody.replace(/\s*$/, `\n\t\t"MostRecent"\t\t"${desired}"\n\t`);
      }
      // Also flip RememberPassword on for the target so Steam doesn't prompt.
      if (isTarget) {
        if (/"RememberPassword"\s*"[01]"/i.test(newBody)) {
          newBody = newBody.replace(
            /"RememberPassword"\s*"[01]"/i,
            `"RememberPassword"\t\t"1"`,
          );
        }
      }
      return `"${sid}"\n\t{${newBody}}`;
    },
  );
  if (!found) {
    throw new Error(
      `SteamID ${targetSteamId} is not signed into Steam on this machine yet. ` +
        `Sign in to it once via the Steam client so SteamVault can swap to it later.`,
    );
  }
  fs.writeFileSync(file, out);
}

async function killSteam() {
  if (process.platform === "win32") {
    tryExec("taskkill", ["/IM", "steam.exe", "/F"]);
    tryExec("taskkill", ["/IM", "steamwebhelper.exe", "/F"]);
  } else if (process.platform === "darwin") {
    tryExec("pkill", ["-x", "steam_osx"]);
    tryExec("osascript", ["-e", 'tell application "Steam" to quit']);
  } else {
    tryExec("pkill", ["-x", "steam"]);
    tryExec("pkill", ["-x", "steamwebhelper"]);
  }
  // Give Steam a moment to flush its own loginusers.vdf write before we touch it.
  await sleep(1500);
}

function setWindowsAutoLogin(accountName) {
  if (process.platform !== "win32") return;
  tryExec("reg", [
    "add",
    "HKCU\\Software\\Valve\\Steam",
    "/v",
    "AutoLoginUser",
    "/t",
    "REG_SZ",
    "/d",
    accountName,
    "/f",
  ]);
  tryExec("reg", [
    "add",
    "HKCU\\Software\\Valve\\Steam",
    "/v",
    "RememberPassword",
    "/t",
    "REG_DWORD",
    "/d",
    "1",
    "/f",
  ]);
}

function launchSteam(appid) {
  const steamPath = findSteamPath();
  const args = appid ? ["-applaunch", String(appid)] : [];
  if (process.platform === "win32") {
    const exe = path.join(steamPath, "steam.exe");
    spawn(exe, args, { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", ["-a", "Steam", "--args", ...args], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } else {
    spawn("steam", args, { detached: true, stdio: "ignore" }).unref();
  }
}

/**
 * Scan all Steam library folders for appmanifest_*.acf files and return a
 * map of appid → { sizeOnDisk, stateFlags, installed }. A game counts as
 * "installed" only when the manifest's StateFlags bit 4 (StateFullyInstalled)
 * is set AND SizeOnDisk is meaningful (>20 MB), so we don't get fooled by
 * orphaned manifests or tiny cache leftovers.
 */
function getInstalledApps() {
  let steamPath;
  try {
    steamPath = findSteamPath();
  } catch (_e) {
    return {};
  }
  const libraryRoots = [path.join(steamPath, "steamapps")];
  const lfFile = path.join(steamPath, "steamapps", "libraryfolders.vdf");
  if (fs.existsSync(lfFile)) {
    try {
      const text = fs.readFileSync(lfFile, "utf8");
      const pathRe = /"path"\s*"([^"]+)"/gi;
      let m;
      while ((m = pathRe.exec(text)) !== null) {
        const p = path.join(m[1].replace(/\\\\/g, "\\"), "steamapps");
        if (!libraryRoots.includes(p) && fs.existsSync(p)) libraryRoots.push(p);
      }
    } catch (_e) {}
  }

  const MIN_INSTALLED_BYTES = 20 * 1024 * 1024; // 20 MB
  const apps = {};
  for (const root of libraryRoots) {
    let files;
    try {
      files = fs.readdirSync(root);
    } catch (_e) {
      continue;
    }
    for (const f of files) {
      const mm = f.match(/^appmanifest_(\d+)\.acf$/);
      if (!mm) continue;
      const appid = Number(mm[1]);
      try {
        const text = fs.readFileSync(path.join(root, f), "utf8");
        const pull = (key) => {
          const r = new RegExp(`"${key}"\\s*"([^"]*)"`, "i");
          const x = text.match(r);
          return x ? x[1] : null;
        };
        const stateFlags = Number(pull("StateFlags") || 0);
        const sizeOnDisk = Number(pull("SizeOnDisk") || 0);
        const fullyInstalled = (stateFlags & 4) !== 0;
        const installed = fullyInstalled && sizeOnDisk >= MIN_INSTALLED_BYTES;
        // If the same appid appears in multiple libraries, keep the "installed" winner.
        if (!apps[appid] || (installed && !apps[appid].installed)) {
          apps[appid] = { appid, sizeOnDisk, stateFlags, installed };
        }
      } catch (_e) {}
    }
  }
  return apps;
}

async function switchAndLaunch({ steamid64, appid, dryRun }) {
  const users = readLoginUsers();
  const target = users.find((u) => u.steamid64 === steamid64);
  if (!target) {
    throw new Error(
      `SteamID ${steamid64} hasn't signed into this Steam client yet. ` +
        `Open Steam once and sign into that account, then SteamVault can swap back to it instantly.`,
    );
  }
  if (dryRun) {
    return { switched: false, target, dryRun: true };
  }
  // Fast path: target is already the active account. No need to kill Steam.
  const current = getCurrentSteamId();
  if (current === steamid64) {
    launchSteam(appid);
    return { switched: false, alreadyActive: true, target, launchedAppid: appid ?? null };
  }
  await killSteam();
  writeMostRecent(steamid64);
  if (target.accountName) setWindowsAutoLogin(target.accountName);
  launchSteam(appid);
  return { switched: true, target, launchedAppid: appid ?? null };
}

module.exports = {
  findSteamPath,
  loginUsersPath,
  readLoginUsers,
  getCurrentSteamId,
  writeMostRecent,
  killSteam,
  setWindowsAutoLogin,
  launchSteam,
  switchAndLaunch,
  getInstalledApps,
};