/**
 * XPT Clip - High-Performance Multi-User Serverless Cloud Clipboard
 * 
 * Powered by Cloudflare Workers & Cloudflare D1
 * Zero Server Cost | End-to-End Privacy | One-Time Invite Codes
 * 
 * @license MIT
 * @author XPT Dev (https://xptdev.com)
 */

const JWT_SECRET = 'xpt-jwt-secret-key-2026-dynamic-invites-v2';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // Background asynchronous cleanup of expired clips
    cleanupExpiredClips(env.DB).catch(() => {});

    // ========================================================
    // 1. PUBLIC AUTHENTICATION & ACCESS APIS
    // ========================================================

    // POST /api/register
    if (pathname === '/api/register' && request.method === 'POST') {
      try {
        const { username, password, inviteCode } = await request.json();
        if (!username || !password || username.trim().length < 3 || password.length < 6) {
          return json({ error: '用户名需至少 3 位，密码需至少 6 位' }, 400);
        }

        const cleanUser = username.toLowerCase().trim();
        const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(cleanUser).first();
        if (existing) {
          return json({ error: '该用户名已被占用，请更换其他名字' }, 400);
        }

        // Count existing users to determine if first user
        const countRes = await env.DB.prepare('SELECT COUNT(*) as total FROM users').first();
        const isFirstUser = countRes.total === 0;

        let assignedRole = 'user';

        if (isFirstUser) {
          // 🏆 The very first user is crowned as Super Administrator (no invite code needed!)
          assignedRole = 'admin';
        } else {
          // Regular users must provide a valid active one-time invite code
          if (!inviteCode || !inviteCode.trim()) {
            return json({ error: '本站实行严格邀请制，必须输入有效的一次性邀请码' }, 403);
          }

          const cleanCode = inviteCode.trim().toUpperCase();
          const invite = await env.DB.prepare(
            'SELECT * FROM invites WHERE code = ? AND status = "active"'
          ).bind(cleanCode).first();

          if (!invite) {
            return json({ error: '该邀请码无效、不存在或已被他人使用' }, 403);
          }
        }

        const salt = crypto.randomUUID();
        const hash = await hashPassword(password, salt);
        const userId = 'u_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

        // Save user
        await env.DB.prepare(
          'INSERT INTO users (id, username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(userId, cleanUser, hash, salt, assignedRole, Date.now()).run();

        // Burn the invite code immediately
        if (!isFirstUser && inviteCode) {
          await env.DB.prepare(
            'UPDATE invites SET status = "used", used_by = ?, used_at = ? WHERE code = ?'
          ).bind(cleanUser, Date.now(), inviteCode.trim().toUpperCase()).run();
        }

        const token = await createJWT({ userId, username: cleanUser, role: assignedRole });
        return json({ success: true, token, username: cleanUser, role: assignedRole });
      } catch (err) {
        return json({ error: '注册发生异常: ' + err.message }, 500);
      }
    }

    // POST /api/login
    if (pathname === '/api/login' && request.method === 'POST') {
      try {
        const { username, password } = await request.json();
        const cleanUser = username.toLowerCase().trim();
        const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(cleanUser).first();
        if (!user) {
          return json({ error: '用户名或密码不正确' }, 401);
        }

        const hash = await hashPassword(password, user.salt);
        if (hash !== user.password_hash) {
          return json({ error: '用户名或密码不正确' }, 401);
        }

        const userRole = user.role || 'user';
        const token = await createJWT({ userId: user.id, username: user.username, role: userRole });
        return json({ success: true, token, username: user.username, role: userRole });
      } catch (err) {
        return json({ error: '登录处理失败' }, 500);
      }
    }

    // GET /api/guest/receive (4-digit code guest pickup)
    if (pathname === '/api/guest/receive' && request.method === 'GET') {
      const code = searchParams.get('code');
      if (!code || !/^\d{4}$/.test(code.trim())) {
        return json({ error: '请输入有效的 4 位数字提取码' }, 400);
      }

      const clip = await env.DB.prepare(
        'SELECT * FROM clips WHERE share_code = ? AND (expires_at IS NULL OR expires_at > ?)'
      ).bind(code.trim(), Date.now()).first();

      if (!clip) {
        return json({ error: '提取码不存在、已过期或已被提取销毁' }, 404);
      }

      // Burn after reading if configured
      if (clip.burn_after_reading === 1) {
        await env.DB.prepare('DELETE FROM clips WHERE id = ?').bind(clip.id).run();
      }

      return json({ success: true, data: clip });
    }

    // ========================================================
    // 2. AUTHENTICATED USER APIS (JWT REQUIRED)
    // ========================================================
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const currentUser = token ? await verifyJWT(token) : null;

    // --- 👑 Admin Invite Code Management ---
    if (pathname.startsWith('/api/admin/invites')) {
      if (!currentUser || currentUser.role !== 'admin') {
        return json({ error: '权限不足：仅管理员可管理邀请码' }, 403);
      }

      // Generate new one-time invite code
      if (request.method === 'POST') {
        const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
        const code = `XPT-${rand.slice(0, 4)}-${rand.slice(4, 8)}`;

        await env.DB.prepare(
          'INSERT INTO invites (code, created_by, status, created_at) VALUES (?, ?, "active", ?)'
        ).bind(code, currentUser.username, Date.now()).run();

        return json({ success: true, code });
      }

      // List invite codes
      if (request.method === 'GET') {
        const list = await env.DB.prepare(
          'SELECT code, status, used_by, created_at, used_at FROM invites ORDER BY created_at DESC LIMIT 30'
        ).all();
        return json({ success: true, invites: list.results || [] });
      }
    }

    // --- User Clips Management ---
    if (pathname.startsWith('/api/clips')) {
      if (!currentUser) {
        return json({ error: '请先登录' }, 401);
      }

      // 1. POST /api/clips/:id/share (Generate 4-digit code) - Matched specifically first!
      const shareMatch = pathname.match(/^\/api\/clips\/([^\/]+)\/share$/);
      if (shareMatch && request.method === 'POST') {
        const clipId = shareMatch[1];
        const randomCode = Math.floor(1000 + Math.random() * 9000).toString();
        const thirtyMinLater = Date.now() + 1800 * 1000;

        await env.DB.prepare(
          'UPDATE clips SET share_code = ?, expires_at = CASE WHEN expires_at IS NULL OR expires_at < ? THEN ? ELSE expires_at END WHERE id = ? AND user_id = ?'
        ).bind(randomCode, thirtyMinLater, thirtyMinLater, clipId, currentUser.userId).run();

        return json({ success: true, shareCode: randomCode });
      }

      // 2. DELETE /api/clips/:id
      const deleteMatch = pathname.match(/^\/api\/clips\/([^\/]+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        const clipId = deleteMatch[1];
        await env.DB.prepare('DELETE FROM clips WHERE id = ? AND user_id = ?').bind(clipId, currentUser.userId).run();
        return json({ success: true });
      }

      // 3. GET /api/clips (List stream)
      if (pathname === '/api/clips' && request.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT id, type, title, content, filename, mime_type, file_size, burn_after_reading, share_code, expires_at, created_at FROM clips WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
        ).bind(currentUser.userId).all();
        return json({ success: true, clips: rows.results || [] });
      }

      // 4. POST /api/clips (New clip)
      if (pathname === '/api/clips' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { type, content, filename, mimeType, fileSize, ttl, burn } = body;
          if (!content) {
            return json({ error: '传输内容不能为空' }, 400);
          }

          const clipId = 'c_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
          const expiresAt = ttl && Number(ttl) > 0 ? Date.now() + Number(ttl) * 1000 : null;

          let displayTitle = filename;
          if (!displayTitle) {
            displayTitle = type === 'file' ? '上传文件' : (content.length > 30 ? content.slice(0, 30) + '...' : content);
          }

          // Resilient insert: tries 11 columns, falls back to 10 columns if file_size column not yet added
          try {
            await env.DB.prepare(
              'INSERT INTO clips (id, user_id, type, title, content, filename, mime_type, file_size, burn_after_reading, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(
              clipId,
              currentUser.userId,
              type || 'text',
              displayTitle,
              content,
              filename || '',
              mimeType || 'text/plain',
              fileSize || 0,
              burn ? 1 : 0,
              expiresAt,
              Date.now()
            ).run();
          } catch (insertErr) {
            if (insertErr.message && insertErr.message.includes('file_size')) {
              await env.DB.prepare(
                'INSERT INTO clips (id, user_id, type, title, content, filename, mime_type, burn_after_reading, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
              ).bind(
                clipId,
                currentUser.userId,
                type || 'text',
                displayTitle,
                content,
                filename || '',
                mimeType || 'text/plain',
                burn ? 1 : 0,
                expiresAt,
                Date.now()
              ).run();
            } else {
              throw insertErr;
            }
          }

          return json({ success: true, id: clipId });
        } catch (err) {
          return json({ error: '保存失败: ' + err.message }, 500);
        }
      }
    }

    // ========================================================
    // 3. EMBEDDED HIGH-PERFORMANCE CLIENT (SPA)
    // ========================================================
    return new Response(frontendHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
};

// ========================================================
// UTILITY & SECURITY FUNCTIONS
// ========================================================

async function cleanupExpiredClips(db) {
  const now = Date.now();
  await db.prepare('DELETE FROM clips WHERE expires_at IS NOT NULL AND expires_at < ?').bind(now).run();
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${password}:::${salt}:::${JWT_SECRET}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createJWT(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 30 * 86400000 })).replace(/=/g, '');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${signature}`;
}

async function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const expectedSig = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, expectedSig, enc.encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ========================================================
// MODERN INDUSTRIAL FRONTEND TEMPLATE
// ========================================================
const frontendHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>XPT Clip · 跨端云剪贴板</title>
  <style>
    :root {
      --bg: #07090e;
      --card-bg: #111726;
      --card-hover: #161e31;
      --border: #1f2a40;
      --text: #f8fafc;
      --text-muted: #8b9bb4;
      --primary: #10b981;
      --primary-hover: #059669;
      --primary-glow: rgba(16, 185, 129, 0.2);
      --accent: #38bdf8;
      --danger: #f43f5e;
      --admin: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 12px;
      overflow-x: hidden;
    }
    .container { width: 100%; max-width: 680px; }
    
    /* Top Navigation Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding: 12px 18px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .logo {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #fff;
    }
    .badge-pro {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 12px;
      background: rgba(56, 189, 248, 0.12);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
    
    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
      transition: border-color 0.2s;
    }
    .admin-card {
      border: 1px solid rgba(245, 158, 11, 0.4);
      background: linear-gradient(180deg, #181926 0%, #111726 100%);
    }

    /* Buttons */
    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 13px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      box-shadow: 0 4px 14px var(--primary-glow);
      transition: all 0.2s;
    }
    .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    
    .btn-sm {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #192237;
      color: #cbd5e1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .btn-sm:hover { background: #23304c; color: #fff; border-color: #3b4d70; }

    /* Inputs & Forms */
    .form-group { margin-bottom: 14px; }
    label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; font-weight: 500; }
    input[type="text"], input[type="password"], textarea, select {
      width: 100%;
      background: #080c14;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; height: 110px; line-height: 1.5; }
    textarea:focus, input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-glow); }
    
    /* Drag and Drop Zone */
    .file-drop {
      border: 2px dashed var(--border);
      border-radius: 10px;
      padding: 22px;
      text-align: center;
      cursor: pointer;
      background: #080c14;
      transition: all 0.2s;
      user-select: none;
    }
    .file-drop:hover, .file-drop.dragover {
      border-color: var(--primary);
      background: rgba(16, 185, 129, 0.05);
    }
    .drag-full-mask {
      position: fixed;
      inset: 0;
      background: rgba(7, 9, 14, 0.85);
      backdrop-filter: blur(4px);
      border: 4px dashed var(--primary);
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 700;
      color: var(--primary);
      pointer-events: none;
    }
    body.dragging .drag-full-mask { display: flex; }

    /* Clip Item in Stream */
    .clip-item {
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 12px;
      transition: all 0.2s;
    }
    .clip-item:hover { border-color: #2b3b5c; }
    .clip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .clip-content {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 140px;
      overflow-y: auto;
      background: #111726;
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 10px;
      border: 1px solid rgba(255,255,255,0.03);
    }
    .clip-img-thumb {
      max-height: 140px;
      border-radius: 8px;
      margin-bottom: 10px;
      display: block;
      border: 1px solid var(--border);
    }
    .clip-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    /* Toast Notification */
    #toastContainer {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .toast {
      background: #192237;
      border: 1px solid var(--border);
      color: #fff;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 14px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      animation: toastIn 0.25s ease-out;
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toast.success { border-color: var(--primary); background: #0c2b20; color: #a7f3d0; }
    .toast.error { border-color: var(--danger); background: #381219; color: #fecdd3; }
    .toast.info { border-color: var(--accent); background: #0f2b3c; color: #bae6fd; }
    @keyframes toastIn {
      from { opacity: 0; transform: translateY(-10px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      z-index: 9000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      animation: toastIn 0.2s ease;
    }

    .footer {
      margin-top: 30px;
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
    }
    .footer a { color: var(--text-muted); text-decoration: none; }
    .footer a:hover { color: var(--accent); }
  </style>
</head>
<body>
  <!-- 全屏拖拽提示遮罩 -->
  <div class="drag-full-mask">
    📥 松开鼠标立即上传到剪贴流
  </div>

  <!-- Toast 消息容器 -->
  <div id="toastContainer"></div>

  <div class="container">
    <!-- 顶部导航 -->
    <div class="header">
      <div class="logo">
        ⚡ XPT Clip <span class="badge-pro">PRO</span>
      </div>
      <div id="userNavStatus"></div>
    </div>

    <!-- 登录 / 注册 面板 -->
    <div id="authCard" class="card" style="display: none;">
      <div style="display:flex; gap:10px; margin-bottom:18px;">
        <button class="btn-sm" id="tabLogin" style="flex:1;background:var(--primary);color:#fff;" onclick="switchAuthTab('login')">登录账号</button>
        <button class="btn-sm" id="tabReg" style="flex:1;" onclick="switchAuthTab('register')">新用户注册</button>
      </div>

      <div class="form-group">
        <label>用户名：</label>
        <input type="text" id="loginUser" placeholder="输入用户名" autocomplete="username">
      </div>
      <div class="form-group">
        <label>密码：</label>
        <input type="password" id="loginPass" placeholder="输入密码" autocomplete="current-password">
      </div>

      <div class="form-group" id="regInviteBox" style="display: none;">
        <label style="color:var(--accent);">🎟️ 一次性邀请码（首位注册者自动升级为超级管理员）：</label>
        <input type="text" id="regInviteCode" placeholder="如 XPT-XXXX-XXXX（首位初始化站长可留空）">
      </div>

      <button class="btn" id="btnAuthSubmit" onclick="handleAuthSubmit()">立即登录</button>

      <!-- 访客免登录提取入口 -->
      <div style="margin-top:20px; padding:16px; background:#080c14; border:1px dashed var(--border); border-radius:10px; text-align:center;">
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:10px;">同事传给你东西了？免登录输入 4 位提取码：</div>
        <div style="display:flex; gap:8px; justify-content:center;">
          <input type="text" id="guestCodeInput" maxlength="4" placeholder="4位码" style="width:130px; text-align:center; font-size:18px; font-weight:700; letter-spacing:4px;">
          <button class="btn-sm" style="background:var(--accent);color:#07090e;font-weight:bold;padding:0 16px;" onclick="openGuestCode()">提取</button>
        </div>
      </div>
    </div>

    <!-- 用户主面板 -->
    <div id="mainDashboard" style="display: none;">
      
      <!-- 👑 管理员专属邀请码分发中心 -->
      <div id="adminPanel" class="card admin-card" style="display: none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="font-weight:700;color:var(--admin);display:flex;align-items:center;gap:6px;">👑 管理员特权：邀请码分发中心</div>
          <button class="btn-sm" style="background:var(--admin);color:#07090e;font-weight:bold;" onclick="createInviteCode()">🎟️ 生成单次码</button>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">每个邀请码仅限注册 1 次，一旦被使用即刻物理失效：</div>
        <div id="inviteList" style="font-size:13px;max-height:150px;overflow-y:auto;">加载中...</div>
      </div>

      <!-- 发送上传工作台 -->
      <div class="card">
        <div class="form-group">
          <label style="display:flex;justify-content:space-between;">
            <span>快速发送到手机（代码/文本）：</span>
            <span style="font-size:11px;color:var(--accent);">💡 支持页面直接按 Ctrl+V 抓取截图</span>
          </label>
          <textarea id="clipText" placeholder="在此粘贴代码、日志、链接或文本，手机端打开本站自动同步展示..."></textarea>
        </div>

        <div class="form-group">
          <label>或者上传小文件（图片/压缩包/文档 < 15MB）：</label>
          <div class="file-drop" id="fileDropZone" onclick="document.getElementById('hiddenFileInput').click()">
            <span id="fileDropLabel">📁 点击选择文件 或 拖放文件到此</span>
            <input type="file" id="hiddenFileInput" style="display:none;" onchange="handleFileSelect(this.files)">
          </div>
        </div>

        <div style="display:flex; gap:10px; align-items:center; margin-bottom:16px;">
          <select id="clipTtl" style="flex:1;">
            <option value="600" selected>保存 10 分钟</option>
            <option value="3600">保存 1 小时</option>
            <option value="86400">保存 24 小时</option>
            <option value="604800">保存 7 天</option>
          </select>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:0;font-size:13px;user-select:none;">
            <input type="checkbox" id="clipBurn" style="width:16px;height:16px;accent-color:var(--primary);"> 🔥 阅后即焚
          </label>
        </div>

        <button class="btn" id="btnPublish" onclick="publishStream()">🚀 发送到我的私密流</button>
      </div>

      <!-- 我的剪贴历史流 -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div style="font-weight:700;font-size:15px;">📱 我的跨设备同步流</div>
          <button class="btn-sm" onclick="loadClips(true)">🔄 刷新</button>
        </div>
        <div id="clipStreamContainer">加载中...</div>
      </div>

    </div>

    <!-- 弹窗：访客提取结果 -->
    <div class="modal-overlay" id="guestModal">
      <div class="modal-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="font-weight:700;font-size:16px;color:var(--accent);">📦 提取成功</div>
          <button class="btn-sm" onclick="closeGuestModal()">✕ 关闭</button>
        </div>
        <div id="guestDisplayArea" style="margin-bottom:16px;"></div>
        <button class="btn" id="btnGuestCopy" onclick="copyGuestResult()">📋 一键复制内容</button>
      </div>
    </div>

    <!-- 弹窗：生成分享码展示 -->
    <div class="modal-overlay" id="shareModal">
      <div class="modal-box" style="text-align:center;">
        <div style="font-weight:700;font-size:16px;margin-bottom:8px;">🔗 访客临时提取码</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:14px;">将此 4 位数字告诉同事，打开本站免登录即可提取（30分钟有效）：</div>
        <div id="shareCodeBig" style="font-size:44px;font-weight:800;letter-spacing:10px;color:var(--accent);font-family:monospace;margin:12px 0;">----</div>
        <button class="btn" onclick="copyShareCode()">📋 复制提取码及使用说明</button>
        <button class="btn-sm" style="margin-top:10px;width:100%;" onclick="closeShareModal()">关闭</button>
      </div>
    </div>

    <div class="footer">
      Powered by <a href="https://xptdev.com" target="_blank">XPT Dev</a> · 零日志 · 内存即时清空
    </div>
  </div>

  <script>
    let currentAuthTab = 'login';
    let selectedFileObject = null;
    let lastGeneratedShareCode = '';
    let cachedClips = {};
    let currentGuestText = '';

    // ==========================================
    // UI Notification (Toast) System
    // ==========================================
    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.innerText = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }

    // ==========================================
    // Global Drag & Drop & Paste Listeners
    // ==========================================
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.body.classList.add('dragging');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX === 0 || e.clientY === 0) {
        document.body.classList.remove('dragging');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.body.classList.remove('dragging');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files);
      }
    });

    // Global Ctrl+V clipboard grabber (Images / Text)
    window.addEventListener('paste', (e) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      if (e.clipboardData && e.clipboardData.items) {
        for (const item of e.clipboardData.items) {
          if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const namedFile = new File([file], 'screenshot_' + new Date().toISOString().slice(11,19).replace(/:/g,'') + '.png', { type: file.type });
              handleFileSelect([namedFile]);
              showToast('📸 已自动从剪贴板捕获截图！', 'success');
              return;
            }
          }
        }
      }

      if (!isInput && e.clipboardData) {
        const text = e.clipboardData.getData('text');
        if (text && text.trim()) {
          document.getElementById('clipText').value = text;
          showToast('📋 已自动抓取剪贴板文字！', 'info');
        }
      }
    });

    function handleFileSelect(files) {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (file.size > 15 * 1024 * 1024) {
        showToast('⚠️ 文件过大，请选择 15MB 以内的小文件', 'error');
        return;
      }
      selectedFileObject = file;
      const dropLabel = document.getElementById('fileDropLabel');
      dropLabel.innerHTML = '✅ 已选择: <b>' + escapeHtml(file.name) + '</b> (' + (file.size / 1024).toFixed(1) + ' KB)';
      showToast('已载入文件: ' + file.name, 'success');
    }

    // Bind specific drop zone
    function bindDropZone() {
      const zone = document.getElementById('fileDropZone');
      if (!zone) return;
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
      });
      zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
          handleFileSelect(e.dataTransfer.files);
        }
      });
    }

    // ==========================================
    // Auth & Navigation
    // ==========================================
    function initApp() {
      bindDropZone();
      const token = localStorage.getItem('xpt_token');
      const user = localStorage.getItem('xpt_user');
      const role = localStorage.getItem('xpt_role');

      if (token && user) {
        renderMainView(user, role);
      } else {
        renderAuthView();
      }

      // Check ?c=XXXX query param
      const c = new URLSearchParams(window.location.search).get('c');
      if (c && c.length === 4) {
        document.getElementById('guestCodeInput').value = c;
        openGuestCode();
      }
    }

    function switchAuthTab(tab) {
      currentAuthTab = tab;
      const isLogin = tab === 'login';
      document.getElementById('tabLogin').style.background = isLogin ? 'var(--primary)' : '#192237';
      document.getElementById('tabLogin').style.color = isLogin ? '#fff' : '#cbd5e1';
      document.getElementById('tabReg').style.background = !isLogin ? 'var(--primary)' : '#192237';
      document.getElementById('tabReg').style.color = !isLogin ? '#fff' : '#cbd5e1';
      document.getElementById('btnAuthSubmit').innerText = isLogin ? '立即登录' : '立即注册';
      document.getElementById('regInviteBox').style.display = isLogin ? 'none' : 'block';
    }

    async function handleAuthSubmit() {
      const u = document.getElementById('loginUser').value.trim();
      const p = document.getElementById('loginPass').value.trim();
      const invite = document.getElementById('regInviteCode').value.trim();

      if (!u || !p) return showToast('请填写用户名与密码', 'error');

      const isReg = currentAuthTab === 'register';
      const endpoint = isReg ? '/api/register' : '/api/login';
      const payload = { username: u, password: p };
      if (isReg && invite) payload.inviteCode = invite;

      const btn = document.getElementById('btnAuthSubmit');
      btn.disabled = true;
      btn.innerText = '正在验证中...';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        btn.disabled = false;
        btn.innerText = isReg ? '立即注册' : '立即登录';

        if (data.success) {
          localStorage.setItem('xpt_token', data.token);
          localStorage.setItem('xpt_user', data.username);
          localStorage.setItem('xpt_role', data.role || 'user');
          showToast('🎉 欢迎，' + data.username + '！', 'success');
          renderMainView(data.username, data.role);
        } else {
          showToast(data.error || '认证失败', 'error');
        }
      } catch (err) {
        btn.disabled = false;
        btn.innerText = isReg ? '立即注册' : '立即登录';
        showToast('网络连接异常: ' + err.message, 'error');
      }
    }

    function doLogout() {
      localStorage.removeItem('xpt_token');
      localStorage.removeItem('xpt_user');
      localStorage.removeItem('xpt_role');
      showToast('已退出登录', 'info');
      renderAuthView();
    }

    function renderAuthView() {
      document.getElementById('authCard').style.display = 'block';
      document.getElementById('mainDashboard').style.display = 'none';
      document.getElementById('userNavStatus').innerHTML = '<span style="font-size:12px;color:var(--text-muted);">访客模式</span>';
    }

    function renderMainView(user, role) {
      document.getElementById('authCard').style.display = 'none';
      document.getElementById('mainDashboard').style.display = 'block';

      const isAdmin = role === 'admin';
      document.getElementById('userNavStatus').innerHTML = \`
        <span style="font-size:13px;margin-right:10px;">\${isAdmin ? '👑' : '👤'} <b>\${user}</b></span>
        <button class="btn-sm" onclick="doLogout()">退出</button>
      \`;

      if (isAdmin) {
        document.getElementById('adminPanel').style.display = 'block';
        loadAdminInvites();
      } else {
        document.getElementById('adminPanel').style.display = 'none';
      }

      loadClips();
    }

    // ==========================================
    // Clip Stream Operations
    // ==========================================
    async function publishStream() {
      const text = document.getElementById('clipText').value.trim();
      if (!text && !selectedFileObject) {
        return showToast('请至少输入文字或选入一个文件', 'error');
      }

      const btn = document.getElementById('btnPublish');
      btn.innerText = '正在上传同步...';
      btn.disabled = true;

      try {
        const payload = {
          ttl: document.getElementById('clipTtl').value,
          burn: document.getElementById('clipBurn').checked
        };

        if (selectedFileObject) {
          const reader = new FileReader();
          reader.readAsDataURL(selectedFileObject);
          reader.onload = async () => {
            payload.type = selectedFileObject.type.startsWith('image/') ? 'image' : 'file';
            payload.content = reader.result;
            payload.filename = selectedFileObject.name;
            payload.mimeType = selectedFileObject.type;
            payload.fileSize = selectedFileObject.size;
            await postClipApi(payload);
          };
        } else {
          payload.type = 'text';
          payload.content = text;
          await postClipApi(payload);
        }
      } catch (e) {
        showToast('发送失败: ' + e.message, 'error');
        btn.innerText = '🚀 发送到我的私密流';
        btn.disabled = false;
      }
    }

    async function postClipApi(payload) {
      const token = localStorage.getItem('xpt_token');
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      const btn = document.getElementById('btnPublish');
      btn.innerText = '🚀 发送到我的私密流';
      btn.disabled = false;

      if (data.success) {
        document.getElementById('clipText').value = '';
        selectedFileObject = null;
        document.getElementById('hiddenFileInput').value = '';
        document.getElementById('fileDropLabel').innerText = '📁 点击选择文件 或 拖放文件到此';
        showToast('🚀 已同步到私密流，手机刷新即可看到！', 'success');
        loadClips();
      } else {
        showToast(data.error || '上传同步失败', 'error');
      }
    }

    async function loadClips(manual = false) {
      const token = localStorage.getItem('xpt_token');
      const res = await fetch('/api/clips', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      const container = document.getElementById('clipStreamContainer');

      if (!data.success || !data.clips || data.clips.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">暂无记录。电脑端粘贴发送后，手机端刷新就能秒见！</div>';
        if (manual) showToast('已刷新，暂无新记录', 'info');
        return;
      }

      // Populate cache for safe one-click copy
      cachedClips = {};
      data.clips.forEach(c => { cachedClips[c.id] = c; });

      container.innerHTML = data.clips.map(c => {
        const isImg = c.type === 'image';
        const isFile = c.type === 'file' || isImg;
        const timeStr = new Date(c.created_at).toLocaleTimeString();
        return \`
          <div class="clip-item">
            <div class="clip-header">
              <span>\${isImg ? '🖼️ 图片' : (isFile ? '📦 文件' : '📝 文本')} · \${timeStr}</span>
              \${c.share_code ? \`<span class="badge-pro" style="color:#10b981;border-color:rgba(16,185,129,0.3);">分享码: \${c.share_code}</span>\` : ''}
            </div>

            \${isImg ? \`<img src="\${c.content}" class="clip-img-thumb" alt="\${escapeHtml(c.filename)}">\` : ''}

            <div class="clip-content">\${isFile ? escapeHtml(c.filename) : escapeHtml(c.content)}</div>

            <div class="clip-actions">
              \${isFile ? 
                \`<a class="btn-sm" href="\${c.content}" download="\${escapeHtml(c.filename)}">⬇️ 下载文件</a>\` :
                \`<button class="btn-sm" onclick="copyClipById('\${c.id}')">📋 一键复制</button>\`
              }
              <button class="btn-sm" style="color:var(--accent);" onclick="requestShareCode('\${c.id}')">🔗 生成临时提取码</button>
              <button class="btn-sm" style="color:var(--danger);" onclick="deleteClipItem('\${c.id}')">🗑️ 删除</button>
            </div>
          </div>
        \`;
      }).join('');

      if (manual) showToast('已同步最新数据', 'success');
    }

    function copyClipById(id) {
      const item = cachedClips[id];
      if (item && item.content) {
        copyPureText(item.content);
      }
    }

    async function requestShareCode(id) {
      const token = localStorage.getItem('xpt_token');
      try {
        const res = await fetch('/api/clips/' + id + '/share', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.success) {
          lastGeneratedShareCode = data.shareCode;
          document.getElementById('shareCodeBig').innerText = data.shareCode;
          document.getElementById('shareModal').style.display = 'flex';
          loadClips();
        } else {
          showToast(data.error || '生成失败', 'error');
        }
      } catch (err) {
        showToast('请求失败: ' + err.message, 'error');
      }
    }

    function closeShareModal() {
      document.getElementById('shareModal').style.display = 'none';
    }

    function copyShareCode() {
      const text = '我在 XPT 快传给你发了文件，请打开网址 ' + window.location.origin + ' 并输入 4 位提取码：' + lastGeneratedShareCode;
      copyPureText(text);
      closeShareModal();
    }

    async function deleteClipItem(id) {
      if (!confirm('确定彻底删除该条记录吗？')) return;
      const token = localStorage.getItem('xpt_token');
      await fetch('/api/clips/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      showToast('已删除记录', 'info');
      loadClips();
    }

    // ==========================================
    // 👑 Admin Invite Code Operations
    // ==========================================
    async function createInviteCode() {
      const token = localStorage.getItem('xpt_token');
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (data.success) {
        showToast('🎉 成功生成新邀请码: ' + data.code, 'success');
        loadAdminInvites();
      } else {
        showToast(data.error || '生成失败', 'error');
      }
    }

    async function loadAdminInvites() {
      const token = localStorage.getItem('xpt_token');
      const res = await fetch('/api/admin/invites', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      const box = document.getElementById('inviteList');

      if (!data.success || !data.invites || data.invites.length === 0) {
        box.innerHTML = '<span style="color:var(--text-muted);">暂无邀请码，点击上方按钮生成</span>';
        return;
      }

      box.innerHTML = data.invites.map(i => {
        const isUsed = i.status === 'used';
        return \`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2a40;">
            <span>\${i.code} <span style="font-size:11px;color:\${isUsed ? 'var(--text-muted)' : 'var(--primary)'}">(\${isUsed ? '已失效 · ' + i.used_by : '有效可用'})</span></span>
            \${!isUsed ? \`<button class="btn-sm" onclick="copyPureText('\${i.code}')">复制</button>\` : ''}
          </div>
        \`;
      }).join('');
    }

    // ==========================================
    // Guest Code Extraction
    // ==========================================
    async function openGuestCode() {
      const code = document.getElementById('guestCodeInput').value.trim();
      if (code.length !== 4) return showToast('请输入 4 位纯数字提取码', 'error');

      try {
        const res = await fetch('/api/guest/receive?code=' + code);
        const data = await res.json();
        if (!data.success) return showToast(data.error || '提取失败', 'error');

        const item = data.data;
        const modal = document.getElementById('guestModal');
        const area = document.getElementById('guestDisplayArea');
        const btn = document.getElementById('btnGuestCopy');

        modal.style.display = 'flex';
        currentGuestText = item.content;

        if (item.type === 'file' || item.type === 'image') {
          area.innerHTML = \`
            <div style="text-align:center;padding:12px 0;">
              \${item.type === 'image' ? \`<img src="\${item.content}" style="max-height:160px;border-radius:8px;margin-bottom:12px;border:1px solid var(--border);">\` : '<div style="font-size:36px;margin-bottom:8px;">📦</div>'}
              <div style="font-weight:700;margin-bottom:12px;">\${escapeHtml(item.filename)}</div>
              <a class="btn" style="text-decoration:none;" href="\${item.content}" download="\${escapeHtml(item.filename)}">⬇️ 立即下载此文件</a>
            </div>
          \`;
          btn.style.display = 'none';
        } else {
          area.innerHTML = \`<div class="clip-content" style="max-height:220px;">\${escapeHtml(item.content)}</div>\`;
          btn.style.display = 'block';
        }
      } catch (err) {
        showToast('网络请求失败: ' + err.message, 'error');
      }
    }

    function closeGuestModal() {
      document.getElementById('guestModal').style.display = 'none';
    }

    function copyGuestResult() {
      if (currentGuestText) copyPureText(currentGuestText);
    }

    // ==========================================
    // Reliable Clipboard Copy with Fallback
    // ==========================================
    function copyPureText(str) {
      if (!str) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str).then(() => {
          showToast('📋 已成功复制到剪贴板！', 'success');
        }).catch(() => fallbackCopy(str));
      } else {
        fallbackCopy(str);
      }
    }

    function fallbackCopy(str) {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        showToast('📋 已复制到剪贴板！', 'success');
      } catch (e) {
        showToast('复制受限，请手动长按复制', 'error');
      }
      document.body.removeChild(ta);
    }

    function escapeHtml(s) {
      if (!s) return '';
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    window.onload = initApp;
  </script>
</body>
</html>
`;
