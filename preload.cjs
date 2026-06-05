/* eslint-disable */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("steamvaultDesktop", {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke("steamvault:getInfo"),
  getInstalledApps: () => ipcRenderer.invoke("steamvault:getInstalledApps"),
  getCurrentSteamId: () => ipcRenderer.invoke("steamvault:getCurrentSteamId"),
  pickFolder: (opts) => ipcRenderer.invoke("steamvault:pickFolder", opts ?? {}),
  switchAndLaunch: (steamid64, appid, opts) =>
    ipcRenderer.invoke("steamvault:switchAndLaunch", {
      steamid64,
      appid,
      dryRun: opts?.dryRun ?? false,
    }),
  openExternal: (url) => ipcRenderer.invoke("steamvault:openExternal", url),
  getAutoStart: () => ipcRenderer.invoke("steamvault:getAutoStart"),
  setAutoStart: (enabled, minimized) =>
    ipcRenderer.invoke("steamvault:setAutoStart", { enabled, minimized }),
  window: {
    minimize: () => ipcRenderer.invoke("steamvault:window", "minimize"),
    maximize: () => ipcRenderer.invoke("steamvault:window", "maximize"),
    close: () => ipcRenderer.invoke("steamvault:window", "close"),
  },
});