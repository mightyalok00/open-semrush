import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
const MAX_REDIRECTS = 5, MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
function isPrivateIpv4(ip) { const p = ip.split('.').map(Number); if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255))
    return true; const [a, b, c] = p; return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 2 || b === 168)) || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && (c === 0 || c === 113)); }
function isPrivateIpv6(ip) { const n = ip.toLowerCase().split('%')[0] ?? ip.toLowerCase(); if (n === '::' || n === '::1' || n.startsWith('fc') || n.startsWith('fd') || n.startsWith('ff') || /^fe[89ab]/.test(n) || n.startsWith('::ffff:'))
    return true; const parts = n.split(':'), first = Number.parseInt(parts[0] || '0', 16); if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff)
    return true; const second = Number.parseInt(parts[1] || '0', 16); if (first === 0x2001 && Number.isFinite(second) && second <= 0x1ff)
    return true; return n.startsWith('2001:db8:') || n.startsWith('2002:') || n.startsWith('3fff:'); }
export function isPublicIpAddress(ip) { const v = isIP(ip); return v === 4 ? !isPrivateIpv4(ip) : v === 6 ? !isPrivateIpv6(ip) : false; }
async function resolvePublicTarget(input, resolver = lookup) { let url; try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
}
catch {
    throw new Error('A valid absolute URL is required.');
} if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Only HTTP and HTTPS URLs are supported.'); if (url.username || url.password)
    throw new Error('URLs containing credentials are not allowed.'); const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ''); if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal' || host.endsWith('.internal'))
    throw new Error('Local and metadata hostnames are not allowed.'); const version = isIP(host); if (version) {
    if (!isPublicIpAddress(host))
        throw new Error('Private or reserved IP addresses are not allowed.');
    return { url, address: host, family: version };
} let addresses; try {
    addresses = await resolver(host, { all: true, verbatim: true });
}
catch {
    throw new Error('The target hostname could not be resolved.');
} if (!addresses.length || addresses.some(x => !isPublicIpAddress(x.address)))
    throw new Error('The target hostname resolves to a private or reserved IP address.'); const selected = addresses[0]; if (!selected)
    throw new Error('The target hostname could not be resolved.'); return { url, address: selected.address, family: selected.family }; }
export async function assertPublicHttpUrl(input, resolver = lookup) { return (await resolvePublicTarget(input, resolver)).url; }
function pinnedRequest(url, address, family, init) { return new Promise((resolve, reject) => { const client = url.protocol === 'https:' ? https : http, headers = {}; new Headers(init.headers).forEach((value, key) => { headers[key] = value; }); const lookupPinned = (_h, opts, cb) => { if (typeof opts === 'object' && opts !== null && 'all' in opts && opts.all)
    cb(null, [{ address, family }]);
else
    cb(null, address, family); }; const req = client.request(url, { method: init.method ?? 'GET', headers, lookup: lookupPinned, signal: init.signal ?? undefined, timeout: 15000 }, res => { const chunks = []; let size = 0; res.on('data', (chunk) => { size += chunk.length; if (size > MAX_RESPONSE_BYTES) {
    req.destroy(new Error('Outbound response exceeded the 5 MiB safety limit.'));
    return;
} chunks.push(chunk); }); res.on('end', () => { const hs = new Headers(); for (const [k, v] of Object.entries(res.headers)) {
    if (Array.isArray(v))
        for (const x of v)
            hs.append(k, x);
    else if (v !== undefined)
        hs.set(k, v);
} resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 502, headers: hs })); }); }); req.on('error', reject); if (init.body && typeof init.body === 'string')
    req.write(init.body); req.end(); }); }
/** Pins each outbound socket to a DNS answer validated as public; redirects are re-resolved and revalidated. */
export async function safeFetch(input, init = {}, dependencies = {}) { let target = input instanceof URL ? new URL(input.href) : new URL(input); for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const resolved = await resolvePublicTarget(target, dependencies.resolver ?? lookup), response = await (dependencies.requester ?? pinnedRequest)(resolved.url, resolved.address, resolved.family, init);
    if (![301, 302, 303, 307, 308].includes(response.status))
        return response;
    const location = response.headers.get('location');
    if (!location)
        return response;
    if (i === MAX_REDIRECTS)
        throw new Error('Too many redirects while fetching the target URL.');
    target = new URL(location, resolved.url);
} throw new Error('Too many redirects while fetching the target URL.'); }
