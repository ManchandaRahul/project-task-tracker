const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3001';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, expectedContentType = 'application/json') {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} returned HTTP ${response.status}`);
  assert(response.headers.get('content-type')?.includes(expectedContentType), `${path} returned an unexpected content type`);
  return expectedContentType === 'application/json' ? response.json() : response.text();
}

async function expectStatus(path, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  assert(response.status === expectedStatus, `${path} returned HTTP ${response.status}; expected ${expectedStatus}`);
}

const dashboard = await request('/api/dashboard');
assert(dashboard.source === 'neon', 'Dashboard is not using Neon');
assert(Array.isArray(dashboard.projects), 'Projects payload is missing');
assert(Array.isArray(dashboard.tasks), 'Tasks payload is missing');
assert(Array.isArray(dashboard.users), 'Users payload is missing');
assert(dashboard.followUp && ['dueToday', 'overdue', 'followUpToday', 'waitingForReview'].every((key) => Array.isArray(dashboard.followUp[key])), 'Follow-up buckets are incomplete');

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
for (const project of dashboard.projects) {
  assert(!project.start_date || dateOnly.test(project.start_date), `Project ${project.id} has an invalid start date`);
  assert(!project.end_date || dateOnly.test(project.end_date), `Project ${project.id} has an invalid end date`);
  assert(typeof project.daily_notifications_enabled === 'boolean', `Project ${project.id} is missing its daily notification setting`);
  assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(project.daily_notification_time), `Project ${project.id} has an invalid notification time`);
}
for (const task of dashboard.tasks) {
  assert(!task.start_date || dateOnly.test(task.start_date), `Task ${task.id} has an invalid start date`);
  assert(!task.due_date || dateOnly.test(task.due_date), `Task ${task.id} has an invalid due date`);
  assert(!task.next_follow_up || dateOnly.test(task.next_follow_up), `Task ${task.id} has an invalid follow-up date`);
}

await Promise.all(['/api/follow-up', '/api/reminders', '/api/issues'].map((path) => request(path)));
await expectStatus('/api/notifications/run-daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 400);
await expectStatus('/api/notifications/run-daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'PRJ-NOT-FOUND' }) }, 404);
await expectStatus('/api/projects/PRJ-001/notification-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: 'yes', notificationTime: '99:99' }) }, 400);
const html = await request('/', 'text/html');
assert(html.includes('<div id="root"></div>'), 'React application root is missing');

console.log(`Smoke check passed: ${dashboard.projects.length} projects, ${dashboard.tasks.length} tasks, ${dashboard.users.length} users, source=${dashboard.source}`);
