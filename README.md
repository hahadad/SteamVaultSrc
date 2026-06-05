# SteamVault Desktop

Open-source Steam account switcher and library manager. This repo contains the source for the **SteamVault desktop app** - an Electron shell around [steamvault.eu](https://steamvault.eu) with a native bridge to the local Steam install (read `loginusers.vdf`, scan installed games, swap accounts, launch games).

## Install (end users)

Grab the latest installer from the [Releases](../../releases) page:

- **Windows** - `SteamVault-Setup-x64.exe` → run it. Installs to `C:\Users\<you>\AppData\Local\Programs\SteamVault\` (or wherever you point it) and creates Start Menu / Desktop shortcuts. Uninstall via `Uninstall SteamVault.exe` or *Add/Remove Programs*.

No Node, no build step, no config. Just run the installer and launch SteamVault.

### What the installer drops on disk

```
SteamVault\
├── SteamVault.exe            ← launch this
├── Uninstall SteamVault.exe
├── resources\
│   └── app.asar              ← the app (main.cjs, preload.cjs, switcher.cjs, config.js)
├── locales\                  ← Chromium locales
├── *.dll, *.pak, *.bin       ← Electron / Chromium runtime
└── LICENSE.electron, LICENSES.chromium
```

User data (settings, the per-user `config.json` override, logs) lives in
`%APPDATA%\steamvault-desktop\`. The uninstaller does not touch that folder -
delete it manually if you want a clean wipe.

## What it does

- Loads `https://steamvault.eu` inside an Electron window.
- Exposes a small native bridge to the page through `preload.cjs`:
  - `getInstalledApps()` - scans every Steam library folder for `appmanifest_*.acf` and reports which appids are fully installed.
  - `getCurrentSteamId()` - reads `loginusers.vdf` + (on Windows) `HKCU\Software\Valve\Steam\AutoLoginUser`.
  - `switchAndLaunch(steamid64, appid)` - kills Steam, flips `MostRecent` in `loginusers.vdf`, writes `AutoLoginUser` + `RememberPassword`, and relaunches Steam with `-applaunch <appid>`.
- Backs up `loginusers.vdf` to `loginusers.vdf.steamvault.bak` once, before the first rewrite.

## Build from source

You only need this if you want to run the app locally or build your own installer.

```bash
git clone https://github.com/hahadad/SteamVaultSrc.git
cd SteamVaultSrc
npm install

# Run unpackaged
npm start

# Build Windows installer
npm run dist:win
```

Output lands in `dist/`.

### Point it at your own web app

By default the shell loads `https://steamvault.eu`. Override per-run:

```bash
STEAMVAULT_URL="http://localhost:3000" npm start
```

Or edit the bundled `config.json`:

```json
{
  "appUrl": "https://your.domain",
  "windowTitle": "My Build \\ SteamVault"
}
```

End users can override the same values in `%APPDATA%\steamvault-desktop\config.json`.

## Project layout

| File | Purpose |
| --- | --- |
| `main.cjs` | Electron main process - creates the BrowserWindow, registers IPC handlers. |
| `preload.cjs` | Exposes `window.steamvaultDesktop` to the web app (contextIsolation on). |
| `switcher.cjs` | Native Steam logic: find install, parse `loginusers.vdf`, kill/relaunch Steam, scan installed apps. |
| `config.js` | Merges defaults + bundled `config.json` + per-user override + env vars. |
| `package.json` | Electron + `@electron/packager` scripts. |

## Security

- `contextIsolation: true`, `nodeIntegration: false` - the web app never touches Node directly, only the whitelisted IPC channels in `preload.cjs`.
- The switcher only reads/writes:
  - `<Steam>\config\loginusers.vdf` (with a one-time `.steamvault.bak` backup).
  - `HKCU\Software\Valve\Steam\AutoLoginUser` and `RememberPassword` (Windows only).
  - `appmanifest_*.acf` files (read-only).
- It does **not** read passwords, tokens, or session cookies. Steam's auto-login is handled by Steam itself once `MostRecent` + `AutoLoginUser` are set.
- No telemetry, no auto-update server, no analytics - the only network traffic is whatever `https://steamvault.eu` (or your `STEAMVAULT_URL`) makes in the embedded browser.
- For safety, i recommend using the SteamVault, instead of making your own.

## License

MIT.
