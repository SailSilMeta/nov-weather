-- CloudBase PostgreSQL / 腾讯云 PostgreSQL 公告表
-- 在云开发控制台的 SQL 编辑器或 psql 中执行。

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning')),
  url text NOT NULL DEFAULT '' CHECK (char_length(url) <= 500),
  pinned boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS announcements_active_idx
  ON announcements (published, pinned DESC, starts_at DESC);

-- 可选：给接口单独创建一个最小权限账号（不要直接用高权限账号连接云函数）。
-- CREATE ROLE announce_api LOGIN PASSWORD '<强密码>';
-- GRANT CONNECT ON DATABASE <你的库名> TO announce_api;
-- GRANT USAGE ON SCHEMA public TO announce_api;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE announcements TO announce_api;