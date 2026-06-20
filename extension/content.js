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

// 제목 편집영역 찾기
function getTitleEditable() {
  // 1) data-placeholder 에 '제목'
  let el = document.querySelector('[contenteditable="true"][data-placeholder*="제목"]');
  if (el) return el;
  // 2) documentTitle 계열 컨테이너 안의 편집영역 (대소문자 변형 포함)
  el = document.querySelector(
    '[class*="ocumentTitle"] [contenteditable="true"], .se-title [contenteditable="true"], .se-documentTitle [contenteditable="true"], .se-section-documentTitle [contenteditable="true"]'
  );
  if (el) return el;
  // 3) placeholder 노드가 '제목' 인 곳의 편집 컨테이너
  const ph = document.querySelector('[data-placeholder*="제목"], .se-placeholder');
  if (ph) {
    const c = ph.matches('[contenteditable="true"]')
      ? ph
      : ph.closest('[contenteditable="true"]') || ph.parentElement?.querySelector('[contenteditable="true"]');
    if (c) return c;
  }
  return null;
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
    clearEditable(titleEl);
    await typeInto(titleEl, title);
    await sleep(300);
  } else {
    notes.push("제목칸 못 찾음");
  }

  // 2) 본문
  const bodyEl = getBodyEditable();
  if (!bodyEl) {
    // 진단: 화면의 편집영역 개수와 클래스 일부를 알려준다 (선택자 보정용)
    const all = editablesIn(document);
    const sample = all
      .slice(0, 8)
      .map((e) => (e.className || e.tagName || "").toString().slice(0, 40))
      .join(" | ");
    return { ok: false, msg: `본문칸 못 찾음. 편집영역 ${all.length}개 [${sample}]` };
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

  return { ok: notes.length === 0, msg: notes.join(", ") };
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
