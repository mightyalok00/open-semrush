import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_REDIRECTS = 5;

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;

  const mappedIpv4 = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4?.[1]) return isPrivateIpv4(mappedIpv4[1]);

  return false;
}

/** Returns false for non-public IPv4/IPv6 addresses and malformed IP literals. */
export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !isPrivateIpv4(address);
  if (version === 6) return !isPrivateIpv6(address);
  return false;
}

/** Rejects local, non-HTTP, and private-network targets before making outbound requests. */
export async function assertPublicHttpUrl(input: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new Error('A valid absolute URL is required.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not allowed.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname === 'metadata.google.internal') {
    throw new Error('Local and metadata hostnames are not allowed.');
  }

  const ipVersion = isIP(hostname);
  if (ipVersion) {
    if (!isPublicIpAddress(hostname)) throw new Error('Private or reserved IP addresses are not allowed.');
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('The target hostname could not be resolved.');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error('The target hostname resolves to a private or reserved IP address.');
  }

  return url;
}

/** Follows redirects manually so each destination is checked independently. */
export async function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  let target = await assertPublicHttpUrl(input);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(target, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error('Too many redirects while fetching the target URL.');
    }

    const nextTarget = new URL(location, target);
    target = await assertPublicHttpUrl(nextTarget);
  }

  throw new Error('Too many redirects while fetching the target URL.');
}
