# 🛡️ Security Policy

## Supported Versions

Security updates are applied to the active `main` branch.

| Version | Supported | Notes |
| --- | --- | --- |
| `1.x` | ✅ Yes | Actively maintained |

---

## 🔒 Security Architecture Overview

Open Semrush enforces strict security boundaries designed for safe execution in self-hosted and cloud environments:

1. **SSRF & Cloud Metadata Defense**:
   - Rejects loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, `fe80::/10`), and cloud provider metadata addresses (`http://169.254.169.254/latest/meta-data/`).
   - Sockets connect directly to the pinned public IP address resolved during DNS pre-flight to defeat Time-of-Check / Time-of-Use (TOCTOU) DNS rebinding.

2. **In-Flight Redirect Controls**:
   - All HTTP redirect hops (`301`, `302`, `307`, `308`) re-run URL parsing, DNS resolution, and IP range checks.
   - Redirect chains are capped at 5 hops to prevent amplification loops.

3. **Authentication & Secret Management**:
   - Protected API routes require a Bearer token when `OPEN_SEMRUSH_API_TOKEN` or `OPEN_SEMRUSH_API_TOKENS` is configured.
   - Secrets are compared using `crypto.timingSafeEqual` over SHA-256 digests to eliminate side-channel timing attacks.
   - Zero-downtime token rotation is supported via comma-separated active tokens.
   - In `NODE_ENV=production`, protected routes fail closed with HTTP 503 if no API token is configured.

4. **Reverse-Proxy Client IP Parsing**:
   - `cleanIpCandidate` strips port suffixes, IPv6 interface zone indexes (`%eth0`), and CRLF/injection payloads.
   - `TRUST_PROXY_HOPS` enforces strict proxy depth behind Cloudflare, Nginx, or AWS ALB to prevent IP spoofing.

5. **Storage Durability & Isolation**:
   - File system storage operates on restrictive file permissions (`0o600`).
   - Writes stage to temporary files and flush via `fsync` before atomic renaming.
   - Corrupted data files cause read operations to fail closed rather than silently overwriting disk contents.

---

## 🚨 Reporting a Vulnerability

If you discover a potential security vulnerability in Open Semrush, please report it responsibly:

1. **Do not open a public GitHub issue.**
2. Send an email to the maintainer or use [GitHub Private Vulnerability Reporting](https://github.com/mightyalok00/open-semrush/security/advisories/new).
3. Include:
   - Target URL / component affected.
   - Step-by-step reproduction instructions or proof-of-concept (PoC).
   - Expected vs actual behavior.
   - Impact assessment.

We will acknowledge receipt within 48 hours and work with you on a timely resolution prior to public disclosure.
