-- Grundschema der Medienzeit-App

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT 'always',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE checklist_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  checked INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'ludwig'
);
CREATE INDEX idx_checklist_events_date ON checklist_events(date);

CREATE TABLE exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  person TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_exams_date ON exams(date);

CREATE TABLE catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  log_text TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  special TEXT,
  hint TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  person TEXT NOT NULL,
  catalog_id INTEGER,
  label TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  mode TEXT NOT NULL,
  date TEXT NOT NULL,
  cut INTEGER NOT NULL DEFAULT 0,
  carry INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_penalties_settled ON penalties(settled);

CREATE TABLE adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  penalty_id INTEGER NOT NULL,
  queue_minutes INTEGER NOT NULL DEFAULT 0,
  cut_minutes INTEGER NOT NULL DEFAULT 0,
  person TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX idx_adjustments_ts ON adjustments(ts);

CREATE TABLE day_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  person TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX idx_day_changes_date ON day_changes(date);

CREATE TABLE grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  person TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX idx_grants_to ON grants(to_ts);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL
);
CREATE INDEX idx_activity_to ON activity(to_ts);

CREATE TABLE log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  person TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  minutes INTEGER
);
CREATE INDEX idx_log_ts ON log(ts);

CREATE TABLE pin_attempts (
  person TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
