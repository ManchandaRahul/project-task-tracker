import app, { startServer } from './server/index.js';

// Vercel detects this root entrypoint and invokes the exported Express app.
// Local development still uses a normal port listener through `npm start`.
if (!process.env.VERCEL) startServer();

export default app;
