// Renders help.js content through markdown.js. Re-rendered on every show()
// so a language switch while the view is closed is picked up on reopen.

import { helpContent } from "./help.js";
import { render } from "./markdown.js";
import { getLang } from "./i18n.js";

export function initHelpView() {
  const el = document.getElementById("help-content");

  function show() {
    el.innerHTML = render(helpContent(getLang()));
  }

  return { show };
}
