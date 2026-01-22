CREATE TABLE IF NOT EXISTS intake_submissions (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  ssn_encrypted TEXT NOT NULL,
  ip_pin_encrypted TEXT NOT NULL,
  filing_year INTEGER NOT NULL,
  dob DATE NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  employer TEXT,
  wages NUMERIC(12, 2),
  federal_withholding NUMERIC(12, 2),
  income_1099 NUMERIC(12, 2),
  investment_income NUMERIC(12, 2),
  retirement NUMERIC(12, 2),
  other_income TEXT,
  mortgage NUMERIC(12, 2),
  charity NUMERIC(12, 2),
  student_loan NUMERIC(12, 2),
  dependents INTEGER,
  hsa NUMERIC(12, 2),
  other_deductions TEXT,
  filing_status TEXT,
  filing_method TEXT,
  contact_method TEXT,
  notes TEXT,
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  client_user_id TEXT,
  client_username TEXT,
  estimated_income NUMERIC(12, 2),
  estimated_taxable NUMERIC(12, 2),
  estimated_tax NUMERIC(12, 2),
  estimated_withholding NUMERIC(12, 2),
  estimated_refund NUMERIC(12, 2),
  review_status TEXT NOT NULL DEFAULT 'received',
  review_notes TEXT,
  review_updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS client_profiles (
  supabase_user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  username TEXT,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_profiles_email ON client_profiles (email);

CREATE TABLE IF NOT EXISTS preparer_profiles (
  supabase_user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preparer_profiles_email ON preparer_profiles (email);

CREATE TABLE IF NOT EXISTS upload_records (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_user_id TEXT,
  client_username TEXT,
  uploader_user_id TEXT,
  uploader_role TEXT,
  category TEXT,
  document_type TEXT,
  scan_status TEXT,
  scan_notes TEXT,
  dlp_hits INTEGER DEFAULT 0,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size NUMERIC(12, 2),
  file_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_records_client ON upload_records (client_user_id);
CREATE INDEX IF NOT EXISTS idx_upload_records_username ON upload_records (client_username);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id TEXT,
  actor_email TEXT,
  actor_role TEXT,
  action_type TEXT,
  target_user_id TEXT,
  target_email TEXT,
  target_username TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events (target_user_id);

CREATE TABLE IF NOT EXISTS contact_requests (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  role TEXT,
  preferred_time TEXT,
  message TEXT NOT NULL
);
