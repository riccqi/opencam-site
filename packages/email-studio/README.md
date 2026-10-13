# Shared email studio

OpenCam and TabTab use this package for the dashboard HTML/CSS/browser app and the
safe Markdown-to-email renderer. Brand, domain, accent, source description and
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
