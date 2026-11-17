# BioBling security review — 2026-11-17

This is the historical containment report, not the current release state. See [RELEASE.md](RELEASE.md) for the Google Authentication and free Cloudflare grading migration completed afterward.

## Confirmed in Firebase Console

- Realtime Database root grants `.read: true` and `.write: true`.
- Active Firestore rules grant `allow read, write: if true` recursively.
- These rules expose legacy account records, exams, and submissions to unauthenticated clients. No exploitation or data exfiltration test was performed.

## Containment status

The owner explicitly authorized immediate maintenance and denial of all client database access. Firestore deny-all Rules were published and the new starred active version was verified in Firebase Console. Realtime Database deny-all Rules have now also been published and verified: the Console displayed both root permissions as false, removed the unpublished changes controls and reported "Default security rules are locked from access".

`database.lockdown.rules.json` and `firestore.lockdown.rules` deny all client requests. They do not delete data or remove owner access through Firebase Console/IAM. Existing website login, course loading, exams, submission and administration are interrupted until a compatible backend is deployed.

The maintenance page is a temporary frontend, not database security. The full application is preserved locally in `index.html` and in GitHub commit `b26228a71d9fd23e3919cf9fb92ae347474c5a36`. Do not restore public database Rules to reopen the application.

Firebase CLI 15.36.0 was installed successfully using a dedicated npm cache outside the repository. `login:list` reported no authorized accounts; an owner-controlled sign-in flow is open. The project was observed on Spark. Server-side grading through Cloud Functions requires a billing/backend decision before deployment. No billing plan changes have been made.

## Required migration before reopening

1. Back up database contents in a private, access-controlled location; never commit account exports to GitHub.
2. Enable a Firebase Authentication provider and map each existing account to a stable UID through a trusted migration process. Reset exposed legacy passwords; removing them from the latest source does not erase Git history or past exposure.
3. Separate private account data from class-member profiles. Remove browser reads/writes of the full `/users` array. Only a trusted admin service may assign roles, approve accounts or change class membership.
4. Separate exam metadata/question identifiers from answer keys. Keep keys server-only. Authorize each attempt against class membership, deadline and server-issued timing; grade on the server and make accepted submissions immutable to students.
5. Scope live sessions, drafts and results to their authenticated owner; grant teacher access explicitly. Bind sender identity of mentor messages to authenticated admins.
6. Test Firebase Rules with unauthenticated, pending, student in another class, approved student, teacher and administrator identities. Verify direct API denial, not only hidden UI controls.
7. Deploy compatible frontend, backend and least-privilege Rules as one coordinated release; verify login, account approval, class access, submission, review, and teacher administration before ending maintenance.

Client-side checks already added are defense in depth only. No claim of completed security or safe production access is made.
