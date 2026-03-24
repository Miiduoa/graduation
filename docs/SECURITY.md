# Security Policy

## Responsible Disclosure

We appreciate the security research community and take all security reports seriously. If you believe you have discovered a security vulnerability in this project, please report it responsibly to:

**Security Contact:** `security@campusapp.edu.tw`

Please do NOT publicly disclose the vulnerability until we have had a chance to address it. We aim to respond to security reports within 48 hours and will work with you on a reasonable timeline for a fix.

## Supported Versions

Security updates are provided for:

- **Current Major Version**: Full support with all security patches
- **Previous Major Version**: Security patches only (12 months)
- **Older Versions**: No longer supported

Please upgrade to the latest version to receive all security updates.

## Security Features Overview

### 1. Device Attestation (App Check)

**Mobile App Protection:**
- Firebase App Check integration with device attestation
- iOS: DeviceCheck (production) / Debug provider (development)
- Android: Play Integrity API (production) / Debug provider (development)
- Prevents API abuse and bot attacks
- Advisory detection for jailbroken/rooted devices

**Implementation:**
- `/apps/mobile/src/services/appCheck.ts` — Token management
- `/apps/mobile/src/services/securityService.ts` — Runtime security checks
- Automatic token refresh with 60-second buffer before expiry

### 2. Transport Security (TLS/HTTPS)

**All Communication Encrypted:**
- HTTPS enforced for all web traffic
- TLS 1.2+ minimum (enforced by Firebase)
- HSTS preload enabled: `max-age=63072000; includeSubDomains; preload`
- Certificate pinning recommended for high-security API endpoints

**Firebase Realtime Database & Firestore:**
- All data in transit encrypted with TLS
- WSS (WebSocket Secure) for real-time subscriptions

### 3. Data Encryption at Rest

**Firebase Firestore:**
- Automatic server-side encryption with Google-managed keys
- Optional customer-managed encryption keys (CMEK) available
- Data encrypted before storage

**Firebase Realtime Database:**
- Automatic encryption at rest
- All data encrypted before persisting to disk

**Cloud Storage:**
- Server-side encryption by default (AES-256)
- CMEK integration available for compliance requirements

### 4. Authentication Security

**Firebase Authentication:**
- Multi-factor authentication (MFA) support
  - SMS-based MFA
  - TOTP via Google Authenticator
- Email/password with secure password reset flow
- Phone number authentication with reCAPTCHA protection
- Session management with automatic token refresh

**Single Sign-On (SSO):**
- SAML 2.0 integration with institutional identity providers
- OAuth 2.0 / OpenID Connect support
- Secure token exchange with server-side validation
- Session validation before granting access

**Implementation Details:**
- Auth tokens stored in secure storage (iOS Keychain / Android Keystore)
- Token refresh happens transparently before expiry
- Logout clears all session data
- Cross-site request forgery (CSRF) protection via state tokens

### 5. Content Security Policy (CSP)

**Browser-based defenses:**
- Strict CSP headers prevent XSS attacks
- Inline script execution restricted to trusted sources
- External resource loading whitelisted
- Frame ancestors policy prevents clickjacking

**Web App Headers:**
```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
```

**Mobile Web Views:**
- CSP enforced for any embedded web content
- External navigation validated before allowing

### 6. API Safety & Rate Limiting

**Client-Side Defenses:**
- Request rate limiting (per endpoint)
- Input sanitization to prevent injection attacks
- URL validation before navigation
- Safe URL scheme whitelist (https, http, mailto, tel)

**Server-Side Security:**
- Cloud Functions enforce per-user and per-IP rate limits
- Request signature validation
- Authentication required for all data modification
- Authorization checks on all Firestore operations

**Implementation:**
- `/apps/mobile/src/utils/apiSafety.ts` — Client-side validation
- `/backend/functions/index.js` — App Check verification middleware
- `/backend/functions/securityUtils.js` — Rate limiting and CORS enforcement

### 7. Payment Security

**PCI Compliance:**
- Payment processing handled by vetted third-party providers
- Stripe integration for tuition payments
- Credit card details never touch our servers
- Payment tokens used for recurring charges
- Tokens encrypted in database

**Payment Data:**
- Transaction records encrypted at rest
- Audit logs of all payment operations
- Compliance with PCI DSS Level 1
- Regular security audits by third parties

### 8. Database Security

**Firestore Security Rules:**
- Role-based access control (RBAC)
- User can only access their own data unless explicitly shared
- Admin-only operations restricted to service roles
- School data protected from unauthorized modification

**Real-time Database Rules:**
- Public read-only access for campus directory
- Authenticated write access only
- Automatic data expiry for temporary records (e.g., join codes)

**Backup & Recovery:**
- Daily automated backups (retained 30 days)
- Encrypted backup storage
- Point-in-time recovery available
- Disaster recovery plan in place

### 9. Admin Console Security

**Access Control:**
- Two-factor authentication required for all admin accounts
- IP allowlisting for admin dashboard
- Session timeout after 30 minutes of inactivity
- Detailed audit logs of all admin actions

**Permissions Model:**
- Principle of least privilege
- Service role-based (school admin, system admin)
- Granular permission scoping
- Regular access reviews

### 10. Dependency Management

**Supply Chain Security:**
- Dependencies pinned to specific versions
- Regular security audits with `npm audit` / `pnpm audit`
- Automated dependency updates with testing
- Known vulnerability monitoring (Snyk integration)

**Code Review:**
- All code changes require peer review
- Security-focused code review checklist
- Automated static analysis (ESLint security rules)
- Dependency tree validation before merge

## Security Headers

The following security headers are configured on all web routes:

| Header | Value | Purpose |
|--------|-------|---------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | HSTS preload list eligibility |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME type sniffing |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking protection |
| `X-XSS-Protection` | `1; mode=block` | Legacy browser XSS filter |
| `Content-Security-Policy` | Strict whitelist | XSS and injection prevention |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referrer header control |
| `Permissions-Policy` | Restricted features | Camera, microphone, geolocation control |
| `X-DNS-Prefetch-Control` | `on` | DNS prefetch optimization |

## Incident Response

In the event of a security incident:

1. **Detection** → Immediate security team notification
2. **Containment** → Isolate affected systems
3. **Investigation** → Determine scope and impact
4. **Remediation** → Deploy fixes and patches
5. **Communication** → Notify affected users if necessary
6. **Post-Incident** → Root cause analysis and prevention measures

## Compliance & Certifications

This application is designed to meet the following standards:

- **Data Protection**: GDPR compliance for EU users
- **Encryption**: AES-256 encryption standards
- **Network**: TLS 1.2+ enforcement
- **Authentication**: NIST password guidelines, MFA support
- **PCI**: Payment Card Industry Data Security Standard

## Security Best Practices for Users

1. **Keep your app updated** — Always install the latest version
2. **Use strong passwords** — 12+ characters, mix of types
3. **Enable MFA** — Activate multi-factor authentication
4. **Don't share credentials** — Never share login information
5. **Report suspicious activity** — Contact security team immediately
6. **Use public WiFi carefully** — Avoid sensitive operations on public networks

## Security Updates

Security patches are released as they become available. We recommend:

- Enabling automatic app updates
- Reviewing security advisories in release notes
- Updating within 24 hours of critical security fixes

Follow our [Releases](../README.md) page for update notifications.

---

**Last Updated:** March 2026

For questions or concerns, please contact: `security@campusapp.edu.tw`
