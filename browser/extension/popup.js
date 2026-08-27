const endpoint = "http://127.0.0.1:8765/seek-saved/sync";
const syncButton = document.getElementById("sync");
const statusNode = document.getElementById("status");
const resultNode = document.getElementById("result");

function showResult(html, { error = false } = {}) {
  resultNode.hidden = false;
  resultNode.classList.toggle("error", error);
  resultNode.innerHTML = html;
}

async function collectSeekJobs(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const hostname = window.location.hostname;
      const pageUrl = window.location.href;
      const urls = [...document.querySelectorAll('a[href*="/job/"]')]
        .map((anchor) => anchor.href)
        .filter((href) => /\/job\/\d+/.test(href));
      return {
        hostname,
        pageUrl,
        urls: [...new Set(urls)],
      };
    },
  });
  return result;
}

async function syncSavedJobs() {
  resultNode.hidden = true;
  syncButton.disabled = true;
  syncButton.textContent = "Syncing…";
  statusNode.textContent = "Reading SEEK jobs from the current tab.";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active browser tab found.");
    }

    const page = await collectSeekJobs(tab.id);
    if (!/(^|\.)seek\.co\.nz$/i.test(page.hostname || "")) {
      throw new Error("Open SEEK New Zealand in this tab first.");
    }
    if (!page.urls.length) {
      throw new Error("No SEEK jobs found. Open your Saved Jobs page and try again.");
    }

    statusNode.textContent = `Found ${page.urls.length} SEEK jobs. Sending to JobPilot…`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: page.urls, page_url: page.pageUrl }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || `JobPilot returned HTTP ${response.status}`);
    }

    statusNode.textContent = "Sync complete.";
    showResult(
      `<strong>${page.urls.length} found</strong><br>` +
        `${payload.imported_count ?? 0} imported<br>` +
        `${payload.existing_count ?? 0} already in JobPilot<br>` +
        `${payload.failed_count ?? 0} failed`
    );
  } catch (error) {
    statusNode.textContent = "Sync could not complete.";
    const message = error instanceof Error ? error.message : String(error);
    const receiverHint = /Failed to fetch|NetworkError|fetch/i.test(message)
      ? "<br><br>Make sure <code>python scripts/seek_saved_receiver.py</code> is running."
      : "";
    showResult(`${message}${receiverHint}`, { error: true });
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "Sync Saved Jobs";
  }
}

syncButton.addEventListener("click", syncSavedJobs);
