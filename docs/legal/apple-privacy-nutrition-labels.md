# Apple Privacy Nutrition Labels (App Privacy Details)

## Campus Helper (校園助手)

**For: Apple App Store - App Privacy Details**

**Last Updated:** 2026-03-20

---

## 1. Overview

This document maps Campus Helper's data practices to Apple's App Privacy Details framework. This information is displayed on the App Store product page and helps users understand what data the app collects and how it's used.

**App Name:** Campus Helper (校園助手)
**Developer:** Campus Helper Development Team
**Platform:** iOS 14.5+

---

## 2. Data Used to Track You (Tracking Data)

### Overview

Campus Helper uses IDFA (Identifier for Advertisers) and cookie identifiers for:
- Analytics (understanding feature usage)
- Fraud prevention
- App performance monitoring

**Cross-app tracking:** NO
**Cross-website tracking:** NO
**Data shared with third parties for tracking:** NO

### Detailed Tracking Data

#### Device Advertising ID (IDFA)
- **Used?** YES
- **Purpose:** Firebase Analytics (anonymized)
- **Linked to Identity?** NO - Anonymized after 90 days
- **Shared with Third Parties?** NO - Used by Firebase only
- **User Control?** Yes - iOS Settings > Privacy > Tracking

#### Cookies and Similar Technologies
- **Used?** YES (session cookies only)
- **Purpose:** Maintain login sessions, store preferences
- **Linked to Identity?** Session-only; cleared on logout
- **Third-Party Cookies?** NO
- **User Control?** Yes - Can clear app cache in Settings

#### Cross-App Tracking
- **Used?** NO
- **Purpose:** N/A
- **Note:** Campus Helper does not track users across other apps

#### Cross-Website Tracking
- **Used?** NO
- **Purpose:** N/A
- **Note:** Campus Helper does not track web browsing

#### Device Fingerprinting
- **Used?** NO
- **Purpose:** N/A
- **Note:** Device ID used for analytics only (not fingerprinting)

---

## 3. Data Linked to You (User-Identified Data)

### Overview

Campus Helper collects the following data that is linked to user identity:

| Category | Linked to You | Purpose |
|----------|--------------|---------|
| Contact Info | YES | Account creation, communication |
| Financial Info | YES | Payment processing |
| Location | YES | Navigation, service finding |
| Sensitive Info | NO | Not collected |
| Health & Fitness | NO | Not collected |
| Search & Browse History | NO | Anonymized |
| Usage Data | NO | Anonymized analytics |

### Detailed User-Identified Data

#### Contact Information

**Name**
- **Linked to You?** YES
- **Purpose:** Account profile, display in study groups
- **Shared?** NO (except payment processor if payment made)
- **Retention:** Until account deletion
- **User Control:** Can edit or delete in Settings > Profile

**Email Address**
- **Linked to You?** YES
- **Purpose:** Account verification, communication, password recovery
- **Shared?** NO
- **Retention:** Until account deletion
- **User Control:** Can update in Settings > Account

**Phone Number**
- **Linked to You?** YES (if provided)
- **Purpose:** Two-factor authentication (optional)
- **Shared?** NO
- **Retention:** Until account deletion or removed
- **User Control:** Optional; can remove in Settings > Security

**Postal Address**
- **Linked to You?** YES (if payment made)
- **Purpose:** Billing address for invoices
- **Shared?** NO (except payment processor)
- **Retention:** 7 years (tax requirement)
- **User Control:** Required for billing; can use PO box

**Email Address (from SSO)**
- **Linked to You?** YES
- **Purpose:** School identity verification
- **Shared?** YES (to school SSO provider only)
- **Retention:** Until SSO unlinked
- **User Control:** Can unlink SSO in Settings > Account

#### Financial Information

**Payment Information**
- **Linked to You?** YES
- **Purpose:** In-app purchases, service payments
- **Shared?** YES (payment processors only: Stripe, TapPay, LINE Pay)
- **Card Data Stored?** NO - Only tokens stored
- **Retention:** 7 years (transaction history)
- **User Control:** Can remove payment method anytime

**Transaction History**
- **Linked to You?** YES
- **Purpose:** Billing records, refunds, disputes
- **Shared?** NO (except payment processors)
- **Retention:** 7 years (tax requirement)
- **User Control:** Can export in Settings > Privacy

**Billing Address**
- **Linked to You?** YES
- **Purpose:** Invoice generation
- **Shared?** NO (except payment processors)
- **Retention:** 7 years (tax requirement)
- **User Control:** Can edit if needed

#### Location Data

**GPS Coordinates**
- **Linked to You?** YES
- **Purpose:** Campus navigation, facility location
- **Shared?** NO
- **Retention:** 30 days (then deleted)
- **User Control:** Can disable completely in Settings > Privacy > Location

**Approximate Location (IP-based)**
- **Linked to You?** NO
- **Purpose:** Region detection, compliance
- **Shared?** NO
- **Retention:** Session only
- **User Control:** Cannot be disabled (used for legal compliance)

**Location History**
- **Linked to You?** YES
- **Purpose:** Generate "on campus" status
- **Shared?** NO
- **Retention:** Configurable (7, 30 days, or manual)
- **User Control:** Can delete manually in Settings > Privacy > Location

#### User IDs

**Account ID**
- **Linked to You?** YES
- **Purpose:** Internal user identification
- **Shared?** NO
- **Retention:** Until account deletion
- **User Control:** N/A (auto-generated)

**Student ID / Employee ID**
- **Linked to You?** YES
- **Purpose:** School identity verification via SSO
- **Shared?** YES (to school SSO only)
- **Retention:** Until account deletion
- **User Control:** Can unlink from SSO

**Device ID**
- **Linked to You?** NO (after 90 days)
- **Purpose:** Identify unique devices
- **Shared?** NO
- **Retention:** 90 days linked; then anonymized
- **User Control:** Can reset in iOS Settings > Privacy > Advertising

---

## 4. Data Not Linked to You (Anonymized Data)

### Overview

Campus Helper collects and uses the following data that is anonymized or pseudonymized:

| Data Type | Linked to Identity | Purpose | Retention |
|-----------|-------------------|---------|-----------|
| Search Queries (anonymized) | NO | Trending topics, recommendations | 90 days |
| Page View History | NO | Feature usage analysis | 90 days |
| App Performance Data | NO | Crash analysis, optimization | 30 days |
| Device Info | NO | Compatibility, optimization | Session |
| OS Version | NO | Compatibility testing | Session |
| App Usage Patterns | NO | Feature prioritization | 90 days |
| Aggregated Statistics | NO | Analytics, reports | Indefinite |

### Detailed Anonymized Data

#### Usage and Analytics Data

**Feature Usage**
- **Linked to You?** NO (anonymized after 90 days)
- **Purpose:** Understand which features are valuable
- **Data Collected?** YES (via Firebase Analytics)
- **Shared?** NO (retained by Firebase/Google)
- **Retention:** 90 days detailed; longer for aggregated stats
- **User Control:** Can disable in Settings > Privacy > Analytics

**Page View Statistics**
- **Linked to You?** NO
- **Purpose:** Understand user journey
- **Data Collected?** YES
- **Shared?** NO
- **Retention:** 90 days; aggregated indefinitely
- **User Control:** Can disable analytics

**App Performance Metrics**
- **Linked to You?** NO
- **Purpose:** Monitor app health
- **Data Collected?** YES (Firebase Performance)
- **Shared?** NO
- **Retention:** 30 days
- **User Control:** Cannot be disabled (critical for reliability)

#### Crash and Error Data

**Crash Reports**
- **Linked to You?** NO (anonymized)
- **Purpose:** Fix crashes and bugs
- **Data Collected?** YES (Firebase Crashlytics)
- **Shared?** NO
- **Retention:** 30 days
- **User Control:** Can disable in Settings > Privacy > Crash Reporting

**Error Logs**
- **Linked to You?** NO
- **Purpose:** Debug issues
- **Data Collected?** YES
- **Shared?** NO
- **Retention:** 14 days
- **User Control:** Can disable analytics

#### Device and System Data

**Device Model**
- **Linked to You?** NO
- **Purpose:** Optimize for different devices
- **Data Collected?** YES
- **Shared?** NO
- **Retention:** Session only
- **User Control:** N/A (necessary for app function)

**Operating System Version**
- **Linked to You?** NO
- **Purpose:** Feature compatibility
- **Data Collected?** YES
- **Shared?** NO
- **Retention:** Session only
- **User Control:** N/A

**Screen Resolution**
- **Linked to You?** NO
- **Purpose:** Optimize layout
- **Data Collected?** YES
- **Shared?** NO
- **Retention:** Session only
- **User Control:** N/A

**Memory and Storage Info**
- **Linked to You?** NO
- **Purpose:** App optimization
- **Data Collected?** YES
- **Shared?** NO
- **Retention:** Session only
- **User Control:** N/A

#### Network Data

**Connection Type**
- **Linked to You?** NO
- **Purpose:** Optimize performance
- **Data Collected?** YES
- **Shared?** NO
- **Retention:** Session only
- **User Control:** N/A

**IP Address**
- **Linked to You?** NO (after 30 days)
- **Purpose:** Region detection, DDoS prevention
- **Data Collected?** YES
- **Shared?** NO
- **Retention:** 30 days; then deleted
- **User Control:** N/A

---

## 5. Data Categories by Apple Standards

### 5.1 Contact Info Category

**Data Collected:**
- ✓ Name (linked to you)
- ✓ Email Address (linked to you)
- ✓ Phone Number (optional, linked to you)
- ✓ Postal Address (for billing, linked to you)
- ✗ Social Media Account
- ✗ Other User Contact Info (does not auto-collect contacts)

**Linked to You?** YES
**Used for Tracking?** NO
**Sharing?** NO (except payment processors for billing)

### 5.2 Health & Fitness Category

**Data Collected:**
- ✗ Health Records
- ✗ Fitness Data
- ✗ Health Conditions
- ✗ Health and Medical Records

**Linked to You?** N/A
**Used for Tracking?** N/A
**Sharing?** N/A

**Note:** Campus Helper is NOT a health app. Does not collect or use health/fitness data.

### 5.3 Financial Info Category

**Data Collected:**
- ✓ Payment Information (tokens only, not card numbers)
- ✓ Purchase History (transaction records)
- ✓ Billing Address (for invoices)
- ✓ Financial Account Information (for some payment methods)
- ✗ Credit Scores
- ✗ Financial Records

**Linked to You?** YES (for purchases only)
**Used for Tracking?** NO
**Sharing?** YES (payment processors: Stripe, TapPay, LINE Pay)

### 5.4 Location Category

**Data Collected:**
- ✓ GPS Coordinates (precise location)
- ✓ Approximate Location (via IP or cell tower)
- ✓ Location History (optional, user-controlled)
- ✗ Coarse Location (not used independently)

**Linked to You?** YES (GPS); NO (approximate)
**Used for Tracking?** NO (location is NOT used to track user across apps)
**Sharing?** NO

### 5.5 Sensitive Info Category

**Data Collected:**
- ✗ Race or Ethnicity
- ✗ Religious or Philosophical Beliefs
- ✗ Sexual Orientation or Gender Identity
- ✗ Trade Union Membership
- ✗ Sexual Activity or Pregnancy
- ✗ Genetic Information
- ✗ Biometric Data (face recognition on-device only, not stored)
- ✗ Government ID (not collected)

**Linked to You?** N/A
**Used for Tracking?** N/A
**Sharing?** N/A

**Note:** Campus Helper does not collect or use sensitive data.

### 5.6 Search & Browse History Category

**Data Collected:**
- ✓ In-App Search Queries (anonymized)
- ✓ In-App Browse History (anonymized)
- ✗ Web Search History
- ✗ Web Browser History

**Linked to You?** NO (anonymized)
**Used for Tracking?** NO
**Sharing?** NO

### 5.7 User ID Category

**Data Collected:**
- ✓ User ID (linked to account)
- ✓ Device ID (anonymized after 90 days)
- ✓ Student/Employee ID (from SSO)
- ✗ Customer ID (not applicable)
- ✗ Advertising ID (IDFA, used for analytics not tracking)

**Linked to You?** PARTIALLY (User ID yes, Device ID no after 90 days)
**Used for Tracking?** NO
**Sharing?** NO (except SSO ID to school SSO)

### 5.8 Purchase History Category

**Data Collected:**
- ✓ Purchase History
- ✓ Transaction Records
- ✗ In-App Purchase History

**Linked to You?** YES
**Used for Tracking?** NO
**Sharing?** NO (except payment processors)

### 5.9 Product Interaction Category

**Data Collected:**
- ✓ Feature Usage (anonymized)
- ✓ Click History (anonymized)
- ✓ Page View History (anonymized)
- ✓ Interaction Duration (anonymized)
- ✗ Event History (not tracked individually)

**Linked to You?** NO (anonymized)
**Used for Tracking?** NO
**Sharing?** NO

### 5.10 App Activity Category

**Data Collected:**
- ✓ App Launches (anonymized)
- ✓ App Crashes (anonymized)
- ✓ App Performance (anonymized)
- ✓ App Errors (anonymized)
- ✗ Feature Usage (categorized above)

**Linked to You?** NO (anonymized)
**Used for Tracking?** NO
**Sharing?** NO

### 5.11 Device ID Category

**Data Collected:**
- ✓ Device ID (IDFA/AAID, anonymized after 90 days)
- ✓ Device Model
- ✓ Operating System
- ✗ Device IP Address (used but not stored permanently)
- ✗ SIM Card ID (not collected)

**Linked to You?** NO (anonymized)
**Used for Tracking?** NO
**Sharing?** NO

### 5.12 Other Data Categories

**Coarse Location**
- **Collected?** YES (IP-based region detection)
- **Linked to You?** NO
- **Purpose:** Compliance, language/region settings
- **Retention:** Session only

**Photos or Videos**
- **Collected?** YES (user-uploaded only)
- **Linked to You?** YES (visible in user's posts)
- **Purpose:** User profile, campus activity sharing
- **Sharing?** YES (visible to users per privacy settings)

**Audio**
- **Collected?** NO (not currently)
- **Purpose:** N/A
- **Note:** Future voice assistant feature may collect audio

**Calendar and Contacts**
- **Collected?** NO (app cannot access without explicit permission)
- **Purpose:** N/A (if enabled, used locally only)

**Calendar Data**
- **Collected?** NO (app can write to calendar, not read)
- **Linked to You?** N/A
- **Purpose:** Allow syncing of course schedule to device calendar
- **Sharing?** NO (stored on device only)

---

## 6. Summary Table for App Store Display

### Quick Reference

| Privacy Aspect | Status | Details |
|---|---|---|
| **Tracking** | Limited | IDFA used for analytics only (not cross-app tracking) |
| **User Identity** | Linked | Name, email, contact info linked to account |
| **Financial** | Linked | Payment info linked; stored securely with processors |
| **Location** | Linked | GPS location linked to account; anonymized after 30 days |
| **Health** | Not Collected | Campus Helper is not a health app |
| **Sensitive Info** | Not Collected | Does not collect race, religion, orientation, etc. |
| **Browsing** | Anonymized | In-app search/browse anonymized |
| **Data Sold?** | NO | Data never sold to advertisers or brokers |
| **Data Shared?** | Limited | Only with necessary service providers |
| **User Control** | Comprehensive | Extensive privacy settings in app |

---

## 7. Privacy Practices Overview

### 7.1 Data Security

**Encryption Standards:**
- TLS 1.3 for data in transit
- AES-256 for sensitive data at rest
- bcrypt for password hashing

**Security Features:**
- Firebase security infrastructure
- Google Cloud encryption
- DDoS protection
- Regular security audits

### 7.2 User Privacy Controls

**Available in Settings:**
- Location toggle (On/Off)
- Analytics opt-out
- Crash reporting opt-out
- AI history disable
- Notification preferences
- Social privacy settings
- Data export
- Account deletion

### 7.3 Compliance

**Standards Adhered To:**
- GDPR (EU/UK/Swiss users)
- Taiwan Personal Data Protection Act
- COPPA (for under-13 protections)
- Apple App Privacy Details requirements

---

## 8. Data Practices Changes

### 8.1 Future Data Collection

**Potential Future Features:**
- Voice input for AI assistant (audio may be collected)
- Fitness tracking integration (health data)
- Enhanced analytics (user research features)

**Notice:** Any new data collection will:
- Require user explicit consent
- Be documented in app privacy settings
- Trigger App Store privacy label update
- Include opt-in, not opt-out

### 8.2 Privacy Label Updates

This document reflects the current version of Campus Helper. As the app evolves:
- Major feature additions will be documented
- Users will be notified of changes
- App privacy labels will be updated
- Previous privacy practices documented

---

## 9. Contact & Support

### 9.1 Privacy Questions

**Email:** privacy@campushelper.app
**In-App:** Settings > Help > Privacy Concerns
**Response Time:** 7-14 business days

### 9.2 Apple Privacy Contact

**App Store Privacy Contact:**
- Name: Campus Helper Privacy Team
- Email: privacy@campushelper.app
- Role: Responsible for data practices

---

## 10. Verification and Accuracy

**Certification:**
This privacy information has been prepared in accordance with Apple's App Store guidelines and accurately reflects the application's actual data practices.

**Last Verified:** 2026-03-20
**Next Verification:** 2026-09-20 (or upon major changes)

**Signature:**
Campus Helper Development Team

---

## Appendix: Mapping to App Store Fields

### App Privacy Details - Required Fields

#### Data Linked to You
- [x] Contact Information
- [ ] Health & Fitness
- [x] Financial Information
- [x] Location
- [ ] Sensitive Information
- [x] Search & Browse History
- [x] User ID
- [x] Purchase History
- [x] Product Interaction
- [x] App Activity
- [x] Device ID
- [ ] Other Data

**Details for Each:**
- **Contact Information:** Name, Email, Phone (optional), Address (for billing)
- **Financial Information:** Payment method (tokens), transaction history
- **Location:** GPS coordinates, location history
- **Search & Browse History:** In-app search queries (anonymized)
- **User ID:** Account ID, Student/Employee ID
- **Purchase History:** Transaction records
- **Product Interaction:** Feature usage statistics
- **App Activity:** Crashes, errors, performance
- **Device ID:** IDFA, device model, OS version

#### Data Not Linked to You
- [x] Contact Information (emails invited to events)
- [ ] Health & Fitness
- [ ] Financial Information
- [x] Location (approximate via IP)
- [ ] Sensitive Information
- [x] Search & Browse History (in-app, anonymized)
- [x] User ID (device ID anonymized after 90 days)
- [ ] Purchase History
- [x] Product Interaction (anonymized)
- [x] App Activity (anonymized)
- [ ] Device ID
- [ ] Other Data

#### Data Used to Track You
- [x] IDFA (anonymized)
- [ ] Other Cross-App Tracking
- [ ] Cross-Website Tracking
- [ ] Fingerprinting

**Details:**
- IDFA: Used for Firebase Analytics (anonymized after 90 days)
- No cross-app or cross-website tracking
- No device fingerprinting

#### Privacy Practices
- [x] Data is encrypted in transit
- [x] Users can request deletion
- [x] Users can download their data
- [x] Provide data privacy and security practices URL
- [ ] Requires biometric or sign-in
- [ ] Users can opt out of tracking
- [x] App has a privacy policy

---

**Document Version:** 1.0
**Format:** Apple App Privacy Details
**Language:** English (primary), Traditional Chinese (secondary)
**Applicable:** iOS version of Campus Helper only

For the most current information, users should refer to:
- In-app Privacy Settings
- Full Privacy Policy: docs/legal/privacy-policy.md
- App Store Privacy Details (official source)
