# Firebase Data Boundaries

## Canonical architecture

- Firebase Auth is the long-term identity layer for both email/password and school SSO.
- Firestore is the canonical store only for app-native and realtime data.
- School-managed records should move behind adapters or backend APIs; Firestore may keep cached or projected copies when useful.

## Firestore canonical domains

- User profile and membership metadata
- Notifications and push-token state
- Groups, group members, posts, comments, chat, and other app collaboration data
- Reviews, reports, engagement state, achievements, preferences, and offline sync state
- Calendar and similar app-generated artifacts

## Adapter or backend canonical domains

- Grades, transcripts, attendance, course registration, and other academic system records
- Library circulation, dormitory operations, health, payments, and other institutional systems
- Any workflow that depends on sensitive business validation should be finalized in backend code, not in client-side Firestore writes

## Runtime modes

- `mock`: local UI and isolated frontend development
- `firebase`: demo, emulator, and Firebase integration verification
- `hybrid`: target runtime for real-school integrations, with app-native domains still backed by Firebase

## Guardrails

- Screens should not talk to Firestore directly. Use `DataSource` or feature repositories instead.
- Security Rules are for access control. Business validation for sensitive actions belongs in Functions or backend APIs.
