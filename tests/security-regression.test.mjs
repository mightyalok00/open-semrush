import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, isPublicIpAddress, safeFetch } from '../dist/url-safety.js';
import {
  cleanIpCandidate,
  parseClientIp,
  checkProductionControls,
  resetRateLimitsForTests,
} from '../scripts/production-controls.mjs';
import { validateDb } from '../dist/storage.js';

test('SSRF: rejects cloud metadata, internal DNS, and link-local addresses before connection', async () => {
  const metadataUrls = [
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.169.254/computeMetadata/v1/',
    'http://metadata.google.internal/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://100.100.100.200/latest/meta-data/',
    'http://[fd00:ec2::254]/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:127.0.0.1]/',
  ];

  for (const url of metadataUrls) {
    await assert.rejects(
      assertPublicHttpUrl(url),
      /private or reserved|unsafe|localhost|metadata/i,
      `Expected ${url} to be blocked by SSRF guard`
    );
  }
});

test('SSRF: rejects non-HTTP schemes and embedded credentials', async () => {
  const dangerousUrls = [
    'file:///etc/passwd',
    'file:///C:/Windows/win.ini',
    'gopher://127.0.0.1:6379/_INFO',
    'dict://127.0.0.1:11211/stat',
    'ldap://127.0.0.1:389/o=example',
    'ftp://public-mirror.example.com/',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://admin:supersecret@example.com/api',
  ];

  for (const url of dangerousUrls) {
    await assert.rejects(
      assertPublicHttpUrl(url),
      /protocol|credential|HTTP and HTTPS/i,
      `Expected ${url} to be blocked`
    );
  }
});

test('SSRF: blocks IPv4 special-purpose ranges and IPv6 non-global scopes', () => {
  const privateIps = [
    '0.0.0.0', '10.0.0.1', '10.255.255.255',
    '100.64.0.1', '127.0.0.1', '127.0.0.2',
    '169.254.1.1', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.168.1.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd00::1', 'fe80::1', 'ff02::1',
    '2001:db8::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1',
  ];

  for (const ip of privateIps) {
    assert.equal(isPublicIpAddress(ip), false, `IP ${ip} should be recognized as non-public`);
  }

  // Known public unicast IPs must be allowed
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('1.1.1.1'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('Redirects: aborts immediately on redirect-to-private-IP attempts', async () => {
  const attempts = [
    'http://127.0.0.1/admin',
    'http://10.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/router-login',
  ];

  for (const target of attempts) {
    const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
    const requester = async () => new Response(null, { status: 302, headers: { location: target } });

    await assert.rejects(
      safeFetch('https://example.com/', {}, { resolver, requester }),
      /Private or reserved IP/i,
      `Expected redirect to ${target} to be blocked`
    );
  }
});

test('Redirects: bounds maximum redirect depth to prevent infinite loops', async () => {
  let hops = 0;
  const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const requester = async () => {
    hops++;
    return new Response(null, { status: 302, headers: { location: `https://example.com/hop-${hops}` } });
  };

  await assert.rejects(
    safeFetch('https://example.com/', {}, { resolver, requester }),
    /Too many redirects/i
  );
  assert.equal(hops, 6); // initial fetch + 5 redirects = 6 attempts
});

test('DNS Rebinding: prevents TOCTOU attacks via DNS answer pinning', async () => {
  let resolutions = 0;
  let socketTargetAddress = '';
  // Resolver returns public on first call, but malicious loopback on second call
  const resolver = async () => {
    resolutions++;
    return [{ address: resolutions === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }];
  };
  const requester = async (_url, address) => {
    socketTargetAddress = address;
    return new Response('safe content', { status: 200 });
  };

  const response = await safeFetch('https://example.com/', {}, { resolver, requester });
  assert.equal(await response.text(), 'safe content');
  // Verified: Only one resolution occurred and socket connected to the pinned checked IP
  assert.equal(resolutions, 1);
  assert.equal(socketTargetAddress, '93.184.216.34');
});

test('DNS: dual-stack response containing mixed public/private IPs fails closed', async () => {
  const mixedResolver = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '::1', family: 6 },
  ];
  await assert.rejects(
    assertPublicHttpUrl('https://example.com/', mixedResolver),
    /private or reserved/i
  );
});

test('Proxy Headers: cleanIpCandidate sanitizes ports, zone indexes, and injection vectors', () => {
  assert.equal(cleanIpCandidate('198.51.100.1'), '198.51.100.1');
  assert.equal(cleanIpCandidate('198.51.100.1:8080'), '198.51.100.1');
  assert.equal(cleanIpCandidate('2001:db8::1'), '2001:db8::1');
  assert.equal(cleanIpCandidate('[2001:db8::1]:443'), '2001:db8::1');
  assert.equal(cleanIpCandidate('fe80::1%eth0'), 'fe80::1');

  // Injection and malformed representations rejected
  assert.equal(cleanIpCandidate('<script>alert("xss")</script>'), '');
  assert.equal(cleanIpCandidate("192.0.2.1' OR '1'='1"), '');
  assert.equal(cleanIpCandidate('127.0.0.1\r\nX-Injected: true'), '');
  assert.equal(cleanIpCandidate('not.an.ip.address'), '');
  assert.equal(cleanIpCandidate(null), '');
  assert.equal(cleanIpCandidate(undefined), '');
});

test('Proxy Headers: parseClientIp enforces TRUST_PROXY_HOPS and falls back safely on spoofing', () => {
  const reqSpoofed = {
    headers: { 'x-forwarded-for': 'malicious-payload, <script>evil()</script>' },
    socket: { remoteAddress: '10.0.0.1' },
  };
  assert.equal(parseClientIp(reqSpoofed, 1), '10.0.0.1');

  const reqLegit = {
    headers: { 'x-forwarded-for': '203.0.113.10, 70.41.3.18, 150.172.238.178' },
    socket: { remoteAddress: '10.0.0.1' },
  };
  // 1 hop behind CDN: client is 150.172.238.178
  assert.equal(parseClientIp(reqLegit, 1), '150.172.238.178');
  // 0 hops: header ignored completely
  assert.equal(parseClientIp(reqLegit, 0), '10.0.0.1');
});

test('Auth: zero-downtime secret rotation accepts either active token', () => {
  resetRateLimitsForTests();
  process.env.OPEN_SEMRUSH_API_TOKENS = 'token-alpha, token-beta';

  const reqAlpha = { method: 'POST', headers: { authorization: 'Bearer token-alpha' }, socket: { remoteAddress: '192.0.2.1' } };
  const reqBeta = { method: 'POST', headers: { authorization: 'Bearer token-beta' }, socket: { remoteAddress: '192.0.2.2' } };
  const reqWrong = { method: 'POST', headers: { authorization: 'Bearer token-wrong' }, socket: { remoteAddress: '192.0.2.3' } };

  assert.equal(checkProductionControls(reqAlpha, '/api/audit', 100), null);
  assert.equal(checkProductionControls(reqBeta, '/api/audit', 101), null);
  assert.equal(checkProductionControls(reqWrong, '/api/audit', 102)?.status, 401);

  delete process.env.OPEN_SEMRUSH_API_TOKENS;
});

test('Auth: production mode fails closed with 503 when protected endpoint lacks token configuration', () => {
  resetRateLimitsForTests();
  delete process.env.OPEN_SEMRUSH_API_TOKEN;
  delete process.env.OPEN_SEMRUSH_API_TOKENS;
  process.env.NODE_ENV = 'production';

  const req = { method: 'POST', socket: { remoteAddress: '192.0.2.1' } };
  const result = checkProductionControls(req, '/api/audit', 200);
  assert.equal(result?.status, 503);
  assert.match(result?.body?.error, /disabled until OPEN_SEMRUSH_API_TOKEN is configured/);

  process.env.NODE_ENV = 'test';
});

test('Persistence: validateDb rejects malformed schemas and out-of-bounds metrics', () => {
  assert.throws(() => validateDb(null), /not a JSON object/);
  assert.throws(() => validateDb({ projects: 'invalid', history: [] }), /invalid schema/);
  assert.throws(() => validateDb({ projects: [], history: 'invalid' }), /invalid schema/);

  // Score > 100
  assert.throws(
    () => validateDb({ projects: [{ id: '1', domain: 'test.com', createdAt: '2026-10-21', lastAuditScore: 101, trackedKeywords: [] }], history: [] }),
    /lastAuditScore must be an integer between 0 and 100/
  );

  // Negative errors count
  assert.throws(
    () => validateDb({ projects: [], history: [{ timestamp: '2026-10-21', domain: 'test.com', healthScore: 90, errors: -5, warnings: 0, notices: 0 }] }),
    /errors must be a non-negative integer/
  );
});
