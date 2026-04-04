# Kindle Claude Code Status Display

## Overview

将废旧 Kindle 变成 Claude Code 的实时状态显示器。Kindle 作为只读终端，展示当前 Claude Code 正在执行的操作。

## Architecture

```
Claude Code Hook → POST /api/status → Vercel Blob (JSON file)
Kindle Browser   → GET  /api/status → 读取 Blob → 返回状态
                 → GET  /            → E-ink 优化的展示页面 (轮询 /api/status)
```

## Tech Stack

- **Runtime**: Next.js (App Router) on Vercel
- **Storage**: Vercel Blob — 存一个 JSON 文件，免费额度足够
- **Frontend**: 纯 HTML + minimal vanilla JS，E-ink 优化
- **Auth**: URL query token (`?token=xxx`)

## Target Device

- Kindle 第10代 (2019), 固件 5.18.1
- 分辨率 800x600, E-ink, 无色彩
- 实验性浏览器 (旧版 WebKit)

## API Design

### POST /api/status

Hook 调用，更新当前状态。

```
Headers: Authorization: Bearer <TOKEN>
Body: {
  "tool": "Edit",
  "file": "src/app.tsx",
  "message": "正在编辑 src/app.tsx"
}
```

### GET /api/status?token=xxx

Kindle 轮询，读取当前状态。

```
Response: {
  "tool": "Edit",
  "file": "src/app.tsx",
  "message": "正在编辑 src/app.tsx",
  "timestamp": "2026-04-04T10:30:00Z"
}
```

## Kindle Page Design

- 纯黑白，无灰度渐变
- 大字体 (24px+)，高对比度
- 无动画，无圆角阴影
- setInterval 轮询 (10s)，fallback meta refresh
- 显示内容：当前工具 + 文件路径 + 时间戳

## Claude Code Hook

在 `.claude/settings.json` 中配置 hook，监听工具调用事件，用 curl POST 到 API。

## Security

- 简单 token 验证，写入用 Bearer token，读取用 query param
- Kindle 收藏带 token 的 URL 即可
