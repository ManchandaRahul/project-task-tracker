import 'dotenv/config';
import express from 'express';
import { neon } from '@neondatabase/serverless';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const app = express();
const port = process.env.PORT || 3001;
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statuses = ['Not Started', 'Assigned', 'In Progress', 'Under Review', 'On Hold', 'Blocked', 'Completed'];
app.use(express.json());

const sessionCookie = 'project_hub_session';
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const demoSessions = new Map();
const loginAttempts = new Map();

function publicUser(user) {
  if (!user) return null;
  const { password_hash, password_salt, ...safe } = user;
  return safe;
}
function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
function passwordMatches(password, user) {
  if (!user?.password_hash || !user?.password_salt) return false;
  const actual = scryptSync(password, user.password_salt, 64);
  const expected = Buffer.from(user.password_hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
function cookieValue(req, name) {
  const entry = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  res.cookie(sessionCookie, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: sessionLifetimeMs, path: '/' });
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  res.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}
async function ensureInitialAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@abc.com').trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password || password.length < 12) return false;
  if (!sql) {
    const user = demo.users.find((item) => item.email.toLowerCase() === email && item.role === 'Admin');
    if (!user) return false;
    if (!user.password_hash) { const record = passwordRecord(password); user.password_hash = record.hash; user.password_salt = record.salt; }
    return true;
  }
  const users = await sql`SELECT * FROM app_users WHERE lower(email) = ${email} AND role = 'Admin' LIMIT 1`;
  const user = users[0];
  if (!user) return false;
  if (!user.password_hash) {
    const record = passwordRecord(password);
    await sql`UPDATE app_users SET password_hash = ${record.hash}, password_salt = ${record.salt} WHERE id = ${user.id} AND password_hash IS NULL`;
  }
  return true;
}
async function initialAdminReady() {
  const email = (process.env.ADMIN_EMAIL || 'admin@abc.com').trim().toLowerCase();
  if (!sql) return Boolean(demo.users.find((item) => item.email.toLowerCase() === email && item.role === 'Admin')?.password_hash);
  const [user] = await sql`SELECT password_hash FROM app_users WHERE lower(email) = ${email} AND role = 'Admin' AND is_active = TRUE LIMIT 1`;
  return Boolean(user?.password_hash);
}
async function userFromRequest(req) {
  const token = cookieValue(req, sessionCookie);
  if (!token) return null;
  const hash = tokenHash(token);
  if (!sql) {
    const session = demoSessions.get(hash);
    if (!session || session.expires_at <= Date.now()) { demoSessions.delete(hash); return null; }
    return publicUser(demo.users.find((item) => item.id === session.user_id && item.is_active));
  }
  const rows = await sql`SELECT u.id, u.name, u.email, u.department, u.role, u.reporting_manager, u.is_active, u.created_at
    FROM app_sessions s JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash} AND s.expires_at > now() AND u.is_active = TRUE LIMIT 1`;
  return rows[0] || null;
}
async function requireAuth(req, res, next) {
  try {
    req.user = await userFromRequest(req);
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    next();
  } catch (error) { res.status(500).json({ error: 'Unable to verify the current session.', detail: error.message }); }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Administrator access is required.' });
  next();
}
function requireManager(req, res, next) {
  if (!['Admin', 'Project Manager'].includes(req.user?.role)) return res.status(403).json({ error: 'Project manager access is required.' });
  next();
}

let demo = {
  projects: [
    { id: 'PRJ-001', name: 'ERP Migration', client: 'Acme Corp', manager: 'Sarah Johnson', start_date: '2026-01-15', end_date: '2026-08-30', status: 'In Progress', priority: 'High', progress: 72 },
    { id: 'PRJ-002', name: 'HRMS Portal', client: 'Delta Inc.', manager: 'Dave Miller', start_date: '2026-03-01', end_date: '2026-09-30', status: 'In Progress', priority: 'Medium', progress: 45 },
    { id: 'PRJ-003', name: 'Mobile App v2.0', client: 'Swift Logistics', manager: 'Alex Rivera', start_date: '2026-02-10', end_date: '2026-09-15', status: 'Assigned', priority: 'Critical', progress: 88 },
    { id: 'PRJ-004', name: 'Client Portal Redesign', client: 'Apex Ventures', manager: 'Emma Stone', start_date: '2026-05-01', end_date: '2026-11-30', status: 'Blocked', priority: 'High', progress: 33 },
    { id: 'PRJ-005', name: 'Data Analytics Platform', client: 'Acme Corp', manager: 'Marcus Vance', start_date: '2026-01-02', end_date: '2026-05-20', status: 'Completed', priority: 'Low', progress: 100 }
  ],
  tasks: [
    task('TSK-010', 'PRJ-001', 'DB Setup', 'Design master DB schema & structure', 'Create and validate the logical schema for migration.', 'Sarah Johnson', 'Alex Rivera', 'Critical', 'In Progress', '2026-08-01', '2026-08-12', 40, 35, 75, '2026-08-10', 'Pending final review', ['TSK-016']),
    task('TSK-011', 'PRJ-001', 'Auth', 'Implement OAuth2 federated single sign-on', 'Implement SSO flow and collect QA approval.', 'Sarah Johnson', 'Marcus Vance', 'High', 'Under Review', '2026-08-02', '2026-08-15', 24, 20, 60, '2026-08-10', 'Awaiting QA sign-off'),
    task('TSK-013', 'PRJ-003', 'Push Notifications', 'Setup FCM cloud messaging endpoints', 'Configure cloud messaging and certify endpoints.', 'Alex Rivera', 'Emma Stone', 'Low', 'Blocked', '2026-08-03', '2026-08-09', 16, 12, 40, '2026-08-10', 'Certificate error'),
    task('TSK-014', 'PRJ-004', 'Payment', 'Integrate Stripe subscription gateway', 'Integrate and test subscription payments.', 'Emma Stone', 'Dave Miller', 'Critical', 'In Progress', '2026-08-04', '2026-08-10', 48, 40, 80, '2026-08-10', 'Testing sandbox'),
    task('TSK-016', 'PRJ-001', 'Migration', 'Write master legacy migration script', 'Produce safe source-to-target migration script.', 'Sarah Johnson', 'Alex Rivera', 'Critical', 'Blocked', '2026-08-02', '2026-08-07', 60, 58, 90, '2026-08-10', 'Host locked'),
    task('TSK-017', 'PRJ-001', 'UI Dev', 'Develop master dashboard layouts', 'Implement management dashboard layouts.', 'Sarah Johnson', 'Marcus Vance', 'Medium', 'In Progress', '2026-08-05', '2026-08-13', 30, 15, 50, '2026-08-12', 'Mockups ready', ['TSK-010']),
    task('TSK-021', 'PRJ-002', 'Reporting', 'Confirm employee policy report', 'Review final report before publishing.', 'Dave Miller', 'Jessica Alba', 'Medium', 'On Hold', '2026-08-06', '2026-08-14', 12, 2, 10, '2026-08-10', 'Waiting for source data')
  ],
  issues: [
    { id: 'ISS-001', project_id: 'PRJ-003', task_id: 'TSK-013', title: 'FCM certificate mismatch', description: 'Production endpoint rejects the uploaded certificate.', raised_by: 'Emma Stone', owner: 'Alex Rivera', priority: 'High', status: 'Open', resolution_date: null },
    { id: 'ISS-002', project_id: 'PRJ-001', task_id: 'TSK-016', title: 'Migration host unavailable', description: 'The source database host is locked for maintenance.', raised_by: 'Alex Rivera', owner: 'Sarah Johnson', priority: 'Critical', status: 'Blocked', resolution_date: null }
  ],
  users: [
    { id: 'USR-001', name: 'Sarah Johnson', email: 'sarah.johnson@example.com', department: 'Program Management', role: 'Project Manager', reporting_manager: '', is_active: true },
    { id: 'USR-002', name: 'Alex Rivera', email: 'alex.rivera@example.com', department: 'Engineering', role: 'Team Member', reporting_manager: 'Sarah Johnson', is_active: true },
    { id: 'USR-003', name: 'Emma Stone', email: 'emma.stone@example.com', department: 'Security', role: 'Team Member', reporting_manager: 'Sarah Johnson', is_active: true },
    { id: 'USR-004', name: 'Dave Miller', email: 'dave.miller@example.com', department: 'Engineering', role: 'Team Member', reporting_manager: 'Sarah Johnson', is_active: true },
    { id: 'USR-005', name: 'Marcus Vance', email: 'admin@abc.com', department: 'Engineering', role: 'Admin', reporting_manager: '', is_active: true }
  ],
  notifications: [],
  reminders: [],
  activity: [
    { type: 'Task completed', message: 'Emma Stone marked “User Auth” as completed', project_name: 'HRMS Portal', occurred_at: '2026-08-10T08:50:00Z' },
    { type: 'Blocked state raised', message: 'Emma Stone marked “Stripe API” as blocked', project_name: 'Client Portal', occurred_at: '2026-08-10T08:15:00Z' }
  ]
};

function task(id, project_id, module, title, description, assigned_by, assignee, priority, status, start_date, due_date, estimated_hours, actual_hours, progress, next_follow_up, remarks, dependencies = [], user_dependencies = []) {
  return { id, project_id, module, title, description, assigned_by, assignee, assignee_email: '', priority, status, start_date, due_date, estimated_hours, actual_hours, progress, next_follow_up, has_task_dependencies: dependencies.length > 0, has_user_dependency: user_dependencies.length > 0, daily_follow_up_enabled: ['TSK-010', 'TSK-013', 'TSK-016'].includes(id), reminder_enabled: false, remarks, dependencies, user_dependencies };
}
function dayStamp(input = new Date()) {
  if (!input) return null;
  if (typeof input === 'string') {
    const match = input.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const value = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(value.getTime())) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function dateDiff(from, to) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000); }
function isOpen(task) { return task.status !== 'Completed'; }
function normaliseProjectDates(project) { return { ...project, start_date: dayStamp(project.start_date), end_date: dayStamp(project.end_date), daily_notifications_enabled: Boolean(project.daily_notifications_enabled), daily_notification_time: String(project.daily_notification_time || '09:00').slice(0, 5) }; }
function normaliseTaskDates(item) { return { ...item, start_date: dayStamp(item.start_date), due_date: dayStamp(item.due_date), next_follow_up: dayStamp(item.next_follow_up) }; }
function normaliseIssueDates(issue) { return { ...issue, resolution_date: dayStamp(issue.resolution_date) }; }
function normaliseUserDependencyDates(item) { return { ...item, needed_by: dayStamp(item.needed_by) }; }
function followUpBuckets(tasks) {
  const today = dayStamp();
  return {
    dueToday: tasks.filter((item) => isOpen(item) && item.due_date === today),
    overdue: tasks.filter((item) => isOpen(item) && item.due_date < today),
    followUpToday: tasks.filter((item) => isOpen(item) && item.next_follow_up === today),
    waitingForReview: tasks.filter((item) => item.status === 'Under Review')
  };
}
async function loadData() {
  if (!sql) return { ...demo, source: 'demo' };
  const [projects, taskRows, dependencies, userDependencies, issues, reminders, users, notifications, activity] = await Promise.all([
    sql`SELECT * FROM projects ORDER BY id`, sql`SELECT * FROM tasks ORDER BY due_date`, sql`SELECT * FROM task_dependencies`,
    sql`SELECT * FROM task_user_dependencies ORDER BY id`,
    sql`SELECT * FROM issues ORDER BY created_at DESC`, sql`SELECT * FROM reminder_log ORDER BY sent_at DESC LIMIT 40`,
    sql`SELECT id, name, email, department, role, reporting_manager, is_active, created_at FROM app_users WHERE is_active = TRUE ORDER BY name`, sql`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100`,
    sql`SELECT * FROM activity ORDER BY occurred_at DESC LIMIT 8`
  ]);
  const dependencyMap = new Map();
  dependencies.forEach((item) => dependencyMap.set(item.task_id, [...(dependencyMap.get(item.task_id) || []), item.depends_on_task_id]));
  const userDependencyMap = new Map();
  userDependencies.forEach((item) => userDependencyMap.set(item.task_id, [...(userDependencyMap.get(item.task_id) || []), normaliseUserDependencyDates(item)]));
  return {
    projects: projects.map(normaliseProjectDates),
    tasks: taskRows.map((item) => normaliseTaskDates({ ...item, dependencies: dependencyMap.get(item.id) || [], user_dependencies: userDependencyMap.get(item.id) || [] })),
    issues: issues.map(normaliseIssueDates),
    reminders,
    users,
    notifications: notifications.map((item) => ({ ...item, scheduled_for: dayStamp(item.scheduled_for) })),
    activity,
    source: 'neon'
  };
}
function eventPlan(task, today = dayStamp()) {
  if (!isOpen(task) || !task.reminder_enabled) return [];
  const offset = dateDiff(today, task.due_date);
  if (offset === 2) return [{ event: 'Due in 2 days', recipients: [task.assignee] }];
  if (offset === 1) return [{ event: 'Due tomorrow', recipients: [task.assignee] }];
  if (offset === 0) return [{ event: 'Due today - high priority', recipients: [task.assignee] }];
  if (offset === -1) return [{ event: 'Overdue day 1', recipients: [task.assignee] }];
  if (offset === -2) return [{ event: 'Overdue day 2 AM', recipients: [task.assignee] }, { event: 'Overdue day 2 PM', recipients: [task.assignee] }];
  if (offset < -2) return [{ event: `Overdue escalation day ${Math.abs(offset)}`, recipients: [task.assignee, task.assigned_by].filter(Boolean) }];
  return [];
}
async function deliver(channel, task, event, recipient) {
  const message = `${event}: ${task.id} – ${task.title} is due ${task.due_date}.`;
  try {
    if (channel === 'Teams' && process.env.TEAMS_WEBHOOK_URL) {
      const response = await fetch(process.env.TEAMS_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message }) });
      return response.ok ? 'Sent' : 'Failed';
    }
    if (channel === 'Email' && process.env.RESEND_API_KEY && task.assignee_email) {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [task.assignee_email], subject: `Project Hub: ${event}`, text: message }) });
      return response.ok ? 'Sent' : 'Failed';
    }
  } catch { return 'Failed'; }
  return 'Queued';
}
async function runAutomation() {
  const current = await loadData();
  const candidates = current.tasks.flatMap((item) => eventPlan(item).flatMap(({ event, recipients }) => (
    recipients.flatMap((recipient) => ['Email', 'Teams'].map((channel) => ({ task: item, event, recipient, channel })))
  )));
  const today = dayStamp();
  const created = [];
  for (const entry of candidates) {
    const key = `${today}:${entry.task.id}:${entry.event}:${entry.recipient}:${entry.channel}`;
    const delivery_status = await deliver(entry.channel, entry.task, entry.event, entry.recipient);
    const record = { task_id: entry.task.id, event_type: entry.event, channel: entry.channel, recipient: entry.recipient, delivery_status, next_reminder_at: `${entry.task.due_date}T09:00:00Z`, reminder_key: key, sent_at: new Date().toISOString() };
    if (sql) {
      const rows = await sql`INSERT INTO reminder_log (task_id, event_type, channel, recipient, delivery_status, next_reminder_at, reminder_key)
        VALUES (${record.task_id}, ${record.event_type}, ${record.channel}, ${record.recipient}, ${record.delivery_status}, ${record.next_reminder_at}, ${record.reminder_key}) ON CONFLICT (reminder_key) DO NOTHING RETURNING *`;
      created.push(...rows);
    } else if (!demo.reminders.some((item) => item.reminder_key === key)) { demo.reminders.unshift({ id: `REM-${demo.reminders.length + 1}`, ...record }); created.push(record); }
  }
  return { created, candidates: candidates.length, externalDeliveryEnabled: Boolean(process.env.TEAMS_WEBHOOK_URL || process.env.RESEND_API_KEY) };
}

async function deliverUserEmail(user, title, message) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL || !user.email) return 'Queued';
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [user.email], subject: title, text: message }) });
    return response.ok ? 'Sent' : 'Failed';
  } catch { return 'Failed'; }
}
async function runProjectDailyNotifications(projectId, loadedData) {
  const current = loadedData || await loadData();
  const project = current.projects.find((item) => item.id === projectId);
  if (!project) { const error = new Error('Project not found.'); error.statusCode = 404; throw error; }
  const today = dayStamp();
  const projectTasks = current.tasks.filter((item) => item.project_id === projectId && isOpen(item));
  const tasksByAssignee = new Map();
  projectTasks.forEach((item) => tasksByAssignee.set(item.assignee, [...(tasksByAssignee.get(item.assignee) || []), item]));
  const created = []; const skipped = [];
  for (const [assignee, assignedTasks] of tasksByAssignee) {
    const user = current.users.find((item) => item.name.toLowerCase() === assignee.toLowerCase());
    if (!user) { skipped.push({ assignee, reason: 'No active application user matches this assignee.' }); continue; }
    const notification_key = `${today}:${project.id}:project-daily:${user.id}`;
    const title = `Daily project follow-up: ${project.name}`;
    const taskSummary = assignedTasks.map((item) => `${item.id} ${item.title} (${item.status}, due ${item.due_date}, ${item.progress}%)`).join('; ');
    const message = `${project.name} has ${assignedTasks.length} open task${assignedTasks.length === 1 ? '' : 's'} assigned to you: ${taskSummary}`;
    const delivery_status = await deliverUserEmail(user, title, message);
    const record = { user_id: user.id, project_id: project.id, task_id: null, title, message, notification_type: 'Project daily follow-up', delivery_status, notification_key, scheduled_for: today, created_at: new Date().toISOString() };
    if (sql) {
      const rows = await sql`INSERT INTO notifications (user_id, project_id, task_id, title, message, notification_type, delivery_status, notification_key, scheduled_for) VALUES (${record.user_id}, ${record.project_id}, ${record.task_id}, ${record.title}, ${record.message}, ${record.notification_type}, ${record.delivery_status}, ${record.notification_key}, ${record.scheduled_for}) ON CONFLICT (notification_key) DO NOTHING RETURNING *`;
      created.push(...rows);
    } else if (!demo.notifications.some((item) => item.notification_key === notification_key)) { const saved = { id: `NOT-${demo.notifications.length + 1}`, ...record }; demo.notifications.unshift(saved); created.push(saved); }
  }
  return { project: { id: project.id, name: project.name }, openTasks: projectTasks.length, recipients: tasksByAssignee.size, created, skipped, emailDeliveryEnabled: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) };
}
function indiaClock() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, minute: parts.minute };
}
let lastScheduledNotificationMinute = '';
function scheduleDailyNotifications() {
  setInterval(async () => {
    const clock = indiaClock(); const minuteKey = `${clock.date}:${clock.hour}:${clock.minute}`;
    if (lastScheduledNotificationMinute === minuteKey) return;
    lastScheduledNotificationMinute = minuteKey;
    try {
      const current = await loadData();
      const scheduled = current.projects.filter((project) => project.daily_notifications_enabled && project.daily_notification_time === `${clock.hour}:${clock.minute}`);
      for (const project of scheduled) await runProjectDailyNotifications(project.id, current);
    } catch (error) { console.error('Project notification schedule failed', error); }
  }, 60 * 1000);
}

function scopeData(data, user) {
  if (user.role === 'Admin') return data;
  const ownedTasks = data.tasks.filter((item) => item.assignee.toLowerCase() === user.name.toLowerCase());
  const projectIds = new Set(ownedTasks.map((item) => item.project_id));
  if (user.role === 'Project Manager') data.projects.filter((item) => item.manager.toLowerCase() === user.name.toLowerCase()).forEach((item) => projectIds.add(item.id));
  const tasks = user.role === 'Project Manager' ? data.tasks.filter((item) => projectIds.has(item.project_id)) : ownedTasks;
  const taskIds = new Set(tasks.map((item) => item.id));
  const projects = data.projects.filter((item) => projectIds.has(item.id));
  const projectNames = new Set(projects.map((item) => item.name));
  return {
    ...data,
    projects,
    tasks,
    issues: data.issues.filter((item) => projectIds.has(item.project_id)),
    reminders: data.reminders.filter((item) => taskIds.has(item.task_id)),
    users: user.role === 'Project Manager' ? data.users : data.users.filter((item) => item.id === user.id),
    notifications: data.notifications.filter((item) => item.user_id === user.id),
    activity: data.activity.filter((item) => projectNames.has(item.project_name))
  };
}

app.get('/api/auth/me', async (req, res) => {
  try {
    await ensureInitialAdmin();
    res.json({ user: await userFromRequest(req), initialAdminConfigured: await initialAdminReady() });
  } catch (error) { res.status(500).json({ error: 'Unable to check authentication.', detail: error.message }); }
});
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const attemptKey = `${req.ip}:${email}`;
  const recent = (loginAttempts.get(attemptKey) || []).filter((time) => Date.now() - time < 15 * 60 * 1000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  try {
    await ensureInitialAdmin();
    const user = sql ? (await sql`SELECT * FROM app_users WHERE lower(email) = ${email} AND is_active = TRUE LIMIT 1`)[0] : demo.users.find((item) => item.email.toLowerCase() === email && item.is_active);
    if (!user || !passwordMatches(password, user)) {
      loginAttempts.set(attemptKey, [...recent, Date.now()]);
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    loginAttempts.delete(attemptKey);
    const token = randomBytes(32).toString('base64url');
    const hash = tokenHash(token);
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    if (sql) await sql`INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (${hash}, ${user.id}, ${expiresAt.toISOString()})`;
    else demoSessions.set(hash, { user_id: user.id, expires_at: expiresAt.getTime() });
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  } catch (error) { res.status(500).json({ error: 'Unable to sign in.', detail: error.message }); }
});
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = cookieValue(req, sessionCookie);
    if (token) {
      const hash = tokenHash(token);
      if (sql) await sql`DELETE FROM app_sessions WHERE token_hash = ${hash}`;
      else demoSessions.delete(hash);
    }
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) { res.status(500).json({ error: 'Unable to sign out.', detail: error.message }); }
});

app.use('/api', requireAuth);

app.get('/api/dashboard', async (req, res) => { try { const data = scopeData(await loadData(), req.user); res.json({ ...data, currentUser: req.user, followUp: followUpBuckets(data.tasks), statuses }); } catch (error) { res.status(500).json({ error: 'Unable to load project data', detail: error.message }); } });
app.get('/api/follow-up', async (req, res) => { try { const data = scopeData(await loadData(), req.user); res.json(followUpBuckets(data.tasks)); } catch (error) { res.status(500).json({ error: error.message }); } });
app.get('/api/reminders', async (req, res) => { try { const data = scopeData(await loadData(), req.user); res.json(data.reminders); } catch (error) { res.status(500).json({ error: error.message }); } });
app.get('/api/issues', async (req, res) => { try { const data = scopeData(await loadData(), req.user); res.json(data.issues); } catch (error) { res.status(500).json({ error: error.message }); } });
app.post('/api/notifications/run-daily', requireAdmin, async (req, res) => { if (!req.body.projectId) return res.status(400).json({ error: 'Select a project.' }); try { res.json(await runProjectDailyNotifications(req.body.projectId)); } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); } });
app.patch('/api/projects/:id/notification-settings', requireAdmin, async (req, res) => {
  const enabled = req.body.enabled;
  const notificationTime = req.body.notificationTime || '09:00';
  if (typeof enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(notificationTime)) return res.status(400).json({ error: 'Provide a valid schedule and time.' });
  try {
    if (!sql) { const project = demo.projects.find((item) => item.id === req.params.id); if (!project) return res.status(404).json({ error: 'Project not found.' }); project.daily_notifications_enabled = enabled; project.daily_notification_time = notificationTime; return res.json(normaliseProjectDates(project)); }
    const [updated] = await sql`UPDATE projects SET daily_notifications_enabled = ${enabled}, daily_notification_time = ${notificationTime} WHERE id = ${req.params.id} RETURNING *`;
    if (!updated) return res.status(404).json({ error: 'Project not found.' }); res.json(normaliseProjectDates(updated));
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post('/api/users', requireAdmin, async (req, res) => {
  const user = { id: req.body.id || `USR-${String(Date.now()).slice(-5)}`, name: req.body.name?.trim(), email: req.body.email?.trim().toLowerCase(), department: req.body.department?.trim(), role: req.body.role, reporting_manager: req.body.reportingManager?.trim() || '' };
  const password = String(req.body.password || '');
  if (!user.name || !user.email || !user.department || !['Admin', 'Project Manager', 'Team Member', 'Stakeholder'].includes(user.role)) return res.status(400).json({ error: 'Complete the required user fields.' });
  if (password.length < 12) return res.status(400).json({ error: 'The initial password must contain at least 12 characters.' });
  const record = passwordRecord(password);
  try { if (!sql) { if (demo.users.some((item) => item.email === user.email)) return res.status(409).json({ error: 'A user already has this email.' }); const created = { ...user, is_active: true, password_hash: record.hash, password_salt: record.salt }; demo.users.push(created); return res.status(201).json(publicUser(created)); } const [created] = await sql`INSERT INTO app_users (id, name, email, department, role, reporting_manager, password_hash, password_salt) VALUES (${user.id}, ${user.name}, ${user.email}, ${user.department}, ${user.role}, ${user.reporting_manager}, ${record.hash}, ${record.salt}) RETURNING id, name, email, department, role, reporting_manager, is_active, created_at`; res.status(201).json(created); } catch (error) { res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'A user already has this email.' : error.message }); }
});

app.post('/api/tasks', requireManager, async (req, res) => {
  const body = normaliseTask(req.body); if (!body.valid) return res.status(400).json({ error: body.error });
  try {
    body.task.assigned_by = req.user.name;
    if (req.user.role === 'Project Manager') {
      const project = sql ? (await sql`SELECT manager FROM projects WHERE id = ${body.task.project_id} LIMIT 1`)[0] : demo.projects.find((item) => item.id === body.task.project_id);
      if (!project) return res.status(404).json({ error: 'Project not found.' });
      if (project.manager.toLowerCase() !== req.user.name.toLowerCase()) return res.status(403).json({ error: 'You can create tasks only in projects you manage.' });
    }
    if (!sql) {
      const created = { ...body.task, user_dependencies: body.task.user_dependency ? [body.task.user_dependency] : [] };
      demo.tasks.push(created);
      return res.status(201).json(created);
    }
    const t = body.task;
    const [created] = await sql`INSERT INTO tasks (id, project_id, module, title, description, assigned_by, assignee, assignee_email, priority, status, start_date, due_date, estimated_hours, actual_hours, progress, next_follow_up, has_task_dependencies, has_user_dependency, daily_follow_up_enabled, reminder_enabled, remarks)
      VALUES (${t.id}, ${t.project_id}, ${t.module}, ${t.title}, ${t.description}, ${t.assigned_by}, ${t.assignee}, ${t.assignee_email}, ${t.priority}, ${t.status}, ${t.start_date}, ${t.due_date}, ${t.estimated_hours}, ${t.actual_hours}, ${t.progress}, ${t.next_follow_up || null}, ${t.has_task_dependencies}, ${t.has_user_dependency}, ${t.daily_follow_up_enabled}, ${t.reminder_enabled}, ${t.remarks}) RETURNING *`;
    for (const dependency of t.dependencies) await sql`INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (${t.id}, ${dependency}) ON CONFLICT DO NOTHING`;
    if (t.user_dependency) await sql`INSERT INTO task_user_dependencies (task_id, person_name, dependency_type, required_action, needed_by, status, remarks) VALUES (${t.id}, ${t.user_dependency.person_name}, ${t.user_dependency.dependency_type}, ${t.user_dependency.required_action}, ${t.user_dependency.needed_by || null}, ${t.user_dependency.status}, ${t.user_dependency.remarks})`;
    res.status(201).json(normaliseTaskDates({ ...created, dependencies: t.dependencies, user_dependencies: t.user_dependency ? [t.user_dependency] : [] }));
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.patch('/api/tasks/:id', async (req, res) => {
  const { status, progress, actualHours, nextFollowUp, remarks } = req.body;
  if (status && !statuses.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    if (req.user.role !== 'Admin') {
      const existing = sql ? (await sql`SELECT t.assignee, p.manager FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${req.params.id} LIMIT 1`)[0] : (() => { const task = demo.tasks.find((item) => item.id === req.params.id); const project = task && demo.projects.find((item) => item.id === task.project_id); return task ? { assignee: task.assignee, manager: project?.manager || '' } : null; })();
      if (!existing) return res.status(404).json({ error: 'Task not found.' });
      const ownsTask = existing.assignee.toLowerCase() === req.user.name.toLowerCase();
      const managesProject = req.user.role === 'Project Manager' && existing.manager.toLowerCase() === req.user.name.toLowerCase();
      if (!ownsTask && !managesProject) return res.status(403).json({ error: 'You can update only your assigned tasks or projects you manage.' });
    }
    if (!sql) { const index = demo.tasks.findIndex((item) => item.id === req.params.id); if (index < 0) return res.status(404).json({ error: 'Task not found.' }); demo.tasks[index] = { ...demo.tasks[index], ...(status ? { status } : {}), ...(progress !== undefined ? { progress: Number(progress) } : {}), ...(actualHours !== undefined ? { actual_hours: Number(actualHours) } : {}), ...(nextFollowUp ? { next_follow_up: nextFollowUp } : {}), ...(remarks !== undefined ? { remarks } : {}) }; return res.json(demo.tasks[index]); }
    const [updated] = await sql`UPDATE tasks SET status = COALESCE(${status || null}, status), progress = COALESCE(${progress ?? null}, progress), actual_hours = COALESCE(${actualHours ?? null}, actual_hours), next_follow_up = COALESCE(${nextFollowUp || null}, next_follow_up), remarks = COALESCE(${remarks ?? null}, remarks) WHERE id = ${req.params.id} RETURNING *`;
    if (!updated) return res.status(404).json({ error: 'Task not found.' }); res.json(normaliseTaskDates(updated));
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post('/api/issues', async (req, res) => {
  const issue = { id: req.body.id || `ISS-${String(Date.now()).slice(-5)}`, ...req.body, raised_by: req.user.name, resolution_date: req.body.resolutionDate || null };
  if (!issue.project_id || !issue.title || !issue.raised_by || !issue.owner || !issue.priority) return res.status(400).json({ error: 'Missing required issue fields.' });
  try { if (!sql) { demo.issues.unshift(issue); return res.status(201).json(issue); } const [created] = await sql`INSERT INTO issues (id, project_id, task_id, title, description, raised_by, owner, priority, status, resolution_date) VALUES (${issue.id}, ${issue.project_id}, ${issue.task_id || null}, ${issue.title}, ${issue.description || ''}, ${issue.raised_by}, ${issue.owner}, ${issue.priority}, ${issue.status || 'Open'}, ${issue.resolution_date}) RETURNING *`; res.status(201).json(normaliseIssueDates(created)); } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post('/api/automation/run', requireAdmin, async (_req, res) => { try { res.json(await runAutomation()); } catch (error) { res.status(500).json({ error: error.message }); } });

function normaliseTask(input) {
  const has_task_dependencies = input.hasTaskDependencies === true || input.hasTaskDependencies === 'true';
  const has_user_dependency = input.hasUserDependency === true || input.hasUserDependency === 'true';
  const user_dependency = has_user_dependency ? { person_name: input.dependencyPerson || '', dependency_type: input.userDependencyType || 'Input', required_action: input.requiredAction || '', needed_by: input.userDependencyNeededBy || null, status: input.userDependencyStatus || 'Pending', remarks: input.userDependencyRemarks || '' } : null;
  const task = { id: input.id || `TSK-${String(Date.now()).slice(-5)}`, project_id: input.projectId || input.project_id, module: input.module, title: input.title, description: input.description || '', assigned_by: input.assignedBy || input.assigned_by || '', assignee: input.assignee, assignee_email: input.assigneeEmail || input.assignee_email || '', priority: input.priority, status: input.status || 'Not Started', start_date: input.startDate || input.start_date || dayStamp(), due_date: input.dueDate || input.due_date, estimated_hours: Number(input.estimatedHours || input.estimated_hours || 0), actual_hours: Number(input.actualHours || input.actual_hours || 0), progress: Number(input.progress || 0), next_follow_up: input.nextFollowUp || input.next_follow_up || null, has_task_dependencies, has_user_dependency, daily_follow_up_enabled: input.dailyFollowUp === true || input.dailyFollowUp === 'true', reminder_enabled: false, remarks: input.remarks || '', dependencies: has_task_dependencies ? input.dependencies || [] : [], user_dependency };
  if (!task.project_id || !task.module || !task.title || !task.assigned_by || !task.assignee || !task.priority || !task.due_date || !statuses.includes(task.status)) return { valid: false, error: 'Complete the required task fields, including an approved status.' };
  if (has_task_dependencies && !task.dependencies.length) return { valid: false, error: 'Select at least one prerequisite task.' };
  if (has_user_dependency && (!user_dependency.person_name || !user_dependency.required_action)) return { valid: false, error: 'Complete the person dependency details.' };
  return { valid: true, task };
}

app.use(express.static(path.join(rootDir, 'dist')));
app.use((req, res, next) => { if (req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(rootDir, 'dist', 'index.html')); next(); });

let localServer;
export function startServer() {
  if (localServer) return localServer;
  scheduleDailyNotifications();
  localServer = app.listen(port, () => console.log(`Project Hub API listening on http://localhost:${port}`));
  return localServer;
}

export default app;
