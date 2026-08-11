CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  manager TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Not Started', 'Assigned', 'In Progress', 'Under Review', 'On Hold', 'Blocked', 'Completed')),
  priority TEXT NOT NULL CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  daily_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  daily_notification_time TIME NOT NULL DEFAULT '09:00'
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS daily_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS daily_notification_time TIME NOT NULL DEFAULT '09:00';

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assigned_by TEXT DEFAULT '',
  assignee TEXT NOT NULL,
  assignee_email TEXT DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  status TEXT NOT NULL CHECK (status IN ('Not Started', 'Assigned', 'In Progress', 'Under Review', 'On Hold', 'Blocked', 'Completed')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  estimated_hours NUMERIC(8,2) DEFAULT 0,
  actual_hours NUMERIC(8,2) DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  next_follow_up DATE,
  has_task_dependencies BOOLEAN NOT NULL DEFAULT FALSE,
  has_user_dependency BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  remarks TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Makes this script safe to apply to the earlier project-hub schema as well.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by TEXT DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_email TEXT DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(8,2) DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_hours NUMERIC(8,2) DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_follow_up DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS has_task_dependencies BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS has_user_dependency BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('Not Started', 'Assigned', 'In Progress', 'Under Review', 'On Hold', 'Blocked', 'Completed'));

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_user_dependencies (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('Approval', 'Input', 'Access', 'Availability', 'Review', 'Handover')),
  required_action TEXT NOT NULL,
  needed_by DATE,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Received', 'Overdue', 'Not Required')) DEFAULT 'Pending',
  remarks TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Project Manager', 'Team Member', 'Stakeholder')),
  reporting_manager TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_salt TEXT;

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx ON app_sessions(expires_at);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS daily_follow_up_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('Queued', 'Sent', 'Failed')) DEFAULT 'Queued',
  notification_key TEXT NOT NULL UNIQUE,
  scheduled_for DATE NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notifications_project_id_idx ON notifications(project_id);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  raised_by TEXT NOT NULL,
  owner TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  status TEXT NOT NULL CHECK (status IN ('Open', 'In Progress', 'Blocked', 'Resolved')) DEFAULT 'Open',
  resolution_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminder_log (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('Email', 'Teams')),
  recipient TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('Queued', 'Sent', 'Failed')) DEFAULT 'Queued',
  response TEXT,
  next_reminder_at TIMESTAMPTZ,
  reminder_key TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  project_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO projects (id, name, client, manager, start_date, end_date, status, priority, progress) VALUES
  ('PRJ-001', 'ERP Migration', 'Acme Corp', 'Sarah Johnson', '2026-01-15', '2026-08-30', 'In Progress', 'High', 72),
  ('PRJ-002', 'HRMS Portal', 'Delta Inc.', 'Dave Miller', '2026-03-01', '2026-09-30', 'In Progress', 'Medium', 45),
  ('PRJ-003', 'Mobile App v2.0', 'Swift Logistics', 'Alex Rivera', '2026-02-10', '2026-09-15', 'Assigned', 'Critical', 88),
  ('PRJ-004', 'Client Portal Redesign', 'Apex Ventures', 'Emma Stone', '2026-05-01', '2026-11-30', 'Blocked', 'High', 33),
  ('PRJ-005', 'Data Analytics Platform', 'Acme Corp', 'Marcus Vance', '2026-01-02', '2026-05-20', 'Completed', 'Low', 100)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, project_id, module, title, description, assigned_by, assignee, assignee_email, priority, status, start_date, due_date, estimated_hours, actual_hours, progress, next_follow_up, remarks) VALUES
  ('TSK-010', 'PRJ-001', 'DB Setup', 'Design master DB schema & structure', 'Create and validate the logical schema for migration.', 'Sarah Johnson', 'Alex Rivera', '', 'Critical', 'In Progress', '2026-08-01', '2026-08-12', 40, 35, 75, '2026-08-10', 'Pending final review'),
  ('TSK-011', 'PRJ-001', 'Auth', 'Implement OAuth2 federated single sign-on', 'Implement SSO flow and collect QA approval.', 'Sarah Johnson', 'Marcus Vance', '', 'High', 'Under Review', '2026-08-02', '2026-08-15', 24, 20, 60, '2026-08-10', 'Awaiting QA sign-off'),
  ('TSK-013', 'PRJ-003', 'Push Notifications', 'Setup FCM cloud messaging endpoints', 'Configure cloud messaging and certify endpoints.', 'Alex Rivera', 'Emma Stone', '', 'Low', 'Blocked', '2026-08-03', '2026-08-09', 16, 12, 40, '2026-08-10', 'Certificate error'),
  ('TSK-014', 'PRJ-004', 'Payment', 'Integrate Stripe subscription gateway', 'Integrate and test subscription payments.', 'Emma Stone', 'Dave Miller', '', 'Critical', 'In Progress', '2026-08-04', '2026-08-10', 48, 40, 80, '2026-08-10', 'Testing sandbox'),
  ('TSK-016', 'PRJ-001', 'Migration', 'Write master legacy migration script', 'Produce safe source-to-target migration script.', 'Sarah Johnson', 'Alex Rivera', '', 'Critical', 'Blocked', '2026-08-02', '2026-08-07', 60, 58, 90, '2026-08-10', 'Host locked'),
  ('TSK-017', 'PRJ-001', 'UI Dev', 'Develop master dashboard layouts', 'Implement the management dashboard layouts.', 'Sarah Johnson', 'Marcus Vance', '', 'Medium', 'In Progress', '2026-08-05', '2026-08-13', 30, 15, 50, '2026-08-12', 'Mockups ready'),
  ('TSK-021', 'PRJ-002', 'Reporting', 'Confirm employee policy report', 'Review final report before publishing.', 'Dave Miller', 'Jessica Alba', '', 'Medium', 'On Hold', '2026-08-06', '2026-08-14', 12, 2, 10, '2026-08-10', 'Waiting for source data')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ('TSK-010', 'TSK-016'), ('TSK-017', 'TSK-010') ON CONFLICT DO NOTHING;
INSERT INTO app_users (id, name, email, department, role, reporting_manager) VALUES
  ('USR-001', 'Sarah Johnson', 'sarah.johnson@example.com', 'Program Management', 'Project Manager', ''),
  ('USR-002', 'Alex Rivera', 'alex.rivera@example.com', 'Engineering', 'Team Member', 'Sarah Johnson'),
  ('USR-003', 'Emma Stone', 'emma.stone@example.com', 'Security', 'Team Member', 'Sarah Johnson'),
  ('USR-004', 'Dave Miller', 'dave.miller@example.com', 'Engineering', 'Team Member', 'Sarah Johnson'),
  ('USR-005', 'Marcus Vance', 'admin@abc.com', 'Engineering', 'Admin', '')
ON CONFLICT (id) DO NOTHING;
UPDATE tasks SET daily_follow_up_enabled = TRUE WHERE id IN ('TSK-010', 'TSK-013', 'TSK-016');
INSERT INTO issues (id, project_id, task_id, title, description, raised_by, owner, priority, status) VALUES
  ('ISS-001', 'PRJ-003', 'TSK-013', 'FCM certificate mismatch', 'Production endpoint rejects the uploaded certificate.', 'Emma Stone', 'Alex Rivera', 'High', 'Open'),
  ('ISS-002', 'PRJ-001', 'TSK-016', 'Migration host unavailable', 'The source database host is locked for maintenance.', 'Alex Rivera', 'Sarah Johnson', 'Critical', 'Blocked')
ON CONFLICT (id) DO NOTHING;
