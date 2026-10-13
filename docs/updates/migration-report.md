# Migration audit — 2026-10-13

Source: **OpenCam Waitlist (Responses)**, Google Sheet ID
`1Y97hWn6c4QEVdIcl3CSIdD2aaHGX321Od7lKTaht4TU`, tab **Form Responses 1**.
The connector identifies the file as private/unshared and owned in the connected
Drive. Grid metadata: 1,905 rows, nine columns; actual CSV header has Timestamp,
Email, and What interests you about OpenCam?. Locale en_US; timezone Asia/Kuching.
No sheet or form was edited. The user explicitly withdrew the TestFlight-source
request; no TestFlight export was downloaded or imported.

| Classification | Count |
| --- | ---: |
| Response rows | 1,804 |
| Syntactically valid rows | 1,795 |
| Unique valid addresses | 1,725 |
| Duplicate valid rows | 70 |
| Invalid rows | 9 |
| Unique addresses held for consent review | 1,725 |
| Addresses imported / sent to | 0 / 0 |

Validation is syntactic only, not proof of mailbox ownership or deliverability.
Case and whitespace are normalized; plus tags and Gmail-style dots are preserved.
Duplicate evidence and raw timestamps are retained. Invalid rows are identified
by row number in the private report so the owner can review without exposing
addresses in source control. No confirmation timestamps were invented.

Current homepage form: https://forms.gle/ZFAa3WXiRgMNXFiN7, resolving to
https://docs.google.com/forms/d/e/1FAIpQLSe-LARYiq46Uy4XMyCOM-2sH2xrAoZv3atQNxpZoBBIwQTWRw/viewform.
On inspection its title is “Join OpenCam Email List”. Current visible wording:
“Thanks for taking an interest in OpenCam! We’ll send the latest updates and
exclusive offers to the email you provide.” It asks only for Email. The extra
interest column in the export suggests the form may have changed. The current
wording does not establish what each historical subscriber saw. We have no
historical wording/version evidence, no mailbox confirmations and no unsubscribe
column or historical suppression file. **Zero recorded unsubscribes in this export
is not proof that nobody unsubscribed.**

Private local backup and audit artifacts (gitignored; directory mode 0700, files
0600):

- private/updates/waitlist-original.private.csv — original connector CSV export
- private/updates/quarantine.private.json — deduplicated addresses, row references,
  raw timestamp evidence, invalid row numbers, no subscribed status
- private/updates/migration-report.private.json — aggregate machine-readable audit

Backup SHA-256:
`73db2f7fa342397db61ab01ca951ddead3a40d20822c7fd6ce5673ccc8e1069b`.
Keep this backup on an encrypted local volume or in an owner-controlled encrypted
backup. Restrictive file permissions alone are not encryption. These artifacts
have not been uploaded to Cloudflare, Resend, or any new email platform.

Reproduce locally (use fresh output filenames; the tool refuses overwrites):

```sh
python3 services/updates/scripts/audit-import.py private/updates/waitlist-original.private.csv \
  --email-column Email --timestamp-column Timestamp \
  --report private/updates/audit-rerun.private.json \
  --quarantine private/updates/quarantine-rerun.private.json
```

Before any import, collect the original wording/history and previous opt-outs,
review duplicate evidence, resolve malformed records without guessing addresses,
and decide which evidence qualifies under the required confirmed-only sending
policy. Known opt-outs and complaints must win over any positive evidence. Do
not mark historical entries subscribed merely because the present form mentions
emails. A separately authorized import must preserve the source timestamp and
consent evidence, and must not trigger confirmation sends by default. There is
intentionally no live bulk import/reconfirmation command in this version; the
reviewed migration is still a deployment blocker, not a completed consent check.
