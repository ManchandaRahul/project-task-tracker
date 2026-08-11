import app from '../server/index.js';

export default function handler(request, response) {
  const forwardedPath = request.query?.path;
  if (forwardedPath) {
    const path = Array.isArray(forwardedPath) ? forwardedPath.join('/') : forwardedPath;
    const url = new URL(request.url, 'http://vercel.local');
    url.searchParams.delete('path');
    const query = url.searchParams.toString();
    request.url = `/api/${path}${query ? `?${query}` : ''}`;
  }
  return app(request, response);
}
