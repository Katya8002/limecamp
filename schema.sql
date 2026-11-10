-- Таблиці бази D1 для сайту Табір Лайм (виконується один раз)
CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL,
  child_age  INTEGER,
  status     TEXT NOT NULL DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  year       INTEGER NOT NULL,
  shift      INTEGER,
  width      INTEGER,
  height     INTEGER
);
CREATE TABLE IF NOT EXISTS rate (
  k     TEXT PRIMARY KEY,
  n     INTEGER NOT NULL,
  reset INTEGER NOT NULL
);
-- Налаштування сайту (зараз тут лежить прайс). Адмінка створює цю таблицю сама, але можна й вручну.
CREATE TABLE IF NOT EXISTS settings (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
