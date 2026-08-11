import app from '../server/index.js';

// Vite deployments use this catch-all Vercel Function for every /api/* route.
// Express receives the original URL and applies the same authentication and
// authorization middleware used by the local server.
export default app;
