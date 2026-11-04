-- サイトの中身（1 行だけ。形は public/content.json と同じ JSON）。version は保存のたびに 1 つ増える
CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- 保存した版の控え（新しい方から 300 件。管理画面の「履歴」から読み戻せる）
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  at TEXT NOT NULL,
  by TEXT NOT NULL
);

-- 管理画面からアップロードした画像（公開側の /images/<key> で配る）
CREATE TABLE IF NOT EXISTS images (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  at TEXT NOT NULL,
  by TEXT NOT NULL
);
