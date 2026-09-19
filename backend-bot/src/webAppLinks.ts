const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function normalizeWebAppBaseUrl(value: string, options: { requirePublicHttps?: boolean } = {}) {
  let url: URL;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("WEBAPP_URL must be a valid absolute URL");
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("WEBAPP_URL must use http or https");
  }
  if (options.requirePublicHttps && url.protocol !== 'https:') {
    throw new Error("WEBAPP_URL must use HTTPS in production");
  }
  if (options.requirePublicHttps && LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error("WEBAPP_URL must point to the public Mini App domain, not localhost");
  }

  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

export function buildWebAppUrl(baseUrl: string, target?: string) {
  const url = new URL(baseUrl);
  if (!target) return url.toString();

  const cleanTarget = normalizeInternalTarget(target);
  url.searchParams.set('open', cleanTarget);
  return url.toString();
}

function normalizeInternalTarget(target: string) {
  const value = String(target).trim();
  if (!value.startsWith('/') || value.startsWith('//')) {
    throw new Error('Mini App target must be an internal absolute path');
  }
  const parsed = new URL(value, 'https://mini-app.internal');
  if (parsed.origin !== 'https://mini-app.internal') {
    throw new Error('Mini App target must stay inside the application');
  }
  return `${parsed.pathname}${parsed.search}`;
}
