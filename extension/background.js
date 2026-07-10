// background.js — 백그라운드 오케스트레이터 (v1.3.x)
//
// 왜 이 파일이 필요한가:
// 지금까지 사진 자동삽입이 안 된 근본 원인은, 자바스크립트로 만든 가짜 이벤트(드래그/파일선택)를
// 브라우저가 isTrusted=false 로 표시해 네이버 에디터가 무시하기 때문이다.
// 그래서 chrome.debugger(CDP)로 "진짜 사용자 입력과 완전히 동일한(trusted)" Ctrl+V 를 만들어
// 클립보드에 올린 사진을 실제 붙여넣기 경로로 통과시킨다.
//
// v1.3.1: 본문 입력을 "모든 프레임에 뿌리고 각 프레임이 스스로 판단"하는 검증된 방식으로 복구.
// (특정 프레임 하나를 골라 넣는 방식은 보이지 않는 엉뚱한 프레임을 고를 수 있었음)
// 팝업이 닫혀도 여기(서비스워커)서 끝까지 진행하고, 진행 상황은 글쓰기 화면 위 초록 상자로 보여준다.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "fillNaver") fillNaver(msg.tabId, msg.payload);
});

function cdp(tabId, method, params) {
  return chrome.debugger.sendCommand({ tabId }, method, params || {});
}

// 모든 프레임에서 실행 — 각 함수가 스스로 "내 프레임이 맞는지" 판단한다 (검증된 방식)
async function execAll(tabId, func, args, notes, tag) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func,
      args: args || [],
    });
    return (res || []).map((r) => (r ? r.result : null));
  } catch (e) {
    if (notes) notes.push((tag || "exec") + ":" + (e && e.message ? e.message : e));
    return [];
  }
}

// 글쓰기 화면 오른쪽 위에 진행 상황 상자 표시 (맨 바깥 프레임에만)
async function say(tabId, text, isError, hideAfter) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (t, e, h) => {
        let el = document.getElementById("__mb_overlay");
        if (!el) {
          el = document.createElement("div");
          el.id = "__mb_overlay";
          el.style.cssText =
            "position:fixed;top:12px;right:12px;z-index:2147483647;color:#fff;padding:10px 14px;" +
            "border-radius:10px;font-size:13px;font-family:sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);" +
            "white-space:pre-line;max-width:340px;line-height:1.5;";
          document.documentElement.appendChild(el);
        }
        el.style.background = e ? "#d33" : "#03c75a";
        el.textContent = t;
        if (el.__t) clearTimeout(el.__t);
        if (h) el.__t = setTimeout(() => el.remove(), h);
      },
      args: [text, !!isError, hideAfter || 0],
    });
  } catch (_) {}
}

// ---------- 페이지 안에서 실행되는 함수들 (외부 변수 참조 금지 — 각자 selector 를 갖고 있음) ----------

function scanFrame() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  const eds = document.querySelectorAll('[contenteditable="true"]').length;
  const titleEl = document.querySelector(sel);
  return { hasTitle: !!titleEl, hasBody: !titleEl && eds > 0, eds, top: window === window.top };
}

function focusTitle() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  const t = document.querySelector(sel);
  if (!t) return false;
  t.focus();
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
    try { t.select(); } catch (_) {}
  } else {
    const r = document.createRange();
    r.selectNodeContents(t);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  return true;
}

function checkTitle(prefix) {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  const t = document.querySelector(sel);
  if (!t) return false;
  const v = typeof t.value === "string" ? t.value : t.textContent || "";
  return v.indexOf(prefix) !== -1;
}

function typeTitleFallback(title) {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  const t = document.querySelector(sel);
  if (!t) return false;
  t.focus();
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
    try {
      const proto = t.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(t, title);
    } catch (_) {
      t.value = title;
    }
    t.dispatchEvent(new Event("input", { bubbles: true }));
    t.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const r = document.createRange();
    r.selectNodeContents(t);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.execCommand("insertText", false, title);
  }
  const v = typeof t.value === "string" ? t.value : t.textContent || "";
  return v.indexOf(title.slice(0, 5)) !== -1;
}

// 본문 프레임에서만 동작: 커서를 본문 끝으로 (제목 프레임이면 스스로 건너뜀)
function focusBodyEnd() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(sel)) return false;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return false;
  bodyEl.focus();
  const r = document.createRange();
  r.selectNodeContents(bodyEl);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  return true;
}

// 본문 프레임에서만 동작: 한 줄을 한 글자씩 입력.
// 줄바꿈은 여기서 하지 않는다 — 네이버가 스크립트 줄바꿈을 무시해 문단이 붙어버리므로,
// 배경에서 '진짜 Enter 키'(sendEnter)를 따로 보낸다.
async function typeOneLine(line) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(sel)) return false;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return false;
  bodyEl.focus();
  const r = document.createRange();
  r.selectNodeContents(bodyEl);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  for (const ch of line) {
    document.execCommand("insertText", false, ch);
    await sleep(8);
  }
  return true;
}

// 줄바꿈 예비용 (디버거 없을 때)
function insertPara() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(sel)) return false;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return false;
  bodyEl.focus();
  document.execCommand("insertParagraph", false, null);
  return true;
}

// 제목칸의 화면 좌표 (프레임 안이면 바깥 좌표로 환산) — 진짜 마우스 클릭용
function titlePoint() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"], [class*="documentTitle"] [contenteditable="true"], .se-title-text [contenteditable="true"]';
  let t = document.querySelector(sel);
  if (!t) return null;
  try { t.scrollIntoView({ block: "center" }); } catch (_) {}
  let r = t.getBoundingClientRect();
  // 크기가 0이면 부모(제목 컨테이너) 좌표로 대체
  if (!r.width || !r.height) {
    const cont = t.closest('[class*="documentTitle"], .se-title, .se-section-documentTitle') || t.parentElement;
    if (cont) r = cont.getBoundingClientRect();
  }
  if (!r.width || !r.height) return null;
  let x = r.left + Math.min(r.width / 2, 200);
  let y = r.top + r.height / 2;
  try {
    let w = window;
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
}

// 본문 프레임의 사진 개수 (삽입 성공 판정용) — 제목 프레임은 0 반환
function countImages() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(sel)) return { res: 0, img: 0 };
  return {
    res: document.querySelectorAll(".se-image-resource").length,
    img: document.querySelectorAll("img").length,
  };
}

// 인용구 처리 1단계 (본문 프레임에서만): 방금 '막 타이핑한' 인용 줄을 커서 기준으로 선택하고,
// 인용구 툴바 버튼의 화면 좌표(맨 바깥 기준)를 계산해 돌려준다.
// ※ DOM 문단 구조(.se-text-paragraph)에 의존하지 않는다 — 네이버 구조가 달라도 동작하도록
//   브라우저 Selection.modify 로 "커서에서 줄 앞까지"를 선택한다.
// 버튼 클릭은 배경에서 '진짜 마우스 클릭'(CDP)으로 한다 — 가짜 click()은 네이버가 무시함.
function prepQuote() {
  const tSel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(tSel)) return null;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return null;
  const s = window.getSelection();
  // 커서가 이 본문 안에 있어야 함 (방금 인용 줄을 타이핑한 프레임만 통과)
  if (!s || s.rangeCount === 0) return { diag: "커서없음" };
  let node = s.anchorNode;
  if (!(node && bodyEl.contains(node))) return { diag: "커서밖" };
  bodyEl.focus();
  // 커서(줄 끝)에서 줄 맨 앞까지 선택
  try {
    s.collapseToEnd();
    s.modify("extend", "backward", "lineboundary");
  } catch (_) {
    return { diag: "선택불가" };
  }
  const selLen = s.toString().length;
  if (selLen === 0) return { diag: "선택0" };
  // 인용구 버튼 좌표 (이 프레임 → 바깥 프레임)
  const toTop = (el, win) => {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height) return null;
    let x = rr.left + rr.width / 2;
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
  const btnSel =
    '[data-name="quotation"], button[data-log*="quotation"], button[aria-label*="인용"], button[title*="인용"], [class*="quotation"] button, button[class*="quotation"]';
  let btn = document.querySelector(btnSel);
  let win = window;
  if (!btn) {
    try {
      btn = window.top.document.querySelector(btnSel);
      win = window.top;
    } catch (_) {}
  }
  if (!btn) return { diag: "버튼없음sel" + selLen };
  const pt = toTop(btn, win);
  if (!pt) return { diag: "버튼좌표없음" };
  const qcount = document.querySelectorAll(".se-quotation, .se-component-quotation, blockquote, [class*='quotation']").length;
  return { btn: pt, qcount, sel: selLen, diag: "" };
}

// 인용구 처리 2단계: 버튼 클릭 후 열린 스타일 목록에서 '세로줄(line)' 항목의 좌표를 찾는다
function quoteStyleOption() {
  const toTop = (el, win) => {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height) return null;
    let x = rr.left + rr.width / 2;
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
  const idv = (x) =>
    (typeof x.className === "string" ? x.className : "") +
    (x.getAttribute("data-value") || "") +
    (x.getAttribute("data-name") || "") +
    (x.getAttribute("data-log") || "");
  const docs = [[document, window]];
  try {
    if (window.top !== window) docs.push([window.top.document, window.top]);
  } catch (_) {}
  for (const dw of docs) {
    const d = dw[0], w = dw[1];
    // 열린 레이어/드롭다운 안의 인용구 스타일 항목들
    const els = [...d.querySelectorAll('[class*="layer"] button, [class*="list"] button, li button, button, li')].filter((x) => {
      const v = idv(x);
      if (!/quotation/i.test(v)) return false;
      if (/toolbar/i.test(v)) return false; // 툴바 본체 버튼 제외
      const rr = x.getBoundingClientRect();
      return rr.width > 0 && rr.height > 0;
    });
    let o = els.find((x) => /line|vertical/i.test(idv(x)));
    if (!o && els.length > 1) o = els[1];
    if (!o && els.length === 1) o = els[0];
    if (o) {
      const pt = toTop(o, w);
      if (pt) return { pt, id: idv(o).slice(0, 30) };
    }
  }
  return null;
}

// 인용구 처리 3단계: 박스가 실제로 생겼는지 확인하고 커서를 본문 끝으로
function quoteFinish(prevCount) {
  const tSel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(tSel)) return null;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return null;
  const now = document.querySelectorAll(".se-quotation, .se-component-quotation, blockquote").length;
  bodyEl.focus();
  const r = document.createRange();
  r.selectNodeContents(bodyEl);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  return { ok: now > prevCount, now };
}

// 예비 1: 가짜 paste 이벤트 (에디터가 스크립트 paste 를 받아줄 경우)
function syntheticPaste(b64, type) {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(sel)) return false;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return false;
  bodyEl.focus();
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], "photo.png", { type });
  const dt = new DataTransfer();
  dt.items.add(file);
  bodyEl.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  return true;
}

// 예비 2: 가짜 드래그&드롭
function syntheticDrop(b64, type) {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(sel)) return false;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return false;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], "photo.png", { type });
  const dt = new DataTransfer();
  dt.items.add(file);
  const mk = (t) => new DragEvent(t, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt });
  bodyEl.dispatchEvent(mk("dragenter"));
  bodyEl.dispatchEvent(mk("dragover"));
  bodyEl.dispatchEvent(mk("drop"));
  return true;
}

// 진짜 마우스 클릭 (CDP) — 가짜 click() 은 네이버 툴바가 무시함
async function clickAt(tabId, pt) {
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
}

// 진짜 Enter 키로 줄바꿈 — 스크립트 줄바꿈은 네이버가 무시해 문단이 붙어버림
async function sendEnter(tabId, attached) {
  await execAll(tabId, focusBodyEnd);
  if (attached) {
    const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    try {
      await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", text: "\r", unmodifiedText: "\r", ...key });
      await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...key });
      await sleep(60);
      return;
    } catch (_) {}
  }
  await execAll(tabId, insertPara);
  await sleep(40);
}

// ---------- 사진 삽입 ----------

// 페이지(메인 월드)에서 실행할 "사진을 클립보드에 올리는" 코드 문자열
function clipExpr(im) {
  return (
    "(async () => { try {" +
    `const r = await fetch("data:${im.media_type};base64,${im.data}");` +
    "let b = await r.blob();" +
    'if (b.type !== "image/png") {' +
    "  const bmp = await createImageBitmap(b);" +
    "  const c = new OffscreenCanvas(bmp.width, bmp.height);" +
    '  c.getContext("2d").drawImage(bmp, 0, 0);' +
    '  b = await c.convertToBlob({ type: "image/png" });' +
    "}" +
    'await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);' +
    'return "ok";' +
    '} catch (e) { return "err:" + (e && e.message ? e.message : e); } })()'
  );
}

// 모든 프레임의 사진 개수 합계
async function totalImages(tabId) {
  const counts = await execAll(tabId, countImages);
  return counts
    .filter(Boolean)
    .reduce((a, c) => ({ res: a.res + (c.res || 0), img: a.img + (c.img || 0) }), { res: 0, img: 0 });
}

async function waitMoreImages(tabId, before, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(500);
    const now = await totalImages(tabId);
    if (now.res > before.res || now.img > before.img) {
      await sleep(1200); // 업로드 마무리 여유
      return true;
    }
  }
  return false;
}

async function insertImage(tabId, im, attached, notes) {
  const before = await totalImages(tabId);

  // A) 진짜 붙여넣기: 클립보드에 사진을 올리고, 디버거로 trusted Ctrl+V
  if (attached) {
    try {
      const w = await cdp(tabId, "Runtime.evaluate", {
        expression: clipExpr(im),
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      const wv = w && w.result ? w.result.value : null;
      if (wv === "ok") {
        await execAll(tabId, focusBodyEnd);
        await sleep(200);
        const key = {
          modifiers: 2, // Ctrl
          key: "v",
          code: "KeyV",
          windowsVirtualKeyCode: 86,
          nativeVirtualKeyCode: 86,
        };
        await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", commands: ["Paste"], ...key });
        await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...key });
        if (await waitMoreImages(tabId, before, 12000)) return "A";
        notes.push("A:붙여넣기 무반응");
      } else {
        notes.push("A:" + (wv || "클립보드 실패"));
      }
    } catch (e) {
      notes.push("A:" + (e && e.message ? e.message : e));
    }
  } else {
    notes.push("A:디버거 없음");
  }

  // B) 예비: 가짜 paste 이벤트
  try {
    await execAll(tabId, syntheticPaste, [im.data, im.media_type], notes, "B");
    if (await waitMoreImages(tabId, before, 5000)) return "B";
    notes.push("B:무반응");
  } catch (_) {}

  // C) 예비: 가짜 드래그&드롭
  try {
    await execAll(tabId, syntheticDrop, [im.data, im.media_type], notes, "C");
    if (await waitMoreImages(tabId, before, 5000)) return "C";
    notes.push("C:무반응");
  } catch (_) {}

  return null;
}

// ---------- 메인 흐름 ----------

async function fillNaver(tabId, payload) {
  let attached = false;
  const notes = [];
  try {
    await say(tabId, "글 입력을 시작합니다…");

    // 1) 프레임 상황 파악 (진단용) — 본문칸이 어딘가에 있는지 확인
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scanFrame,
    });
    const scan = frames
      .map((f) => f && f.result && `f${f.frameId}${f.result.top ? "T" : ""}:제${+f.result.hasTitle} 본${+f.result.hasBody} 편${f.result.eds}`)
      .filter(Boolean)
      .join(" | ");
    const hasBodyAnywhere = frames.some((f) => f.result && f.result.hasBody);
    const titleFrame = frames.find((f) => f.result && f.result.hasTitle) || null;
    if (!hasBodyAnywhere) {
      await say(tabId, "본문칸을 못 찾았어요. 글쓰기 화면을 새로고침(F5)한 뒤 다시 눌러주세요.\n진단: " + scan, true, 15000);
      return;
    }

    // 2) 디버거 연결 (trusted 입력용) — F12 개발자도구가 열려 있으면 실패함
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      attached = true;
    } catch (e) {
      notes.push("attach:" + (e && e.message ? e.message : e));
      await say(tabId, "⚠ 사진 자동삽입 모드를 못 켰어요.\nF12 개발자도구가 열려 있으면 닫고 다시 시도하세요.\n일단 글만 입력합니다.", true);
      await sleep(2000);
    }

    // 3) 글쓰기 탭을 앞으로 (클립보드 사용 조건)
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      if (attached) await cdp(tabId, "Page.bringToFront");
    } catch (_) {}
    await sleep(400);

    // 4) 제목: 진짜 마우스 클릭으로 제목칸 포커스 → trusted insertText → 예비 방식들
    let titleOk = false;
    if (payload.title) {
      await say(tabId, "제목 입력 중…");
      if (attached) {
        try {
          const pt = (await execAll(tabId, titlePoint)).filter(Boolean)[0];
          if (pt) {
            await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
            await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
            await sleep(300);
            await cdp(tabId, "Input.insertText", { text: payload.title });
            await sleep(300);
            titleOk = (await execAll(tabId, checkTitle, [payload.title.slice(0, 5)])).some(Boolean);
            if (!titleOk) notes.push("title:클릭입력 무반응(" + pt.x + "," + pt.y + ")");
          } else notes.push("title:좌표없음");
        } catch (e) {
          notes.push("title:" + (e && e.message ? e.message : e));
        }
      }
      if (!titleOk) {
        const focused = (await execAll(tabId, focusTitle, [], notes, "titleFocus")).some(Boolean);
        if (focused && attached) {
          try {
            await cdp(tabId, "Input.insertText", { text: payload.title });
            await sleep(300);
            titleOk = (await execAll(tabId, checkTitle, [payload.title.slice(0, 5)])).some(Boolean);
          } catch (_) {}
        }
        if (!titleOk && focused) {
          titleOk = (await execAll(tabId, typeTitleFallback, [payload.title])).some(Boolean);
        }
      }
    }

    // 5) 본문을 세그먼트로 나눔: 텍스트 묶음 / [이미지N] / [인용]→앞뒤 빈 줄의 단독 문장
    const segs = [];
    {
      const imgRe = /^\[이미지\s*(\d+)\]\s*$/;
      const quoteRe = /^\[인용\]\s*(.*)$/;
      let buf = [];
      for (const raw of (payload.body || "").split("\n")) {
        const line = raw.trim();
        let m;
        if ((m = line.match(imgRe))) {
          if (buf.length) { segs.push({ t: "text", lines: buf }); buf = []; }
          segs.push({ t: "img", idx: parseInt(m[1], 10) - 1 });
        } else if ((m = line.match(quoteRe))) {
          if (buf.length) { segs.push({ t: "text", lines: buf }); buf = []; }
          segs.push({ t: "quote", text: m[1] });
        } else if (line !== "") {
          buf.push(line);
        } else if (buf.length && buf[buf.length - 1] !== "") {
          buf.push(""); // 문단 사이 빈 줄 유지 (한 번만)
        }
      }
      if (buf.length) segs.push({ t: "text", lines: buf });
    }

    // 6) 순서대로 입력 (글 → 사진 → 글 …) — 모든 프레임에 뿌리면 본문 프레임만 스스로 반응
    const images = payload.images || [];
    let imgOk = 0, imgTotal = 0, bodyTyped = false;
    for (const seg of segs) {
      if (seg.t === "text") {
        await say(tabId, "본문 입력 중… (실시간으로 써집니다)");
        for (const line of seg.lines) {
          if (line === "") {
            await sendEnter(tabId, attached);
            continue;
          }
          const typed = (await execAll(tabId, typeOneLine, [line], notes, "type")).some(Boolean);
          if (typed) bodyTyped = true;
          await sendEnter(tabId, attached);
          // 첫 줄부터 아예 안 써지면 바로 원인 표시하고 중단
          if (!bodyTyped) {
            await say(tabId, "본문이 안 써졌어요. 화면을 새로고침(F5)한 뒤 다시 시도해 주세요.\n진단: " + scan + "\n" + notes.slice(0, 5).join(" | "), true, 30000);
            return;
          }
        }
      } else if (seg.t === "quote") {
        await say(tabId, "인용구 넣는 중…");
        await sendEnter(tabId, attached); // 인용 앞 여백
        // 인용 줄을 타이핑 (커서는 줄 끝에 남는다 — 아직 Enter 치지 않음)
        const typed = (await execAll(tabId, typeOneLine, [seg.text], notes, "quote")).some(Boolean);
        if (typed) bodyTyped = true;
        await sleep(120);
        // 방금 친 줄을 선택 + 인용구 버튼 좌표 → 진짜 마우스 클릭으로 박스 적용
        let quoteApplied = false;
        if (attached) {
          const preps = (await execAll(tabId, prepQuote, [], notes, "quotePrep")).filter(Boolean);
          const prep = preps.find((p) => p && p.btn);
          if (prep) {
            try {
              await clickAt(tabId, prep.btn);
              await sleep(600);
              const opt = (await execAll(tabId, quoteStyleOption)).filter(Boolean)[0];
              if (opt && opt.pt) {
                await clickAt(tabId, opt.pt);
                await sleep(500);
              }
              const fins = (await execAll(tabId, quoteFinish, [prep.qcount || 0])).filter(Boolean);
              quoteApplied = fins.some((f) => f && f.ok);
              if (!quoteApplied) notes.push("인용:박스무반응" + (opt ? " opt:" + opt.id : " 스타일없음"));
            } catch (e) {
              notes.push("인용:" + (e && e.message ? e.message : e));
            }
          } else {
            notes.push("인용:" + (preps.map((p) => p && p.diag).filter(Boolean).join("/") || "준비실패"));
          }
        } else {
          notes.push("인용:디버거없음");
        }
        // 인용 블록 밖으로 나가 다음 문단을 위한 줄바꿈
        await execAll(tabId, focusBodyEnd);
        await sendEnter(tabId, attached);
      } else {
        const im = images[seg.idx];
        if (!im) continue;
        imgTotal++;
        await say(tabId, `사진 ${seg.idx + 1} 넣는 중… (클립보드 붙여넣기)`);
        const how = await insertImage(tabId, im, attached, notes);
        if (how) imgOk++;
      }
    }

    // 7) 마무리 정리 + 결과 표시
    if (!titleOk && payload.title && attached) {
      // 사진 붙여넣기로 클립보드가 바뀌었을 수 있으니 제목을 다시 복사해 둔다
      try {
        await cdp(tabId, "Runtime.evaluate", {
          expression: "navigator.clipboard.writeText(" + JSON.stringify(payload.title) + ').then(()=>"ok")',
          awaitPromise: true,
          userGesture: true,
        });
      } catch (_) {}
    }
    const titleNote = titleOk ? "제목·본문 입력 완료" : "본문 입력 완료 · 제목은 복사해뒀어요(제목칸 클릭 후 Ctrl+V)";
    const imgNote = imgTotal
      ? imgOk === imgTotal
        ? `사진 ${imgOk}장 모두 넣었습니다`
        : `사진 ${imgOk}/${imgTotal}장`
      : "";
    const quoteNotes = notes.filter((n) => n.indexOf("인용") === 0);
    const quoteNote = quoteNotes.length ? "인용구 박스 일부 실패(문장은 들어감) — " + quoteNotes.slice(0, 2).join(" | ") : "";
    const hasIssue = (imgTotal > 0 && imgOk < imgTotal) || quoteNotes.length > 0;
    const diagLine = hasIssue ? "\n진단: " + notes.slice(0, 5).join(" | ") : "";
    await say(
      tabId,
      `✅ ${titleNote}${imgNote ? "\n🖼️ " + imgNote : ""}${quoteNote ? "\n💬 " + quoteNote : ""}\n내용 확인 후 발행해 주세요.${diagLine}`,
      hasIssue,
      40000
    );
  } catch (e) {
    await say(tabId, "오류: " + (e && e.message ? e.message : e) + "\n" + notes.slice(0, 4).join(" | "), true, 20000);
  } finally {
    if (attached) {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }
}
