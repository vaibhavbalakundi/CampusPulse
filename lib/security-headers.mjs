export const permissionsPolicy = [
  'microphone=(self)', 'camera=()', 'geolocation=()', 'display-capture=()',
  'accelerometer=()', 'gyroscope=()', 'magnetometer=()', 'midi=()', 'usb=()',
  'serial=()', 'hid=()', 'payment=()', 'clipboard-read=()', 'clipboard-write=()',
].join(', ');

export function securityHeaders(hashes, apiOrigin) {
  const csp = [
    "default-src 'self'", `script-src 'self' ${hashes.map(h => `'sha256-${h}'`).join(' ')}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
    "img-src 'self' data: blob:", "media-src 'self' blob:", `connect-src 'self' ${apiOrigin}`,
    "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "frame-src 'none'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", 'upgrade-insecure-requests',
  ].join('; ');
  if (csp.length > 12000) throw new Error('Content Security Policy exceeds the release header budget.');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Permissions-Policy', value: permissionsPolicy.replace('microphone=(self)', 'microphone=()') },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ];
}
