# ⚡ XPT Clip

> **A high-performance, multi-user, serverless cloud clipboard and fast file drop system.**  
> Built for zero-cost edge computing with Cloudflare Workers & Cloudflare D1.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare_D1-blue?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![No Card Required](https://img.shields.io/badge/Credit_Card-Not_Required-brightgreen)](https://xptdev.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cost: $0](https://img.shields.io/badge/Hosting_Cost-$0_Forever-brightgreen)](https://xptdev.com)

---

## ✨ Features (核心特性)

* 🔒 **Multi-Tenant Physical Isolation (多用户物理隔离)**:  
  Every user operates within their own encrypted workspace. Data is strictly filtered at the database level by `user_id`.
* 🎟️ **Admin-Exclusive One-Time Invite Codes (管理员专属一次性邀请码)**:  
  The very first user who initializes the deployment automatically crowns as **Super Administrator**. Only the admin can generate one-time invite codes. Once used by an invited user, the code is immediately burned and cannot be reused or forwarded!
* 🚀 **Smart Dual-Engine Storage up to 1GB (智能双引擎，最大 1GB，终身免绑卡)**:  
  - **Small files & text (≤ 2MB)**: Stored 100% in your private Cloudflare D1 edge database (zero external exposure).
  - **Large files & media (> 2MB up to 1GB)**: Streamed to high-stability relay storage (Primary: 9-year veteran Litterbox / Catbox since 2017; Backup: Tmpfiles.org). Turn off your computer immediately after sending; download anytime on mobile!
* 📱 **Seamless Cross-Device Stream (双端极速同步流)**:  
  Paste on desktop PC, refresh on mobile browser, and your notes or files are already there with a 1-click copy button—**no passcodes required for personal devices**!
* 🔗 **Guest 4-Digit Pickup Codes (访客4位临时提取码)**:  
  Need to send a quick file or code snippet to a colleague without an account? Click "Generate Share Code" to get a temporary 4-digit code (e.g., `5829`) with auto-expiration and burn-after-reading.
* 📸 **Global `Ctrl + V` & Drag-Drop Anywhere (截图剪贴板直读与全屏拖拽)**:  
  Capture screenshots with `Win + Shift + S` and press `Ctrl + V` anywhere on the page to automatically stage the screenshot for upload. Drag files anywhere across the window to upload effortlessly.
* 🔥 **Burn-After-Reading & TTL Expiration (阅后即焚与自动清理)**:  
  Configure clips to self-destruct immediately after viewing, or set expiration times from 10 minutes to 7 days.
* 💎 **100% Serverless & $0 Operating Cost (永久零服务器费用、无需绑卡)**:  
  Runs on Cloudflare Workers and D1 Database free tiers. Zero server maintenance, zero egress bandwidth fees, lightning-fast edge response worldwide.

---

## 🏗️ Architecture (技术架构)

```text
┌─────────────────────────────────────────────────────────────┐
│                    Client Browser (SPA)                     │
│  · Glassmorphism Obsidian Dark UI                           │
│  · Global Ctrl+V Screenshot Capture & Drag-and-Drop (1GB)   │
│  · Smooth Toast Notifications (No ugly alert popups)        │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / RESTful API
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Cloudflare Worker (Edge Serverless)             │
│  · Salted SHA-256 Authentication & Native Web Crypto JWT    │
│  · Admin Role Guard & Single-Use Invite Code Validator      │
│  · Smart Dual-Engine File Router (D1 vs 1GB Relay)          │
└──────────────┬──────────────────────────────┬───────────────┘
               │ SQL (≤2MB & Metadata)        │ High-Stability Stream (>2MB)
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│ Cloudflare D1 (Private DB)   │ │ 9-Year Veteran Relay       │
│ · users & invites tables     │ │ · Primary: Litterbox (1GB) │
│ · clips records & text       │ │ · Backup: Tmpfiles.org     │
└──────────────────────────────┘ └────────────────────────────┘
```

---

## 🚀 Quick Deployment (极速部署指南)

### Method 1: Web Dashboard (零代码命令行，2分钟搞定)

1. **Create D1 Database**:
   * Open [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Storage & Databases** -> **D1** -> **Create Database**.
   * Name: `clip-db` -> Click **Create**.
   * Open the **Console** tab, paste the contents of [`schema.sql`](./schema.sql), and click **Execute**.

2. **Create Worker & Bind Database**:
   * Open **Workers & Pages** -> **Create** -> **Create Worker** -> Name: `xpt-clip` -> **Deploy**.
   * In Worker **Settings** -> **Variables and Secrets** -> **D1 Database Bindings** -> **Add binding**:
     * Variable name: `DB` *(Must be uppercase)*
     * D1 database: select `clip-db`
     * Click **Save and Deploy**.

3. **Deploy Code & Custom Domain**:
   * Click **Edit code** in the Worker, paste the full content of [`src/worker.js`](./src/worker.js), and click **Deploy**.
   * In **Settings** -> **Domains & Routes** -> Add your custom subdomain (e.g., `clip.yourdomain.com`).

---

### Method 2: Wrangler CLI (命令行一键部署)

```bash
# 1. Clone repository
git clone https://github.com/x658/xpt-clip.git
cd xpt-clip

# 2. Create D1 database
npx wrangler d1 create clip-db

# 3. Apply SQL schema
npx wrangler d1 execute clip-db --file=./schema.sql --remote

# 4. Deploy to Cloudflare (100% Free, No Credit Card!)
npx wrangler deploy
```

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

Built with passion by [XPT Dev](https://xptdev.com) · Empowering developers worldwide with privacy-first, zero-cost utilities.
