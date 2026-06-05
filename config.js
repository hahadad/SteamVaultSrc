/* eslint-disable */


const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULTS = {
  
  appUrl: "https://steamvault.eu",
  // Your own configurable wwindow title shown in the OS taskbar / dock.
  windowTitle: "Library \\ SteamVault",
};

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_e) {
    return null;
  }
}

function loadConfig() {
  const bundled = readJsonSafe(path.join(__dirname, "config.json")) || {};
  let userFile = null;
  try {
    userFile = readJsonSafe(path.join(app.getPath("userData"), "config.json"));
  } catch (_e) {
    
  }
  const merged = { ...DEFAULTS, ...bundled, ...(userFile || {}) };

  if (process.env.STEAMVAULT_URL) merged.appUrl = process.env.STEAMVAULT_URL;
  if (process.env.STEAMVAULT_WINDOW_TITLE)
    merged.windowTitle = process.env.STEAMVAULT_WINDOW_TITLE;

  return merged;
}

module.exports = { loadConfig };
