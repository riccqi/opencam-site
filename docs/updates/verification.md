# Verification and launch status

Updated 2026-10-13. Resend replaces the original SES plan; no AWS setup is required.

## Automated checks

23 JavaScript tests plus the Python import test pass, including real workerd/D1 integration. GitHub CI run 38467948467
passed, as did the Astro build and Worker bundle. Tests cover double opt-in,
expiry/reuse/forgery, scanner-safe GET, RFC 8058 POST, resubscribe, Turnstile and
rate limits, admin authentication, public App Store version gating, immutable
campaigns, duplicate launches, queued unsubscribe, postal-address gating,
quota/retry/ambiguous recovery, encrypted payloads, CSV escaping, signed Resend
callbacks, cross-app isolation and idempotent sending.

## Production infrastructure and tests

- Worker `opencam-updates`: https://updates-api.opencam.app. Version
  `6f01f8a9-5775-4b8b-bff0-29e41d933e01`; D1 migrations 0001 and 0002 applied.
- Resend team `xiaochean`: owner upgraded Transactional to Pro, $20/month,
  50,000 shared emails. OpenCam has a separate domain-restricted sending key and
  webhook `bdb1d6a3-8c03-4f6b-8d3a-892104798a1d`. TabTab was not changed.
- OpenCam domain verified. Sending DKIM/CNAMEs and monitoring DMARC published;
  existing website and incoming-mail DNS preserved. All seven secrets are in
  Worker secret storage; private local recovery file is gitignored, mode 0600.
- Real Turnstile signup at https://opencam.app/updates/?source=app returned generic
  success, stored source=app, and queued an encrypted confirmation. Gmail received
  the confirmation. GET left the subscriber pending; POST confirmed it. Reusing
  the token did not reconfirm. Unsubscribe GET left it subscribed; POST unsubscribed.
- Resubscribe returned generic success and remained unsubscribed pending fresh
  confirmation. The fresh emailed token successfully resubscribed the address.
  RFC 8058 one-click POST then unsubscribed it; repeating POST was safe. The owner
  test record is left unsubscribed.
- Resend simulator delivered/bounced/complained/suppressed tests ran through the
  real cron queue. Signed callbacks created all three suppression reasons in D1.
  Unauthenticated webhook requests return 403; unauthenticated admin returns 401;
  forged Turnstile returns 400. A forged confirmation did not mutate state.
- Owner inbox received a Worker-generated test announcement. Gmail reports aligned
  DKIM, SPF and DMARC pass. List-Unsubscribe and List-Unsubscribe-Post are present
  and covered by the opencam.app DKIM signature. Test-mode unsubscribe is intentionally
  PREVIEW_ONLY; actual unsubscribe is tested separately on the owner test record.
- Both richard@opencam.app and updates@opencam.app forwarded test mail to
  opencamapp@gmail.com. Reply-To is richard@opencam.app.
- Repeated setup test request returns the same delivery ID. No live announcement
  launched; the launch endpoint returns 403 while LIVE_SEND_ENABLED=false.
- Earlier responsive browser checks at 780px and 480px found no horizontal overflow;
  native validation, focused live status, network errors and success were checked.

## Operating limits and remaining owner actions

- Homepage and /updates use the verified new signup form. Signups and confirmation
  sending are enabled. LIVE_SEND_ENABLED remains false.
  POSTAL_ADDRESS is intentionally blank for setup and must be supplied before
  release campaigns. Each campaign also requires explicit owner authorization.
- Queue sends at most once per minute (cron scheduling can add delay), with a
  1,000-attempt rolling daily ceiling. This includes confirmations and tests.
  Quota is local; check TabTab and shared Resend usage before a campaign.
- Owner reviewed original form consent and reported no known opt-outs. All 1,725
  valid unique addresses were imported with legacy-consent evidence and NULL
  confirmed_at. No confirmation or campaign emails were queued by the import.
  No TestFlight import. See migration-report.md.
- Move secret recovery values to the owner's password manager; choose a private
  backup-retention policy. No secret or subscriber export is committed to Git.

## General-update scope revision

Signup, confirmation, unsubscribe, homepage and privacy copy now cover OpenCam
news, features, announcements and releases. Migration 0002 adds an explicit campaign
type while preserving all existing release campaigns. General updates use an
explicit key and do not require an App Store version; release campaigns retain
that gate. Tests verify narrow-consent exclusion, send-time recheck, immutable
keys and duplicate launch protection. Postal-address and live-send gates remain.
