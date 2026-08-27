# SEEK Saved Jobs sync

JobPilot can ingest jobs you explicitly saved in SEEK without copying SEEK cookies or credentials into the application.

## 1. Apply the database migration

Apply `database/migrations/003_seek_saved_source.sql` to the JobPilot PostgreSQL / Supabase database.

## 2. Start the local receiver

From the repository root, with the normal JobPilot database environment variables loaded:

```bash
python scripts/seek_saved_receiver.py
```

The receiver listens only on `127.0.0.1:8765` by default.

## 3. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `browser/extension` from this repository.
5. Pin **JobPilot SEEK Sync** if you want one-click access.

## 4. Sync Saved Jobs

1. Sign in to SEEK and open your Saved Jobs page.
2. Click the **JobPilot SEEK Sync** extension.
3. Click **Sync Saved Jobs**.

The popup reports:

- jobs found on the current SEEK page;
- newly imported jobs;
- jobs already known to JobPilot;
- failed imports.

The extension only sends SEEK job URLs to the local JobPilot receiver. It does not send SEEK cookies, account credentials, or page HTML.

## Data model

Saved Jobs use `seek_saved` as a source. `job_sources` stores multi-source provenance, so a job already discovered from a SEEK recommendation email is not duplicated when you later save it. Instead, the existing job gains `seek_saved` provenance.

## Console fallback

`browser/seek-saved-sync.js` remains as a lightweight fallback for debugging. The Chrome extension is the normal user path.

## Next step

After a real-account smoke test, surface Saved provenance and sync health inside the JobPilot dashboard.
