# App Store Review Notes

## Campus Helper (校園助手)
**For: Apple App Review and Google Play Console**

---

## 1. Overview

Campus Helper is a comprehensive campus information and services platform designed exclusively for university students and staff in Taiwan. The app provides course management, campus navigation, campus services booking, and AI-powered campus assistance.

**Target Users:** University students and staff (18+ years old)

**Supported Platforms:**
- iOS 14.5+
- Android 10.0+

**Languages:** Traditional Chinese (主要), English (secondary)

**Regions:** Taiwan, with potential expansion to Asia-Pacific

---

## 2. App Functionality Summary

### Core Features

**2.1 Campus Services**
- Campus maps and navigation
- Course schedules and academic management
- Classroom finder with real-time availability
- Campus event discovery and registration
- Campus news and announcements
- Multi-campus support (users can switch between affiliated universities)

**2.2 Academic Tools**
- Timetable management with sync to device calendar
- Grade tracking and notifications
- Assignment and exam calendar
- Study group coordination
- Library resource reservation

**2.3 Campus Life**
- Dormitory maintenance requests
- Dining hall menus and reviews
- Campus activity recommendations
- Social networking features (school-only)
- Student clubs and organizations directory

**2.4 Smart Features**
- AI assistant for campus-related queries (powered by Google Gemini API)
- Location-based campus service recommendations
- Push notifications for important updates
- Personalized course reminders

**2.5 Payment Integration**
- Campus service payments (utility bills, meal plans)
- Event ticket purchases
- Service booking deposits
- Supported providers: Stripe, TapPay, Line Pay

### Permissions Justification

See Section 3 for detailed permission usage explanations.

---

## 3. Permission Usage and Justification

### 3.1 Location Permissions

**Permissions Required:**
- `ACCESS_FINE_LOCATION` (Android)
- `NSLocationWhenInUseUsageDescription` (iOS)
- `NSLocationAlwaysAndWhenInUseUsageDescription` (iOS) - *for optional background location tracking*

**Usage:**
1. **Campus Map Navigation**
   - Shows user's current position on campus map
   - Helps locate nearest campus facilities
   - Provides turn-by-turn directions to classrooms, libraries, etc.

2. **Campus Service Locator**
   - Finds nearest dining halls, restrooms, ATMs, parking
   - Shows real-time availability of services
   - Estimates walking time to facilities

3. **Location-Based Reminders**
   - Reminds user when approaching classroom location
   - Notifies when arriving at campus
   - Suggests relevant events based on location

4. **Optional Background Location Tracking**
   - Allows "I'm on campus" status inference
   - Enables automatic clock-in for campus activities
   - Used for campus analytics (completely anonymized)
   - **User can disable in Settings > Privacy > Location Services**

**Privacy Protection:**
- Location data is not shared with third parties
- Location history is encrypted and stored locally when possible
- Location data is deleted after 30 days
- GPS location is converted to campus zone (not precise coordinates)
- Users can disable location completely - app remains fully functional

**Why Location is Necessary:**
Campus Helper's core functionality (navigation, finding services, classroom location) requires accurate location. Without location services, the app cannot provide essential features.

---

### 3.2 Camera Permissions

**Permissions Required:**
- `CAMERA` (Android)
- `NSCameraUsageDescription` (iOS)

**Usage:**
1. **QR Code Scanning**
   - Scans campus service QR codes (exam schedules, facility booking info)
   - Scans event registration codes
   - Scans NFC tags for classroom location verification
   - Uses: ZXing library (open source)

2. **Meeting Check-In**
   - Scans QR codes for class attendance verification
   - Used during lectures and campus events
   - Optional - traditional manual check-in also available

3. **Profile Avatar Upload**
   - Take selfie or photo for profile picture
   - Alternative: import from Photo Library

4. **Optional ID Verification**
   - Face recognition for secure account access (beta feature)
   - Completely optional - password login available
   - No biometric data stored - only verification success/failure recorded

**Privacy Protection:**
- Camera feed is never recorded or stored
- Captured photos are not automatically uploaded
- User explicitly chooses what to upload
- Camera frames are processed locally (not sent to cloud)
- Face recognition (if enabled) uses on-device processing, no server-side storage

**Why Camera is Necessary:**
QR code scanning is essential for campus services (event registration, facility booking). Face verification is optional and provides enhanced security.

---

### 3.3 Photo Library Permissions

**Permissions Required:**
- `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` (Android)
- `NSPhotoLibraryUsageDescription` (iOS)
- `NSPhotoLibraryAddOnlyUsageDescription` (iOS) - *for saving shared photos*

**Usage:**
1. **Profile Avatar Selection**
   - Select existing photos from library for profile picture
   - Crop and edit before uploading

2. **Campus Activity Photos**
   - Share photos from campus events to app feed
   - Upload evidence for campus service requests
   - Attach images to campus activity posts

3. **Document Attachments**
   - Attach supporting documents for maintenance requests
   - Include photos with activity reports
   - Add images to discussion posts

**Privacy Protection:**
- Photos are not automatically uploaded
- Users choose which photos to share
- Shared photos are only visible within app
- Photos are not used for any analytics or training
- Users can delete shared photos anytime

**Why Photo Library Access is Necessary:**
Sharing campus event photos and evidence images is core to community features. Users should have easy access to their photo library rather than required re-taking photos.

---

### 3.4 Microphone Permissions (if voice features added)

**Currently Not Used** but included for future voice-based campus assistant features.

If implemented:
- Voice input for AI assistant queries
- Transcription using Google Cloud Speech-to-Text
- Voice notes in study groups
- Voice-based event check-in

---

### 3.5 Contacts Permissions (Android only)

**Permissions Required:**
- `READ_CONTACTS` (Android)

**Usage:**
1. **Find Campus Friends**
   - Search campus directory to find classmates
   - Create study group with existing contacts

2. **Invite to Events**
   - Invite contacts to campus events
   - Bulk invite to study groups

**Privacy Protection:**
- Contacts are never uploaded or backed up
- Contact list is only used locally on device
- Contact information is not shared with servers
- Users can deny permission - app remains functional

---

### 3.6 Calendar Permissions

**Permissions Required:**
- `READ_CALENDAR`, `WRITE_CALENDAR` (Android)
- `EKCalendarWriteOnly` (iOS)

**Usage:**
- Sync campus schedule to device calendar
- Add important campus events to calendar
- Create reminders for classes and deadlines

**Privacy Protection:**
- Only reads/writes to app-created calendar events
- Does not access other calendar entries
- Calendar sync is completely optional
- Users can revoke permission anytime

---

### 3.7 Storage Permissions

**Permissions Required:**
- `MANAGE_EXTERNAL_STORAGE` (Android 11+)

**Usage:**
- Cache campus maps for offline usage
- Store downloaded course materials
- Temporary storage for photo uploads

**Privacy Protection:**
- Files are encrypted when sensitive
- Cached data is automatically deleted after 30 days
- Users can manually clear storage in app settings

---

## 4. School SSO (Single Sign-On) Integration

### 4.1 SSO Systems Supported

Campus Helper integrates with institutional authentication systems:

**Supported Methods:**
- LDAP / Active Directory (most common in Taiwan)
- OAuth 2.0 (newer institutions)
- SAML 2.0 (enterprise institutions)
- Unified campus authentication portals

**No Password Stored:**
- Campus Helper never stores or transmits user SSO passwords
- Only uses short-lived authentication tokens (typically 1 hour)
- Tokens are encrypted and stored securely

### 4.2 For App Store Review

**How to Test Without School Account:**

1. **Mock Mode (Development Version)**
   - Launch app and select "Test Campus" on login screen
   - Use test credentials:
     - Student ID: `TEST0001`
     - Password: `password123`
   - Or skip SSO and create local test account

2. **Demo Account (Production Build)**
   - Email: `demo@campushelper.app`
   - Password: `DemoPassword2026!`
   - Provides access to all features with simulated campus data

3. **SSO Bypass for Review**
   - App detects App Store review environment
   - Automatically enters mock mode with pre-loaded test data
   - Does not require SSO credentials

### 4.3 SSO Data Handling

**What is Collected via SSO:**
- Student/Employee ID (from institution directory)
- Full name
- School email address
- Department/Faculty affiliation
- Authentication status only

**What is NOT Collected:**
- SSO passwords (we never see or store them)
- Authentication credentials
- Any additional personal data beyond identity

**Data Usage:**
- Identity verification only
- Account creation and linking
- Personalization (showing relevant campus)
- Security and fraud prevention

**Data Sharing:**
- SSO information is NOT shared with third parties
- Not used for marketing or analytics
- Only used within Campus Helper

**Privacy & Security:**
- Complies with GDPR and Taiwan PDPA
- All SSO communications use encrypted HTTPS
- SSO data is stored in encrypted database
- Users can link to local account and disconnect SSO

---

## 5. Testing Without School Account

### 5.1 Demo Account (Recommended for Review)

Reviewers can immediately access full app functionality without SSO:

```
Email: demo@campushelper.app
Password: DemoPassword2026!
```

**Demo Account Includes:**
- ✓ All campus features (maps, events, courses)
- ✓ Simulated campus data
- ✓ AI assistant (with rate limiting)
- ✓ All payment features
- ✓ Notification system
- ✓ Social features
- ✗ Real campus data (uses sample data instead)
- ✗ Real SSO integration (not required)

**Demo Data Available:**
- Campus: "Demo University (示範大學)"
- Courses: 5 sample courses
- Events: Upcoming demo events
- Facilities: Sample campus facilities
- Users: Simulated classmates for social testing

### 5.2 Creating Local Test Account

Users (and reviewers) can also create account locally:

1. Select "Sign Up" instead of "Sign In"
2. Enter email and password (no SSO required)
3. Verify email address
4. Account is created without school affiliation
5. Access basic features (limited to non-campus-specific data)

### 5.3 App Store / Play Store Sandbox Environments

App automatically detects sandbox environment:

**Sandbox Detection:**
- iOS TestFlight: App enters reduced-feature mode
- Google Play Internal Testing: App enters demo mode
- App Store / Play Store Review: Auto-loads demo account

**TestFlight Testers:**
- Can use real SSO if their school is configured
- Or use demo account if school not configured
- Full feature access in both cases

---

## 6. Payment Feature Explanation

### 6.1 Payment Processing

Campus Helper supports in-app purchases and subscription services:

**Payment Methods:**
- Credit/Debit Card (Visa, Mastercard, AMEX)
- TapPay (Taiwan e-wallet, LINE Pay integration)
- LINE Pay
- Google Play Billing (Android)
- App Store In-App Purchase (iOS)

**Supported Payment Providers:**
- Stripe (international)
- TapPay (Taiwan local)
- LINE Pay

### 6.2 What is Purchased

**One-Time Purchases:**
- Campus event tickets
- Course materials
- Facility booking deposits
- Service request fees

**Subscription Services:**
- Premium features (optional)
- Enhanced AI assistant usage
- Ad-free experience
- Campus notifications priority

**In-App Currency:**
- Campus Points (optional)
- Can be purchased with real money
- Used for campus services, event registration, etc.

### 6.3 Payment Security

**Card Security:**
- PCI-DSS Level 1 compliant (Stripe certified)
- No credit card data is stored by Campus Helper
- Tokenization used - only token is stored locally
- End-to-end encryption for all transactions

**How Safe Are Payments:**
- Secure server communication (TLS 1.3)
- Token-based system (no full card numbers)
- Fraud detection and prevention
- Refund policies for disputes
- Compliance with payment provider security

### 6.4 Testing Payments

**For App Store Review:**

Use Apple's sandbox test cards:

```
Card Number: 4111 1111 1111 1111
Expiry: Any future date
CVV: Any 3 digits
```

**For Google Play Review:**

Use Google Play test methods:

- Google Play Billing Library handles sandbox
- Payments show as "pending" instead of charging
- No actual money charged
- Full workflow testable

**For TapPay / LINE Pay:**

Sandbox environments provided by payment providers:
- TapPay sandbox: https://sandbox.tappay.com
- LINE Pay sandbox: Available in LINE Business Center

### 6.5 Refund Process

**User Refunds:**
- 30-day money-back guarantee for one-time purchases
- Refunds processed through payment provider
- Support: billing@campushelper.app

**Dispute Resolution:**
- Payment disputes handled by Stripe/TapPay/LINE
- We comply with all chargeback requests
- Full refund documentation available

---

## 7. Push Notification Usage

### 7.1 Why Push Notifications Are Used

**Mandatory Notifications (cannot be disabled):**
- Security alerts (unusual account activity, login from new device)
- Payment confirmations and receipts
- Account verification codes
- Critical campus safety alerts

**Personalized Notifications (can be toggled individually):**
- Course reminders (class in 15 minutes)
- Grade notifications (grades posted)
- Campus event reminders
- Social notifications (friend requests, messages)

**Public Notifications (can be unsubscribed):**
- Campus news and announcements
- New event listings
- Campus service updates

### 7.2 Notification Frequency

**Daily Limit:** Maximum 10 notifications per day (configurable)
- Users can set quiet hours
- Can disable by notification type
- Can disable all except critical

**Quiet Hours:** Users can set no-notification periods
- Default: 21:00 - 08:00 (9 PM to 8 AM)
- Can be customized

### 7.3 Push Configuration for Review

**In Settings > Notifications:**
- Course Reminders (default: ON) → toggleable
- Campus News (default: ON) → toggleable
- Social Updates (default: OFF) → toggleable
- Payment Alerts (default: ON) → mandatory
- Security Alerts (default: ON) → mandatory

Demo account has realistic notification configuration for testing.

---

## 8. Background Modes and Justification

### 8.1 Background Modes Used (if any)

**Location Updates** (Optional background feature):
- Updates location cache for offline campus maps
- Allows "I'm on campus" status inference
- Background sync every 15 minutes when enabled

**Notification Delivery** (Required for push):
- Ensures notifications arrive even when app closed
- Uses system push notification framework

**Data Sync** (Optional):
- Syncs new messages and events when app backgrounded
- Helps app stay current

### 8.2 Justification for Review

All background modes have legitimate educational and convenience purposes:

1. **Location Caching:** Enables offline campus navigation
2. **Notifications:** Critical for time-sensitive campus updates
3. **Data Sync:** Ensures users don't miss important information

---

## 9. Demo Credentials for Reviewers

### 9.1 Primary Demo Account

```
Platform: All (iOS, Android, Web)
Email: demo@campushelper.app
Password: DemoPassword2026!
Campus: Demo University (示範大學)
User Role: Student
Feature Access: Full
Notes: All features enabled and testable
```

### 9.2 Optional: Admin Demo Account

```
Email: admin-demo@campushelper.app
Password: AdminDemo2026!
User Role: Campus Admin
Feature Access: Admin dashboard, analytics, user management
Notes: For testing admin features
```

### 9.3 Optional: Payment Testing

```
Payment Method: Apple Test Card (iOS) or Google Play Sandbox (Android)
Purchase Amount: $0.99 - $99.99 (all amounts testable)
Status: All transactions pending (not charged)
Refund: All test transactions reversible
```

---

## 10. Feature-Specific Review Notes

### 10.1 AI Assistant Feature

**How It Works:**
- Users input questions about campus, courses, events, services
- Queries sent to Google Gemini API (or similar LLM)
- Response cached and filtered for appropriateness
- AI trained on general knowledge + campus-specific context

**Data Handling:**
- User queries stored encrypted for 180 days
- Sensitive queries (containing personal IDs) encrypted and deleted after 90 days
- Privacy mode available: disable query logging
- Queries never used to train public AI models

**Safety Measures:**
- Content filtering for inappropriate responses
- Jailbreak prevention (cannot be manipulated)
- Rate limiting (20 queries per hour)
- Moderation of user feedback

**Why It's Trustworthy:**
- Uses established Google Gemini API
- No personal data in prompts
- Fully transparent data usage
- User can delete history anytime
- In-app privacy controls

### 10.2 Social Features

**What's Included:**
- Find classmates and friends
- Create study groups
- Share campus event experiences
- Post campus activity photos

**Privacy Controls:**
- Profile visibility settings (school-wide, study group only, private)
- Block/report users
- Post privacy (who can comment, share)
- Delete posts and data anytime

**Moderation:**
- Community guidelines enforced
- Automatic filtering of inappropriate content
- User reporting system
- Manual review of reported content

### 10.3 Multi-Campus Support

**How It Works:**
- Users can have accounts at multiple affiliated universities
- Quick campus switching in settings
- Different course schedules per campus
- Separate campus networks (can't see other campus's private groups)

**Data Separation:**
- All data is campus-segregated
- No cross-campus data leakage
- User controls which campuses are active

---

## 11. Age Restrictions and Parental Controls

### 11.1 Age Requirement

**Minimum Age:** 18 years old

**Why 18+:**
- Primary users are university students
- Complies with Taiwan law for app accounts
- College students are typically 18+
- Some features (payment) require legal age

**Younger Users (13-17):**
- Cannot create own account
- Can use family account with parental supervision
- Requires parental consent in app
- Limited to safe campus features only

**Under 13:**
- Cannot create account
- Not supported
- Full COPPA compliance if accessed

### 11.2 Parental Controls

**For Young Users (if accessible):**
- Parental override of privacy settings
- Monitoring of messaging (study group only)
- Screen time limits
- Notification controls

---

## 12. Accessibility Compliance

### 12.1 WCAG 2.1 Level AA Compliance

Campus Helper supports:
- VoiceOver (iOS) and TalkBack (Android)
- High contrast mode
- Dynamic type/font scaling
- Keyboard navigation
- Screen reader support

**Tested Features:**
- Campus maps (with accessible alt text)
- Course schedules (screen reader optimized)
- Event listings (proper heading hierarchy)
- Forms and inputs (proper labels)

---

## 13. Content Restrictions

### 13.1 Content Guidelines Compliance

**No Prohibited Content:**
- ✓ No gambling or casino games
- ✓ No adult content or erotica
- ✓ No tobacco or vaping promotion
- ✓ No excessive violence
- ✓ No illegal drug promotion
- ✓ No weapon sales
- ✓ No discriminatory content

**Content Moderation:**
- Automated filtering for inappropriate content
- User reporting system
- Manual review team
- Quick removal of violations (24 hours)

---

## 14. Data Privacy Declaration

### 14.1 Data Collection Summary

**Collected Data:**
- Account info (name, student ID, email)
- Location (campus zone, not precise GPS)
- Usage analytics (anonymized)
- Photos (if user chooses to share)
- Device info (OS version, device model)
- Crash reports (for debugging)

**NOT Collected:**
- ✗ Browsing history
- ✗ Health/medical data
- ✗ Financial information beyond payments
- ✗ Biometric data (face recognition is on-device only)
- ✗ Contact list (unless used to invite)

**Data Sharing:**
- Not shared with third parties (except payment providers for necessary processing)
- Not sold to advertisers
- Not used for targeted advertising
- Not shared with school (except if user explicitly chooses)

**User Controls:**
- Data export available (Settings > Privacy > Export)
- Account deletion available (Settings > Privacy > Delete Account)
- Per-feature privacy controls
- Location toggle
- Analytics opt-out
- AI history disable

---

## 15. Additional Resources

### 15.1 Documentation

- Full Privacy Policy: `docs/legal/privacy-policy.md`
- Terms of Service: `docs/legal/terms-of-service.md`
- Acceptable Use Policy: See Terms of Service, Section 4
- GDPR Compliance: Privacy Policy, Section 19
- Taiwan PDPA Compliance: Privacy Policy, Section 20

### 15.2 Contact Information

**For App Store Review Questions:**
- General Support: support@campushelper.app
- Privacy Concerns: privacy@campushelper.app
- Security Issues: security@campushelper.app
- Legal Questions: legal@campushelper.app

**Response Time:** 24-48 hours for review team inquiries

---

## 16. Review Checklist

Reviewers can use this checklist when reviewing Campus Helper:

### Core Functionality
- [ ] User can sign up and create account (with demo account)
- [ ] User can sign in and access all features
- [ ] Campus map displays and shows user location
- [ ] Course schedule loads and syncs to device calendar
- [ ] Course search and filtering works
- [ ] Event listing and details display correctly

### Permissions & Privacy
- [ ] Location permission request shows proper description
- [ ] Camera permission request shows proper description
- [ ] Photo library request shows proper description
- [ ] Users can deny permissions without breaking app
- [ ] Permission rationale is clear and honest

### Payments
- [ ] Payment flows work in sandbox mode
- [ ] Purchase confirmation displays
- [ ] Refund information available
- [ ] No charges in sandbox
- [ ] Payment methods display correctly

### Notifications
- [ ] Notifications deliver correctly
- [ ] Users can toggle notification types
- [ ] Notifications can be disabled
- [ ] Quiet hours respected

### Social Features
- [ ] User can view other student profiles (study groups only)
- [ ] User can report inappropriate content
- [ ] Blocking works properly
- [ ] No data leakage between users

### AI Assistant
- [ ] AI assistant responds to queries
- [ ] Inappropriate queries filtered
- [ ] Response quality reasonable
- [ ] User can disable AI feature
- [ ] AI history can be deleted

### Safety
- [ ] No exploitative content visible
- [ ] No spam or ads present
- [ ] Content filtering works
- [ ] Moderation system functional

### Age-Appropriate
- [ ] No inappropriate content for 18+ users
- [ ] Parental controls present (if applicable)
- [ ] No targeting of minors

---

## 17. Common Review Concerns and Responses

### Concern: "Why does the app need location permission?"
**Response:** Campus navigation, facility finding, and location-based reminders are core features. Users can disable location and still use most features (course schedule, events, AI assistant).

### Concern: "Why camera access?"
**Response:** QR code scanning is essential for campus services (event registration, facility booking). Users can disable camera permission and use alternative methods.

### Concern: "Is location tracking always on?"
**Response:** No. Location is only active when user explicitly opens map or enables location-based features. Background location is optional and can be disabled. Default is OFF.

### Concern: "Is my data shared with schools?"
**Response:** No. School data is not shared unless user explicitly chooses. School can only see anonymized aggregate statistics with explicit institutional opt-in.

### Concern: "Can young users access the app?"
**Response:** App is designed for 18+ (university students). Younger users (13-17) can use with parental consent. Under 13 cannot create account (COPPA compliant).

### Concern: "Is this a dating app?"
**Response:** No. Social features are limited to study groups, classmate directory, and campus events. No dating/matching algorithms. School-only network.

### Concern: "What happens to my data if I delete account?"
**Response:** All personal data deleted within 30 days (after 30-day review period). Anonymized analytics retained. Payment records retained for 7 years (tax law requirement).

---

## 18. Version Information

**Version:** 1.0.0
**Release Date:** 2026-03-20
**Supported Languages:** Traditional Chinese (zh-TW), English (en)
**Supported Regions:** Taiwan, Asia-Pacific (pending)

---

**Last Updated:** 2026-03-20

For any additional questions or clarifications, contact: **support@campushelper.app**
