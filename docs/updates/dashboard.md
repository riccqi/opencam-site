# OpenCam Email Studio

Open https://updates-api.opencam.app/dashboard and request a sign-in code.
The code goes only to opencamapp@gmail.com; it expires in 10 minutes and is
single-use. The secure, HTTP-only session lasts seven days. Signing out revokes it.
These owner login emails are separate from subscriber signup, which still sends
no confirmation email.

## Switch apps

Use the OpenCam / TabTab switcher on the sign-in page or sidebar. It saves the
current draft before leaving and stops if saving fails. Each app keeps its own
session: OpenCam codes go to opencamapp@gmail.com, TabTab codes to
xiaochean@gmail.com. Once signed into both, switching reuses those sessions.
Switching does not copy contacts, drafts, credentials or settings between apps.

## Write and send

1. Choose **Write an update**. Enter a subject, optional inbox preview text, and
   your message. Markdown supports headings, emphasis, links, images and lists.
   Drafts autosave and can also be saved explicitly.
2. Review the desktop/mobile preview or plain-text version. Email-client frames
   are approximations; send a real test to check your inbox rendering.
3. Choose **Send test** using opencamapp@gmail.com or xiaochean@gmail.com.
   The cron queue sends the test, normally within a minute. Wait for it and review it.
4. Choose **Review & send**. Check the recipient count and mailing address, type
   the exact subject, and press **Start sending**. A test accepted by Resend for
   this exact content and footer is required. Editing the draft/footer requires
   another test. The content and audience are fixed when sending starts.
5. Delivery continues in the background at up to 100 recipients per minute.
   Use **Pause sending** / **Resume remaining** to control it. A batch already
   handed to Resend cannot be recalled. Failed or uncertain deliveries are held
   for review and are never blindly resent.

Subscribers provides paginated search, status filters and unsubscribe actions.
Settings edits the footer mailing address. Resend Pro uses no OpenCam daily cap;
monthly account usage is shared with TabTab. Each app retains its own list,
login, settings, suppression records and campaign delivery backend.

## Shared code

Both deployed Workers use `@riccqi/email-studio` version 1.0.1 from
`packages/email-studio`. OpenCam installs the committed local release tarball;
TabTab pins that same tarball at an immutable GitHub commit URL in its package lockfile. See the package README for updates.
The shared code contains no credentials or subscriber data. It provides the
branded UI and safe Markdown email renderer; each Worker implements the API.

## Operations

Migration 0003 adds dashboard codes, sessions, settings and drafts, plus immutable
campaign Markdown/footer snapshots and pause flags. A private database backup
was taken before migration. Existing subscriptions and delivery records persist.

`LIVE_SEND_ENABLED=true` enables owner self-service. It does not launch drafts or
send on deploy: only the authenticated, tested, explicitly confirmed start action
(or the existing protected CLI launch) can snapshot recipients and begin sending.
Set it to false to pause all announcements. `SENDING_ENABLED=false` pauses the
outbox; owner authentication codes are rate-limited and sent separately.
