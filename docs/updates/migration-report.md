# Legacy form import — 2026-10-13

Imported the owner-authorized starting list from **OpenCam Waitlist (Responses)**,
Sheet `1Y97hWn6c4QEVdIcl3CSIdD2aaHGX321Od7lKTaht4TU`, tab **Form Responses 1**.
A fresh CSV export matched the original audit SHA-256:
`73db2f7fa342397db61ab01ca951ddead3a40d20822c7fd6ce5673ccc8e1069b`.

| Result | Count |
| --- | ---: |
| Source response rows | 1,804 |
| Unique valid addresses imported | 1,725 |
| Duplicate valid entries excluded | 70 |
| Invalid entries excluded | 9 |
| Existing records overwritten | 0 |
| Email-confirmation timestamps fabricated | 0 |
| Emails queued or sent by import | 0 |

The owner confirmed the original wording was “latest updates and exclusive
 offers” and reported no known opt-outs. The current form was inspected, and
ownership by xiaochean@gmail.com was verified. This owner attestation is recorded
as evidence; it is not represented as independent historical version evidence or
mailbox verification.

Imported records have status subscribed, source legacy-google-form, consent version
`legacy-form-updates-owner-reviewed-2026-10-13`, and NULL confirmed_at. Evidence
records preserve original row references, raw timestamps, source hash, original
wording, owner attestation and actual review/import-preparation time. Signup dates
are parsed using the Sheet's verified Asia/Kuching timezone; duplicate records use
the earliest signup and preserve every source-row timestamp. Validation is syntactic,
not a claim that every mailbox exists.

The insert-only import never updates existing addresses. Existing unsubscribe and
suppression records take precedence. Import is repeatable without duplicates and
cannot queue email. No TestFlight records were accessed or imported.

The list resides in OpenCam's private Cloudflare D1 database. Approved campaigns
are sent via the domain-restricted Resend API; no Resend Marketing audience was
created. New website signups still require double opt-in. The explicit, reviewed
legacy-consent exception supports both general updates and release campaigns without
inventing confirmation timestamps. Release campaigns retain the App Store gate.

Production verification: 1,725 legacy subscribed, one owner test unsubscribed,
three simulator addresses suppressed, zero pending deliveries and zero launched
campaigns. LIVE_SEND_ENABLED remains false and the postal address remains blank.

Private artifacts in gitignored private/updates (directory 0700, files 0600):
- waitlist-import-source.private.csv — fresh source export
- before-legacy-import.private.sql — pre-import recovery backup
- legacy-consent-evidence.private.json — owner attestation
- legacy-import.private.sql — insert-only statements with HMAC unsubscribe hashes
- legacy-import-report.private.json — aggregate audit and invalid row numbers

Keep these on an encrypted local volume or owner-controlled encrypted backup.
Do not restore an old backup over later opt-outs. No personal data or secret was
committed. The reusable prepare-legacy-import.py writes private SQL only; uploading
it is a separate authorized operation. It refuses overwrite and requires affirmative
consent-review evidence. Its test verifies deduplication, timestamp conversion,
preserved opt-outs, NULL confirmations, idempotency and zero queued mail.
