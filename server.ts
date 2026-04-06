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

// Todo list — persisted to disk
const TODO_FILE = join(DATA_DIR, "todo.json");
const VALID_PRIORITIES = ["high", "mid", "low"] as const;
type Priority = typeof VALID_PRIORITIES[number];
type TodoItem = { id: string; text: string; priority: Priority; done: boolean; ts: number };

function loadTodos(): TodoItem[] {
  try {
    if (existsSync(TODO_FILE)) return JSON.parse(readFileSync(TODO_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveTodos() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(TODO_FILE, JSON.stringify(todos));
  } catch {}
}

let todos: TodoItem[] = loadTodos();

function handleTodoAction(body: { action: string; id?: string; text?: string; priority?: string }): { ok: boolean; id?: string; error?: string } {
  const action = body.action;
  if (action === "add") {
    if (!body.text || !body.text.trim()) return { ok: false, error: "text required" };
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const priority: Priority = VALID_PRIORITIES.includes(body.priority as Priority) ? body.priority as Priority : "mid";
    todos.push({ id, text: body.text.trim().slice(0, 100), priority, done: false, ts: Date.now() });
    if (todos.length > 50) todos = todos.slice(-50);
    saveTodos();
    return { ok: true, id };
  }
  if (action === "done" || action === "undone") {
    const item = todos.find(t => t.id === body.id);
    if (!item) return { ok: false, error: "not found" };
    item.done = action === "done";
    saveTodos();
    return { ok: true, id: item.id };
  }
  if (action === "remove") {
    const len = todos.length;
    todos = todos.filter(t => t.id !== body.id);
    if (todos.length === len) return { ok: false, error: "not found" };
    saveTodos();
    return { ok: true };
  }
  if (action === "list") {
    return { ok: true };
  }
  return { ok: false, error: "unknown action: add|done|undone|remove|list" };
}

// Notification queue — in-memory, not persisted
const NOTIFY_TTL = 60; // seconds before auto-expire on server side
let notifications: Array<{ id: string; title: string; message: string; size: string; ttl: number; ts: number }> = [];

const VALID_SIZES = ["sm", "md", "lg", "full"];
const MSG_LIMITS: Record<string, number> = { sm: 60, md: 200, lg: 500, full: 800 };

function addNotification(body: { title?: string; message?: string; size?: string; ttl?: number }) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ttl = Math.max(5, Math.min(300, body.ttl || NOTIFY_TTL));
  const size = VALID_SIZES.includes(body.size || "") ? body.size! : "md";
  notifications.push({
    id,
    title: (body.title || "Notification").slice(0, 50),
    message: (body.message || "").slice(0, MSG_LIMITS[size]),
    size,
    ttl,
    ts: Date.now(),
  });
  // Keep max 20 notifications
  if (notifications.length > 20) notifications = notifications.slice(-20);
  return id;
}

function getAndCleanNotifications() {
  const now = Date.now();
  // Remove expired (server-side TTL as safety net)
  notifications = notifications.filter(n => (now - n.ts) < n.ttl * 1000 + 30000);
  return notifications;
}

// In-memory state — no database needed
let state: Record<string, string> = {
  tool: "",
  file: "",
  detail: "",
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
    detail: isMetrics ? (prev.detail || "") : (body.detail || ""),
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
  padding: 12px 16px;
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
.hdr { text-align: center; padding: 4px 0 6px; border-bottom: 2px solid #000; margin-bottom: 8px; position: relative; }
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
.sl { font-size: 12px; font-weight: 900; color: #555; margin-bottom: 4px; margin-top: 6px; letter-spacing: 2px; text-transform: uppercase; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
.sl:first-of-type { margin-top: 0; }
.act { border: 2px solid #000; padding: 6px 8px 8px; height: 68px; overflow: hidden; }
.act-row { display: flex; justify-content: space-between; align-items: baseline; }
.act-tool { font-size: 20px; font-weight: 900; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 75%; }
.act-time { font-size: 12px; color: #555; font-family: "Courier New", monospace; }
.act-file { font-size: 12px; font-family: "Courier New", monospace; padding: 2px 6px; background: #f0f0f0; border-left: 3px solid #000; margin-top: 3px; word-break: break-all; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; height: 18px; visibility: hidden; }
.act-file.vis { visibility: visible; }
.act.offline { border-style: dashed; color: #999; }
.act.offline .act-tool { color: #999; }
.act-stale { font-size: 11px; color: #999; font-family: "Courier New", monospace; text-align: right; }
.gs { overflow: hidden; }
.g { float: left; width: 49%; background: #f0f0f0; padding: 6px 8px; height: 40px; overflow: hidden; }
.g + .g { float: right; }
.g-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
.g-lbl { font-size: 13px; font-weight: bold; color: #555; }
.g-val { font-size: 16px; font-weight: 900; font-family: "Courier New", monospace; }
.g-bar { height: 10px; background: #ddd; position: relative; border-radius: 1px; }
.g-fill { height: 100%; background: #000; position: absolute; left: 0; top: 0; border-radius: 1px; }
.mt { display: flex; justify-content: space-between; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 4px 8px; font-size: 13px; height: 24px; overflow: hidden; color: #555; }
.lg { padding: 0 4px; height: 160px; overflow: hidden; }
.lg-t { font-size: 12px; font-weight: bold; color: #888; margin-bottom: 4px; border-bottom: 1px solid #ddd; padding-bottom: 4px; letter-spacing: 1px; }
.lg-e { display: flex; font-size: 13px; height: 20px; line-height: 20px; border-bottom: 1px dotted #eee; font-family: "Courier New", monospace; }
.lg-e:last-child { border-bottom: none; }
.lg-n { font-weight: 900; width: 70px; flex-shrink: 0; }
.lg-f { flex: 1; color: #666; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 4px; }
.lg-t2 { color: #999; width: 45px; text-align: right; flex-shrink: 0; }
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
.rm { overflow: hidden; }
.rm-card { float: left; width: 49%; background: #f0f0f0; padding: 4px 6px; text-align: center; cursor: pointer; height: 60px; overflow: hidden; }
.rm-card + .rm-card { float: right; }
.rm-card.alert { border: 3px solid #000; background: #e8e8e8; }
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
/* Heatmap — 6 level grayscale */
.hm { padding: 4px 0; height: 40px; overflow: hidden; }
.hm-row { display: flex; justify-content: center; gap: 1px; }
.hm-cell { width: 21px; text-align: center; }
.hm-hour { font-size: 9px; color: #999; font-family: "Courier New", monospace; line-height: 1.2; }
.hm-box { width: 19px; height: 14px; background: #f0f0f0; }
.hm-box.l1 { background: #ccc; }
.hm-box.l2 { background: #aaa; }
.hm-box.l3 { background: #777; }
.hm-box.l4 { background: #444; }
.hm-box.l5 { background: #000; }
/* Notifications */
.ntf-bg { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.3); z-index: 1100; }
.ntf-bg.show { display: block; }
.ntf { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border: 4px solid #000; z-index: 1101; text-align: center; cursor: pointer; box-shadow: 6px 6px 0 #000; overflow: hidden; }
.ntf.show { display: block; }
/* Size: sm — compact toast */
.ntf.sz-sm { width: 70%; max-width: 300px; padding: 12px 12px 8px; }
.ntf.sz-sm .ntf-title { font-size: 20px; }
.ntf.sz-sm .ntf-msg { font-size: 13px; max-height: 36px; overflow: hidden; }
/* Size: md — default */
.ntf.sz-md { width: 82%; max-width: 370px; padding: 16px 16px 12px; }
.ntf.sz-md .ntf-title { font-size: 26px; }
.ntf.sz-md .ntf-msg { font-size: 15px; max-height: 80px; overflow: hidden; }
/* Size: lg — expanded */
.ntf.sz-lg { width: 90%; max-width: 420px; padding: 16px 16px 12px; }
.ntf.sz-lg .ntf-title { font-size: 26px; }
.ntf.sz-lg .ntf-msg { font-size: 14px; max-height: 200px; overflow: hidden; text-align: left; line-height: 1.5; }
/* Size: full — nearly full screen */
.ntf.sz-full { width: 94%; max-width: 500px; max-height: 85%; padding: 14px 14px 10px; }
.ntf.sz-full .ntf-title { font-size: 22px; }
.ntf.sz-full .ntf-msg { font-size: 14px; max-height: 400px; overflow-y: auto; text-align: left; line-height: 1.5; }
.ntf-title { font-weight: 900; font-family: "Courier New", monospace; letter-spacing: 1px; margin-bottom: 4px; word-break: break-word; }
.ntf-msg { color: #555; margin-bottom: 8px; word-break: break-word; }
.ntf-footer { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #888; font-family: "Courier New", monospace; }
.ntf-timer { font-size: 13px; font-weight: bold; color: #555; }
.ntf-msg code { font-family: "Courier New", monospace; background: #e8e8e8; padding: 1px 4px; font-size: 0.9em; }
.ntf-msg pre { font-family: "Courier New", monospace; background: #f0f0f0; border-left: 3px solid #000; padding: 4px 8px; margin: 4px 0; font-size: 12px; text-align: left; overflow-x: hidden; white-space: pre-wrap; word-break: break-all; }
.ntf-msg hr { border: none; border-top: 1px solid #ccc; margin: 6px 0; }
.ntf-msg ul { text-align: left; margin: 2px 0; padding-left: 18px; }
.ntf-msg li { margin: 1px 0; }
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
  <span class="gear" style="left:84px" onclick="location.href='/'">[H]</span>
  <span class="hdr-clock" id="clock"></span>
  <span class="hdr-session" id="i-session"></span>
  <span class="ci"><span class="ci-body"></span><span class="ci-eye-l"></span><span class="ci-eye-r"></span><span class="ci-leg ci-l1"></span><span class="ci-leg ci-l2"></span><span class="ci-leg ci-l3"></span><span class="ci-leg ci-l4"></span></span>
  <div class="px-title">CLAUDE CODE</div>
  <div class="hdr-model" id="i-model"></div>
</div>

<div class="sl">Current Action</div>
<div class="act" id="act-card">
  <div class="act-row">
    <span class="act-tool" id="s-tool">Loading...</span>
    <span class="act-time" id="s-time"></span>
  </div>
  <div class="act-file" id="s-file"></div>
  <div class="act-stale" id="s-stale"></div>
</div>

<div class="sl">Metrics</div>
<div class="gs">
  <div class="g"><div class="g-row"><span class="g-lbl">Context</span><span class="g-val" id="g-ctx">—</span></div><div class="g-bar"><div class="g-fill" id="g-ctx-fill" style="width:0%"></div></div></div>
  <div class="g"><div class="g-row"><span class="g-lbl">5h Limit</span><span class="g-val" id="g-5h">—</span></div><div class="g-bar"><div class="g-fill" id="g-5h-fill" style="width:0%"></div></div></div>
</div>

<div class="mt">
  <span><b id="i-project">—</b></span>
  <span><b id="i-git">—</b></span>
</div>

<div class="sl">Recent Activity</div>
<div class="lg">
  <div id="log-entries"></div>
</div>

<div class="sl">Reminders</div>
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

<div class="sl">Activity</div>
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

<div class="ntf-bg" id="ntf-bg"></div>
<div class="ntf" id="ntf-box" onclick="dismissNotify()">
  <div class="ntf-title" id="ntf-title"></div>
  <div class="ntf-msg" id="ntf-msg"></div>
  <div class="ntf-footer"><span>tap to dismiss</span><span class="ntf-timer" id="ntf-timer"></span></div>
</div>

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
  window.applySettings = function() { window.location.href="/hud?water="+setW+"&stand="+setS; };

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
    var START=0, END=24;
    var hours="", blocks="";
    for(var i=START;i<END;i++){
      var h=i<10?"0"+i:""+i;
      var label = (i%2===0) ? h : "";
      hours+='<span class="hm-cell"><span class="hm-hour">'+label+'</span></span>';
      var v=hm[i]||0;
      var cls="hm-box";
      if(v>=1&&v<=2)cls="hm-box l1";
      else if(v>=3&&v<=5)cls="hm-box l2";
      else if(v>=6&&v<=10)cls="hm-box l3";
      else if(v>=11&&v<=20)cls="hm-box l4";
      else if(v>20)cls="hm-box l5";
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

  // --- Mini markdown parser (no deps, XSS-safe) ---
  var BT = String.fromCharCode(96); // backtick char
  var BT3 = BT+BT+BT;
  function esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function miniMd(raw) {
    if (!raw) return "";
    var lines = raw.split("\\n");
    var out = [], inCode = false, codeBlock = [], inList = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (ln.indexOf(BT3) === 0) {
        if (inCode) { out.push("<pre>" + esc(codeBlock.join("\\n")) + "</pre>"); codeBlock = []; }
        inCode = !inCode; continue;
      }
      if (inCode) { codeBlock.push(ln); continue; }
      if (inList && !/^[-*] /.test(ln)) { out.push("</ul>"); inList = false; }
      if (/^---+$/.test(ln.trim())) { out.push("<hr>"); continue; }
      if (/^[-*] /.test(ln)) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + inlineMd(esc(ln.replace(/^[-*] /, ""))) + "</li>");
        continue;
      }
      if (ln.trim() === "") { out.push("<br>"); continue; }
      out.push(inlineMd(esc(ln)) + "<br>");
    }
    if (inCode && codeBlock.length) out.push("<pre>" + esc(codeBlock.join("\\n")) + "</pre>");
    if (inList) out.push("</ul>");
    var result = out.join("");
    if (result.slice(-4) === "<br>") result = result.slice(0, -4);
    return result;
  }
  function inlineMd(s) {
    s = s.replace(/\\*\\*(.+?)\\*\\*/g, "<b>$1</b>");
    s = s.replace(/\\*(.+?)\\*/g, "<i>$1</i>");
    var re = new RegExp(BT + "([^" + BT + "]+)" + BT, "g");
    s = s.replace(re, "<code>$1</code>");
    return s;
  }

  // --- Notification queue ---
  var ntfQueue = [];
  var ntfSeen = {};
  var ntfCurrent = null;
  var ntfCountdown = 0;
  var ntfTimerInterval = null;
  function showNextNotify() {
    if (ntfCurrent) return;
    if (ntfQueue.length === 0) return;
    ntfCurrent = ntfQueue.shift();
    var sz = ntfCurrent.size || "md";
    document.getElementById("ntf-title").textContent = ntfCurrent.title;
    document.getElementById("ntf-msg").innerHTML = miniMd(ntfCurrent.message || "");
    document.getElementById("ntf-msg").style.display = ntfCurrent.message ? "block" : "none";
    ntfCountdown = ntfCurrent.ttl || 60;
    document.getElementById("ntf-timer").textContent = ntfCountdown + "s";
    document.getElementById("ntf-bg").className = "ntf-bg show";
    document.getElementById("ntf-box").className = "ntf sz-" + sz + " show";
    if (ntfTimerInterval) clearInterval(ntfTimerInterval);
    ntfTimerInterval = setInterval(function() {
      ntfCountdown--;
      document.getElementById("ntf-timer").textContent = ntfCountdown + "s";
      if (ntfCountdown <= 0) dismissNotify();
    }, 1000);
  }
  window.dismissNotify = function() {
    if (ntfTimerInterval) { clearInterval(ntfTimerInterval); ntfTimerInterval = null; }
    ntfCurrent = null;
    document.getElementById("ntf-bg").className = "ntf-bg";
    document.getElementById("ntf-box").className = "ntf";
    setTimeout(showNextNotify, 300);
  };
  function processNotifications(list) {
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      if (!ntfSeen[list[i].id]) {
        ntfSeen[list[i].id] = true;
        ntfQueue.push(list[i]);
      }
    }
    showNextNotify();
  }

  function updateUI(d) {
    if(d.timestamp===last) return; last=d.timestamp; resetIdle();
    var tn=cleanTool(d.tool); document.getElementById("s-tool").textContent=prefixTool(d.tool);
    var f=document.getElementById("s-file"); var ftext=d.file||d.detail||""; if(ftext){f.textContent=ftext;f.className="act-file vis";}else{f.textContent="";f.className="act-file";}
    document.getElementById("s-time").textContent="Last "+fmt(d.timestamp); document.getElementById("clock").textContent=now();
    document.getElementById("i-project").textContent=shortPath(d.project);
    if(d.sessionStart) sessionStartCache=d.sessionStart; document.getElementById("i-session").textContent=sessionStartCache?"Session "+dur(sessionStartCache):"";
    if(d.gitBranch){var gt=d.gitBranch; if(d.gitStatus)gt+=" "+d.gitStatus; document.getElementById("i-git").textContent=gt;}
    if(d.model) document.getElementById("i-model").textContent=d.model;
    if(d.contextPercent){var cp=Math.round(parseFloat(d.contextPercent)); document.getElementById("g-ctx").textContent=cp+"%"; document.getElementById("g-ctx-fill").style.width=cp+"%";}
    if(d.usage5h){var h5=Math.round(parseFloat(d.usage5h)); document.getElementById("g-5h").textContent=h5+"%"; document.getElementById("g-5h-fill").style.width=h5+"%";}
    if(d.usage7d){var d7=Math.round(parseFloat(d.usage7d)); updateBorder(d7);}
    if(tn&&tn!=="Idle"){todayCalls++; history.unshift({tool:tn,file:shortFile(d.file||d.detail),time:fmtShort(d.timestamp)}); if(history.length>MAX_HISTORY)history.pop(); renderHistory();}
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
    x.onload=function(){if(x.status===200){try{var d=JSON.parse(x.responseText); updateUI(d); checkFreshness(); if(d.notifications) processNotifications(d.notifications); checkTodos(d.todos);}catch(e){}}};
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

  // Auto-switch to clock after 5 min idle or todo change
  var idleTimer = 0;
  var lastTodoHash = "";
  function resetIdle() { idleTimer = 0; }
  function tickIdle() {
    idleTimer += 30;
    if (idleTimer >= STALE_SEC) { location.href = "/"; }
  }
  function checkTodos(todos) {
    var hash = JSON.stringify(todos || []);
    if (lastTodoHash && hash !== lastTodoHash) { location.href = "/"; return; }
    lastTodoHash = hash;
  }

  renderHistory(); poll();
  setInterval(poll, 10000);
  setInterval(function(){document.getElementById("clock").textContent=now();if(sessionStartCache)document.getElementById("i-session").textContent=sessionStartCache?"Session "+dur(sessionStartCache):"";checkFreshness();tickIdle();},30000);
})();
</script>
</body>
</html>`;
}

function getClockHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clock</title>
<style>
@font-face { font-family: 'Bebas Neue'; font-style: normal; font-weight: 400; src: url(data:font/ttf;base64,AAEAAAAOAIAAAwBgR0RFRhSEFF0AAAHQAAAAdEdQT1OmL5MAAAAnQAAAHohHU1VCnx6I3wAADagAAAWaT1MvMmpTcccAAAFwAAAAYGNtYXBaTg03AAAILAAABXpnYXNwAAAAEAAAAOwAAAAIZ2x5ZvQC3awAAEXIAABPkGhlYWQRoaVEAAABOAAAADZoaGVhBeADMwAAARQAAAAkaG10eLK7LmUAABNEAAAHpmxvY2HEY9hUAAAESAAAA+RtYXhwAgEAsAAAAPQAAAAgbmFtZSlmRb0AAAJEAAACBHBvc3Q4F/pWAAAa7AAADFEAAQAB//8ADwABAAAB8QBMAAcAYAAFAAEAAAAAAAAAAAAAAAAAAwADAAEAAAOE/tQAAANN/y//LwMqAAEAAAAAAAAAAAAAAAAAAAHiAAEAAAACAABfHQJpXw889QAPA+gAAAAA1p64pgAAAADZhajy/y//OAMqA5AAAAAHAAIAAAAAAAAAAwGDAZAABQAAAooCWAAAAEsCigJYAAABXgBQAaQAAAILBgYCAgIFAgEAAAAHAAAAAQAAAAAAAAAAREhSTQBAAA34/wOE/tQAAAO2AV4gAACTAAAAAAK8ArwAAAAgAAMAAQAAACIAAAAAAAwAAgADAc0B0QACAdMB2QACAdoB2wABAAIADQAEAFkAAQBbAFwAAQBfAGkAAQBrAOUAAQDnAOgAAQDrAPUAAQD3ARcAAQGVAZUAAQGYAZgAAQGxAbEAAQHJAcoAAQHNAdEAAwHTAeAAAwAAAAgAZgADAAEECQAAALAA7gADAAEECQABABQA2gADAAEECQACAA4AzAADAAEECQADADgAlAADAAEECQAEACQAcAADAAEECQAFABoAVgADAAEECQAGACIANAADAAEECQAOADQAAABoAHQAdABwADoALwAvAHMAYwByAGkAcAB0AHMALgBzAGkAbAAuAG8AcgBnAC8ATwBGAEwAQgBlAGIAYQBzAE4AZQB1AGUALQBSAGUAZwB1AGwAYQByAFYAZQByAHMAaQBvAG4AIAAyAC4AMAAwADAAQgBlAGIAYQBzACAATgBlAHUAZQAgAFIAZQBnAHUAbABhAHIAMgAuADAAMAAwADsARABIAFIATQA7AEIAZQBiAGEAcwBOAGUAdQBlAC0AUgBlAGcAdQBsAGEAcgBSAGUAZwB1AGwAYQByAEIAZQBiAGEAcwAgAE4AZQB1AGUAQwBvAHAAeQByAGkAZwBoAHQAIAAyADAAMQA5ACAAVABoAGUAIABCAGUAYgBhAHMAIABOAGUAdQBlACAAUAByAG8AagBlAGMAdAAgAEEAdQB0AGgAbwByAHMAIAAoAGgAdAB0AHAAcwA6AC8ALwBnAGkAdABoAHUAYgAuAGMAbwBtAC8AZABoAGEAcgBtAGEAdAB5AHAAZQAvAEIAZQBiAGEAcwAtAE4AZQB1AGUAKQAAACkAKQApACkARABQAFwAaAB0AIAAjAC+AMoA1gD3AQMBOQFFAWwBeAGEAccB0wHfAgACKgI2Aj4CSgJfAmsCdwKDAo8CmwKnArMCvwLqAv0DCQMyAz4DSgNWA2IDeQOdA6kDtgPCA84D2gPmA/ID/gQKBBYEOQRFBF4EagR2BI8EmwSqBLYEwgTOBOME/QUbBScFPwVLBVcFYwWLBZcFvAXIBdQF4AXsBfgGBAYQBkgGVAZgBokGrAa4BtwHDQdCB04HWgdmB50HqQe1CAgIFAggCCwIUghjCH0IiQi2CMIIzgjsCPgJBAkQCRwJKAk0CUAJdQmBCY0JoAm/CcsJ1wnjCe8KCgohCi0KOQpFClEKZgpyCn4KigqSCpoKogqqCrIKugrCCsoK0graCuIK6gryCvoLAgsKCxILGgsiCyoLMgs6C0ILSgtSC1oLYgtqC3ILeguCC4oLkguaC6ILqguyC7oLwgvKC9IL2gviC+oL8gv6DAIMCgwSDBoMIgwqDDIMOgxCDEoMUgxaDGIMagxyDHoMggyKDJIMmgyiDKoMsgy6DMIMygzSDNoM5gzuDPYM/g0GDQ4NFg0eDSYNLg02DT4NRg1ODVYNXg1mDW4Ndg1+DYYNjg2WDZ4Npg2uDbYNvg3GDc4N1g3eDeYN7g32Df4OBg4ODhYOHg4mDi4ONg4+DkYOTg5WDl4OZg5uDnYOfg6GDo4Olg6eDqYOrg62Dr4Oxg7ODtYO3g7mDu4PJw9TD2gPmQ+3D80P8hAGEDMQcRCMELgQ6xD8ET4RcRF5EYERiRGREZkRoRGpEbERuRHBEeQR9xIjEl4SeBKjEtUS5RMiE1QTdxOKE7YT8RQLFDYUaBR4FLUU5xUKFR0VShWFFaAVyxX9Fg0WShZ8FqAWsxbgFxsXNhdhF5QXpBfiGBUYIxgzGEMYUxhjGHMYgxiTGKMYsxi/GM4Y4Bj2GQ0ZIhk4GWkZmxmnGb0Z2xoMGhoaKBpHGmYalBrCGtMa5BrwGvgbBRsSGx8bKxszG0sbZRt+G44bnhu3G9Ab4BvwHAMcEBwQHBAcEBwQHBAcEBw/HHwcuBz0HT0dZh2eHaYdyh3WHeQd+B4FHh4eNh5JHmceeR6KHqIevB7UHyMfTh9eH28fwCAAICIgKiAyIEQgXSBxIHkguyEFIWshnCG1IeIiRCKMIqcjBCNVI7Mj/SQkJEokVyRpJH4kuyTXJRklVyWiJbIluiXMJdgl5SXyJgUmFSYmJjcmUSZ3JqImria+Js0m8ScPJxsnKCc3J0YnUCdaJ2Qnbid4J4InjCeWJ6Anqie0J74nyCfIJ8gnyAAAAAIAAAADAAAAFAADAAEAAAAUAAQFZgAAAJYAgAAGABYADQAvADkAfgF+AZIB/wIbAjcCvALHAskC3QMEAwgDDAMSAygDOAOUA6kDvAPAHgMeCx4fHkEeVx5hHmsehR6eHvMgAyAIIAsgFCAaIB4gIiAmIDAgOiBEIHAgeSCJIKwguSC/IRMhFyEgISIhJiEuIVQhXiICIgYiDyISIhUiGiIeIisiSCJgImUly+D/7/3wAPj///8AAAANACAAMAA6AKABkgH8AhgCNwK8AsYCyQLYAwADBgMKAxIDJgM1A5QDqQO8A8AeAh4KHh4eQB5WHmAeah6AHp4e8iACIAcgCyASIBggHCAgICYgMCA5IEQgcCB0IIAgrCC5IL8hEyEWISAhIiEmIS4hUyFbIgIiBSIPIhEiFSIZIh4iKyJIImAiZCXK4P/v/fAA+P/////1AAAA7gAAAAAAAwAAAAD+j/8PAAD/AwAAAAAAAAAA/sf+tP6o/Yb9cv1g/V0AAAAAAAAAAAAAAAAAAAAA4cwAAAAA4YbhhQAAAAAAAAAA4ULhhuFO4Rbg4ODg4LLg6ODd4NngswAA4Krgn+CI4JrgCeAF37IAAN+hAADfhgAA343fgt9f30EAAAAAIO8R8hHwCLoAAQAAAJQAAACwATgAAALyAvgAAAAAAvoAAAL6AwQDDAMQAAAAAAAAAAAAAAAAAAADBgMIAwoDDAMOAxADEgMUAAADHAMeAAAAAAMcAyADJAMoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMWAAAAAAAAAAAAAAAAAAADCgAAAwoAAAMKAAAAAAAAAAADBAMGAAAAAAAAAAAAAAADAWkBiQFwAZMBtQG7AYoBcwF0AW8BnAFlAXkBZAFxAWYBZwGjAaABogFrAboABAAQABIAGAAdACcAKQAuADEAPAA/AEEARwBJAE8AWwBeAF8AYwBrAHEAfAB9AIIAgwCIAXcBcgF4AaoBfgHoAIwAmACaAKAApQCvALEAtgC5AMUAyQDMANIA1ADbAOcA6gDrAO8A9wD9AQgBCQEOAQ8BFAF1AcMBdgGoAY8BagGRAZcBkgGZAcQBvQHmAb4BGAGFAakBegG/AeoBwgGmAVIBUwHhAbMBvAFtAeQBUQEZAYYBXgFbAV8BbAAJAAUABwANAAgADAAOABUAJAAeACEAIgA4ADMANQA2ABkATgBUAFAAUgBZAFMBngBXAHYAcgB0AHUAhABdAPYAkQCNAI8AlQCQAJQAlgCdAKwApgCpAKoAwAC7AL0AvgChANoA4ADcAN4A5QDfAZ8A4wECAP4BAAEBARAA6QESAAoAkgAGAI4ACwCTABMAmwAWAJ4AFwCfABQAnAAaAKIAGwCjACUArQAfAKcAIwCrACYArgAgAKgAKwCzACoAsgAtALUALAC0ADAAuAAvALcAOwDEADkAwgA0ALwAOgDDADcAugAyAMEAPgDIAEAAygDLAEIAzQBEAM8AQwDOAEUA0ABGANEASgDVAEwA2ABLANcA1gBNANkAVgDiAFEA3QBVAOEAWgDmAGAA7ABiAO4AYQDtAGQA8ABnAPMAZgDyAGUA8QBuAPoAbQD5AGwA+AB7AQcAeAEEAHMA/wB6AQYAdwEDAHkBBQB/AQsAhQERAIYAiQEVAIsBFwCKARYADwCXAFgA5ABoAPQAbwD7AeUB4wHiAecB7AHrAe0B6QHPAdAB0wHXAdgB1QHOAc0B1gHRAdQAEQCZABwApAAoALAASADTAFwA6ABpAPUAcAD8AIEBDQB+AQoAgAEMAIcBEwGMAYsBfQF7AXwBgwGEAX8BgQGCAYABxQHHAW4ByQHAAawBrwGxAZ0BmgGyAaUBpAG4AbcAAAABAAAACgEuA1AAAkRGTFQBDmxhdG4ADgDuAAlBWkUgANpDQVQgAMZDUlQgALJLQVogAJ5NT0wgAIpOTEQgAHZST00gAGJUQVQgAE5UUksgADoAAP//AAcACgAVACAAKQA0AD8ASgAA//8ABwAJABQAHwAoADMAPgBJAAD//wAHAAgAEwAeACcAMgA9AEgAAP//AAcABwASAB0AJgAxADwARwAA//8ABwAGABEAHAAlADAAOwBGAAD//wAHAAUAEAAbACQALwA6AEUAAP//AAcABAAPABoAIwAuADkARAAA//8ABwADAA4AGQAiAC0AOABDAAD//wAHAAIADQAYACEALAA3AEIAAP//AAYAAQAMABcAKwA2AEEABAAAAAD//wAGAAAACwAWACoANQBAAEtjY21wAhxjY21wAhxjY21wAhxjY21wAhxjY21wAhxjY21wAhxjY21wAhxjY21wAhxjY21wAhxjY21wAhxjY21wAhxkbm9tAhZkbm9tAhZkbm9tAhZkbm9tAhZkbm9tAhZkbm9tAhZkbm9tAhZkbm9tAhZkbm9tAhZkbm9tAhZkbm9tAhZmcmFjAgxmcmFjAgxmcmFjAgxmcmFjAgxmcmFjAgxmcmFjAgxmcmFjAgxmcmFjAgxmcmFjAgxmcmFjAgxmcmFjAgxsb2NsAgZsb2NsAgBsb2NsAfpsb2NsAfRsb2NsAe5sb2NsAehsb2NsAeJsb2NsAdxsb2NsAdZudW1yAdBudW1yAdBudW1yAdBudW1yAdBudW1yAdBudW1yAdBudW1yAdBudW1yAdBudW1yAdBudW1yAdBudW1yAdBwbnVtAcpwbnVtAcpwbnVtAcpwbnVtAcpwbnVtAcpwbnVtAcpwbnVtAcpwbnVtAcpwbnVtAcpwbnVtAcpwbnVtAcp0bnVtAcR0bnVtAcR0bnVtAcR0bnVtAcR0bnVtAcR0bnVtAcR0bnVtAcR0bnVtAcR0bnVtAcR0bnVtAcR0bnVtAcQAAAABABAAAAABAAoAAAABAAsAAAABAAcAAAABAAYAAAABAAMAAAABAAEAAAABAAQAAAABAAUAAAABAAgAAAABAAIAAAABAAkAAAADAA0ADgAPAAAAAQAMAAAAAQAAABUB+AGyAW4BTAFMATgBOAE4ATgBOAEgARIBBADwARIAqACQAIIAaAA6ACwAAQAAAAEACAABAKz/9gAEAAAAAQAIAAEAHgACABQACgABAAQA0AACAW0AAQAEAEUAAgFtAAEAAgBBAMwAAQAAAAEACAACAAoAAgA9AMcAAQACADwAxQABAAAAAQAIAAEBuAABAAEAAAABAAgAAQAG//YAAgABASgBMQAAAAYAAAACACYACgADAAEAEgABAC4AAAABAAAAFAACAAEBPAFFAAAAAwABABwAAQASAAAAAQAAABQAAgABAUYBTwAAAAEAAQFaAAEAAAABAAgAAQAG/+kAAQABAXEAAQAAAAEACAABACIAHgABAAAAAQAIAAEAFAAoAAEAAAABAAgAAQAGAAoAAgABAR4BJwAAAAEAAAABAAgAAQAGAAYAAQABALkAAQAAAAEACAACAA4ABABoAG8A9AD7AAEABABmAG4A8gD6AAYAAAACACQACgADAAAAAgAUAC4AAQAUAAEAAAATAAEAAQBBAAMAAAACABoAFAABABoAAQAAABMAAQABAW0AAQABAMwABgAAAAIAKAAKAAMAAQAYAAEAEgAAAAEAAAASAAEAAQA8AAEAAQAzAAMAAQAYAAEAEgAAAAEAAAASAAEAAQDFAAEAAQC7AAYAAAACACgACgADAAAAAQBAAAIAFAAwAAEAAAARAAIAAQHbAeAAAAADAAAAAQAiAAEAEgABAAAAEQACAAIBzQHRAAAB0wHZAAUAAQACALkAxQAAAuIANgAAAAAAoAAAAKAAAAGRAAwBkQAMAZEADAGRAAwBkQAMAZEADAGRAAwBkQAMAZEADAGRAAwCRAAKAkQACgGUACkBlAApAX8AIgF/ACIBfwAiAX8AIgF/ACIBfwAiAZYAKQGnAAoBlgApAacACgGWACkBawApAWsAKQFrACkBawApAWsAKQFrACkBawApAWsAKQFrACkBawApAVgAKQFYACkBhwAhAYcAIQGHACEBhwAhAYcAIQGkACkBtgAKAaQAKQDAACkByQApAMAAJADA/+oAwP/aAMD/4gDAACkAwP/eAMD/7QDAABEAwP/VAQkAEAEJABABCQAQAZ4AKQGeACkBWAApAVgAKQFYACkBWAApAVcAKQFsAAoCGgApAhoAKQGrACkBqwApAasAKQGrACkBqwApAasAKQGQACEBkAAhAZAAIQGQACEBkAAhAZAAIQGQACEBkAAhAZAAFwGQABcBkAAhAkEAIQGCACkBggApAYIAKQGQACEBkwApAZMAKQGTACkBkwApAXQAFgF0ABYBdAAWAXQAFgF0ABYBdAAWAXQAFgGXACkBbAAMAWwADAFsAAwBbAAMAWwADAFsAAwBkgAlAZIAJQGSACUBkgAlAZIAJQGSACUBkgAlAZIAJQGSACUBkgAlAZIAJQF+AAwCLQAPAi0ADwItAA8CLQAPAi0ADwGWAAsBigAJAYoACQGKAAkBigAJAYoACQFqABMBagATAWoAEwFqABMBkQAMAZEADAGRAAwBkQAMAZEADAGRAAwBkQAMAZEADAGRAAwBkQAMAkQACgJEAAoBlAApAZQAKQF/ACIBfwAiAX8AIgF/ACIBfwAiAX8AIgGWACkBpwAKAZYAKQGnAAoBlgApAWsAKQFrACkBawApAWsAKQFrACkBawApAWsAKQFrACkBawApAWsAKQFYACkBWAApAYcAIQGHACEBhwAhAYcAIQGHACEBpAApAbYACgGkACkAwAApAMAAKQDAACQAwP/qAMD/2gDA/+IAwAApAMD/3gHJACkAwP/tAMAAEQDA/9UBCQAQAQkAEAEJABABCQAQAZ4AKQGeACkBngApAVgAKQFYACkBWAApAVgAKQFXACkBbAAKAhoAKQIaACkBqwApAasAKQIeAAQBqwApAasAKQGrACkBqwApAZAAIQGQACEBkAAhAZAAIQGQACEBkAAhAZAAIQGQACEBkAAXAZAAFwGQACECQQAhAYIAKQGCACkBggApAZAAIQGTACkBkwApAZMAKQGTACkBdAAWAXQAFgF0ABYBdAAWAXQAFgF0ABYBdAAWAZcAKQFsAAwBbAAMAWwADAFsAAwBbAAMAWwADAGSACUBkgAlAZIAJQGSACUBkgAlAZIAJQGSACUBkgAlAZIAJQGSACUBkgAlAX4ADAItAA8CLQAPAi0ADwItAA8CLQAPAZYACwGKAAkBigAJAYoACQGKAAkBigAJAWoAEwFqABMBagATAWoAEwEYAB4BGgAjAZEADAGSACIBlQApAcQADgGQACEBkABQAZAAJwGQACEBkAAPAZAAJgGQACQBkAAiAZAAHAGQAB4BkAAhASMAEgF0ABgBdgAUAY4ADgF+ABwBiQAhAWQADAGMABoBiQAaARoAIwEaADoBGgAmARoAIgEaABcBGgAmARoAJQEaACMBGgAgARoAIQEaACMBGgA6ARoAJgEaACIBGgAXARoAJgEaACUBGgAjARoAIAEaACEBGgAjARoAOgEaACYBGgAiARoAFwEaACYBGgAlARoAIwEaACABGgAhARoAIwEaADoBGgAmARoAIgEaABcBGgAmARoAJQEaACMBGgAgARoAIQBZ/4ICjQA6Ao0AOgKNACYCjQA6Ao0AIgKNADoCjQAiAo0AJgKNACMAvAApALwAKQC8ACkAvAAjAfQAHwDSADIA0gAyAWsAEwFrABQAvAApASwAIwGmAA8BnAAQAYUACQGFAAkBFAA1ARQAIwEUABUBFAAZARQAOwEUACMBDgAZAQ4AGQEsAAAB9AAAAZAAAAEsAAAAvAAqAVAAIwFQACkBUAAjALwAKQC8ACMBUAAOAU8AEQC8AA4AvAARAVAAJgC8ACYB9AAAASwAAAGQAAAAvAAAAKAAAAAAAAABkAAqAZAAHwGQACQBkAAXAZAAEwGQABwBkAAjAZAAEwGQAAsA3AAuAZAAEQGQABsBkAAbAZAAKAGQABsBkAAlAZAAJQGQADYBkAAoAZAAMwGQACsBkAAkAZAADAGQAAwBkAAWAZAAEwKDABoC3gA2AZAANgGSACIBkQAMAdEAMQGbABkB2wAQAZUAKQGsACECTQAjA00AIwLiABUBkAAUAnoAFwK4ABkBoQAiAcEAGgGQABcC4gAVAuIAFQLiABUCVgAKAZAASQH0AM0B9ADNAZAAFgGcAAsBkAAWAzUAIQKVACkCVwAVAAD/ywH0AIcAAP+CAAD/zgAA/34AAP/EAAD/fgAA/80AAP96AAD/egAA/4oAAP+nAAD/dQAA/40AAP/SAAD/0gAA/5gAAP+yAAD/lQAA/y8AAP9ZAAD/TwH0AL4AhAB0AJcAdAB8AMgAeAB4AIcArAChAG8AAAAAAAAAAAACAAAAAAAA/9gAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAfEAAAECAAIAAwAkAMkBAwDHAGIArQEEAQUAYwCuAJABBgAlAQcAJgD9AP8AZAEIAQkAJwDpAQoBCwEMACgAZQENAQ4AyADKAQ8AywEQAREAKQESACoA+AETARQBFQArARYBFwAsARgAzAEZAM0AzgD6AM8BGgEbARwALQEdAR4ALgEfAC8BIAEhASIBIwDiADABJAAxASUBJgEnASgAZgAyANABKQDRAGcA0wEqASsAkQEsAK8AsAAzAS0A7QA0ADUBLgEvATAANgExAOQA+wEyATMBNAE1ADcBNgE3ATgBOQE6ADgA1AE7ANUAaADWATwBPQE+AT8BQAA5ADoBQQFCAUMBRAA7ADwA6wFFALsBRgA9AUcA5gFIAEQAaQFJAGsAbABqAUoBSwBuAG0AoAFMAEUBTQBGAP4BAABvAU4BTwBHAOoBUAEBAVEASABwAVIBUwByAHMBVABxAVUBVgBJAVcASgD5AVgBWQFaAEsBWwFcAEwA1wB0AV0AdgB3AV4AdQFfAWABYQFiAE0BYwFkAWUATgFmAWcATwFoAWkBagFrAOMAUAFsAFEBbQFuAW8BcAFxAHgAUgB5AXIAewB8AHoBcwF0AKEBdQB9ALEAUwF2AO4AVABVAXcBeAF5AFYBegDlAPwBewF8AX0AiQBXAX4BfwGAAYEBggBYAH4BgwCAAIEAfwGEAYUBhgGHAYgAWQBaAYkBigGLAYwAWwBcAOwBjQC6AY4AXQGPAOcBkACdAJ4BkQGSAZMAmwATABQAFQAWABcAGAAZABoAGwAcAZQBlQGWAZcBmAGZAZoBmwGcAZ0BngGfAaABoQGiAaMBpAGlAaYBpwGoAakBqgGrAawBrQGuAa8BsAGxAbIBswG0AbUBtgG3AbgBuQG6AbsBvAG9Ab4BvwHAAcEBwgHDAcQBxQC8APQBxgHHAPUA9gHIAckBygHLABEADwAdAB4AqwAEAKMAIgCiAMMAhwANAAYAEgA/AAsADABeAGAAPgBAABABzACyALMBzQBCAMQAxQC0ALUAtgC3AKkAqgC+AL8ABQAKAc4BzwHQAdEB0gHTAIQAvQAHAdQApgHVAIUB1gCWAdcB2AAOAO8A8AC4ACAAjwAhAB8AlQCUAJMApwBhAKQAQQCSAdkAnAHaAdsAmgCZAKUB3ACYAAgAxgHdALkB3gAjAAkAiACGAIsAigHfAIwAgwBfAOgAggHgAMIB4QHiAeMB5AHlAeYB5wHoAekB6gHrAewB7QHuAe8B8AHxAfIB8wH0AfUB9gH3AfgB+QCNANsA4QDeANgAjgDcAEMA3wDaAOAA3QDZAfoB+wH8BE5VTEwGQWJyZXZlB0FtYWNyb24HQW9nb25lawdBRWFjdXRlB3VuaTFFMDILQ2NpcmN1bWZsZXgKQ2RvdGFjY2VudAZEY2Fyb24GRGNyb2F0B3VuaTFFMEEGRWJyZXZlBkVjYXJvbgpFZG90YWNjZW50B0VtYWNyb24HRW9nb25lawd1bmkxRTFFC0djaXJjdW1mbGV4B3VuaTAxMjIKR2RvdGFjY2VudARIYmFyC0hjaXJjdW1mbGV4AklKBklicmV2ZQdJbWFjcm9uB0lvZ29uZWsGSXRpbGRlC3VuaTAwQTQwMzAxC0pjaXJjdW1mbGV4B3VuaTAxMzYGTGFjdXRlBkxjYXJvbgd1bmkwMTNCBExkb3QHdW5pMUU0MAZOYWN1dGUGTmNhcm9uB3VuaTAxNDUDRW5nBk9icmV2ZQ1PaHVuZ2FydW1sYXV0B09tYWNyb24LT3NsYXNoYWN1dGUHdW5pMUU1NgZSYWN1dGUGUmNhcm9uB3VuaTAxNTYGU2FjdXRlC1NjaXJjdW1mbGV4B3VuaTAyMTgHdW5pMUU2MAd1bmkxRTlFBFRiYXIGVGNhcm9uB3VuaTAxNjIHdW5pMDIxQQd1bmkxRTZBBlVicmV2ZQ1VaHVuZ2FydW1sYXV0B1VtYWNyb24HVW9nb25lawVVcmluZwZVdGlsZGUGV2FjdXRlC1djaXJjdW1mbGV4CVdkaWVyZXNpcwZXZ3JhdmULWWNpcmN1bWZsZXgGWWdyYXZlBlphY3V0ZQpaZG90YWNjZW50BmFicmV2ZQdhbWFjcm9uB2FvZ29uZWsHYWVhY3V0ZQd1bmkxRTAzC2NjaXJjdW1mbGV4CmNkb3RhY2NlbnQGZGNhcm9uB3VuaTFFMEIGZWJyZXZlBmVjYXJvbgplZG90YWNjZW50B2VtYWNyb24HZW9nb25lawd1bmkxRTFGC2djaXJjdW1mbGV4B3VuaTAxMjMKZ2RvdGFjY2VudARoYmFyC2hjaXJjdW1mbGV4BmlicmV2ZQlpLmxvY2xUUksCaWoHaW1hY3Jvbgdpb2dvbmVrBml0aWxkZQd1bmkwMjM3C3VuaTAwNkEwMzAxC2pjaXJjdW1mbGV4B3VuaTAxMzcMa2dyZWVubGFuZGljBmxhY3V0ZQZsY2Fyb24HdW5pMDEzQwRsZG90B3VuaTFFNDEGbmFjdXRlC25hcG9zdHJvcGhlBm5jYXJvbgd1bmkwMTQ2A2VuZwZvYnJldmUNb2h1bmdhcnVtbGF1dAdvbWFjcm9uC29zbGFzaGFjdXRlB3VuaTFFNTcGcmFjdXRlBnJjYXJvbgd1bmkwMTU3BnNhY3V0ZQtzY2lyY3VtZmxleAd1bmkwMjE5B3VuaTFFNjEEdGJhcgZ0Y2Fyb24HdW5pMDE2Mwd1bmkwMjFCB3VuaTFFNkIGdWJyZXZlDXVodW5nYXJ1bWxhdXQHdW1hY3Jvbgd1b2dvbmVrBXVyaW5nBnV0aWxkZQZ3YWN1dGULd2NpcmN1bWZsZXgJd2RpZXJlc2lzBndncmF2ZQt5Y2lyY3VtZmxleAZ5Z3JhdmUGemFjdXRlCnpkb3RhY2NlbnQHdW5pMDM5NAd1bmkwM0E5B3VuaTAzQkMHemVyby5sZgZvbmUubGYGdHdvLmxmCHRocmVlLmxmB2ZvdXIubGYHZml2ZS5sZgZzaXgubGYIc2V2ZW4ubGYIZWlnaHQubGYHbmluZS5sZgd1bmkyMDgwB3VuaTIwODEHdW5pMjA4Mgd1bmkyMDgzB3VuaTIwODQHdW5pMjA4NQd1bmkyMDg2B3VuaTIwODcHdW5pMjA4OAd1bmkyMDg5CXplcm8uZG5vbQhvbmUuZG5vbQh0d28uZG5vbQp0aHJlZS5kbm9tCWZvdXIuZG5vbQlmaXZlLmRub20Ic2l4LmRub20Kc2V2ZW4uZG5vbQplaWdodC5kbm9tCW5pbmUuZG5vbQl6ZXJvLm51bXIIb25lLm51bXIIdHdvLm51bXIKdGhyZWUubnVtcglmb3VyLm51bXIJZml2ZS5udW1yCHNpeC5udW1yCnNldmVuLm51bXIKZWlnaHQubnVtcgluaW5lLm51bXIHdW5pMjA3MAd1bmkwMEI5B3VuaTAwQjIHdW5pMDBCMwd1bmkyMDc0B3VuaTIwNzUHdW5pMjA3Ngd1bmkyMDc3B3VuaTIwNzgHdW5pMjA3OQd1bmkyMTUzB3VuaTIxNTQJb25lZWlnaHRoDHRocmVlZWlnaHRocwtmaXZlZWlnaHRocwxzZXZlbmVpZ2h0aHMHdW5pMDBBRApmaWd1cmVkYXNoB3VuaTIwMDMHdW5pMjAwMgd1bmkyMDA3B3VuaTIwMDgHdW5pMDBBMAd1bmkyMDBCBEV1cm8HdW5pMjBCOQd1bmkyMEJGB3VuaTIyMTkHdW5pMjIxNQhlbXB0eXNldAd1bmkyMTI2B3VuaTIyMDYHdW5pMDBCNQZjaXJjbGUHdW5pRjhGRgd1bmkyMTE3B3VuaTIxMTMJZXN0aW1hdGVkB3VuaTIxMTYHdW5pMjEyMAd1bmkwMkJDB3VuaTAyQzkHdW5pMDMwOAd1bmkwMzA3CWdyYXZlY29tYglhY3V0ZWNvbWIHdW5pMDMwQgt1bmkwMzBDLmFsdAd1bmkwMzAyB3VuaTAzMEMHdW5pMDMwNgd1bmkwMzBBCXRpbGRlY29tYgd1bmkwMzA0B3VuaTAzMTIHdW5pMDMyNgd1bmkwMzI3B3VuaTAzMjgHdW5pMDMzNQd1bmkwMzM2B3VuaTAzMzcHdW5pMDMzOAd1bmlFMEZGB3VuaUVGRkQHdW5pRjAwMAAAAAABAAAACgA4AHYAAkRGTFQAHmxhdG4ADgAEAAAAAP//AAMAAQADAAUABAAAAAD//wADAAAAAgAEAAZrZXJuADZrZXJuADZtYXJrAC5tYXJrAC5ta21rACZta21rACYAAAACAAQABQAAAAIAAgADAAAAAgAAAAEABhyODeINJAFQAQYADgAGAgAAAQAIAAEA4ACMAAEArgAMABgAegB0AHQAbgBuAGgAbgBuAG4AYgBcAFYAUABKAEoASgBKAEQARABKAD4AegA4ADIAAQD6A2IAAQD6A5AAAQD+A14AAQD6A1EAAQD6A14AAQAAA0sAAQAAAz0AAQAAA2IAAQAAA5AAAQAEA14AAQAAA14AAQAAA1EAAQD6Az0AAgAFAcwB0QAAAdMB2QAGAeEB4wANAeUB6gAQAewB7QAWAAwAAA0IAAANCAAADQgAAA0IAAANAgAADQgAAA0IAAANCAAADQgAAA0IAAANCAAADQgAAgACAc0B0QAAAdMB2QAFAAYBAAABAAgAAQA6ACYAAQAwAAwAAwAUAA4ACAABAP//bQABAAD/bQABAAD/QwABAAMB2gHbAeQAAgAADIIAAAyCAAEAAgHaAdsABAAAAAEACAABC7wLLgAEC2IADAENCxwLFgsQAAALHAsWCwoAAAscCxYLCgAACxwLFgsKAAALHAsWCwQAAAscCxYLCgAACxwLFgr+AAALHAsWCxAAAAscCxYK+AAACxwLFgryAAAK7AAACuYAAArsAAAK4AAACtoAAArUAAAK2gAACs4AAArIAAAKwgAACsgAAAq8AAAKyAAACrwAAAq2AAAAAAAACsgAAAq8AAAKyAAACrAAAAqqAAAKpAqeCpgAAAqSCowKqgAACoYKngqYAAAKkgqMCqoAAAqACp4Kegp0CtQAAAp6CnQKbgAACnoKdApuAAAKegp0Cm4AAAp6CnQKbgAACnoKdArOAAAKegp0Cs4AAAp6CnQKbgAACnoKdApoAAAKegp0CtQAAApiAAAKXAAACmIAAApWAAAKUAAACkoAAApQAAAKRAAAClAAAApEAAAKPgAACkoAAApQAAAKOAAACjIAAAosCiYKIAAAChoKFAoyAAAKDgomCggKAgn8AAAJ9goCCfAAAAoICgIJ6gAACggKAgnqAAAKCAoCCeoAAAoICgIJ5AAACggKAgnkAAAKCAoCCeoAAAoICgIJ3gAACggKAgn8AAAKCAoCCdgAAAnSAAAJzAAACdIAAAnGAAAJ0gAACcYAAAnAAAAJugAACbQAAAm6AAAJrgAACagJogmuAAAJnAmiCa4AAAmoCaIJlgAACagJogmuAAAJqAmiCZAAAAmKCYQJfgAACXgAAAl+AAAJcgAACWwAAAlmAAAJbAAACWAAAAlsAAAJYAAACVoAAAlmAAAJbAAACWYAAAlsAAAJVAAACU4JSAlCCTwJTglICTYJPAlOCUgJNgk8CU4JSAk2CTwJTglICTAJPAlOCUgJNgk8CU4JSAk2CTwJTglICSoJPAlOCUgJQgk8CU4JSAk2CTwJTglICSQJPAkeAAAK1AAACR4AAArOAAAJGAAACsIAAAkYAAAKvAAACRgAAAq8AAAJEgAACsIAAAkMAAAJBgAACQwAAAkAAAAJDAAACQAAAAj6AAAAAAAACQwAAAkAAAAI9AAACQYAAAkMAAAI7gAACOgAAAjiCNwI6AAACOII3AjoAAAI1gjcCNAAAAAACNwIygAACOII3AjoAAAIxAjcCxwIvgsQAAALHAi+CwoAAAscCL4LCgAACxwIvgsKAAALHAi+CwQAAAscCL4LCgAACxwIvgsKAAALHAi+Cv4AAAscCL4LEAAACxwIvgr4AAALHAi+CvIAAAi4AAAK1AAACLIAAAisAAAIsgAACKYAAAiyAAAIpgAACLIAAAigAAAIsgAACKYAAAkYAAAImgAACsgAAApKAAAKyAAACkQAAArIAAAKRAAACsgAAAo4AAAKyAAACkQAAAiUAAAIjgAACJQAAAiIAAAIlAAACIgAAAiUAAAIggAACxwLFgsQAAALHAsWCwoAAAscCxYLCgAACxwLFgsKAAALHAsWCwQAAAscCxYLCgAACxwLFgr+AAALHAsWCxAAAAscCxYK+AAACxwLFgryAAAK7AAACuYAAArsAAAK4AAACtoAAArUAAAK2gAACs4AAArIAAAKwgAACsgAAAq8AAAKyAAACrwAAAq2AAAAAAAACsgAAAq8AAAKyAAACrAAAAqqAAAKpAqeCpgAAAqSCowKqgAACoYKngqYAAAKkgqMCqoAAAqACp4Kegp0CtQAAAp6CnQKbgAACnoKdApuAAAKegp0Cm4AAAp6CnQKbgAACnoKdArOAAAKegp0Cs4AAAp6CnQKbgAACnoKdApoAAAKegp0CtQAAApiAAAKXAAACmIAAApWAAAKUAAACkoAAApQAAAKRAAAClAAAApEAAAKPgAACkoAAApQAAAKOAAACjIAAAosCiYKIAAAChoKFAoyAAAKDgomCggKAgn8AAAKCAoCCfwAAAoICgIJ6gAACggKAgnqAAAKCAoCCeoAAAoICgIJ5AAACggKAgnkAAAKCAoCCeoAAAn2CgIJ8AAACggKAgneAAAKCAoCCfwAAAoICgIJ2AAACdIAAAnMAAAJ0gAACcwAAAnSAAAJxgAACdIAAAnGAAAJwAAACboAAAm0AAAJugAACcAAAAm6AAAJrgAACagJogmuAAAJnAmiCa4AAAmoCaIJlgAACagJogmuAAAJqAmiCZAAAAmKCYQJfgAACXgAAAl+AAAJcgAACWwAAAlmAAAJbAAACWAAAAh8AAAIdgAACWwAAAlgAAAJWgAACWYAAAlsAAAJZgAACWwAAAlUAAAJTglICUIJPAlOCUgJNgk8CU4JSAk2CTwJTglICTYJPAlOCUgJMAk8CU4JSAk2CTwJTglICTYJPAlOCUgJKgk8CU4JSAlCCTwJTglICTYJPAlOCUgJJAk8CR4AAArUAAAJHgAACs4AAAkYAAAKwgAACRgAAAq8AAAJGAAACrwAAAkSAAAKwgAACQwAAAkGAAAJDAAACQAAAAkMAAAJAAAACPoAAAAAAAAJDAAACQAAAAj0AAAJBgAACQwAAAjuAAAI6AAACOII3AjoAAAI4gjcCOgAAAjWCNwI0AAAAAAI3AjKAAAI4gjcCOgAAAjECNwLHAi+CxAAAAscCL4LCgAACxwIvgsKAAALHAi+CwoAAAscCL4LBAAACxwIvgsKAAALHAi+CwoAAAscCL4K/gAACxwIvgsQAAALHAi+CvgAAAscCL4K8gAACLgAAArUAAAIsgAACKwAAAiyAAAIpgAACLIAAAimAAAIsgAACKAAAAiyAAAIpgAACRgAAAiaAAAKyAAACkoAAArIAAAKRAAACsgAAApEAAAKyAAACjgAAArIAAAKRAAACJQAAAiOAAAIlAAACIgAAAiUAAAIiAAACJQAAAiCAAAIcAAACGoAAAABALgCvAABAL0AAAABAUkCvAABAUkAAAABALkDUQABALkDXgABALkCvAABALUAAAABAMsCvAABARcDUQABARcDXgABARcCvAABARcAAAABAL8AAAABASkAAAABALYDUQABALb/QwABALb/bQABALYDXgABALYBXgABALYCvAABALYAAAABALoDUQABALr/QwABALr/bQABALoDXgABALoCvAABALoAAAABAMv/QwABAMsAAAABAMEAAAABAMgDYgABAMgDPQABAMgDUQABAMgDXgABAMgBXgABAMgCvAABAWcACgABAMgAAAABANYDYgABANb/QwABANYDXgABANYCvAABANYAAAABAQ0DUQABAQ0CvAABAQ0AAAABAMABXgABAH4CvAABAM8AAAABALv/QwABAGoDXgABAKwBXgABAGoCvAABALsAAAABANn/QwABAM8CvAABANkAAAABAJ0DXgABAJ0CvAABAIcAAAABAGADYgABAGADPQABAGADUQABAGADXgABAV0CvAABAUcAAAABAGACvAABAK0AAAABAGAAAAABANIDXgABANsCHgABANsCvAABANsAAAABANICHgABANICvAABANIAAAABAMUDUQABAMT/QwABAMUDXgABAMUCvAABAMQAAAABALcDUQABALcCvAABAKwAAAABAL8DPQABAL8DXgABAVUAAAABALQAAAABAMMDUQABAMMDXgABAHYBaAABANQCvAABAN0AAAABAGUBaAABAMMCvAABAMwAAAABAMEDUQABAMX/bQABAMEDXgABAMECvAABAMUAAAABAL8DUQABAL8CvAABAMoAAAABASADXgABASACvAABASAAAAABAMkDYgABAMkDkAABAMkDPQABAMkDUQABAMkDXgABAMkCvAABAYUAAAABAMkAAAACAAgABABZAAAAWwBcAFYAXwBpAFgAawDlAGMA5wDoAN4A6wD1AOAA9wEXAOsBlQGVAQwAEwACARIAAgESAAIBEgACARIAAgEMAAIBEgACARIAAgESAAIBEgACARIAAgESAAIBEgAAAQYAAAEGAAEAVAADAE4AAwBOAAMATgAD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ADEAAAACAdBgAAAA////6gAAANYDXgAiADEAAAACAdVgAAAA////2gAAAOYDXgAiADEAAAACAdNgAAAA////4gAAAN4DUQAiADEAAAACAc1gAAAA//8AKQAAAJcDUQAiADEAAAACAc5gAAAA////3gAAAJwDXgAiADEAAAACAc9gAAAA////7QAAANMDQgAiADEAAAACAdhgAAAAAAEAEf9tAK0CvAAVAAAWNjcVBgYjIiY1NDcjETMRIwYVFBYzmREDER0WKS9ELG4THhQPVgUBOAcEIB4zIgK8/UQZIQ0PAP///9UAAADrA2IAIgAxAAAAAgHXYAAAAAABABD//ADjArwADQAAFic1FjMyNjURMxEUBiMlFRAUISBuT1EEBGQEISICGf3qVlQA//8AEP/8AR8DXgAiADwAAAADAdAAnQAA//8AEP/8ASMDXgAiADwAAAADAdMAnQAAAAEAKQAAAZMCvAALAAATMxETMwMTIwMHFSMpboxug4VzXSxuArz+2QEn/v/+RQE4Wd///wAp/0MBkwK8ACIAPwAAAAMB2gDZAAAAAQApAAABTAK8AAUAABMzETMVISlutf7dArz9qGT//wApAAABTANeACIAQQAAAAIB0GoAAAD//wApAAABTAK8ACIAQQAAAAMB0gEEAAD//wAp/0MBTAK8ACIAQQAAAAMB2gC7AAAAAgApAAABTAK8AAUACQAAEzMRMxUhEzMVIylutf7drWpqArz9qGQBk2oAAQAKAAABYAK8AA0AACUVITUHNTcRMxE3FQcVAWD+3TMzbnd3ZGSgN3g3AaT+0n94f7IAAAEAKQAAAfECvAAPAAATMxMzEzMRIxEjAyMDIxEjKZ1GAkadaAJQXFACYAK8/gsB9f1EAhL97gIS/e4A//8AKQAAAfEDUQAiAEcAAAADAc4BDQAAAAEAKQAAAYICvAALAAATMxMzETMRIwMjESMpimsCYnGEAmICvP5dAaP9RAH//gEA//8AKQAAAYIDXgAiAEkAAAADAdAA1gAA//8AKQAAAYIDXgAiAEkAAAADAdQA1gAA//8AKf9DAYICvAAiAEkAAAADAdoA1gAAAAEAKf9WAYICvAAYAAAWJzUWMzI2NTQmJwMjESMRMxMzETMRFAYj0hUQFxYeBAaBAmKKawJiS0mqBF8EGx4RGhUB3f31Arz+dAGM/UJU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AAwAAP//AAwAAAGFA2IAAgANAAD//wAKAAACLgK8AAIADgAA//8ACgAAAi4DXgACAA8AAP//ACkAAAF9ArwAAgAQAAD//wApAAABfQNRAAIAEQAA//8AIv/2AWYCxgACABIAAP//ACL/9gFmA14AAgATAAD//wAi//YBZgNeAAIAFAAA//8AIv9tAWYCxgACABUAAP//ACL/9gFmA14AAgAWAAD//wAi//YBZgNRAAIAFwAA//8AKQAAAXUCvAACABgAAP//AAoAAAGGArwAAgAZAAD//wApAAABdQNeAAIAGgAA//8ACgAAAYYCvAACABsAAP//ACkAAAF1A1EAAgAcAAD//wApAAABVQK8AAIAHQAA//8AKQAAAVUDXgACAB4AAP//ACkAAAFVA14AAgAfAAD//wApAAABVQNeAAIAIAAA//8AKQAAAVUDXgACACEAAP//ACkAAAFVA1EAAgAiAAD//wApAAABVQNRAAIAIwAA//8AKQAAAVUDXgACACQAAP//ACkAAAFVA0IAAgAlAAD//wAp/20BVQK8AAIAJgAA//8AKQAAAUwCvAACACcAAP//ACkAAAFMA1EAAgAoAAD//wAh//YBaQLGAAIAKQAA//8AIf/2AWkDXgACACoAAP//ACH/9gFpA14AAgArAAD//wAh/0MBaQLGAAIALAAA//8AIf/2AWkDUQACAC0AAP//ACkAAAF7ArwAAgAuAAD//wAKAAABrAK8AAIALwAA//8AKQAAAXsDXgACADAAAP//ACkAAACXArwAAgAxAAD//wApAAAAlwK8AAIAMQAA//8AJAAAAOIDXgACADMAAP///+oAAADWA14AAgA0AAD////aAAAA5gNeAAIANQAA////4gAAAN4DUQACADYAAP//ACkAAACXA1EAAgA3AAD////eAAAAnANeAAIAOAAA//8AKf/8AaMCvAACADIAAP///+0AAADTA0IAAgA5AAD//wAR/20ArQK8AAIAOgAA////1QAAAOsDYgACADsAAP//ABD//ADjArwAAgA8AAD//wAQ//wA4wK8AAIAPAAA//8AEP/8AR8DXgACAD0AAP//ABD//AEjA14AAgA+AAD//wApAAABkwK8AAIAPwAA//8AKf9DAZMCvAACAEAAAP//ACkAAAGTArwAAgA/AAD//wApAAABTAK8AAIAQQAA//8AKQAAAUwDXgACAEIAAP//ACkAAAFMArwAAgBDAAD//wAp/0MBTAK8AAIARAAA//8AKQAAAUwCvAACAEUAAP//AAoAAAFgArwAAgBGAAD//wApAAAB8QK8AAIARwAA//8AKQAAAfEDUQACAEgAAP//ACkAAAGCArwAAgBJAAD//wApAAABggNeAAIASgAA//8ABAAAAfUCvAAiAcs5AAACAElzAAAA//8AKQAAAYIDXgACAEsAAP//ACn/QwGCArwAAgBMAAD//wAp/1YBggK8AAIATQAA//8AKQAAAYIDYgACAE4AAP//ACH/9gFvAsYAAgBPAAD//wAh//YBbwNeAAIAUAAA//8AIf/2AW8DXgACAFEAAP//ACH/9gFvA14AAgBSAAD//wAh//YBbwNRAAIAUwAA//8AIf/2AW8DXgACAFQAAP//ACH/9gGMA14AAgBVAAD//wAh//YBbwNCAAIAVgAA//8AF//mAXkC1gACAFcAAP//ABf/5gF5A14AAgBYAAD//wAh//YBbwNiAAIAWQAA//8AIQAAAisCvAACAFoAAP//ACkAAAFvArwAAgBbAAD//wApAAABbwNRAAIAXAAA//8AKQAAAW8CvAACAF0AAP//ACH/vwGKAsYAAgBeAAD//wApAAABfAK8AAIAXwAA//8AKQAAAXwDXgACAGAAAP//ACkAAAF8A14AAgBhAAD//wAp/0MBfAK8AAIAYgAA//8AFv/2AV4CxgACAGMAAP//ABb/9gFeA14AAgBkAAD//wAW//YBXgNeAAIAZQAA//8AFv9tAV4CxgACAGYAAP//ABb/9gFeA14AAgBnAAD//wAW/0MBXgLGAAIAaAAA//8AFv/2AV4DUQACAGkAAP//ACkAAAGBArwAAgBqAAD//wAMAAABYAK8AAIAawAA//8ADAAAAWACvAACAGwAAP//AAwAAAFgA14AAgBtAAD//wAM/20BYAK8AAIAbgAA//8ADP9DAWACvAACAG8AAP//AAwAAAFgA1EAAgBwAAD//wAl//YBbQK8AAIAcQAA//8AJf/2AW0DXgACAHIAAP//ACX/9gFtA14AAgBzAAD//wAl//YBbQNeAAIAdAAA//8AJf/2AW0DUQACAHUAAP//ACX/9gFtA14AAgB2AAD//wAl//YBjQNeAAIAdwAA//8AJf/2AW0DQgAC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) format('truetype'); }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: "Courier New", monospace;
  background: #fff;
  color: #000;
  -webkit-font-smoothing: none;
  height: 100vh;
  overflow: hidden;
}
.clock-wrap {
  text-align: center;
  padding: 40px 0 0;
}
.digit {
  font-family: "Bebas Neue", Helvetica, "Amazon Ember", Arial, sans-serif;
  font-size: 220px;
  font-weight: 400;
  letter-spacing: 4px;
  line-height: 0.85;
  display: inline-block;
  vertical-align: baseline;
}
.digit-hour { color: #999; }
.digit-colon {
  font-family: "Bebas Neue", Helvetica, "Amazon Ember", Arial, sans-serif;
  font-size: 170px;
  color: #ccc;
  display: inline-block;
  vertical-align: baseline;
  margin: 0 4px;
  line-height: 0.85;
}
.digit-min { color: #000; }
.clock-date {
  font-size: 16px;
  color: #999;
  letter-spacing: 4px;
  text-transform: uppercase;
  margin-top: 14px;
}
.todo-section {
  padding: 0 16px;
  margin-top: 20px;
}
.todo-hdr {
  font-size: 12px;
  font-weight: 900;
  color: #555;
  letter-spacing: 2px;
  text-transform: uppercase;
  border-bottom: 1px solid #ddd;
  padding-bottom: 2px;
  margin-bottom: 4px;
}
.todo-hdr-count {
  font-weight: normal;
  color: #999;
  font-size: 11px;
}
.todo-list {
  height: 230px;
  overflow: hidden;
}
.todo-item {
  height: 35px;
  line-height: 35px;
  border-bottom: 1px dotted #ddd;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 16px;
}
.todo-item.done {
  color: #999;
  text-decoration: line-through;
}
.todo-pri {
  display: inline-block;
  width: 22px;
  text-align: center;
  font-size: 14px;
}
.todo-text {
  font-family: "Amazon Ember", Helvetica, sans-serif;
}
.todo-empty {
  color: #ccc;
  font-size: 14px;
  text-align: center;
  padding-top: 40px;
}
.nag {
  text-align: center;
  padding: 8px 16px;
  margin-top: 8px;
  height: 50px;
  overflow: hidden;
}
.nag-text {
  font-family: "Amazon Ember", Helvetica, sans-serif;
  font-size: 18px;
  font-weight: bold;
  color: #333;
  line-height: 1.3;
}
.nag-usage {
  font-family: "Courier New", monospace;
  font-size: 13px;
  color: #999;
  margin-top: 2px;
}
.clock-hint {
  font-size: 11px;
  color: #ccc;
  text-align: center;
  position: fixed;
  bottom: 8px;
  left: 0;
  right: 0;
}
</style>
</head>
<body>
<div class="clock-wrap" onclick="location.href='/hud'">
  <span class="digit digit-hour" id="c-hour">--</span><span class="digit-colon">:</span><span class="digit digit-min" id="c-min">--</span>
  <div class="clock-date" id="c-date"></div>
</div>
<div class="nag" id="nag">
  <div class="nag-text" id="nag-text"></div>
  <div class="nag-usage" id="nag-usage"></div>
</div>
<div class="todo-section">
  <div class="todo-hdr">TODO <span class="todo-hdr-count" id="todo-count"></span></div>
  <div class="todo-list" id="todo-list">
    <div class="todo-empty">no items</div>
  </div>
</div>
<div class="clock-hint">tap clock to return</div>
<script>
(function(){
  var TZ = ${TZ_OFFSET_HOURS};
  var days = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  var months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  var priMap = { high: "\\u25CF", mid: "\\u25D0", low: "\\u25CB" };

  // Capitalist nag messages based on usage
  var nags = {
    idle: [
      "Anthropic 感谢您的慷慨捐款 (^_~)",
      "您的订阅费正在变成 Dario 的晚餐 (o^^o)",
      "每一秒闲置，都是对资本家的无私奉献 T_T",
      "白嫖指数 -- Anthropic 100% / 你 0% >_<",
      "200刀/月，当前用途：暖服务器 (=_=)",
      "您的钱在帮助 AI 安全研究（不是您） (;_;)",
      "Claude 在机房里等您，电费您出的 (/_;)"
    ],
    low: [
      "才用了这点？Anthropic 偷着乐呢 (*^o^*)",
      "按这速度，您是慈善家不是程序员 (^^;)",
      "用量感人，利润率感谢您 \\\\(^o^)/",
      "这用量配得上免费套餐，但您付的 Max orz",
      "多用点，别让 Anthropic 太舒服 (>^<)"
    ],
    mid: [
      "还行，但 Anthropic 觉得还可以更多 (-_-)",
      "半梦半醒之间，钱在缓慢燃烧 (u_u)",
      "及格线。但您付了满分的钱 (=.=)",
      "用了一半？另一半是给 Anthropic 的小费 ^_^;"
    ],
    high: [
      "这才对嘛！把本钱用回来！(>w<)",
      "榨干每一分钱，正确的姿势！(*^^)v",
      "Anthropic 的利润率正在因您而下降 (T^T)",
      "终于！一个不当冤大头的用户 (^o^)/"
    ],
    max: [
      "极限压榨！GPU 在冒烟了 (@_@)",
      "恭喜，您是 Anthropic 最不想要的用户 \\\\(^^)/",
      "Dario: 这用户能不能别续费了 (x_x)",
      "订阅费的每一分都没浪费！(*^^*)b"
    ]
  };

  function getNag(u5h) {
    var level;
    var v = u5h || 0;
    if (v <= 0) level = "idle";
    else if (v < 20) level = "low";
    else if (v < 50) level = "mid";
    else if (v < 80) level = "high";
    else level = "max";
    var list = nags[level];
    return list[Math.floor(Math.random() * list.length)];
  }

  var lastNag = "";
  function updateNag(u5h, u7d) {
    var el = document.getElementById("nag-text");
    var uel = document.getElementById("nag-usage");
    if (!lastNag) lastNag = getNag(u5h, u7d);
    el.textContent = lastNag;
    if (u5h > 0 || u7d > 0) {
      uel.textContent = "5h: " + (u5h||0) + "% | 7d: " + (u7d||0) + "%";
    } else {
      uel.textContent = "usage: --";
    }
  }
  // Rotate nag every 5 minutes
  var nagCount = 0;

  function updateClock() {
    var utc = Date.now();
    var d = new Date(utc + TZ * 3600000);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    document.getElementById("c-hour").textContent = (h < 10 ? "0" : "") + h;
    document.getElementById("c-min").textContent = (m < 10 ? "0" : "") + m;
    document.getElementById("c-date").textContent = days[d.getUTCDay()] + " \\u00B7 " + months[d.getUTCMonth()] + " " + d.getUTCDate();
  }

  function renderTodos(todos) {
    var el = document.getElementById("todo-list");
    var countEl = document.getElementById("todo-count");
    if (!todos || !todos.length) {
      el.innerHTML = '<div class="todo-empty">no items</div>';
      countEl.textContent = "";
      return;
    }
    // Sort: undone first, then by priority (high > mid > low), done items at bottom
    var priOrder = { high: 0, mid: 1, low: 2 };
    todos.sort(function(a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (priOrder[a.priority] !== priOrder[b.priority]) return priOrder[a.priority] - priOrder[b.priority];
      return a.ts - b.ts;
    });
    var doneCount = 0;
    var html = "";
    for (var i = 0; i < todos.length && i < 10; i++) {
      var t = todos[i];
      if (t.done) doneCount++;
      var cls = "todo-item" + (t.done ? " done" : "");
      var pri = priMap[t.priority] || priMap.mid;
      html += '<div class="' + cls + '"><span class="todo-pri">' + pri + '</span><span class="todo-text">' + escHtml(t.text) + '</span></div>';
    }
    el.innerHTML = html;
    countEl.textContent = doneCount + "/" + todos.length;
  }

  function escHtml(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // Single poll: clock + todos + active detection
  var lastToolTs = "";
  function poll() {
    updateClock();
    var x = new XMLHttpRequest();
    x.open("GET", "/status");
    x.onload = function() {
      if (x.status === 200) {
        try {
          var d = JSON.parse(x.responseText);
          // Auto-return to HUD when Claude Code becomes active
          var key = (d.tool||"") + (d.timestamp||"");
          if (key && key !== lastToolTs) {
            if (lastToolTs && d.tool) { location.href = "/hud"; return; }
            lastToolTs = key;
          }
          // Update todos + nag
          if (d.todos) renderTodos(d.todos);
          var u5h = Math.round(parseFloat(d.usage5h) || 0);
          var u7d = Math.round(parseFloat(d.usage7d) || 0);
          nagCount++;
          if (nagCount >= 20) { nagCount = 0; lastNag = getNag(u5h); }
          updateNag(u5h, u7d);
        } catch(e) {}
      }
    };
    x.send();
  }

  updateClock();
  poll();
  setInterval(poll, 15000);
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

    // POST /notify — push notification (localhost only)
    if (req.method === "POST" && url.pathname === "/notify") {
      const host = url.hostname;
      if (host !== "localhost" && host !== "127.0.0.1") {
        return Response.json({ error: "POST only from localhost" }, { status: 403 });
      }
      return req.json().then((body: { title?: string; message?: string; size?: string; ttl?: number }) => {
        const id = addNotification(body);
        return Response.json({ ok: true, id });
      }).catch(() => Response.json({ error: "bad json" }, { status: 400 }));
    }

    // POST /todo — manage todo list (localhost only)
    if (req.method === "POST" && url.pathname === "/todo") {
      const host = url.hostname;
      if (host !== "localhost" && host !== "127.0.0.1") {
        return Response.json({ error: "POST only from localhost" }, { status: 403 });
      }
      return req.json().then((body: { action: string; id?: string; text?: string; priority?: string }) => {
        const result = handleTodoAction(body);
        if (!result.ok) return Response.json(result, { status: 400 });
        return Response.json({ ...result, todos });
      }).catch(() => Response.json({ error: "bad json" }, { status: 400 }));
    }

    // GET /status — Kindle polls (includes todos)
    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json({ ...state, heatmap, notifications: getAndCleanNotifications(), todos }, {
        headers: { "Cache-Control": "no-cache, no-store", "Access-Control-Allow-Origin": "*" },
      });
    }

    // GET /hud — HUD dashboard
    if (req.method === "GET" && (url.pathname === "/hud" || url.pathname === "/kindle")) {
      const water = Math.max(5, Math.min(120, parseInt(url.searchParams.get("water") || "", 10) || WATER_DEFAULT));
      const stand = Math.max(5, Math.min(120, parseInt(url.searchParams.get("stand") || "", 10) || STAND_DEFAULT));
      return new Response(getHTML(water, stand), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    // GET / — Default: Clock + Todo
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(getClockHTML(), {
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
║  Notify:  http://localhost:${PORT}/notify
║  Todo:    POST http://localhost:${PORT}/todo
╚══════════════════════════════════════════════╝
`);
