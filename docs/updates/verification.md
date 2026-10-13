# Verification and launch status

Updated 2026-10-13. Resend replaces the original SES plan; no AWS setup is required.

## Automated checks

35 JavaScript tests plus the Python import test pass, including real workerd/D1 integration. Local checks passed, as did the Astro build and Worker bundle. Tests cover immediate single opt-in without outbound email, legacy confirmation
expiry/reuse/forgery, scanner-safe GET, RFC 8058 POST, resubscribe, Turnstile and
rate limits, admin authentication, public App Store version gating, immutable
campaigns, duplicate launches, queued unsubscribe, postal-address gating,
quota/retry/ambiguous recovery, encrypted payloads, CSV escaping, signed Resend
callbacks, cross-app isolation and idempotent sending.

## Production infrastructure and tests

- Worker `opencam-updates`: https://updates-api.opencam.app. Version
  `6eff63d6-303a-4942-8a7e-d91b33eea19c`; D1 migrations 0001–0003 applied.
- Resend team `xiaochean`: owner upgraded Transactional to Pro, $20/month,
  50,000 shared emails. OpenCam has a separate domain-restricted sending key and
  webhook `bdb1d6a3-8c03-4f6b-8d3a-892104798a1d`. TabTab was not changed.
- OpenCam domain verified. Sending DKIM/CNAMEs and monitoring DMARC published;
  existing website and incoming-mail DNS preserved. All seven secrets are in
  Worker secret storage; private local recovery file is gitignored, mode 0600.
- Historical double-opt-in setup test (superseded below): real Turnstile signup at https://opencam.app/updates/?source=app returned generic
  success, stored source=app, and queued an encrypted confirmation. Gmail received
  the confirmation. GET left the subscriber pending; POST confirmed it. Reusing
  the token did not reconfirm. Unsubscribe GET left it subscribed; POST unsubscribed.
- Historical resubscribe test: resubscribe returned generic success and remained unsubscribed pending fresh
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

- Homepage and /updates use the verified new signup form. Signups activate immediately without confirmation email. LIVE_SEND_ENABLED is now true for owner-reviewed dashboard sends; no campaign is automatically launched.
  POSTAL_ADDRESS now uses the owner-approved TabTab postal address with the OpenCam name. Each campaign also requires explicit owner authorization.
- Queue submits up to 100 individually addressed messages per minute via the Resend batch API;
  the OpenCam daily cap is disabled. This includes test announcements.
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

## Single-opt-in revision

OpenCam now matches TabTab: submitting Subscribe activates the subscription immediately.
No confirmation email or token is created. Explicit resubscribe works the same way;
suppression remains permanent. Consent evidence records website single opt-in without
inventing a mailbox-confirmation timestamp. Old queued confirmations are skipped,
and previously issued links remain valid until their original expiry. No pending
contacts are bulk-activated. Imported contacts and campaign gates are unchanged.

## Batch throughput verification

A synthetic 1,725-contact campaign completes in 18 mocked batch calls, with
concurrent-drain duplicate protection and no daily cutoff. Real workerd/D1 also
processes 100 recipients through one intercepted Resend batch request. Tests cover
ordered acceptance IDs, malformed responses, throttling/backoff, uncertain sends,
optional cap boundaries, opt-outs, suppression, and the disabled live-send gate.
No real campaign or email was sent for this change. The postal address was copied
from TabTab settings with owner approval; LIVE_SEND_ENABLED is now true for owner-reviewed dashboard sends; no campaign is automatically launched.

## Shared Email Studio

OpenCam and TabTab now consume the same versioned UI and Markdown renderer.
32 OpenCam tests and 14 TabTab tests pass. Dashboard tests cover owner-only OTP,
single use, secure cookies, CSRF rejection, rate limits, saved drafts, safe preview,
exact-content test requirements, footer invalidation, immutable launches and
pause/resume. Production sign-in email arrived in the owner inbox. No subscriber
campaign is launched during dashboard setup.

Production browser verification on 2026-10-13 confirmed owner sign-in, saving a
Markdown draft, desktop/mobile and plain-text previews, and the 1,725-recipient
review dialog with typed-subject confirmation. The owner-only `[TEST] Dashboard
setup test — OpenCam` arrived in opencamapp@gmail.com with SPF, DKIM and DMARC
passing. It includes the configured postal address and a preview-only unsubscribe
link; subscriber sends use individual unsubscribe links. The setup draft remains
unsent. Both GitHub Actions checks for e2b079b passed.


## Unified owner login and isolated workspaces

Both apps use shared Email Studio 1.1.1. OpenCam hosts the owner session and
proxies an allowlist of TabTab dashboard routes through a service binding with a
dashboard-only server credential. TabTab's old dashboard URL redirects to the
shared studio. Its direct dashboard API rejects old local sessions when central
studio mode is enabled. Subscriber databases and senders remain separate.

35 OpenCam tests and 15 TabTab tests pass, including execution of the bundled
browser script to verify actual workspace API and login routing. Production
checks confirmed switching between the two distinct lists/drafts under one
session, saving before switching, correct TabTab preview and send-review audience,
and HTTP 401 for anonymous access to both workspace APIs and the direct TabTab
API. Both setup drafts remain unsent. No campaigns or new test emails were sent
for this revision. OpenCam CI and GitHub Pages deployment passed for 2916855.
TabTab Worker version: 6feb30d3-c1c4-4feb-b8e5-fe60a9750326.

Both repositories are public. Secret files and private contact exports are ignored.
A focused scan of the local Git histories (306 OpenCam and 642 TabTab blobs before
this revision) found no literal matches for the current stored credentials. This
is not a comprehensive security audit. Public websites remain on GitHub Pages;
Workers, D1 data and secret storage remain on Cloudflare.
