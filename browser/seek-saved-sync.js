(() => {
  const endpoint = "http://127.0.0.1:8765/seek-saved/sync";
  const allowedHost = /(^|\.)seek\.co\.nz$/i;

  if (!allowedHost.test(window.location.hostname)) {
    alert("JobPilot: open SEEK New Zealand first.");
    return;
  }

  const urls = [...document.querySelectorAll('a[href*="/job/"]')]
    .map((anchor) => anchor.href)
    .filter((href) => /\/job\/\d+/.test(href));

  const uniqueUrls = [...new Set(urls)];
  if (!uniqueUrls.length) {
    alert("JobPilot: no SEEK jobs found on this page. Open your Saved Jobs page and try again.");
    return;
  }

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls: uniqueUrls }),
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      }
      return payload;
    })
    .then((result) => {
      alert(
        `JobPilot sync complete\n\n` +
          `Found: ${uniqueUrls.length}\n` +
          `Imported: ${result.imported_count ?? 0}\n` +
          `Already in JobPilot: ${result.existing_count ?? 0}\n` +
          `Failed: ${result.failed_count ?? 0}`
      );
    })
    .catch((error) => {
      alert(
        "JobPilot sync failed. Make sure scripts/seek_saved_receiver.py is running.\n\n" +
          error.message
      );
    });
})();
