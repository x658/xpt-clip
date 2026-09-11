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
  - **Large files & media (> 2MB up to 1GB)**: Direct client-side stream to high-speed relay storage (Primary: Tmpfiles.org via Cloudflare Tokyo CDN; Backup: Filebin AWS S3). Turn off your computer immediately after sending; download anytime on mobile!
* ⚡ **Live Progress & Speed Meter (实时动态进度条与测速仪)**:  
  Features real-time percentage progress bar, transferred data counter, and live upload bandwidth meter (e.g. `3.8 MB/s`). No more frozen buttons!
* 🛡️ **Zero Redirection Reverse Proxy (边缘透明反向中继代理)**:  
  All downloads stay strictly on your custom domain (`/api/files/:id`). Never redirects to third-party ad sites, completely solving domestic mobile network connection timeouts!
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
│  · Real-time Upload Progress Bar & Speed Meter (MB/s)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / RESTful API
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Cloudflare Worker (Edge Serverless)             │
│  · Salted SHA-256 Authentication & Native Web Crypto JWT    │
│  · Admin Role Guard & Single-Use Invite Code Validator      │
│  · Smart Dual-Engine File Router (D1 vs 1GB Relay)          │
│  · Transparent Edge Reverse Stream Proxy (Zero Redirection) │
└──────────────┬──────────────────────────────┬───────────────┘
               │ SQL (≤2MB & Metadata)        │ Cloudflare Internal Stream
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│ Cloudflare D1 (Private DB)   │ │ High-Speed Dual Relay (1GB)│
│ · users & invites tables     │ │ · Primary: Tmpfiles (CDN)  │
│ · clips records & text       │ │ · Backup: Filebin (AWS S3) │
└──────────────────────────────┘ └────────────────────────────┘
```

---

## ⚙️ Configuration (部署需修改项与自定义说明)

如果你 fork 或克隆本项目部署到自己的 Cloudflare 账号，只需修改以下几处配置：

| 配置项 | 文件位置 | 是否必改 | 说明 / 示例 |
| :--- | :--- | :---: | :--- |
| **D1 数据库 ID** | `wrangler.toml` (`database_id`) | **必填** | 运行 `npx wrangler d1 create clip-db` 后生成的专属 UUID（如 `920eae6d-xxxx-xxxx-xxxx-xxxxxxxxxxxx`） |
| **自定义域名路由** | `wrangler.toml` (`routes`) | 选填 | 填入你自己的二级域名（如 `clip.yourdomain.com`）；**若无需独立域名，可将 `routes` 整段注释掉**，直接免费使用 Cloudflare 赠送的 `xxx.workers.dev` 域名！ |
| **JWT 鉴权密钥** | `src/worker.js` (第 11 行 `JWT_SECRET`) | 建议 | 用于签发用户登录状态的加密密钥，建议随意修改为一串长随机字符串 |
| **站点品牌名称** | `src/worker.js` (第 527 行、809 行) | 选填 | 默认标题与左上角 LOGO 为 `⚡ XPT Clip PRO`，可自由定制为你自己的项目名称 |

---

## 🚀 Quick Deployment (极速部署指南)

### 选项 A：Wrangler 命令行一键部署（推荐，仅需 1 分钟）

```bash
# 1. 克隆代码仓库
git clone https://github.com/x658/xpt-clip.git
cd xpt-clip

# 2. 创建 Cloudflare D1 边缘数据库（若未登录按提示登录即可，完全免信用卡）
npx wrangler d1 create clip-db

# ⚠️ 注意：终端输出中会包含一行 database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
# 请打开 wrangler.toml，将 database_id 替换为你自己的 ID；若有独立域名顺便修改 routes。

# 3. 初始化数据库表结构（执行建表语句）
npx wrangler d1 execute clip-db --file=./schema.sql --remote

# 4. 一键部署上线
npx wrangler deploy
```

---

### 选项 B：Cloudflare 网页后台零代码部署（全图形化）

1. **创建 D1 数据库**：
   * 打开 [Cloudflare 控制台](https://dash.cloudflare.com/) ➡️ **存储与数据库** ➡️ **D1** ➡️ **创建数据库**；
   * 数据库名称输入 `clip-db` ➡️ 点击创建；
   * 点击进入该数据库的 **控制台 (Console)** 标签页，将项目中的 [`schema.sql`](./schema.sql) 文件内容全部粘贴进去，点击 **执行 (Execute)**。

2. **创建 Worker 并绑定 D1 数据库**：
   * 在控制台进入 **Workers 和 Pages** ➡️ **创建** ➡️ **创建 Worker** ➡️ 名称填 `xpt-clip` ➡️ 点击部署；
   * 部署后进入该 Worker 的 **设置 (Settings)** ➡️ **变量和机密 (Variables and Secrets)** ➡️ **D1 数据库绑定 (D1 Database Bindings)** ➡️ **添加绑定**：
     * 变量名称 (Variable name)：`DB` *(必须严格全大写)*
     * D1 数据库 (D1 database)：选择刚才创建的 `clip-db`
     * 点击 **保存并部署**。

3. **粘贴代码并绑定域名**：
   * 在 Worker 页面点击 **快速编辑 (Edit code)**，将 [`src/worker.js`](./src/worker.js) 的完整代码清空粘贴进去，点击右上角 **部署 (Deploy)**；
   * （可选）在 Worker 的 **设置** ➡️ **触发器 (Domains & Routes)** 中添加你的自定义域名（如 `clip.yourdomain.com`）。

---

## 👑 站长初始化与私密邀请制使用说明

1. **初始化站长账号**：
   * 部署完成后首次打开网站，切换到 **「新用户注册」**；
   * **系统中的首位注册用户将自动成为终身超级管理员（无需输入邀请码即可直接注册）**！
2. **分发邀请码给好友/同事**：
   * 超级管理员登录后，顶部会自动出现 **👑 管理员特权：邀请码分发中心**；
   * 点击 **「🎟️ 生成单次码」** 即可一键生成诸如 `XPT-ABCD-1234` 的专属激活码；
   * 每个激活码均为**物理单次有效**，一旦被注册使用便立即销毁作废，杜绝任何外部人员非法蹭用你的存储。

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

Built with passion by [XPT Dev](https://xptdev.com) · Empowering developers worldwide with privacy-first, zero-cost utilities.
