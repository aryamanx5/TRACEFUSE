-- TRACEFUSE schema v1

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'live',            -- live | historical_case
  review_state TEXT NOT NULL DEFAULT 'open',      -- open | in_review | closed
  ui_state TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
  config TEXT NOT NULL,
  status TEXT NOT NULL,
  data_origin TEXT NOT NULL,
  seed_kind TEXT,
  seed_value TEXT,
  chain TEXT,
  provider TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_investigations_case ON investigations(case_id);

CREATE TABLE IF NOT EXISTS transfers (
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  ts REAL,
  from_address TEXT NOT NULL,
  to_address TEXT,
  kind TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (investigation_id, id)
);
CREATE INDEX IF NOT EXISTS idx_transfers_tx ON transfers(investigation_id, tx_hash);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(investigation_id, from_address);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(investigation_id, to_address);

CREATE TABLE IF NOT EXISTS artifacts (
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (investigation_id, kind)
);

CREATE TABLE IF NOT EXISTS progress_events (
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL,
  PRIMARY KEY (investigation_id, seq)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,     -- case | address | transfer | edge | evidence | relationship
  target_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_case ON notes(case_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,     -- address | transfer | edge | evidence
  target_id TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (case_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS evidence_reviews (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL,
  state TEXT NOT NULL,           -- unreviewed | reviewed | accepted | disputed | rejected
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (case_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyst_relationships (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  source_entity TEXT NOT NULL,
  target_entity TEXT NOT NULL,
  relation TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS http_cache (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  url TEXT NOT NULL,
  body TEXT NOT NULL,
  status INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ofac_datasets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  publish_date TEXT,
  record_count INTEGER,
  sha256 TEXT NOT NULL,
  address_count INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ofac_addresses (
  dataset_id INTEGER NOT NULL REFERENCES ofac_datasets(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  address_norm TEXT NOT NULL,
  currency TEXT NOT NULL,
  sdn_uid TEXT NOT NULL,
  sdn_name TEXT NOT NULL,
  sdn_type TEXT,
  programs TEXT NOT NULL DEFAULT '[]',
  id_uid TEXT
);
CREATE INDEX IF NOT EXISTS idx_ofac_addr ON ofac_addresses(address_norm);

CREATE TABLE IF NOT EXISTS ofac_actions (
  url TEXT NOT NULL,
  action_date TEXT NOT NULL,
  title TEXT NOT NULL,
  action TEXT NOT NULL,          -- designation | removal | mention
  address TEXT NOT NULL,
  address_norm TEXT NOT NULL,
  currency TEXT NOT NULL,
  entity TEXT,
  retrieved_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (url, address_norm, action)
);
CREATE INDEX IF NOT EXISTS idx_ofac_actions_addr ON ofac_actions(address_norm);

CREATE TABLE IF NOT EXISTS challenge_progress (
  session_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, challenge_id, checkpoint_id)
);
