from pathlib import Path
import json

BACKGROUND = Path("extension/background.js")
MANIFEST = Path("extension/manifest.json")
INSTALL = Path("extension/install.bat")
UPDATE = Path("extension/update.bat")
WORKFLOW = Path(".github/workflows/apply-smarteditor-fix.yml")
SELF = Path("scripts/apply_smarteditor_compat_fix.py")

MARKER = "// ---------- SmartEditor 2026 compatibility fixes ----------"
INSERT_BEFORE = "// ---------- 발행 흐름 ----------"
PATCH = r"""// The title component is virtual-rendered in some SmartEditor versions.
// Remember the exact title node found by titlePoint(), then restore a caret
// inside that same title component before trusted text insertion.
titlePoint = function titlePointFixed() {
  const toTop = (el, win) => {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height) return null;
    let x = rr.left + Math.min(Math.max(28, rr.width * 0.18), 180);
    let y = rr.top + Math.min(Math.max(12, rr.height / 2), 30);
    try {
      let w = win;
      while (w !== w.top) {
        const fr = w.frameElement.getBoundingClientRect();
        x += fr.left;
        y += fr.top;
        w = w.parent;
      }
    } catch (_) {
      return null;
    }
    return { x: Math.round(x), y: Math.round(y) };
  };
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rr = el.getBoundingClientRect();
    return rr.width > 20 && rr.height > 5;
  };
  const inToolbar = (el) => !!el.closest('[class*="toolbar"], [class*="Toolbar"], [role="toolbar"]');
  const titleSel = '.se-component.se-documentTitle, .se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]';

  let target = [...document.querySelectorAll(
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [data-placeholder*="제목"], [aria-label*="제목"]'
  )].find((el) => visible(el) && !inToolbar(el));

  let root = target && target.closest ? target.closest(titleSel) : null;
  if (!root) {
    const roots = [...document.querySelectorAll(titleSel)]
      .filter((el) => visible(el) && !inToolbar(el))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    root = roots[0] || null;
  }
  if (!root) return null;

  const inner = [...root.querySelectorAll(
    '[contenteditable="true"], .se-text-paragraph, [data-placeholder], .se-title-text, p, textarea, input'
  )].filter((el) => visible(el) && !inToolbar(el));
  if (!target || !root.contains(target)) {
    target = inner.find((el) => el.matches('[contenteditable="true"], textarea, input')) ||
      inner.find((el) => /제목/.test((el.getAttribute("data-placeholder") || "") + (el.getAttribute("aria-label") || ""))) ||
      inner[0] || root;
  }

  try { root.scrollIntoView({ block: "center" }); } catch (_) {}
  window.__monsterBlogTitleRoot = root;
  window.__monsterBlogTitleTarget = target;

  const pt = toTop(target, window) || toTop(root, window);
  if (!pt) return null;
  const classes = typeof root.className === "string" ? root.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
  pt.tag = (root.tagName + (classes ? "." + classes : "")).slice(0, 64);
  return pt;
};

titleFocused = function titleFocusedFixed() {
  const titleSel = '.se-component.se-documentTitle, .se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]';
  const insideTitle = (node) => {
    const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return !!(el && el.closest && el.closest(titleSel));
  };

  if (insideTitle(document.activeElement)) return true;
  const current = window.getSelection && window.getSelection();
  if (current && insideTitle(current.anchorNode)) return true;

  const root = window.__monsterBlogTitleRoot;
  let target = window.__monsterBlogTitleTarget;
  if (!root || !root.isConnected || !root.matches(titleSel)) return false;
  if (!target || !target.isConnected || !root.contains(target)) target = root;

  try {
    const focusable = target.matches && target.matches('input, textarea, [contenteditable="true"]')
      ? target
      : target.querySelector && target.querySelector('[contenteditable="true"], input, textarea');
    const focusTarget = focusable || target;
    if (focusTarget.focus) focusTarget.focus({ preventScroll: true });

    if (focusTarget.tagName === "INPUT" || focusTarget.tagName === "TEXTAREA") {
      try { focusTarget.setSelectionRange(focusTarget.value.length, focusTarget.value.length); } catch (_) {}
    } else {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch (_) {
    return false;
  }

  const selection = window.getSelection && window.getSelection();
  return insideTitle(document.activeElement) || !!(selection && insideTitle(selection.anchorNode));
};

checkTitle = function checkTitleFixed(prefix) {
  const wanted = String(prefix || "").replace(/\s+/g, "");
  if (!wanted) return false;
  const titleSel = '.se-component.se-documentTitle, .se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]';
  const roots = [...document.querySelectorAll(titleSel)];
  for (const root of roots) {
    const text = (root.textContent || "").replace(/\s+/g, "");
    if (text.includes(wanted)) return true;
    for (const field of root.querySelectorAll('input, textarea')) {
      if (String(field.value || "").replace(/\s+/g, "").includes(wanted)) return true;
    }
  }
  return false;
};

// The old flow trusted the selection left behind after choosing a quotation
// style. Naver often clears that selection, so locate the newest quote box
// again and place the caret in its main text area explicitly.
typeHere = async function typeInNewestQuoteFixed(text) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rr = el.getBoundingClientRect();
    return rr.width > 4 && rr.height > 4;
  };
  const quoteSel = ".se-quotation, .se-component-quotation, .se-quote, blockquote, [class*='quotation'], [class*='se-quote']";
  const boxes = [...document.querySelectorAll(quoteSel)].filter(visible);
  const box = boxes[boxes.length - 1];
  if (!box) return false;

  const sourceLike = (el) => {
    const meta =
      (el.getAttribute && (el.getAttribute("data-placeholder") || "")) + " " +
      (el.getAttribute && (el.getAttribute("aria-label") || "")) + " " +
      (typeof el.className === "string" ? el.className : "");
    return /출처|cite|source/i.test(meta);
  };
  const areas = [...box.querySelectorAll('[contenteditable="true"], .se-text-paragraph, [data-placeholder], p')]
    .filter((el) => visible(el) && !sourceLike(el));
  const target = areas.find((el) => el.matches('[contenteditable="true"]')) ||
    areas.find((el) => /인용|내용|문구/.test((el.getAttribute("data-placeholder") || "") + (el.getAttribute("aria-label") || ""))) ||
    areas[0] || box;

  try {
    const editable = target.matches && target.matches('[contenteditable="true"]')
      ? target
      : target.closest && target.closest('[contenteditable="true"]');
    const focusTarget = editable || target;
    if (focusTarget.focus) focusTarget.focus({ preventScroll: true });

    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    await pause(60);

    for (const ch of String(text || "")) {
      document.execCommand("insertText", false, ch);
      await pause(8);
    }
    await pause(80);
  } catch (_) {
    return false;
  }

  const actual = (box.textContent || "").replace(/\s+/g, "");
  const expected = String(text || "").replace(/\s+/g, "").slice(0, 8);
  return !!expected && actual.includes(expected);
};

quoteCount = function quoteCountFixed() {
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rr = el.getBoundingClientRect();
    return rr.width > 4 && rr.height > 4;
  };
  const qs = [...document.querySelectorAll(
    ".se-quotation, .se-component-quotation, .se-quote, blockquote, [class*='quotation'], [class*='se-quote']"
  )].filter(visible);
  if (!qs.length) return null;
  const last = qs[qs.length - 1];
  return { n: qs.length, lastLen: (last.textContent || "").trim().length };
};

// Return null, not a diagnostic object, from frames that do not own the map
// result. The caller takes the first truthy frame result, so a diagnostic
// object could previously hide a real result found in a later iframe.
mapResultPoint = function mapResultPointFixed(q) {
  const toTop = (el, win) => {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height) return null;
    let x = rr.left + Math.min(Math.max(20, rr.width / 2), rr.width - 10);
    let y = rr.top + rr.height / 2;
    try {
      let w = win;
      while (w !== w.top) {
        const fr = w.frameElement.getBoundingClientRect();
        x += fr.left;
        y += fr.top;
        w = w.parent;
      }
    } catch (_) {
      return null;
    }
    return { x: Math.round(x), y: Math.round(y) };
  };
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rr = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rr.width > 20 && rr.height > 18 && rr.height < 220 && style.visibility !== "hidden" && style.display !== "none";
  };
  const normalize = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");
  const needle = normalize(q);
  if (!needle) return null;

  let items = [...document.querySelectorAll(
    'li, [role="option"], [role="listitem"], [class*="result"], [class*="place-item"], [class*="place_item"], [class*="search-item"], [class*="search_item"], [class*="list"] > *'
  )].filter((el) => visible(el) && normalize(el.textContent).includes(needle));

  // Prefer the smallest matching row rather than a whole panel that happens
  // to contain the same text.
  items.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return (ar.width * ar.height) - (br.width * br.height) || ar.top - br.top;
  });
  const item = items[0];
  if (!item) return null;

  const controls = [...item.querySelectorAll('button, a, [role="button"]')].filter(visible);
  const action = controls.find((el) => /추가|선택|등록|확인/.test((el.textContent || "").trim()));
  const title = item.querySelector('a, [class*="title"], [class*="name"], strong');
  const target = action || title || item;
  return toTop(target, window);
};
"""


def patch_background():
    text = BACKGROUND.read_text(encoding="utf-8")
    if MARKER not in text:
        if INSERT_BEFORE not in text:
            raise RuntimeError("background insertion marker not found")
        block = MARKER + "\n" + PATCH.rstrip() + "\n\n"
        text = text.replace(INSERT_BEFORE, block + INSERT_BEFORE, 1)
        BACKGROUND.write_text(text, encoding="utf-8", newline="\n")


def patch_manifest():
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    data["version"] = "2.0.1"
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def add_downloads(path: Path):
    raw = path.read_text(encoding="utf-8")
    nl = "\r\n" if "\r\n" in raw else "\n"
    text = raw.replace("\r\n", "\n")
    if "if not exist prompts mkdir prompts" not in text:
        text = text.replace("set V=%RANDOM%\n", "set V=%RANDOM%\nif not exist prompts mkdir prompts\n", 1)
    if "prompts/hooks.js" not in text:
        anchor = 'curl.exe -L -s -o popup.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/popup.js?v=%V%"\necho'
        idx = text.find(anchor)
        if idx == -1:
            raise RuntimeError(f"popup.js download anchor not found in {path}")
        line_end = text.find("\n", text.find("\n", idx) + 1) + 1
        extra = (
            'curl.exe -L -s -o prompts\\hooks.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/prompts/hooks.js?v=%V%"\n'
            'echo   - prompts/hooks.js OK\n'
            'curl.exe -L -s -o prompts\\body.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/prompts/body.js?v=%V%"\n'
            'echo   - prompts/body.js OK\n'
            'curl.exe -L -s -o prompts\\bridge.js "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/extension/prompts/bridge.js?v=%V%"\n'
            'echo   - prompts/bridge.js OK\n'
        )
        text = text[:line_end] + extra + text[line_end:]
    path.write_text(text.replace("\n", nl), encoding="utf-8", newline="")


def main():
    patch_background()
    patch_manifest()
    add_downloads(INSTALL)
    add_downloads(UPDATE)
    if WORKFLOW.exists():
        WORKFLOW.unlink()
    if SELF.exists():
        SELF.unlink()


if __name__ == "__main__":
    main()
