# Shared email studio

OpenCam and TabTab use this package for the dashboard HTML/CSS/browser app and the
safe Markdown-to-email renderer. Brand, domain, accent, source description and
sending-plan presentation are configured by each app. Authentication, contacts,
settings and campaign delivery stay in each app's own Worker and database.

To release a change, bump package.json, run `npm pack ./packages/email-studio
--pack-destination ./packages/releases` from the repository root, and commit the
source and resulting versioned tarball. OpenCam installs that local tarball;
TabTab pins the same tarball at an immutable GitHub commit URL. Update both lockfiles,
run both backend suites, and deploy both Workers. Never replace a released version.
