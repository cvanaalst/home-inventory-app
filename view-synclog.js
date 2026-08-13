// Sync log (§8.4): the app's black box for "sync isn't working". A capped
// ring buffer, local only, rendered newest-first with a coloured status
// dot. Deliberately named "sync log" not "activity" — if this app ever
// grows a real-world event timeline, two screens called "activity" would
// send people to the wrong one every time.

import { getActivityLog, clearActivityLog } from "./db.js";
import { escapeHtml } from "./ui.js";
import { t } from "./i18n.js";

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function initSyncLogView() {
  const listEl = document.getElementById("synclog-list");
  const emptyEl = document.getElementById("synclog-empty");
  const clearBtn = document.getElementById("synclog-clear-btn");

  function render(entries) {
    emptyEl.hidden = entries.length > 0;
    clearBtn.hidden = entries.length === 0;
    listEl.innerHTML = entries
      .slice()
      .reverse()
      .map(
        (e) => `
        <div class="synclog-row">
          <span class="synclog-dot synclog-dot-${escapeHtml(e.outcome)}"></span>
          <span class="synclog-body">
            <span class="synclog-kind">${escapeHtml(t(`synclog.kind.${e.kind}`))} — ${escapeHtml(t(`synclog.outcome.${e.outcome}`))}</span>
            <span class="synclog-detail">${escapeHtml(e.detail || "")}</span>
            <span class="synclog-when">${escapeHtml(formatWhen(e.at))}</span>
          </span>
        </div>`,
      )
      .join("");
  }

  clearBtn.addEventListener("click", async () => {
    await clearActivityLog();
    render([]);
  });

  async function show() {
    render(await getActivityLog());
  }

  return { show };
}
