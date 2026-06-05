# SteamVault Desktop

Open-source desktop shell for [SteamVault](https://steamvault.eu) — a Steam account switcher and library manager.

This repo contains the Electron app that wraps the SteamVault web app and adds native bridges for talking to your local Steam install (reading `loginusers.vdf`, scanning installed games, switching account + launching games).

The web app itself is closed-source; this desktop wrapper is MIT-licensed so you can audit exactly what touches your machine.

---

## Download

Grab the latest build from the [Releases page](../../releases) — no build step required.

- **Windows**: `SteamVault-win32-x64.zip` — unzip and run `SteamVault.exe`
- **Linux**: `SteamVault-linux-x64.tar.gz` — extract and run `./SteamVault`
- **macOS**: `SteamVault-darwin-x64.zip` — unzip and run `SteamVault.app`

> macOS users: right-click → Open the first time (unsigned build).

---

## What it does

- Reads your local `loginusers.vdf` to list every Steam account you've signed into.
- Scans your Steam library folders for installed games (via `appmanifest_*.acf`).
- Switches the active Steam account and launches a chosen game in one click:
  1. Kills any running Steam process
  2. Rewrites `loginusers.vdf` so the target account is `MostRecent`
  3. On Windows, sets `HKCU\Software\Valve\Steam\AutoLoginUser` + `RememberPassword`
  4. Relaunches Steam with `-applaunch <appid>`
- Everything else (UI, library data, account sync) is the SteamVault web app loaded inside an Electron `BrowserWindow`.

No keylogging, no credential capture, no network calls outside of `steamvault.eu`. See `main.cjs` and `switcher.cjs` — that's all of it.

---

## Build from source

Requires Node 20+.

```bash
git clone https://github.com/YOUR_USERNAME/SteamVaultSrc.git
cd SteamVaultSrc
npm install

# Run in dev
npm start

# Package binaries (output in ./release)
npm run package:win
npm run package:linux
npm run package:mac
```

### Point it at a different URL

By default the app loads `https://steamvault.eu`. Override it with an env var:

```bash
STEAMVAULT_URL="http://localhost:3000" npm start
```

Or edit `config.json`:

```json
{
  "appUrl": "https://your-instance.example.com",
  "windowTitle": "Library \\ SteamVault"
}
```

---

## Project layout

```
main.cjs        Electron main process + IPC handlers
preload.cjs     contextBridge — exposes the native API to the renderer
switcher.cjs    Steam install detection, vdf parsing, account switch + launch
config.js       Config loader (env > userData/config.json > bundled defaults)
config.json     Bundled default config
package.json    Electron + packaging scripts
```

---

## Security

- `contextIsolation: true`, `nodeIntegration: false` — the renderer can only call the whitelisted IPC handlers defined in `preload.cjs`.
- External links (`http(s)://`, `steam://`, `mailto:`) are handed off to the OS shell; the window cannot navigate away from `steamvault.eu`.
- The Windows registry write is limited to `HKCU\Software\Valve\Steam` (`AutoLoginUser`, `RememberPassword`).
- A one-time backup of `loginusers.vdf` is written to `loginusers.vdf.steamvault.bak` before the first edit.

Found something off? Open an issue or PR.

---

## License

MIT.
