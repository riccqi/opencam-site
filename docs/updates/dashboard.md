# OpenCam Email Studio

Open https://updates-api.opencam.app/dashboard and request a sign-in code.
The code goes only to opencamapp@gmail.com; it expires in 10 minutes and is
single-use. The secure, HTTP-only session lasts seven days. Signing out revokes it.
These owner login emails are separate from subscriber signup, which still sends
no confirmation email.

## Switch apps

OpenCam and TabTab share one sign-in at the URL above. Use the sidebar app switcher.
Both workspaces use the session created by the code sent to opencamapp@gmail.com.
The old TabTab dashboard URL redirects to the TabTab workspace in this studio.
Signing out revokes access to both workspaces for that session.

Switching saves the current draft and stops if saving fails. Each workspace keeps
its own database, subscribers, opt-outs, drafts, sender, footer and delivery queue.
No contacts are copied or combined. The send review names the active app.

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
settings, suppression records and database; both deliver through the same shared
outbox module. Owner login is shared.

## Shared code

Both deployed Workers use `@riccqi/email-studio` version 1.1.1 from
`packages/email-studio`. OpenCam installs the committed local release tarball;
TabTab pins that same tarball at an immutable GitHub commit URL in its package lockfile. See the package README for updates.
The shared code contains no credentials or subscriber data. It provides the
branded UI and safe Markdown email renderer; each Worker implements the API.

The OpenCam Worker authenticates every workspace request. TabTab requests use a
Cloudflare service binding plus a server-only `SHARED_STUDIO_TOKEN`, limited to
TabTab dashboard APIs. This credential cannot access TabTab admin APIs. The
proxy permits only known dashboard paths, strips browser cookies/authorization,
and performs origin/CSRF checks before forwarding. Public TabTab login APIs are
disabled when `STUDIO_URL` is configured. Secrets remain in Worker secret storage
and ignored private recovery files, never the shared package.

## Operations

Migration 0003 adds dashboard codes, sessions, settings and drafts, plus immutable
campaign Markdown/footer snapshots and pause flags. A private database backup
was taken before migration. Existing subscriptions and delivery records persist.

`LIVE_SEND_ENABLED=true` enables owner self-service. It does not launch drafts or
send on deploy: only the authenticated, tested, explicitly confirmed start action
(or the existing protected CLI launch) can snapshot recipients and begin sending.
Set it to false to pause all announcements. `SENDING_ENABLED=false` pauses the
outbox; owner authentication codes are rate-limited and sent separately.

## Everyday use and account protection

Bookmark the studio URL; no local server, terminal or Resend dashboard is needed
for routine updates. Pick the app before writing. Use a fresh draft for a new
update, inspect its sender/links/footer and mobile preview, then send a test to
your own inbox. Wait for the actual test email. Any content/footer changes require
another test. Review the named app and recipient count, type the subject and start.
The sending process continues after closing the browser. Check progress here later;
pause stops remaining sends but cannot recall accepted emails.

Owner codes expire after 10 minutes; the session can remain signed in for seven
days. Protect opencamapp@gmail.com with two-step verification: access to that inbox
can grant access to both workspaces. Do not share sign-in codes, and sign out on
shared devices. The public studio URL itself does not grant access. The setup/test
drafts are examples, not announcements intended for subscribers.
