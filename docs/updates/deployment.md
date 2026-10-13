# Deployment and account setup

The owner selected Resend on 2026-10-13 to share the existing TabTab account,
then upgraded the Transactional plan to Pro ($20/month, 50,000 emails).
SES/SNS/IAM setup is superseded; no AWS account is required for this system.

## Existing infrastructure

- Website remains GitHub Pages (`riccqi/opencam-site`, main branch workflow).
- Cloudflare account: `bca4998daf3ad4fb150bb827c3ad72a8`.
- Zone: `35f2cd89b7ed29c6c9bae50352b222e4`, opencam.app.
- Worker: `opencam-updates`, `https://updates-api.opencam.app`.
- D1: `opencam-updates`, `5ee8febb-7928-4855-b0a6-85c41e2b5c53`.
  Migration 0001 has been applied remotely. Do not create a duplicate database.
- Managed Turnstile widget: `OpenCam updates`, hostname opencam.app only;
  pre-clearance disabled. Real public sitekey is in GitHub repository variables.
- Admin/encryption/rate and Turnstile secrets installed in Worker secret storage.
  Local recovery copy: `private/updates/worker-secrets.private.json`, mode 0600,
  gitignored. Move recovery values to the owner's password manager.
- Incoming email: richard@opencam.app and updates@opencam.app both actively forward
  to verified opencamapp@gmail.com. Catch-all disabled. Preserve routing MX,
  apex SPF and cf2024-1 DKIM. Gmail send-as is not configured by forwarding.

## Resend setup

1. Use the existing `xiaochean` Resend team used by TabTab. Keep separate OpenCam
   credentials, sender and D1 subscriber list. Never reuse TabTab keys.
2. Add opencam.app as a sending domain. Install the exact DNS records shown by
   Resend, with CNAME proxying off. Preserve root/www website and incoming routing.
   Current supplied records are resend._domainkey TXT, rsend CNAME to
   rsend.forge.rmta.net and send CNAME to send.forge.rmta.net. Read the actual
   DKIM value from the dashboard; do not invent or copy TabTab's key.
3. Review existing _dmarc before adding a monitoring TXT policy
   `v=DMARC1; p=none;`. Do not replace a stronger existing policy.
4. Leave Resend receiving, open tracking, and click tracking disabled.
5. Create a sending-only key restricted to opencam.app. Install RESEND_API_KEY
   as a Worker secret. From is OpenCam <updates@opencam.app>; Reply-To is
   richard@opencam.app. Full-access account keys must not be installed in Worker.
6. Register `https://updates-api.opencam.app/events/resend` with events
   email.sent, email.delivered, email.bounced, email.complained, email.suppressed,
   and email.failed. Install its unique RESEND_WEBHOOK_SECRET. Preserve TabTab's
   existing webhook. OpenCam now has its own enabled endpoint:
   `bdb1d6a3-8c03-4f6b-8d3a-892104798a1d`. Its signing secret is installed.
   Do not route TabTab events through OpenCam or change TabTab's endpoint.
7. Verify signed callbacks using delivered@resend.dev, bounced@resend.dev,
   complained@resend.dev and suppressed@resend.dev. Test mail counts toward quota.
   Webhook logs must show 2xx; bounce/complaint/suppression must update D1.
8. Check shared account usage before raising DAILY_SEND_LIMIT. OpenCam starts at
   1,000 attempts/day, at most one per minute; announcements remain gated off. The limit is
   local to OpenCam; TabTab usage also consumes Resend's account quota. Pro permits
   50,000 emails/month and 10 domains for $20/month at the checked pricing; no paid
   upgrade or add-on is automatic. Keep overage billing off unless authorized.

## Production gate

Use only explicitly approved owner inboxes and Resend simulator recipients.
The separately authorized, reviewed legacy import is complete (see migration-report.md).
Do not email that list during setup or reimport without reviewing later opt-outs.

1. Verify domain DNS, sender/reply routing, real Turnstile secret, webhook,
   admin authentication and D1 schema. Set an owner-provided business postal
   address before release campaigns.
2. Deploy Worker with SIGNUPS_ENABLED=true, SENDING_ENABLED=true and
   LIVE_SEND_ENABLED=false only when provider setup is verified.
3. Set GitHub PUBLIC_UPDATES_FORM_ENABLED=true, with existing real sitekey/API,
   while PUBLIC_UPDATES_ENABLED=false. Publish via existing Pages workflow:
   /updates uses the new form, homepage continues the existing Google Form.
4. Test production signup activates immediately without queueing email, scanner-safe GET,
   repeat token, unsubscribe POST, and a fresh resubscription. Verify simulated
   delivery events and suppression. Inspect MIME for aligned SPF/DKIM/DMARC,
   unsubscribe headers and DKIM coverage of those headers (RFC 8058).
5. Only after the gate passes, set PUBLIC_UPDATES_ENABLED=true and publish again.
6. Keep LIVE_SEND_ENABLED=false until an explicit approved release campaign. A
   public App Store version is independently required by the launch endpoint.

Rollback: disable PUBLIC_UPDATES_ENABLED and PUBLIC_UPDATES_FORM_ENABLED and rebuild
for the Google Form fallback. SIGNUPS_ENABLED=false pauses signup;
SENDING_ENABLED=false pauses all sends; LIVE_SEND_ENABLED=false pauses announcements.
Keep confirmation/unsubscribe/webhook endpoints running during pauses.

References: [Resend pricing](https://resend.com/pricing),
[webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests),
[test addresses](https://resend.com/docs/dashboard/emails/send-test-emails).
