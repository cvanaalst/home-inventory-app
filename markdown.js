// PURE minimal Markdown renderer for help.js content. No imports, no DOM.
// Deliberately line-based: each paragraph/bullet must live on one source
// line, or a bare newline shatters into a stray <br> (BLUEPRINT.md §13.12).
//
// Supports: # / ## / ### headings, **bold**, *italic* / _italic_,
// `code`, [text](url) links, "- "/"* " bullet lists, blank-line-separated
// paragraphs. Raw HTML in the source is always escaped, never passed
// through — and link URLs are scheme-checked before being trusted.

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Only http(s)/mailto and relative/hash links are ever linkified — never
 * javascript:, data:, vbscript:, or any other scheme. */
function isSafeUrl(url) {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return true;
  if (/^[#/.]/.test(trimmed)) return true;
  return false;
}

// A Private Use Area character can never appear inside escapeHtml's
// output or in typed help content, so it's a safe, collision-free
// placeholder delimiter — unlike a plain space or digit, it can't
// collide with real escaped text sitting next to a code span.
const CODE_MARK = "\uE000";

/** Applies inline formatting to an already-escaped line. Code spans are
 * pulled out into placeholders FIRST and restored last, so their content
 * is never re-scanned by the bold/italic/link passes that run in between
 * (a plain string-replace order alone doesn't protect already-substituted
 * HTML from later regexes matching inside it). */
function renderInline(escapedLine) {
  const codeSpans = [];
  let out = escapedLine.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code);
    return `${CODE_MARK}${codeSpans.length - 1}${CODE_MARK}`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, text) => `<strong>${text}</strong>`);
  out = out.replace(/\*([^*]+)\*/g, (_, text) => `<em>${text}</em>`);
  out = out.replace(/_([^_]+)_/g, (_, text) => `<em>${text}</em>`);
  // The url group tolerates one level of nested parens (e.g. a trailing
  // "(1)" in a javascript: url) so it doesn't stop at the wrong ")".
  out = out.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, (whole, label, url) => {
    // label/url were already HTML-escaped as part of the whole line, so
    // quotes inside the URL can't break out of the href attribute.
    return isSafeUrl(url) ? `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
  // Code spans are restored last, verbatim — their content was captured
  // before any other inline regex ran, so it can never be reinterpreted.
  out = out.replace(new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, "g"), (_, i) => `<code>${codeSpans[Number(i)]}</code>`);
  return out;
}

/** render(markdown) -> safe HTML string. */
export function render(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const html = [];
  let inList = false;

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInline(escapeHtml(bullet[1]))}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(escapeHtml(line))}</p>`);
  }

  closeList();
  return html.join("\n");
}
