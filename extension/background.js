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
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"], [class*="documentTitle"], [class*=" documentTitle"], .se-title-text, .se-section-documentTitle, .se-documentTitle';
  const toTop = (r, win) => {
    let x = r.left + Math.min(r.width / 2, 200);
    let y = r.top + r.height / 2;
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
  // 후보를 모두 훑어 눈에 보이는(크기 있는) 것 중 가장 위쪽 요소를 고른다
  const cands = [...document.querySelectorAll(sel)];
  let best = null;
  for (const el of cands) {
    let r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 8) {
      const inner = el.querySelector('[contenteditable="true"], input, textarea');
      if (inner) r = inner.getBoundingClientRect();
    }
    if (r.width >= 40 && r.height >= 8) {
      if (!best || r.top < best.top) best = r;
    }
  }
  if (!best) {
    if (!cands.length) return null;
    try { cands[0].scrollIntoView({ block: "center" }); } catch (_) {}
    best = cands[0].getBoundingClientRect();
    if (best.width < 10 || best.height < 5) return { diag: "rect0" };
  }
  const pt = toTop(best, window);
  return pt || { diag: "환산실패" };
}

// 인용구 박스의 '출처' 편집칸 좌표 (인용문과 같은 문장이 잘못 들어갔을 때 비우기용)
function quoteCitePoint(sameText) {
  const tSel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(tSel)) return null;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return null;
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
  // 마지막 인용구 박스 안에서 '출처/인용' placeholder 를 가진 칸
  const boxes = bodyEl.querySelectorAll(".se-quotation, .se-component-quotation, blockquote, [class*='quotation']");
  const box = boxes[boxes.length - 1];
  const scope = box || bodyEl;
  const cites = [...scope.querySelectorAll('[data-placeholder], [contenteditable="true"]')].filter((e) => {
    const ph = e.getAttribute("data-placeholder") || "";
    const cls = (typeof e.className === "string" ? e.className : "") || "";
    return /출처|cite|source/i.test(ph + cls);
  });
  // 출처칸에 인용문과 같은 텍스트가 들어가 있으면 그 좌표 반환
  const bad = cites.find((c) => (c.textContent || "").trim() && (!sameText || (c.textContent || "").indexOf(sameText.slice(0, 6)) !== -1));
  const target = bad || cites[0];
  if (!target) return null;
  return toTop(target, window);
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

// 인용구/지도용 공통: 요소의 화면 좌표(맨 바깥 기준) 계산 문자열은 각 함수 안에 복제되어 있음
// (executeScript 로 주입되는 함수는 외부 변수 참조 불가)

// 인용구 버튼(+ 옆 ▾ 화살표) 좌표 — 어느 프레임이든 찾으면 반환
function quoteBtnPoint() {
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
    '[data-name="quotation"], button[data-log*="quotation"], button[aria-label*="인용"], button[title*="인용"], button[class*="quotation"]';
  let btn = document.querySelector(btnSel);
  if (!btn) {
    btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "인용구");
  }
  if (!btn) return null;
  const pt = toTop(btn, window);
  if (!pt) return null;
  // 옆의 펼침(▾) 버튼: 같은 부모 안의 다른 클릭 요소
  let arrow = null;
  const wrap = btn.parentElement;
  if (wrap) {
    const others = [...wrap.querySelectorAll("button, [role='button']")].filter(
      (b) => b !== btn && !btn.contains(b) && !b.contains(btn) && b.getBoundingClientRect().width > 0
    );
    if (others[0]) arrow = toTop(others[0], window);
  }
  return { btn: pt, arrow };
}

// 인용구 버튼 클릭 후 열린 스타일 목록에서 '세로줄(line)' 항목의 좌표
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
    (x.getAttribute("data-log") || "") +
    (x.getAttribute("aria-label") || "") +
    (x.getAttribute("title") || "");
  const els = [...document.querySelectorAll("button, [role='button'], li, a")].filter((x) => {
    const rr = x.getBoundingClientRect();
    if (!rr.width || !rr.height) return false;
    return /quotation|인용/i.test(idv(x)) || /세로/.test((x.textContent || "").trim());
  });
  // 세로줄 우선 → 목록의 두 번째(보통 1번이 기본 따옴표) → 아무거나
  let o = els.find((x) => /line|vertical/i.test(idv(x)) || /세로/.test(idv(x) + (x.textContent || "")));
  if (!o) {
    const opts = els.filter((x) => /option|list|layer/i.test(idv(x)) || x.tagName === "LI");
    if (opts.length > 1) o = opts[1];
    else if (opts.length === 1) o = opts[0];
  }
  if (!o) return null;
  const pt = toTop(o, window);
  return pt ? { pt, id: idv(o).slice(0, 40), n: els.length } : null;
}

// 본문 프레임의 인용구 박스 개수 + 마지막 박스의 글자수
function quoteCount() {
  const tSel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(tSel)) return null;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return null;
  const qs = bodyEl.querySelectorAll(".se-quotation, .se-component-quotation, blockquote, [class*='quotation']");
  const last = qs[qs.length - 1];
  return { n: qs.length, lastLen: last ? (last.textContent || "").trim().length : -1 };
}

// 커서 위치 그대로 타이핑 (빈 인용구 박스 '안'에 문장을 넣을 때 사용 — 끝으로 이동하지 않음)
async function typeHere(text) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tSel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(tSel)) return false;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return false;
  const s = window.getSelection();
  if (!s || !s.anchorNode || !bodyEl.contains(s.anchorNode)) return false;
  for (const ch of text) {
    document.execCommand("insertText", false, ch);
    await sleep(8);
  }
  return true;
}

// ---------- 지도(장소) 첨부용 ----------

function mapBtnPoint() {
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
  const sel = '[data-name="map"], button[data-log*="map"], button[aria-label*="장소"], button[title*="장소"]';
  let btn = document.querySelector(sel);
  if (!btn) btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "장소");
  return btn ? toTop(btn, window) : null;
}

function mapSearchPoint() {
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
  const ins = [...document.querySelectorAll("input")].filter((i) => {
    const rr = i.getBoundingClientRect();
    if (!rr.width || !rr.height) return false;
    const ph = (i.placeholder || "") + (i.getAttribute("aria-label") || "") + (i.className || "");
    return /장소|위치|검색|place|search/i.test(ph);
  });
  return ins[0] ? toTop(ins[0], window) : null;
}

function mapResultPoint(q) {
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
  const items = [...document.querySelectorAll("li")].filter((x) => {
    const rr = x.getBoundingClientRect();
    return rr.width > 0 && rr.height > 0 && (x.textContent || "").indexOf(q) !== -1;
  });
  const it = items[0];
  if (!it) return null;
  const addBtn = [...it.querySelectorAll("button")].find((b) => /추가|선택/.test((b.textContent || "").trim()));
  return toTop(addBtn || it, window);
}

function mapConfirmPoint() {
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
  const clickable = [...document.querySelectorAll('button, [role="button"], a')].filter((b) => {
    const rr = b.getBoundingClientRect();
    return rr.width > 0 && rr.height > 0;
  });
  // 1) '확인' 계열 텍스트/속성 (포함 매칭)
  let btn = clickable.find((b) => {
    const s = (b.textContent || "").trim() + (b.getAttribute("aria-label") || "") + (b.getAttribute("title") || "") + (b.className || "");
    return /확인|추가|완료|등록|삽입|적용|apply|confirm|submit/i.test(s);
  });
  if (btn) return toTop(btn, window);
  // 2) 못 찾으면 화면에 보이는 버튼 텍스트들을 진단으로 (좌표는 없음)
  const labels = clickable
    .map((b) => (b.textContent || "").trim())
    .filter((t) => t && t.length <= 8)
    .slice(0, 8);
  return { diag: "확인버튼후보:" + labels.join(",") };
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

// 진짜 Enter 키 (현재 포커스 위치에)
async function pressEnter(tabId) {
  const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", text: "\r", unmodifiedText: "\r", ...key });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...key });
  await sleep(60);
}

// 본문 끝에서 진짜 Enter 로 줄바꿈 — 스크립트 줄바꿈은 네이버가 무시해 문단이 붙어버림
async function sendEnter(tabId, attached) {
  await execAll(tabId, focusBodyEnd);
  if (attached) {
    try {
      await pressEnter(tabId);
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
          const results = (await execAll(tabId, titlePoint)).filter(Boolean);
          const pt = results.find((r) => r && typeof r.x === "number");
          if (pt) {
            // 더블클릭으로 확실히 포커스 (한 번 클릭이 안 먹는 경우 대비)
            await clickAt(tabId, pt);
            await sleep(200);
            await clickAt(tabId, pt);
            await sleep(300);
            await cdp(tabId, "Input.insertText", { text: payload.title });
            await sleep(300);
            titleOk = (await execAll(tabId, checkTitle, [payload.title.slice(0, 5)])).some(Boolean);
            if (!titleOk) notes.push("title:클릭입력무반응(" + pt.x + "," + pt.y + ")");
          } else {
            const d = results.map((r) => r && r.diag).filter(Boolean).join("/");
            notes.push("title:좌표없음" + (d ? "(" + d + ")" : ""));
          }
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
        // 순서: 빈 인용구 박스를 먼저 만들고(▾화살표→세로줄 우선) → 그 '안'에 문장을 타이핑.
        // 선택(드래그)을 흉내내는 방식은 네이버 내부 모델이 무시해서 빈 박스가 됐었음.
        await say(tabId, "인용구 넣는 중…");
        await sendEnter(tabId, attached); // 인용 앞 여백
        let quoteApplied = false;
        if (attached) {
          const before = (await execAll(tabId, quoteCount)).filter(Boolean)[0] || { n: 0 };
          const bp = (await execAll(tabId, quoteBtnPoint)).filter(Boolean)[0];
          if (bp) {
            try {
              await execAll(tabId, focusBodyEnd);
              let opened = false;
              if (bp.arrow) {
                // ▾ 화살표 → 스타일 목록 → 세로줄
                await clickAt(tabId, bp.arrow);
                await sleep(600);
                const opt = (await execAll(tabId, quoteStyleOption)).filter(Boolean)[0];
                if (opt && opt.pt) {
                  await clickAt(tabId, opt.pt);
                  await sleep(600);
                  opened = true;
                  notes.push("인용스타일:" + opt.id);
                }
              }
              if (!opened) {
                // 화살표가 없으면 본 버튼 (마지막 사용 스타일로 삽입됨)
                await clickAt(tabId, bp.btn);
                await sleep(600);
                const opt = (await execAll(tabId, quoteStyleOption)).filter(Boolean)[0];
                if (opt && opt.pt) {
                  await clickAt(tabId, opt.pt);
                  await sleep(600);
                }
              }
              // 커서가 새 빈 박스 안에 있음 → 문장을 그 자리에 타이핑
              const typedIn = (await execAll(tabId, typeHere, [seg.text], notes, "quoteType")).some(Boolean);
              const after = (await execAll(tabId, quoteCount)).filter(Boolean)[0] || { n: 0, lastLen: -1 };
              quoteApplied = typedIn && after.n > (before.n || 0) && after.lastLen > 0;
              if (quoteApplied) bodyTyped = true;
              else notes.push("인용:박스" + (after.n > (before.n || 0) ? "생김" : "안생김") + " 안글자" + after.lastLen + (typedIn ? "" : " 타이핑실패"));
              // 출처칸에 같은 문장이 복제됐으면 클릭해서 비운다 (전체선택 후 삭제, trusted)
              if (quoteApplied) {
                const cite = (await execAll(tabId, quoteCitePoint, [seg.text])).filter(Boolean)[0];
                if (cite && typeof cite.x === "number") {
                  await clickAt(tabId, cite);
                  await sleep(200);
                  const a = { modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 };
                  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...a });
                  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...a });
                  await sleep(120);
                  const del = { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 };
                  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...del });
                  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...del });
                  await sleep(150);
                }
              }
              // 박스 밖으로 탈출 (아래 방향키)
              await execAll(tabId, focusBodyEnd);
              const dk = { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 };
              await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...dk });
              await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...dk });
              await sleep(150);
            } catch (e) {
              notes.push("인용:" + (e && e.message ? e.message : e));
            }
          } else {
            notes.push("인용:버튼못찾음");
          }
        } else {
          notes.push("인용:디버거없음");
        }
        if (!quoteApplied) {
          // 자동 박스 실패 → 문장을 일반 문단으로라도 남긴다
          const typed = (await execAll(tabId, typeOneLine, [seg.text], notes, "quote")).some(Boolean);
          if (typed) bodyTyped = true;
        }
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

    // 6.5) 지도(장소) 첨부 — 장소 버튼 → "더몬스터학원" 검색 → 첫 결과 추가 (실험 기능)
    let mapOk = false;
    if (attached) {
      try {
        await say(tabId, "지도(장소) 첨부 중…");
        const mb = (await execAll(tabId, mapBtnPoint)).filter(Boolean)[0];
        if (mb) {
          await execAll(tabId, focusBodyEnd);
          await clickAt(tabId, mb);
          await sleep(1500);
          const sp = (await execAll(tabId, mapSearchPoint)).filter(Boolean)[0];
          if (sp) {
            await clickAt(tabId, sp);
            await sleep(250);
            await cdp(tabId, "Input.insertText", { text: "더몬스터학원" });
            await sleep(250);
            await pressEnter(tabId);
            await sleep(2200);
            const rp = (await execAll(tabId, mapResultPoint, ["더몬스터"])).filter(Boolean)[0];
            if (rp && typeof rp.x === "number") {
              await clickAt(tabId, rp);
              await sleep(1000);
              const cfs = (await execAll(tabId, mapConfirmPoint)).filter(Boolean);
              const cf = cfs.find((c) => c && typeof c.x === "number");
              if (cf) {
                await clickAt(tabId, cf);
                await sleep(1400);
                mapOk = true;
              } else {
                const d = cfs.map((c) => c && c.diag).filter(Boolean).join(" ");
                notes.push("지도:확인버튼없음 " + d);
              }
            } else notes.push("지도:검색결과없음");
          } else notes.push("지도:검색창없음");
        } else notes.push("지도:장소버튼없음");
      } catch (e) {
        notes.push("지도:" + (e && e.message ? e.message : e));
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
    const quoteNotes = notes.filter((n) => n.indexOf("인용:") === 0);
    const quoteNote = quoteNotes.length ? "인용구 박스 일부 실패(문장은 들어감) — " + quoteNotes.slice(0, 2).join(" | ") : "";
    const mapNote = mapOk ? "지도 첨부됨 (위치 확인해 주세요)" : "지도 자동첨부 실패 — 장소 버튼에서 '더몬스터학원' 검색하면 됩니다";
    const hasIssue = (imgTotal > 0 && imgOk < imgTotal) || quoteNotes.length > 0;
    const diagLine = hasIssue || !mapOk ? "\n진단: " + notes.slice(0, 6).join(" | ") : "";
    await say(
      tabId,
      `✅ ${titleNote}${imgNote ? "\n🖼️ " + imgNote : ""}${quoteNote ? "\n💬 " + quoteNote : ""}\n📍 ${mapNote}\n내용 확인 후 발행해 주세요.${diagLine}`,
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
