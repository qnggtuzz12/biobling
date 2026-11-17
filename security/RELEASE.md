# BioBling security migration — 2026-11-18

## Architecture

- Google Firebase Authentication identifies each user. The Worker verifies JWT signature, issuer, audience, provider, verified email and expiration.
- Both Firebase client databases remain deny-all. The authenticated Cloudflare API enforces class membership, account status and role for all operations.
- A dedicated service account, explicitly approved by the owner with Database Admin only in BioBling, is stored in Cloudflare Secrets. It is never included in the website or GitHub.
- `/secure` contains migrated accounts, catalogs, exams and history. Legacy data remains preserved. Passwords and device sessions are excluded from the new accounts.
- Students receive question identifiers/counts, never master keys or raw key text. Teachers can read keys. Linked Google Docs must themselves exclude answer sheets; Firebase does not control third-party sharing.
- Each attempt records authenticated UID, server timestamps and an immutable exam version. The server grades answers. Retries return the original result. Late submissions grade only the last draft received before the deadline.
- The previous scoring formula is preserved: standard 18/4/6 exams total 10; custom structures keep their weighting. Practice mode has correctness counts without a numeric score.
- Key edits affect new attempts. Old attempts and historical results retain their original answer versions; only teachers can read those keys.
- New Google accounts remain pending. Teachers approve or explicitly link a verified student to a legacy profile; only the owner can grant teacher privileges or link a legacy teacher.
- Catalog writes use conditional updates. Requests are limited to 400 KB and throttled by authenticated UID.
- Vercel builds only a list of public website files. Private backups, service credentials and local tools are excluded.

## Verification

- 14 server tests cover forged JWTs, privilege escalation, cross-class access, private keys, foreign submissions, malformed answers, expired attempts, idempotence, exam version snapshots, Firebase numeric-map conversion, CORS and JSON validation.
- Frontend syntax, URL validation, UID matching, fail-closed confirmation and question-map status tests pass.
- Service-account access verified; all 19 migrated exams pass validation.
- Owner browser login verified on the Vercel preview. A three-part QA attempt graded immediately: 1/1 MCQ, 4/4 TF, 1/1 short answer, 2.25 points as expected. Navigator statuses, partial TF, incomplete filter and question navigation verified. QA exam archived; test submission retained under its own exam code.

## Operations

Website: https://biobling.vercel.app/

Use **Đăng nhập → Tiếp tục với Google**. Legacy passwords no longer sign into BioBling. Existing students sign in once, then a teacher confirms identity and chooses **Liên kết hồ sơ cũ** in account approvals. This preserves class membership and submission history. New students are approved and assigned to a class. Teachers use their own Google accounts; the owner grants their role.

The Worker switch `RELEASE_ENABLED=false` limits API access to the owner during maintenance. Never restore permissive Firebase Rules. `security/maintenance.html` is the optional maintenance frontend. Do not rerun provisioning against live `/secure` data.

Firebase Spark and Workers Free have quotas; exceeding them can interrupt service. Submission errors preserve local drafts. No paid Functions, KV, D1 or billing upgrade was added. This is a focused migration, not a guarantee against every vulnerability or cheating method. Inline handlers remain, so CSP permits inline script. Account suspension is checked from application records; Firebase ID tokens retain their normal validity window.

Run `node --test server/test/*.test.mjs`, `node security-check.cjs`, `node check-navigator.cjs`, and `node build-site.cjs` after changes. Review login, class access, exams and submissions before reopening.

Sources: [Firebase REST authentication](https://firebase.google.com/docs/database/rest/auth), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
