// content.js — 네이버 블로그 글쓰기(스마트에디터 ONE) 화면 안에서 실행됨
// 팝업이 보낸 제목/본문/이미지를 에디터에 자동 입력한다.
//
// ★ 네이버 에디터는 구조가 자주 바뀝니다. 입력이 안 되면 아래 선택자(SELECTOR)를
//   실제 화면 개발자도구로 확인해 수정해야 합니다.

const SEL = {
  // 제목 입력 영역(편집 가능한 곳)
  titleEditable: [
    ".se-section-documentTitle [contenteditable='true']",
    ".se-documentTitle [contenteditable='true']",
    ".se-section-documentTitle .se-text-paragraph",
  ],
  // 본문 입력 영역(첫 문단)
  bodyEditable: [
    ".se-section-text [contenteditable='true']",
    ".se-component-content [contenteditable='true']",
    ".se-text-paragraph[contenteditable='true']",
  ],
  // 사진 업로드용 숨은 input
  fileInput: ["input[type='file']"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findOne(selectors) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

// 편집영역에 포커스 주고 텍스트 삽입 (execCommand 가 SE 모델도 갱신함)
function insertText(editable, text) {
  editable.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);
  document.execCommand("insertText", false, text);
}

function appendText(editable, text) {
  editable.focus();
  // 커서를 맨 끝으로
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand("insertText", false, text);
}

function base64ToFile(base64, mediaType) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mediaType.includes("png") ? "png" : "jpg";
  return new File([bytes], `photo_${Date.now()}.${ext}`, { type: mediaType });
}

async function uploadImage(img) {
  const input = findOne(SEL.fileInput);
  if (!input) {
    console.warn("[블로그자동화] 사진 업로드 input 을 못 찾음 — 이미지 건너뜀");
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
  const titleEl = findOne(SEL.titleEditable);
  if (titleEl) {
    insertText(titleEl, title);
    await sleep(400);
  } else {
    notes.push("제목 영역을 못 찾음");
  }

  // 2) 본문 + 이미지 (본문을 [이미지N] 기준으로 쪼갬)
  const bodyEl = findOne(SEL.bodyEditable);
  if (!bodyEl) {
    return { ok: false, msg: "본문 영역을 못 찾음 (선택자 수정 필요)" };
  }
  bodyEl.focus();
  await sleep(200);

  const parts = body.split(/\[이미지\s*(\d+)\]/);
  let first = true;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      const seg = parts[i];
      if (seg && seg.trim()) {
        if (first) {
          insertText(bodyEl, seg);
          first = false;
        } else {
          appendText(bodyEl, "\n" + seg);
        }
        await sleep(250);
      }
    } else {
      const idx = parseInt(parts[i], 10) - 1;
      if (images && images[idx]) {
        const ok = await uploadImage(images[idx]);
        if (!ok) notes.push(`[이미지${parts[i]}] 업로드 실패`);
        await sleep(1800); // 업로드 반영 대기
        try { bodyEl.focus(); } catch (_) {}
      }
    }
  }

  return { ok: notes.length === 0, msg: notes.join(", ") };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "fill") return;
  // 에디터가 있는 프레임에서만 처리/응답
  if (!findOne(SEL.titleEditable) && !findOne(SEL.bodyEditable)) {
    return; // 이 프레임엔 에디터 없음 — 응답하지 않음
  }
  fillEditor(msg)
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse({ ok: false, msg: String(e) }));
  return true; // 비동기 응답
});
