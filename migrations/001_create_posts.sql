CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'blog',
  tags TEXT NOT NULL DEFAULT '[]',
  hero_image TEXT DEFAULT NULL,
  pub_date TEXT NOT NULL,
  updated_date TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_draft INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_pub_date ON posts(pub_date DESC);

CREATE TABLE IF NOT EXISTS post_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_slug TEXT NOT NULL,
  title TEXT,
  description TEXT,
  content TEXT,
  tags TEXT,
  changes_summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (post_slug) REFERENCES posts(slug)
);

CREATE INDEX IF NOT EXISTS idx_revisions_post_slug ON post_revisions(post_slug);
CREATE INDEX IF NOT EXISTS idx_revisions_status ON post_revisions(status);
