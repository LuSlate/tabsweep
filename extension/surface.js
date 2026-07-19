// Reads ?surface=popup|panel and flags it on <html> so the compact single-column
// CSS applies. Lives in its own file because MV3's content-security-policy
// (script-src 'self') blocks inline scripts. Runs synchronously in <head> so the
// width is set before the body paints — no flash, and the popup sizes correctly.
const surface = new URLSearchParams(location.search).get('surface');
if (surface) document.documentElement.dataset.surface = surface;
