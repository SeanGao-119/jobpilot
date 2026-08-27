# SEEK Saved Jobs sync

This is the first browser-side ingestion path for JobPilot Saved Jobs.

## 1. Apply the database migration

Apply `database/migrations/003_seek_saved_source.sql` to the JobPilot PostgreSQL / Supabase database.

## 2. Start the local receiver

From the repository root, with the normal JobPilot database environment variables loaded:

```bash
python scripts/seek_saved_receiver.py
```

The receiver listens only on `127.0.0.1:8765` by default.

## 3. Run the browser helper on SEEK Saved Jobs

Open your signed-in SEEK Saved Jobs page, then run the contents of `browser/seek-saved-sync.js` in the browser console.

The helper only sends SEEK job URLs to the local JobPilot receiver. It does not send SEEK cookies, account credentials, or page HTML.

A successful sync reports:

- jobs found on the page;
- newly imported jobs;
- jobs already known to JobPilot;
- failed imports.

## Data model

Saved Jobs use `seek_saved` as a source. `job_sources` stores multi-source provenance, so a job that was already discovered from a SEEK recommendation email is not duplicated when the user later saves it.

## Next step

Replace the console helper with a small Chrome extension and add a `Sync SEEK Saved Jobs` control to the JobPilot dashboard once this ingestion path has been exercised against a real Saved Jobs page.
