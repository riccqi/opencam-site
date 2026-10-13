# Verification and remaining blockers

Updated 2026-10-13 after the owner selected shared Resend delivery instead of SES.

## Verified

- 21 tests pass, including an actual workerd/D1 integration test. All external
  calls are intercepted in tests; they do not send email.
- Double opt-in, duplicate/expired/reused/forged tokens, scanner-safe GET, POST
  confirmation/unsubscribe, explicit resubscribe, rate limits and Turnstile checks.
- Resend HMAC webhook authentication against raw request bytes, timestamp bounds,
  replay deduplication, bounce/complaint/suppression and cross-app sender isolation.
- Protected admin, public App Store version gating, immutable/duplicate campaigns,
  queued unsubscribe, sender postal-address gate, attempt quota, retry/ambiguity,
  delivery-tag reconciliation, encrypted payloads and CSV escaping.
- Resend request headers, stable idempotency keys, message formatting and errors.
- Astro production build and Wrangler dry-run pass; GitHub Pages hosting retained.
- Earlier browser checks at 780px and 480px CSS widths found no horizontal overflow.
  Native validation, focused aria-live status, network-error and success UI checked.
  Success used a temporary localhost stub, now stopped; not proof of live delivery.
- D1 `opencam-updates` created with migration 0001. Worker deployed at
  https://updates-api.opencam.app; latest paused Resend version:
  `7c4ff48e-baf0-4b8b-8239-547e694fa7ab`.
- Production health 200, unauthenticated admin 401, authenticated empty counts 200,
  disabled signup 503. No legacy subscribers imported.
- Managed Turnstile for opencam.app created. Secret installed; public sitekey and
  API configured in GitHub repository variables. Both frontend switches remain off.
- Four generated admin/encryption/rate secrets installed in Worker. Private 0600
  recovery file is gitignored. No production secret in frontend or tracked files.
- Both incoming aliases (richard, updates) actively forward to the owner-verified
  opencamapp@gmail.com inbox through Cloudflare. Reply to richard was received in the destination Gmail inbox on 2026-10-13.

## Pending live activation

1. OpenCam domain is verified in Resend; DKIM and two sending CNAME records are
   published. Existing website and incoming-email records are preserved.
2. Owner selected **Keep Free**. No upgrade was purchased. The existing TabTab
   webhook occupies the one available endpoint. Owner chose **Keep separate; wait
   for Pro**. No shared router is retained or deployed; TabTab is unchanged.
3. Sending-only opencam.app-restricted RESEND_API_KEY is installed. Webhook signing
   secret and live webhook verification remain pending a separate endpoint after Pro.
4. Approved setup-only email reached xiaochean@gmail.com inbox on 2026-10-13.
   Gmail reports SPF, aligned opencam.app DKIM and DMARC pass; Reply-To is correct.
   Resend message ID: 01a1370e-a8e0-75ee-b87e-84a7256dde08. This direct provider
   diagnostic does not prove the Worker signup flow. Confirmation, unsubscribe,
   resubscribe, announcement unsubscribe headers and signed event tests remain.
5. Production website staging/cutover after all gates pass. Existing Google Form
   remains the live homepage signup. LIVE_SEND_ENABLED remains false.
6. POSTAL_ADDRESS is deliberately blank during setup; required before any release announcement, plus explicit
   approval of each campaign. No announcement or mass reconfirmation has been sent.
7. Historical consent/opt-out review for 1,725 quarantined unique valid addresses.
   No TestFlight contacts are included. Confirmations have not been fabricated.
8. Owner password-manager backup of secrets and a private backup-retention policy.

SES setup is superseded; there is no AWS credential or production-access blocker.
