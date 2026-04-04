#!/usr/bin/env bun
/**
 * claude-ink-hud — Your Claude Code dashboard on Kindle E-ink
 * Zero dependencies. Zero cloud. Just run: bun server.ts
 *
 * Kindle:  http://<your-mac-ip>:3456
 * Hooks:   http://localhost:3456/status
 */

const PORT = 3456;
const WATER_DEFAULT = 30;
const STAND_DEFAULT = 45;
const TZ_OFFSET_HOURS = 8; // UTC+8 (China Standard Time)

// Heatmap — 24 slots, persisted to disk
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dir, ".data");
const HEATMAP_FILE = join(DATA_DIR, "heatmap.json");

function loadHeatmap(): { date: string; data: number[] } {
  try {
    if (existsSync(HEATMAP_FILE)) {
      return JSON.parse(readFileSync(HEATMAP_FILE, "utf-8"));
    }
  } catch {}
  return { date: new Date().toDateString(), data: new Array(24).fill(0) };
}

function saveHeatmap() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(HEATMAP_FILE, JSON.stringify({ date: heatmapDate, data: heatmap }));
  } catch {}
}

let { date: heatmapDate, data: heatmap } = loadHeatmap();

function recordHeatmap() {
  const today = new Date().toDateString();
  if (today !== heatmapDate) { heatmap = new Array(24).fill(0); heatmapDate = today; }
  const utcNow = Date.now();
  const hour = new Date(utcNow + TZ_OFFSET_HOURS * 3600000).getUTCHours();
  heatmap[hour]++;
  saveHeatmap();
}

// In-memory state — no database needed
let state: Record<string, string> = {
  tool: "",
  file: "",
  message: "Waiting for Claude Code...",
  project: "",
  sessionStart: "",
  gitBranch: "",
  gitStatus: "",
  model: "",
  contextPercent: "",
  contextSize: "",
  usage5h: "",
  usage7d: "",
  timestamp: new Date().toISOString(),
};

function merge(prev: Record<string, string>, body: Record<string, string>, isMetrics: boolean): Record<string, string> {
  return {
    tool: isMetrics ? (prev.tool || "") : (body.tool || "unknown"),
    file: isMetrics ? (prev.file || "") : (body.file || ""),
    message: isMetrics ? (prev.message || "") : (body.message || ""),
    project: body.project || prev.project || "",
    sessionStart: body.sessionStart || prev.sessionStart || "",
    gitBranch: body.gitBranch || prev.gitBranch || "",
    gitStatus: body.gitStatus || prev.gitStatus || "",
    model: body.model || prev.model || "",
    contextPercent: isMetrics ? (body.contextPercent || prev.contextPercent || "") : (prev.contextPercent || ""),
    contextSize: isMetrics ? (body.contextSize || prev.contextSize || "") : (prev.contextSize || ""),
    usage5h: isMetrics ? (body.usage5h || prev.usage5h || "") : (prev.usage5h || ""),
    usage7d: isMetrics ? (body.usage7d || prev.usage7d || "") : (prev.usage7d || ""),
    timestamp: new Date().toISOString(),
  };
}

function getHTML(waterMin: number, standMin: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Code</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: "Amazon Ember", Helvetica, sans-serif;
  background: #fff;
  color: #000;
  padding: 10px 14px;
  line-height: 1.2;
  -webkit-font-smoothing: none;
}
.ctx-border { position: fixed; background: #ddd; z-index: 10; }
.ctx-border .fill { background: #000; position: absolute; }
.ctx-top, .ctx-bottom { left: 0; width: 100%; height: 8px; }
.ctx-top { top: 0; }
.ctx-bottom { bottom: 0; }
.ctx-top .fill { left: 0; top: 0; height: 100%; width: 0; }
.ctx-bottom .fill { right: 0; top: 0; height: 100%; width: 0; }
.ctx-left, .ctx-right { top: 0; width: 8px; height: 100%; }
.ctx-right { right: 0; }
.ctx-left { left: 0; }
.ctx-right .fill { top: 0; left: 0; width: 100%; height: 0; }
.ctx-left .fill { bottom: 0; left: 0; width: 100%; height: 0; }
.ctx-label { position: fixed; bottom: 6px; left: 50%; transform: translateX(-50%); font-size: 10px; font-family: "Courier New", monospace; color: #666; background: #fff; padding: 0 6px; z-index: 11; }
.hdr { text-align: center; padding: 4px 0 6px; border-bottom: 2px solid #000; margin-bottom: 5px; position: relative; }
.hdr-clock { position: absolute; right: 0; top: 4px; font-size: 13px; font-family: "Courier New", monospace; }
.hdr-session { position: absolute; right: 0; bottom: 6px; font-size: 12px; color: #555; }
.ci { display: inline-block; width: 68px; height: 62px; position: relative; vertical-align: middle; }
.ci-body { position: absolute; top: 2px; left: 6px; width: 56px; height: 38px; background: #000; border-radius: 14px 14px 5px 5px; }
.ci-eye-l, .ci-eye-r { position: absolute; top: 16px; width: 8px; height: 8px; background: #fff; border-radius: 4px; }
.ci-eye-l { left: 19px; } .ci-eye-r { left: 41px; }
.ci-leg { position: absolute; bottom: 0; width: 8px; height: 18px; background: #000; border-radius: 0 0 4px 4px; transform-origin: top center; }
.ci-l1 { left: 9px; } .ci-l2 { left: 22px; } .ci-l3 { left: 36px; } .ci-l4 { left: 50px; }
.px-title { font-family: "Courier New", monospace; font-size: 20px; font-weight: 900; letter-spacing: 5px; text-transform: uppercase; margin-top: 2px; text-shadow: 1px 0 0 #000, 2px 0 0 #000; }
.hdr-model { font-size: 11px; color: #666; }
.gear { position: absolute; left: 0; top: 4px; font-size: 18px; cursor: pointer; width: 24px; text-align: center; font-family: "Courier New", monospace; }
.sl { font-size: 12px; font-weight: bold; color: #555; margin-bottom: 2px; }
.act { border: 2px solid #000; padding: 5px 8px 8px; margin-bottom: 5px; height: 68px; overflow: hidden; }
.act-row { display: flex; justify-content: space-between; align-items: baseline; }
.act-tool { font-size: 20px; font-weight: bold; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 75%; }
.act-time { font-size: 12px; color: #555; font-family: "Courier New", monospace; }
.act-file { font-size: 12px; font-family: "Courier New", monospace; padding: 2px 6px; background: #f0f0f0; border-left: 3px solid #000; margin-top: 3px; word-break: break-all; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; height: 18px; visibility: hidden; }
.act-file.vis { visibility: visible; }
.act.offline { border-style: dashed; color: #999; }
.act.offline .act-tool { color: #999; }
.act-stale { font-size: 11px; color: #999; font-family: "Courier New", monospace; text-align: right; }
.gs { display: flex; gap: 4px; margin-bottom: 5px; }
.g { flex: 1; border: 1px solid #888; padding: 4px 6px 6px; height: 44px; overflow: hidden; }
.g-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
.g-lbl { font-size: 14px; font-weight: bold; }
.g-val { font-size: 16px; font-weight: bold; font-family: "Courier New", monospace; }
.g-bar { height: 14px; background: #e8e8e8; border: 1px solid #888; position: relative; }
.g-fill { height: 100%; background: #000; position: absolute; left: 0; top: 0; }
.mt { display: flex; justify-content: space-between; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 3px 4px; margin-bottom: 5px; font-size: 14px; height: 22px; overflow: hidden; }
.lg { border: 1px solid #ccc; padding: 4px 6px; margin-bottom: 4px; height: 200px; overflow: hidden; }
.lg-t { font-size: 13px; font-weight: bold; color: #555; margin-bottom: 2px; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
.lg-e { display: flex; font-size: 14px; height: 22px; line-height: 22px; border-bottom: 1px dotted #ddd; font-family: "Courier New", monospace; }
.lg-e:last-child { border-bottom: none; }
.lg-n { font-weight: bold; width: 70px; flex-shrink: 0; }
.lg-f { flex: 1; color: #555; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 4px; }
.lg-t2 { color: #888; width: 45px; text-align: right; flex-shrink: 0; }
.settings { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 85%; max-width: 380px; background: #fff; border: 3px solid #000; z-index: 999; padding: 14px 16px; box-shadow: 4px 4px 0 #000; }
.settings.show { display: block; }
.set-title { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 12px; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
.set-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #ddd; }
.set-label { font-size: 14px; font-weight: bold; }
.set-ctrl { display: flex; align-items: center; gap: 8px; }
.set-btn { width: 32px; height: 32px; border: 2px solid #000; background: #fff; font-size: 20px; font-weight: bold; text-align: center; line-height: 28px; cursor: pointer; font-family: "Courier New", monospace; }
.set-val { font-size: 20px; font-weight: bold; font-family: "Courier New", monospace; min-width: 50px; text-align: center; }
.set-unit { font-size: 12px; color: #666; }
.set-actions { display: flex; gap: 8px; margin-top: 12px; }
.set-actions button { flex: 1; padding: 8px; font-size: 14px; font-weight: bold; border: 2px solid #000; cursor: pointer; font-family: "Amazon Ember", Helvetica, sans-serif; }
.set-ok { background: #000; color: #fff; }
.set-cancel { background: #fff; color: #000; }
.welcome-bg { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.3); z-index: 999; }
.welcome-bg.show { display: block; }
.welcome { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 420px; max-height: 85%; overflow-y: auto; background: #fff; border: 4px solid #000; box-shadow: 6px 6px 0 #000; z-index: 1000; padding: 12px 16px; }
.welcome.show { display: block; }
.welcome h1 { text-align: center; font-size: 16px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #000; }
.welcome .w-item { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px dotted #ccc; align-items: flex-start; }
.welcome .w-icon { min-width: 30px; font-size: 18px; text-align: center; font-family: "Courier New", monospace; font-weight: bold; }
.welcome .w-text { font-size: 13px; line-height: 1.4; }
.welcome .w-text b { font-size: 14px; }
.welcome .w-ok { display: block; width: 100%; margin-top: 12px; padding: 10px; font-size: 16px; font-weight: bold; background: #000; color: #fff; border: none; cursor: pointer; font-family: "Amazon Ember", Helvetica, sans-serif; }
.rm { display: flex; gap: 6px; margin-top: 4px; }
.rm-card { flex: 1; border: 1px solid #aaa; padding: 4px 6px; text-align: center; cursor: pointer; height: 62px; overflow: hidden; }
.rm-card.alert { border: 3px solid #000; background: #f0f0f0; }
.overlay-bg { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.3); z-index: 998; }
.overlay-bg.show { display: block; }
.overlay { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80%; max-width: 360px; background: #fff; border: 4px solid #000; z-index: 999; text-align: center; padding: 20px 16px 16px; cursor: pointer; box-shadow: 6px 6px 0 #000; }
.overlay.show { display: block; }
.overlay-icon { display: inline-block; width: 80px; height: 90px; position: relative; margin-bottom: 10px; }
.ow-rim { position: absolute; top: 8px; left: 0; width: 80px; height: 6px; background: #000; }
.ow-body { position: absolute; top: 14px; left: 8px; width: 64px; height: 70px; border: 5px solid #000; border-top: none; border-radius: 0 0 10px 10px; }
.ow-water { position: absolute; bottom: 5px; left: 13px; width: 54px; height: 35px; background: #000; border-radius: 0 0 8px 8px; }
.os-head { position: absolute; top: 0; left: 30px; width: 20px; height: 20px; background: #000; border-radius: 10px; }
.os-body { position: absolute; top: 22px; left: 37px; width: 6px; height: 32px; background: #000; }
.os-arm-l { position: absolute; top: 28px; left: 14px; width: 22px; height: 5px; background: #000; transform: rotate(-30deg); }
.os-arm-r { position: absolute; top: 28px; left: 44px; width: 22px; height: 5px; background: #000; transform: rotate(30deg); }
.os-leg-l { position: absolute; top: 52px; left: 22px; width: 5px; height: 30px; background: #000; transform: rotate(10deg); }
.os-leg-r { position: absolute; top: 52px; left: 52px; width: 5px; height: 30px; background: #000; transform: rotate(-10deg); }
.overlay-title { font-size: 32px; font-weight: 900; font-family: "Courier New", monospace; letter-spacing: 2px; margin-bottom: 8px; }
.overlay-sub { font-size: 16px; color: #666; }
.rm-icons { display: flex; justify-content: center; margin-bottom: 2px; }
.icon-water { display: inline-block; width: 20px; height: 24px; position: relative; }
.iw-body { position: absolute; bottom: 0; left: 3px; width: 14px; height: 18px; border: 2px solid #000; border-top: none; border-radius: 0 0 3px 3px; }
.iw-water { position: absolute; bottom: 2px; left: 5px; width: 10px; height: 8px; background: #000; border-radius: 0 0 2px 2px; }
.iw-rim { position: absolute; top: 4px; left: 1px; width: 18px; height: 2px; background: #000; }
.icon-stand { display: inline-block; width: 20px; height: 24px; position: relative; }
.is-head { position: absolute; top: 0; left: 7px; width: 6px; height: 6px; background: #000; border-radius: 3px; }
.is-body { position: absolute; top: 7px; left: 9px; width: 2px; height: 10px; background: #000; }
.is-arm-l { position: absolute; top: 9px; left: 3px; width: 6px; height: 2px; background: #000; transform: rotate(-30deg); }
.is-arm-r { position: absolute; top: 9px; left: 11px; width: 6px; height: 2px; background: #000; transform: rotate(30deg); }
.is-leg-l { position: absolute; top: 16px; left: 5px; width: 2px; height: 8px; background: #000; transform: rotate(10deg); }
.is-leg-r { position: absolute; top: 16px; left: 13px; width: 2px; height: 8px; background: #000; transform: rotate(-10deg); }
.rm-label { font-size: 11px; font-weight: bold; color: #555; }
.rm-time { font-size: 16px; font-weight: bold; font-family: "Courier New", monospace; }
.rm-alert-text { font-size: 13px; font-weight: 900; display: none; }
.rm-card.alert .rm-alert-text { display: block; }
.rm-card.alert .rm-time { display: none; }
/* Heatmap */
.hm { padding: 4px 0; margin-top: 3px; height: 42px; overflow: hidden; }
.hm-row { display: flex; justify-content: center; gap: 2px; }
.hm-cell { width: 22px; text-align: center; }
.hm-hour { font-size: 10px; color: #888; font-family: "Courier New", monospace; line-height: 1.2; }
.hm-box { width: 20px; height: 16px; border: 1px solid #ccc; background: #fff; }
.hm-box.lo { background: #bbb; border-color: #999; }
.hm-box.hi { background: #000; border-color: #000; }
</style>
</head>
<body>
<div class="ctx-border ctx-top"><div class="fill" id="cb-top"></div></div>
<div class="ctx-border ctx-right"><div class="fill" id="cb-right"></div></div>
<div class="ctx-border ctx-bottom"><div class="fill" id="cb-bottom"></div></div>
<div class="ctx-border ctx-left"><div class="fill" id="cb-left"></div></div>
<span class="ctx-label" id="cb-label"></span>

<div class="hdr">
  <span class="gear" onclick="openSettings()">[=]</span>
  <span class="gear" style="left:42px" onclick="showHelp()">[?]</span>
  <span class="hdr-clock" id="clock"></span>
  <span class="hdr-session" id="i-session"></span>
  <span class="ci"><span class="ci-body"></span><span class="ci-eye-l"></span><span class="ci-eye-r"></span><span class="ci-leg ci-l1"></span><span class="ci-leg ci-l2"></span><span class="ci-leg ci-l3"></span><span class="ci-leg ci-l4"></span></span>
  <div class="px-title">CLAUDE CODE</div>
  <div class="hdr-model" id="i-model"></div>
</div>

<div class="sl">&#9654; Current Action</div>
<div class="act" id="act-card">
  <div class="act-row">
    <span class="act-tool" id="s-tool">Loading...</span>
    <span class="act-time" id="s-time"></span>
  </div>
  <div class="act-file" id="s-file"></div>
  <div class="act-stale" id="s-stale"></div>
</div>

<div class="sl">&#9632; Metrics</div>
<div class="gs">
  <div class="g"><div class="g-row"><span class="g-lbl">Context</span><span class="g-val" id="g-ctx">—</span></div><div class="g-bar"><div class="g-fill" id="g-ctx-fill" style="width:0%"></div></div></div>
  <div class="g"><div class="g-row"><span class="g-lbl">5h Limit</span><span class="g-val" id="g-5h">—</span></div><div class="g-bar"><div class="g-fill" id="g-5h-fill" style="width:0%"></div></div></div>
</div>

<div class="mt">
  <span>&#9679; <b id="i-project">—</b></span>
  <span>&#9588; <b id="i-git">—</b></span>
</div>

<div class="lg">
  <div class="lg-t">&#9776; Recent Activity</div>
  <div id="log-entries"></div>
</div>

<div class="sl">!! Reminders</div>
<div class="rm">
  <div class="rm-card" id="rm-water" onclick="resetWater()">
    <div class="rm-icons"><span class="icon-water"><span class="iw-rim"></span><span class="iw-body"><span class="iw-water"></span></span></span></div>
    <div class="rm-label">Drink Water</div>
    <div class="rm-time" id="rm-water-time">${waterMin}:00</div>
    <div class="rm-alert-text">GO DRINK!</div>
  </div>
  <div class="rm-card" id="rm-stand" onclick="resetStand()">
    <div class="rm-icons"><span class="icon-stand"><span class="is-head"></span><span class="is-body"></span><span class="is-arm-l"></span><span class="is-arm-r"></span><span class="is-leg-l"></span><span class="is-leg-r"></span></span></div>
    <div class="rm-label">Stand Up</div>
    <div class="rm-time" id="rm-stand-time">${standMin}:00</div>
    <div class="rm-alert-text">STAND UP!</div>
  </div>
</div>

<div class="sl">::: Today's Activity</div>
<div class="hm" id="heatmap"></div>

<div class="welcome-bg" id="welcome-bg"></div>
<div class="welcome" id="welcome">
  <h1>Welcome to Claude Code Status</h1>
  <div class="w-item"><span class="w-icon">[]</span><div class="w-text"><b>Border Progress</b><br>The border fills clockwise showing 7-day usage limit.</div></div>
  <div class="w-item"><span class="w-icon">[=]</span><div class="w-text"><b>Settings</b><br>Tap [=] (top-left) to configure reminder intervals.</div></div>
  <div class="w-item"><span class="w-icon">></span><div class="w-text"><b>Current Action</b><br>Shows the tool Claude Code is using and which file.</div></div>
  <div class="w-item"><span class="w-icon">##</span><div class="w-text"><b>Metrics</b><br>Context window and 5-hour rate limit. 7-day shown as border.</div></div>
  <div class="w-item"><span class="w-icon">=</span><div class="w-text"><b>Recent Activity</b><br>Log of recent tool calls.</div></div>
  <div class="w-item"><span class="w-icon">!!</span><div class="w-text"><b>Reminders</b><br>Drink water and stand up timers. Tap to reset.</div></div>
  <button class="w-ok" onclick="dismissWelcome()">Got it!</button>
</div>

<div class="overlay-bg" id="set-bg"></div>
<div class="settings" id="settings-modal">
  <div class="set-title">Reminder Settings</div>
  <div class="set-row"><span class="set-label">Drink Water</span><div class="set-ctrl"><span class="set-btn" onclick="adjWater(-5)">-</span><span><span class="set-val" id="set-water">${waterMin}</span><span class="set-unit">min</span></span><span class="set-btn" onclick="adjWater(5)">+</span></div></div>
  <div class="set-row"><span class="set-label">Stand Up</span><div class="set-ctrl"><span class="set-btn" onclick="adjStand(-5)">-</span><span><span class="set-val" id="set-stand">${standMin}</span><span class="set-unit">min</span></span><span class="set-btn" onclick="adjStand(5)">+</span></div></div>
  <div class="set-actions"><button class="set-cancel" onclick="closeSettings()">Cancel</button><button class="set-ok" onclick="applySettings()">OK</button></div>
</div>

<div class="overlay-bg" id="ov-bg"></div>
<div class="overlay" id="ov-water" onclick="resetWater()"><div class="overlay-icon"><span class="ow-rim"></span><span class="ow-body"><span class="ow-water"></span></span></div><div class="overlay-title">GO DRINK!</div><div class="overlay-sub">tap to dismiss</div></div>
<div class="overlay" id="ov-stand" onclick="resetStand()"><div class="overlay-icon"><span class="os-head"></span><span class="os-body"></span><span class="os-arm-l"></span><span class="os-arm-r"></span><span class="os-leg-l"></span><span class="os-leg-r"></span></div><div class="overlay-title">STAND UP!</div><div class="overlay-sub">tap to dismiss</div></div>

<script>
(function() {
  var last = "";
  var sessionStartCache = "";
  var history = [];
  var MAX_HISTORY = 8;
  var todayCalls = 0;
  var waterSec = ${waterMin} * 60, standSec = ${standMin} * 60;
  var waterLeft = waterSec, standLeft = standSec;

  function fmtTimer(s) { var m = Math.floor(s/60), ss = s%60; return (m<10?"0"+m:m)+":"+(ss<10?"0"+ss:ss); }
  function updateTimers() {
    if (waterLeft > 0) { waterLeft--; document.getElementById("rm-water-time").textContent = fmtTimer(waterLeft); }
    if (waterLeft <= 0) { document.getElementById("rm-water").className="rm-card alert"; document.getElementById("ov-bg").className="overlay-bg show"; document.getElementById("ov-water").className="overlay show"; }
    if (standLeft > 0) { standLeft--; document.getElementById("rm-stand-time").textContent = fmtTimer(standLeft); }
    if (standLeft <= 0) { document.getElementById("rm-stand").className="rm-card alert"; document.getElementById("ov-bg").className="overlay-bg show"; document.getElementById("ov-stand").className="overlay show"; }
  }
  window.resetWater = function() { waterLeft=waterSec; document.getElementById("rm-water").className="rm-card"; document.getElementById("rm-water-time").textContent=fmtTimer(waterLeft); document.getElementById("ov-water").className="overlay"; document.getElementById("ov-bg").className="overlay-bg"; };
  window.resetStand = function() { standLeft=standSec; document.getElementById("rm-stand").className="rm-card"; document.getElementById("rm-stand-time").textContent=fmtTimer(standLeft); document.getElementById("ov-stand").className="overlay"; document.getElementById("ov-bg").className="overlay-bg"; };
  setInterval(updateTimers, 1000);

  var setW=${waterMin}, setS=${standMin};
  window.adjWater = function(d) { setW=Math.max(5,Math.min(120,setW+d)); document.getElementById("set-water").textContent=setW; };
  window.adjStand = function(d) { setS=Math.max(5,Math.min(120,setS+d)); document.getElementById("set-stand").textContent=setS; };
  window.openSettings = function() { setW=${waterMin}; setS=${standMin}; document.getElementById("set-water").textContent=setW; document.getElementById("set-stand").textContent=setS; document.getElementById("set-bg").className="overlay-bg show"; document.getElementById("settings-modal").className="settings show"; };
  window.closeSettings = function() { document.getElementById("set-bg").className="overlay-bg"; document.getElementById("settings-modal").className="settings"; };
  window.applySettings = function() { window.location.href="/?water="+setW+"&stand="+setS; };

  function fmt(ts) { try { var d=new Date(ts),utc=d.getTime()+d.getTimezoneOffset()*60000,cn=new Date(utc+${TZ_OFFSET_HOURS}*3600000),h=cn.getHours(),m=cn.getMinutes(),s=cn.getSeconds(); return (h<10?"0"+h:h)+":"+(m<10?"0"+m:m)+":"+(s<10?"0"+s:s); } catch(e) { return ts; } }
  function now() { return fmt(new Date().toISOString()); }
  function fmtShort(ts) { try { var d=new Date(ts),utc=d.getTime()+d.getTimezoneOffset()*60000,cn=new Date(utc+${TZ_OFFSET_HOURS}*3600000),h=cn.getHours(),m=cn.getMinutes(); return (h<10?"0"+h:h)+":"+(m<10?"0"+m:m); } catch(e) { return ""; } }
  function dur(ms) { if(!ms)return""; var s=Math.floor((Date.now()-parseInt(ms))/1000); if(s<60)return s+"s"; var m=Math.floor(s/60); if(m<60)return m+"m"; return Math.floor(m/60)+"h"+(m%60)+"m"; }
  function shortPath(p) { if(!p)return"—"; var a=p.split("/"); return a.length<=2?p:a[a.length-1]; }
  var cached7d = 0;
  function updateBorder(pct) { var p=Math.max(0,Math.min(100,pct)); cached7d=p; document.getElementById("cb-top").style.width=Math.min(100,p*4)+"%"; document.getElementById("cb-right").style.height=Math.min(100,Math.max(0,(p-25)*4))+"%"; document.getElementById("cb-bottom").style.width=Math.min(100,Math.max(0,(p-50)*4))+"%"; document.getElementById("cb-left").style.height=Math.min(100,Math.max(0,(p-75)*4))+"%"; }

  // Bottom label carousel: rotates between 7d / session / today stats
  var carouselIdx = 0;
  function tickCarousel() {
    var labels = [];
    labels.push("7d " + cached7d + "%");
    if(sessionStartCache) labels.push("session " + dur(sessionStartCache));
    labels.push("today " + todayCalls + " calls");
    carouselIdx = (carouselIdx + 1) % labels.length;
    document.getElementById("cb-label").textContent = labels[carouselIdx];
  }
  setInterval(tickCarousel, 5000);
  var toolPrefix = {Read:">",Edit:"*",Write:"*",Bash:"$",Grep:">",Glob:">",Agent:"@",Skill:"~"};
  function cleanTool(t) {
    if(!t) return "Idle";
    if(t.indexOf("mcp__")===0){var p=t.split("__"); t=p[p.length-1];}
    return t;
  }
  function prefixTool(t) {
    var name = cleanTool(t);
    var px = toolPrefix[name] || "#";
    return px + " " + name;
  }
  function shortFile(f) { if(!f)return""; if(f.length>30){var p=f.split("/"); return p.length>1?".../"+p[p.length-1]:f.substring(0,30);} return f; }
  function renderHeatmap(hm) {
    if(!hm||!hm.length) return;
    var START=8, END=24;
    var hours="", blocks="";
    for(var i=START;i<END;i++){
      var h=i<10?"0"+i:""+i;
      hours+='<span class="hm-cell"><span class="hm-hour">'+h+'</span></span>';
      var v=hm[i]||0;
      var cls=v===0?"hm-box":v<6?"hm-box lo":"hm-box hi";
      blocks+='<span class="hm-cell"><div class="'+cls+'"></div></span>';
    }
    document.getElementById("heatmap").innerHTML='<div class="hm-row">'+hours+'</div><div class="hm-row">'+blocks+'</div>';
  }

  function renderHistory() {
    var c=document.getElementById("log-entries"),h="";
    for(var i=0;i<MAX_HISTORY;i++){
      if(i<history.length){var e=history[i]; h+='<div class="lg-e"><span class="lg-n">'+e.tool+'</span><span class="lg-f">'+e.file+'</span><span class="lg-t2">'+e.time+'</span></div>';}
      else{h+='<div class="lg-e"><span class="lg-n">&nbsp;</span><span class="lg-f"></span><span class="lg-t2"></span></div>';}
    }
    c.innerHTML=h;
  }

  function updateUI(d) {
    if(d.timestamp===last) return; last=d.timestamp;
    var tn=cleanTool(d.tool); document.getElementById("s-tool").textContent=prefixTool(d.tool);
    var f=document.getElementById("s-file"); if(d.file){f.textContent=d.file;f.className="act-file vis";}else{f.textContent="";f.className="act-file";}
    document.getElementById("s-time").textContent=fmt(d.timestamp); document.getElementById("clock").textContent=now();
    document.getElementById("i-project").textContent=shortPath(d.project);
    if(d.sessionStart) sessionStartCache=d.sessionStart; document.getElementById("i-session").textContent=dur(sessionStartCache);
    if(d.gitBranch){var gt=d.gitBranch; if(d.gitStatus)gt+=" "+d.gitStatus; document.getElementById("i-git").textContent=gt;}
    if(d.model) document.getElementById("i-model").textContent=d.model;
    if(d.contextPercent){var cp=Math.round(parseFloat(d.contextPercent)); document.getElementById("g-ctx").textContent=cp+"%"; document.getElementById("g-ctx-fill").style.width=cp+"%";}
    if(d.usage5h){var h5=Math.round(parseFloat(d.usage5h)); document.getElementById("g-5h").textContent=h5+"%"; document.getElementById("g-5h-fill").style.width=h5+"%";}
    if(d.usage7d){var d7=Math.round(parseFloat(d.usage7d)); updateBorder(d7);}
    if(tn&&tn!=="Idle"){todayCalls++; history.unshift({tool:tn,file:shortFile(d.file),time:fmtShort(d.timestamp)}); if(history.length>MAX_HISTORY)history.pop(); renderHistory();}
    if(d.heatmap) renderHeatmap(d.heatmap);
  }

  var STALE_SEC = 300; // 5 minutes = offline

  function checkFreshness() {
    if (!last) return;
    var age = Math.floor((Date.now() - new Date(last).getTime()) / 1000);
    var card = document.getElementById("act-card");
    var stale = document.getElementById("s-stale");
    if (age > STALE_SEC) {
      card.className = "act offline";
      document.getElementById("s-tool").textContent = "Offline";
      stale.textContent = "last seen " + Math.floor(age/60) + "m ago";
    } else if (age > 60) {
      card.className = "act";
      stale.textContent = Math.floor(age/60) + "m ago";
    } else {
      card.className = "act";
      stale.textContent = "";
    }
  }

  function poll() {
    var x=new XMLHttpRequest(); x.open("GET","/status");
    x.onload=function(){if(x.status===200){try{updateUI(JSON.parse(x.responseText)); checkFreshness();}catch(e){}}};
    x.onerror=function(){
      document.getElementById("act-card").className="act offline";
      document.getElementById("s-tool").textContent="Server offline";
      document.getElementById("s-stale").textContent="cannot connect";
    };
    x.send();
  }

  window.dismissWelcome=function(){document.getElementById("welcome").className="welcome";document.getElementById("welcome-bg").className="welcome-bg";try{localStorage.setItem("kindle-status-welcomed","1");}catch(e){}};
  window.showHelp=function(){document.getElementById("welcome-bg").className="welcome-bg show";document.getElementById("welcome").className="welcome show";};
  try{if(!localStorage.getItem("kindle-status-welcomed")){document.getElementById("welcome-bg").className="welcome-bg show";document.getElementById("welcome").className="welcome show";}}catch(e){}

  renderHistory(); poll();
  setInterval(poll, 10000);
  setInterval(function(){document.getElementById("clock").textContent=now();if(sessionStartCache)document.getElementById("i-session").textContent=dur(sessionStartCache);checkFreshness();},30000);
})();
</script>
</body>
</html>`;
}

// --- Bun HTTP Server ---
const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);

    // POST /status — hook & statusline write (localhost only)
    if (req.method === "POST" && url.pathname === "/status") {
      const host = url.hostname;
      if (host !== "localhost" && host !== "127.0.0.1") {
        return Response.json({ error: "POST only from localhost" }, { status: 403 });
      }
      return req.json().then((body: Record<string, string>) => {
        const isMetrics = body.type === "statusline";
        if (!isMetrics) recordHeatmap();
        state = merge(state, body, isMetrics);
        return Response.json({ ok: true });
      }).catch(() => Response.json({ error: "bad json" }, { status: 400 }));
    }

    // GET /status — Kindle polls
    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json({ ...state, heatmap }, {
        headers: { "Cache-Control": "no-cache, no-store", "Access-Control-Allow-Origin": "*" },
      });
    }

    // GET / — Kindle page
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/kindle")) {
      const water = Math.max(5, Math.min(120, parseInt(url.searchParams.get("water") || "", 10) || WATER_DEFAULT));
      const stand = Math.max(5, Math.min(120, parseInt(url.searchParams.get("stand") || "", 10) || STAND_DEFAULT));
      return new Response(getHTML(water, stand), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

// Get LAN IP
const nets = Object.values(require("os").networkInterfaces()).flat();
const lanIP = (nets as Array<{family: string; internal: boolean; address: string}>)
  .find((n) => n.family === "IPv4" && !n.internal)?.address || "localhost";

console.log(`
╔══════════════════════════════════════════════╗
║  claude-ink-hud — Local Server               ║
╠══════════════════════════════════════════════╣
║  Kindle:  http://${lanIP}:${PORT}
║  Hook:    http://localhost:${PORT}/status
╚══════════════════════════════════════════════╝
`);
