# Shared email studio

OpenCam and TabTab use this package for the dashboard HTML/CSS/browser app, the
safe Markdown-to-email renderer, and the Resend delivery queue (`outbox.js`).

`outbox.js` owns the sending rules for both apps: each cron run claims up to 100 due
rows from the app's `deliveries` table, the app prepares each email (or skips or holds
it), and the batch goes to Resend in one request. Throttling retries with backoff (up
to 5 attempts); any outcome where Resend may have accepted the email is held as
`ambiguous` and never resent automatically; a Resend webhook event settles it. Both
apps are on Resend Pro, so there is no daily cap. Each app keeps its own database,
contacts and campaign tables, and supplies only `prepare` and a claim filter. Brand, domain, accent, source description and
sending-plan presentation are configured by each app. Contacts, settings and campaign delivery stay in each app's own Worker and
database. OpenCam hosts the shared owner login and routes authenticated TabTab
workspace requests through a Cloudflare service binding. The package itself
contains UI configuration only: API bases, auth base, asset query, and workspace
links. It contains no credentials or subscriber data.

To release a change, bump package.json, run `npm pack ./packages/email-studio
--pack-destination ./packages/releases` from the repository root, and commit the
source and resulting versioned tarball. OpenCam installs that local tarball;
TabTab pins the same tarball at an immutable GitHub commit URL. Update both lockfiles,
run both backend suites, and deploy both Workers. Never replace a released version.
