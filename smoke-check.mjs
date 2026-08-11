const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3001';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectStatus(path, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  assert(response.status === expectedStatus, `${path} returned HTTP ${response.status}; expected ${expectedStatus}`);
  return response;
}

const authResponse = await fetch(`${baseUrl}/api/auth/me`);
assert(authResponse.ok, `/api/auth/me returned HTTP ${authResponse.status}`);
const auth = await authResponse.json();
assert(Object.hasOwn(auth, 'user'), 'Authentication status is missing the user field');
await expectStatus('/api/dashboard', {}, 401);
await expectStatus('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'invalid@example.com', password: 'invalid-password' }) }, 401);

const htmlResponse = await fetch(`${baseUrl}/`);
assert(htmlResponse.ok && htmlResponse.headers.get('content-type')?.includes('text/html'), 'Application shell is unavailable');
const html = await htmlResponse.text();
assert(html.includes('<div id="root"></div>'), 'React application root is missing');

if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }) });
  assert(login.ok, `Test login returned HTTP ${login.status}`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert(cookie?.startsWith('project_hub_session='), 'Login did not issue the HTTP-only session cookie');
  const request = async (path) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
    assert(response.ok, `${path} returned HTTP ${response.status}`);
    return response.json();
  };
  const dashboard = await request('/api/dashboard');
  assert(dashboard.source === 'neon', 'Dashboard is not using Neon');
  assert(dashboard.currentUser?.email === process.env.SMOKE_EMAIL, 'Dashboard is not bound to the authenticated user');
  assert(Array.isArray(dashboard.projects) && Array.isArray(dashboard.tasks) && Array.isArray(dashboard.users), 'Dashboard collections are incomplete');
  assert(dashboard.followUp && ['dueToday', 'overdue', 'followUpToday', 'waitingForReview'].every((key) => Array.isArray(dashboard.followUp[key])), 'Follow-up buckets are incomplete');
  assert(dashboard.users.every((user) => !Object.hasOwn(user, 'password_hash') && !Object.hasOwn(user, 'password_salt')), 'Dashboard exposed password material');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  for (const project of dashboard.projects) {
    assert(!project.start_date || dateOnly.test(project.start_date), `Project ${project.id} has an invalid start date`);
    assert(typeof project.daily_notifications_enabled === 'boolean', `Project ${project.id} is missing its daily notification setting`);
  }
  for (const task of dashboard.tasks) assert(!task.due_date || dateOnly.test(task.due_date), `Task ${task.id} has an invalid due date`);
  await Promise.all(['/api/follow-up', '/api/reminders', '/api/issues'].map(request));
  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert(logout.status === 204, `Logout returned HTTP ${logout.status}`);
  await expectStatus('/api/dashboard', { headers: { Cookie: cookie } }, 401);
  console.log(`Authenticated smoke check passed for ${dashboard.currentUser.role}: ${dashboard.projects.length} projects, ${dashboard.tasks.length} tasks, source=${dashboard.source}`);
} else {
  console.log(`Unauthenticated smoke check passed: login gate active, initial admin configured=${auth.initialAdminConfigured}`);
}
