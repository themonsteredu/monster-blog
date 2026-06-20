// content.js — 네이버 블로그 글쓰기(스마트에디터 ONE) 화면 안에서 실행됨
// 팝업이 보낸 제목/본문/이미지를 에디터에 자동 입력한다.
//
// ★ 본문칸을 못 찾으면, 화면에 있는 편집영역 정보를 팝업에 알려줘서(진단) 선택자를 보정한다.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function editablesIn(doc) {
  try {
    return Array.from(doc.querySelectorAll('[contenteditable="true"]'));
  } catch (e) {
    return [];
  }
}

// 제목 편집영역 찾기 (글자칸/입력칸 모두 시도)
function getTitleEditable() {
  // 1) data-placeholder 에 '제목' 인 편집영역
  let el = document.querySelector('[contenteditable="true"][data-placeholder*="제목"]');
  if (el) return el;
  // 2) documentTitle 컨테이너 '안'의 편집영역
  const cont = document.querySelector(
    '[class*="ocumentTitle"], .se-documentTitle, .se-section-documentTitle, .se-title'
  );
  if (cont) {
    const inner = cont.querySelector('[contenteditable="true"], input, textarea');
    if (inner) return inner;
  }
  // 3) data-placeholder 가 '제목' 인 요소 자체 (글자칸이 아닐 수도 — 입력칸 등)
  el = document.querySelector('[data-placeholder*="제목"], input[placeholder*="제목"], textarea[placeholder*="제목"]');
  if (el) return el;
  return null;
}

// 진단: 제목 후보(class에 'itle' 포함) 요소들을 태그/클래스/편집가능 여부와 함께 보여준다
function describeEditables() {
  const out = [];
  out.push(
    `ed${editablesIn(document).length} file${document.querySelectorAll("input[type='file']").length} input${document.querySelectorAll("input").length} ta${document.querySelectorAll("textarea").length} iframe${document.querySelectorAll("iframe").length}`
  );
  document.querySelectorAll('[class*="itle"], [class*="ocumentTitle"]').forEach((e) => {
    const ce = e.getAttribute && e.getAttribute("contenteditable");
    const inEd = !!(e.closest && e.closest('[contenteditable="true"]'));
    const cls = (typeof e.className === "string" ? e.className : "").slice(0, 32);
    out.push(`<${e.tagName} ${cls} ce=${ce} inEd=${inEd ? 1 : 0}>`);
  });
  return "\n[진단2] " + out.slice(0, 12).join("  ");
}

// 본문 편집영역 찾기 (제목 영역이 아닌 편집가능 요소)
function getBodyEditable() {
  const titleEl = getTitleEditable();
  const eds = editablesIn(document).filter(
    (e) =>
      e !== titleEl &&
      !e.closest('[class*="ocumentTitle"]') &&
      !e.closest(".se-documentTitle") &&
      !e.closest(".se-section-documentTitle")
  );
  if (eds.length) return eds[0];
  // 보조 선택자들
  return document.querySelector(
    '.se-component.se-text [contenteditable="true"], .se-content [contenteditable="true"], .se-text-paragraph'
  );
}

function clearEditable(el) {
  el.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);
}

function moveCursorToEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// 한 글자씩 입력해 '실시간으로 써지는' 효과 (네이버 에디터 호환도 더 좋음)
async function typeInto(el, text, delay = 12) {
  el.focus();
  // 입력칸(input/textarea)이면 value 로 한 번에 설정 (React 등 호환 위해 native setter 사용)
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    try {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
    } catch (_) {
      el.value = text;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  for (const ch of text) {
    if (ch === "\n") {
      document.execCommand("insertParagraph", false, null);
    } else {
      document.execCommand("insertText", false, ch);
    }
    if (delay) await sleep(delay);
  }
}

function base64ToFile(base64, mediaType) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mediaType.includes("png") ? "png" : "jpg";
  return new File([bytes], `photo_${Date.now()}.${ext}`, { type: mediaType });
}

async function uploadImage(img) {
  let input =
    document.querySelector("input[type='file']") ||
    document.querySelector("input[accept*='image']") ||
    document.querySelector("input.se-image-file, input[name*='file'], input[name*='image']");
  if (!input) {
    console.warn("[블로그자동화] 사진 업로드 input 못 찾음");
    return false;
  }
  const file = base64ToFile(img.data, img.media_type);
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function fillEditor({ title, body, images }) {
  const notes = [];

  // 1) 제목
  const titleEl = getTitleEditable();
  if (titleEl) {
    if (titleEl.tagName !== "INPUT" && titleEl.tagName !== "TEXTAREA") clearEditable(titleEl);
    await typeInto(titleEl, title);
    await sleep(300);
  } else {
    notes.push("제목칸 못 찾음");
  }

  // 2) 본문
  const bodyEl = getBodyEditable();
  if (!bodyEl || bodyEl === titleEl) {
    return { ok: false, msg: "본문칸 못 찾음" + describeEditables() };
  }

  bodyEl.focus();
  await sleep(200);

  // 본문을 줄 단위로: [이미지N]=사진, [인용]=인용구, 그 외=본문 문단
  const imgRe = /^\[이미지\s*(\d+)\]\s*$/;
  const quoteRe = /^\[인용\]\s*(.*)$/;
  const lines = body.split("\n");
  let first = true;
  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if ((m = line.match(imgRe))) {
      const idx = parseInt(m[1], 10) - 1;
      if (images && images[idx]) {
        const ok = await uploadImage(images[idx]);
        if (!ok) notes.push(`이미지${m[1]} 업로드 실패`);
        await sleep(1800);
        moveCursorToEnd(bodyEl);
      }
      continue;
    }
    if (line === "") continue;
    moveCursorToEnd(bodyEl);
    if ((m = line.match(quoteRe))) {
      // 인용구: 따옴표로 감싸 한 문단으로 (네이버 인용구 스타일 적용은 다음 단계)
      await typeInto(bodyEl, (first ? "" : "\n") + "“" + m[1] + "”");
    } else {
      await typeInto(bodyEl, (first ? "" : "\n") + line);
    }
    first = false;
    await sleep(120);
  }

  const ok = notes.length === 0;
  // 진단을 항상 함께 보여줘서 선택자를 정확히 보정한다
  const msg = (notes.length ? notes.join(", ") : "입력 완료") + describeEditables();
  return { ok, msg };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "fill") return;
  // 에디터가 있는 프레임에서만 처리/응답
  if (!getTitleEditable() && !getBodyEditable()) return;
  fillEditor(msg)
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse({ ok: false, msg: String(e) }));
  return true; // 비동기 응답
});
