# ⚡ XPT Clip

> **A high-performance, multi-user, serverless cloud clipboard and fast file drop system.**  
> Built for zero-cost edge computing with Cloudflare Workers & Cloudflare D1.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare_D1-blue?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Cloudflare R2](https://img.shields.io/badge/Storage-Cloudflare_R2-yellow?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/r2/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cost: $0](https://img.shields.io/badge/Hosting_Cost-$0_Forever-brightgreen)](https://xptdev.com)

---

## ✨ Features (核心特性)

* 🔒 **Multi-Tenant Physical Isolation (多用户物理隔离)**:  
  Every user operates within their own encrypted workspace. Data is strictly filtered at the database level by `user_id`.
* 🎟️ **Admin-Exclusive One-Time Invite Codes (管理员专属一次性邀请码)**:  
  The very first user who initializes the deployment automatically crowns as **Super Administrator**. Only the admin can generate one-time invite codes. Once used by an invited user, the code is immediately burned and cannot be reused or forwarded!
* 📦 **100MB File Fast Drop with Cloudflare R2 (100MB 大文件快传与对象存储)**:  
  Native Cloudflare R2 integration for lightning-fast file and media drops up to 100MB. Deleted or expired files are automatically purged, releasing storage space immediately!
* 📱 **Seamless Cross-Device Stream (双端极速同步流)**:  
  Paste on desktop PC, refresh on mobile browser, and your notes or files are already there with a 1-click copy button—**no passcodes required for personal devices**!
* 🔗 **Guest 4-Digit Pickup Codes (访客4位临时提取码)**:  
  Need to send a quick file or code snippet to a colleague without an account? Click "Generate Share Code" to get a temporary 4-digit code (e.g., `5829`) with auto-expiration and burn-after-reading.
* 📸 **Global `Ctrl + V` & Drag-Drop Anywhere (截图剪贴板直读与全屏拖拽)**:  
  Capture screenshots with `Win + Shift + S` and press `Ctrl + V` anywhere on the page to automatically stage the screenshot for upload. Drag files anywhere across the window to upload effortlessly.
* 🔥 **Burn-After-Reading & TTL Expiration (阅后即焚与自动清理)**:  
  Configure clips to self-destruct immediately after viewing, or set expiration times from 10 minutes to 7 days.
* 💎 **100% Serverless & $0 Operating Cost (永久零服务器费用)**:  
  Runs on Cloudflare Workers, D1 Database, and R2 Object Storage free tiers (10GB free permanent storage). Zero server maintenance, zero egress bandwidth fees, lightning-fast edge response worldwide.

---

## 🏗️ Architecture (技术架构)

```text
┌─────────────────────────────────────────────────────────────┐
│                    Client Browser (SPA)                     │
│  · Glassmorphism Obsidian Dark UI                           │
│  · Global Ctrl+V Screenshot Capture & Drag-and-Drop         │
│  · Smooth Toast Notifications (No ugly alert popups)        │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / RESTful API
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Cloudflare Worker (Edge Serverless)             │
│  · Salted SHA-256 Authentication & Native Web Crypto JWT    │
│  · Admin Role Guard & Single-Use Invite Code Validator      │
│  · Automatic Background Expiration Cleaner                  │
└──────────────┬──────────────────────────────┬───────────────┘
               │ SQL                          │ Streams (Up to 100MB)
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│ Cloudflare D1 (Database)     │ │ Cloudflare R2 (Storage)    │
│ · users & invites tables     │ │ · Direct streaming uploads │
│ · clips metadata             │ │ · Auto-space release on rm │
└──────────────────────────────┘ └────────────────────────────┘
```

---

## 🚀 Quick Deployment (极速部署指南)

### Method 1: Web Dashboard (零代码命令行，3分钟搞定)

1. **Create D1 Database**:
   * Open [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Storage & Databases** -> **D1** -> **Create Database**.
   * Name: `clip-db` -> Click **Create**.
   * Open the **Console** tab, paste the contents of [`schema.sql`](./schema.sql), and click **Execute**.

2. **Create R2 Bucket**:
   * In [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **R2 Object Storage** -> **Create bucket** -> Name: `clip-files` -> Click **Create bucket**.

3. **Create Worker & Bind Storage**:
   * Open **Workers & Pages** -> **Create** -> **Create Worker** -> Name: `xpt-clip` -> **Deploy**.
   * In Worker **Settings** -> **Variables and Secrets**:
     * **D1 Database Bindings** -> Add binding: Variable name: `DB`, Database: `clip-db`.
     * **R2 Bucket Bindings** -> Add binding: Variable name: `BUCKET`, Bucket: `clip-files`.
     * Click **Save and Deploy**.

4. **Deploy Code & Custom Domain**:
   * Click **Edit code** in the Worker, paste the full content of [`src/worker.js`](./src/worker.js), and click **Deploy**.
   * In **Settings** -> **Domains & Routes** -> Add your custom subdomain (e.g., `clip.yourdomain.com`).

---

### Method 2: Wrangler CLI (命令行一键部署)

```bash
# 1. Clone repository
git clone https://github.com/x658/xpt-clip.git
cd xpt-clip

# 2. Create D1 database & R2 bucket
npx wrangler d1 create clip-db
npx wrangler r2 bucket create clip-files

# 3. Apply SQL schema
npx wrangler d1 execute clip-db --file=./schema.sql --remote

# 4. Deploy to Cloudflare
npx wrangler deploy
```

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

Built with passion by [XPT Dev](https://xptdev.com) · Empowering developers worldwide with privacy-first, zero-cost utilities.
