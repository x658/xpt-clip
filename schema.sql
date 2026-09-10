-- =========================================================
-- XPT Clip - D1 Database Schema
-- Multi-user Serverless Clipboard & Fast Transfer
-- =========================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'admin' or 'user'
  created_at INTEGER NOT NULL
);

-- 2. Clips Table (Multi-tenant isolated)
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- 'text', 'file', 'image'
  title TEXT,
  content TEXT NOT NULL, -- raw text or base64 data URI
  filename TEXT,
  mime_type TEXT,
  file_size INTEGER DEFAULT 0,
  burn_after_reading INTEGER DEFAULT 0, -- 1 = burn, 0 = keep
  share_code TEXT, -- 4-digit guest extraction code
  expires_at INTEGER, -- UNIX timestamp in ms or NULL
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. One-Time Disposable Invite Codes Table
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  used_by TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' or 'used'
  created_at INTEGER NOT NULL,
  used_at INTEGER
);

-- 4. High-Performance Indexes
CREATE INDEX IF NOT EXISTS idx_clips_user ON clips(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_share ON clips(share_code);
CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status);
