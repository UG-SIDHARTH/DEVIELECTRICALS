export function applyCacheHeaders(req, res, next) {
  const path = req.path;

  // Protect sensitive endpoints and billing HTML from caching and indexing
  if (path.startsWith('/api/') || path.startsWith('/billing/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return next();
  }

  // Immutable long-term caching for static fingerprinted assets
  if (path.startsWith('/assets/') || path.startsWith('/vendor/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return next();
  }

  // Public HTML landing pages
  if (path === '/' || path === '/index.html') {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return next();
  }

  next();
}

export default applyCacheHeaders;
