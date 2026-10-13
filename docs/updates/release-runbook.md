# Release-send runbook

Before the first send complete deployment.md, including Resend domain verification and adequate shared account capacity,
reply routing, simulator events and consent review. Do not send to the legacy
quarantine. Launch is an explicit owner action; pushes, GitHub releases and TestFlight
uploads never send email.

1. Verify the version is publicly downloadable on the App Store in all intended
   storefronts. The API independently checks the exact version in the URL's country.
2. In a private local directory, create campaign.json:

   ```json
   {
     "version": "2.1.0",
     "subject": "OpenCam 2.1.0 is available",
     "notes": "Describe the actual public release here.\nUse plain text, not HTML.",
     "app_store_url": "https://apps.apple.com/us/app/opencam-open-gate-camera/id6743316690"
   }
   ```

3. Load ADMIN_TOKEN from your password manager into the shell environment (not
   command-line arguments/history). Set UPDATES_API if different from production.
   From services/updates:

   ```sh
   npm run admin -- counts
   npm run admin -- create ../../private/updates/campaign.json
   npm run admin -- preview CAMPAIGN_ID ../../private/updates/preview.html
   npm run admin -- test CAMPAIGN_ID delivered@resend.dev release-2-1-0-test-1
   npm run admin -- status CAMPAIGN_ID
   ```

   Reuse the test request ID if a CLI response is lost. To test an owner address,
   explicitly add that approved address to TEST_RECIPIENTS first; simulator-only
   is the default. Test mode never subscribes a recipient. The preview-only
   unsubscribe link in a test message intentionally changes no subscriber record;
   separately test real unsubscribe using an approved double-opt-in address.

4. Review preview and received test, count eligible subscribers, confirm daily
   quota and remaining shared Resend account capacity, and review suppression and Resend webhook failures.
   Campaign content is immutable; a conflicting version is rejected, not overwritten.
   Correct a draft only using a reviewed database migration before any launch.
5. After explicit live-send approval, enable LIVE_SEND_ENABLED and run:

   ```sh
   npm run admin -- launch CAMPAIGN_ID --public-version 2.1.0
   npm run admin -- status CAMPAIGN_ID
   ```

   Repeating launch is safe. A durable snapshot of currently confirmed subscribers
   is created once. Later signups do not enter that campaign. Cron drains the queue
   at one message per minute, under the rolling daily ceiling. No browser needs to
   stay open. Check status until no queued/retry/sending entries remain.

6. Review ambiguous/failed entries. Do not retry blindly. Signed Resend delivery/send
   events may resolve ambiguous acceptance. If provider evidence confirms acceptance:
   `npm run admin -- resolve DELIVERY_ID sent`. Otherwise leave held or resolve to
   skipped. This version has no bulk resend command. Confirmations can be requested
   afresh by their owner; do not mass-reconfirm legacy contacts.

Administration:

```sh
npm run admin -- search person@example.com
npm run admin -- unsubscribe person@example.com
npm run admin -- suppress person@example.com
npm run admin -- export ../../private/updates/subscribers.private.csv
# Only after an authorized deletion request; removes subscriber and delivery rows:
npm run admin -- delete person@example.com
```

Exports are paginated, formula-escaped, written mode 0600 and never overwrite an
existing file. Search returns at most 100 records. Store exports outside Git and
remove them according to the retention policy. Admin mutations leave an audit
record with an opaque target ID and no raw address. After restoring any backup,
reconcile unsubscribes and suppressions received since that backup **before**
re-enabling sends. Rotate exposed admin credentials immediately.
