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

// 이 프레임에 제목칸이 있으면 그 내용이 비었는지 반환. 제목칸이 없으면 null(판단 불가)
function titleIsEmpty() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"], .se-documentTitle [contenteditable="true"]';
  const t = document.querySelector(sel);
  if (!t) return null;
  const v = (typeof t.value === "string" ? t.value : t.textContent || "").trim();
  return v.length === 0;
}

// 지금 커서(포커스)가 '제목' 영역 안에 있는지 — 제목에 확실히 들어갈 때만 입력하려는 안전장치
function titleFocused() {
  const ae = document.activeElement;
  if (!ae) return false;
  // 활성 요소 자신이나 조상이 제목 컨테이너/제목 속성이면 true
  if (ae.closest && ae.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')) return true;
  const ph = (ae.getAttribute && (ae.getAttribute("placeholder") || ae.getAttribute("data-placeholder") || ae.getAttribute("aria-label"))) || "";
  if (/제목/.test(ph)) return true;
  // 반대로, 본문 컴포넌트 안이면 명확히 false
  if (ae.closest && ae.closest('.se-component:not(.se-documentTitle), .se-text-paragraph')) return false;
  return false;
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
// 툴바 버튼(aria-label 에 '제목'이 있어도)은 제외하고, 실제 '제목 입력 영역'만 고른다.
function titlePoint() {
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
  const inToolbar = (el) => !!el.closest('[class*="toolbar"], [class*="Toolbar"], [role="toolbar"]');
  const rectOf = (el) => {
    let r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 8) {
      const inner = el.querySelector('[contenteditable="true"], input, textarea');
      if (inner) r = inner.getBoundingClientRect();
    }
    return r;
  };
  const tag = (el) => (el.tagName + "." + ((typeof el.className === "string" ? el.className : "").trim().split(/\s+/)[0] || "")).slice(0, 24);

  // 1순위: 진짜 제목 편집영역 (툴바 버튼 제외)
  const strong = [
    'input[placeholder*="제목"]',
    'textarea[placeholder*="제목"]',
    '[contenteditable="true"][data-placeholder*="제목"]',
    '.se-documentTitle [contenteditable="true"]',
    '.se-section-documentTitle [contenteditable="true"]',
    '[class*="documentTitle"] [contenteditable="true"]',
  ];
  let el = null;
  for (const s of strong) {
    const found = [...document.querySelectorAll(s)].filter((e) => !inToolbar(e));
    // 가장 넓은(=제목 입력줄) 것
    found.sort((a, b) => rectOf(b).width - rectOf(a).width);
    if (found[0]) { el = found[0]; break; }
  }
  // 2순위: 제목 컨테이너 자체
  if (!el) {
    const conts = [...document.querySelectorAll('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')].filter((e) => !inToolbar(e));
    conts.sort((a, b) => rectOf(b).width - rectOf(a).width);
    el = conts[0] || null;
  }
  if (!el) return { diag: "제목요소없음" };
  try { el.scrollIntoView({ block: "center" }); } catch (_) {}
  const r = rectOf(el);
  if (r.width < 20 || r.height < 5) return { diag: "rect0:" + tag(el) };
  const pt = toTop(r, window);
  if (!pt) return { diag: "환산실패" };
  pt.tag = tag(el);
  return pt;
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
  const qs = bodyEl.querySelectorAll(
    ".se-quotation, .se-component-quotation, .se-quote, blockquote, [class*='quotation'], [class*='se-quote']"
  );
  const last = qs[qs.length - 1];
  return { n: qs.length, lastLen: last ? (last.textContent || "").trim().length : -1 };
}

// 방금 만들어진 마지막 인용구 박스 '안'에 커서를 두고 문장을 타이핑
async function typeInLastQuote(text) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tSel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(tSel)) return false;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return false;
  const boxes = bodyEl.querySelectorAll(
    ".se-quotation, .se-component-quotation, .se-quote, blockquote, [class*='quotation'], [class*='se-quote']"
  );
  const box = boxes[boxes.length - 1];
  if (!box) return false;
  // 인용문 본문 영역(출처 칸 제외)에 커서
  const areas = [...box.querySelectorAll('.se-text-paragraph, [contenteditable], p, span')].filter((e) => {
    const ph = (e.getAttribute("data-placeholder") || "") + (typeof e.className === "string" ? e.className : "");
    return !/출처|cite|source/i.test(ph);
  });
  const target = areas[0] || box;
  bodyEl.focus();
  const r = document.createRange();
  r.selectNodeContents(target);
  r.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  await sleep(50);
  for (const ch of text) {
    document.execCommand("insertText", false, ch);
    await sleep(8);
  }
  return true;
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
  const vis = (el) => {
    const rr = el.getBoundingClientRect();
    return rr.width > 4 && rr.height > 4;
  };
  // 결과 항목 후보: li / 결과·항목·장소 클래스 / 검색어를 포함한 클릭 가능한 컨테이너
  let items = [...document.querySelectorAll('li, [class*="item"], [class*="result"], [class*="place"], [class*="search"] a, [class*="list"] > *')].filter(
    (x) => vis(x) && (x.textContent || "").indexOf(q) !== -1
  );
  // 너무 큰(패널 전체) 컨테이너는 제외하고, 실제 한 줄짜리 결과만
  items = items.filter((x) => x.getBoundingClientRect().height < 160);
  // 가장 위쪽(첫 결과)
  items.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  let it = items[0];
  if (!it) {
    // 검색어 매칭 실패 시: 결과 목록의 첫 항목이라도 (search 후 첫 결과가 보통 정답)
    const anyList = [...document.querySelectorAll('li, [class*="item"]')].filter(vis).filter((x) => {
      const h = x.getBoundingClientRect().height;
      return h > 24 && h < 160;
    });
    anyList.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    it = anyList[0];
    if (!it) return { diag: "결과항목없음" };
  }
  // 항목 안의 '추가/선택/등록' 버튼 우선, 없으면 항목의 제목 링크, 없으면 항목 자체
  const addBtn = [...it.querySelectorAll('button, a, [role="button"]')].find((b) =>
    /추가|선택|등록|확인/.test((b.textContent || "").trim())
  );
  const titleLink = it.querySelector('a, [class*="title"], strong, [class*="name"]');
  const target = addBtn || titleLink || it;
  const pt = toTop(target, window);
  return pt || { diag: "결과좌표없음" };
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

// ---------- 발행용 좌표 찾기 (모두: 어느 프레임이든 찾으면 맨 바깥 좌표로 환산) ----------
function _toTopFactory() {}

// 상단 '발행' 버튼
function publishOpenPoint() {
  const toTop = (el, win) => {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height) return null;
    let x = rr.left + rr.width / 2, y = rr.top + rr.height / 2;
    try { let w = win; while (w !== w.top) { const fr = w.frameElement.getBoundingClientRect(); x += fr.left; y += fr.top; w = w.parent; } } catch (_) { return null; }
    return { x: Math.round(x), y: Math.round(y) };
  };
  const cand = [...document.querySelectorAll('button, [role="button"], a')].filter((b) => {
    const rr = b.getBoundingClientRect();
    if (rr.width < 20 || rr.height < 10) return false;
    const s = (b.textContent || "").trim() + (b.getAttribute("class") || "") + (b.getAttribute("data-click-area") || "") + (b.getAttribute("data-log") || "");
    return /발행|publish/i.test(s);
  });
  // 화면 오른쪽 위(상단 툴바)의 발행 버튼 우선
  cand.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const btn = cand[0];
  return btn ? toTop(btn, window) : null;
}

// 발행 레이어 안의 '예약' 라디오/버튼
function reserveRadioPoint() {
  const toTop = (el, win) => {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height) return null;
    let x = rr.left + rr.width / 2, y = rr.top + rr.height / 2;
    try { let w = win; while (w !== w.top) { const fr = w.frameElement.getBoundingClientRect(); x += fr.left; y += fr.top; w = w.parent; } } catch (_) { return null; }
    return { x: Math.round(x), y: Math.round(y) };
  };
  const el = [...document.querySelectorAll('label, button, [role="radio"], span, a')].find((b) => {
    const rr = b.getBoundingClientRect();
    return rr.width > 0 && rr.height > 0 && /^예약/.test((b.textContent || "").trim());
  });
  return el ? toTop(el, window) : null;
}

// 발행 레이어 안의 날짜/시간 입력 후보 좌표 + 종류
function reserveFieldPoints() {
  const toTop = (el, win) => {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height) return null;
    let x = rr.left + rr.width / 2, y = rr.top + rr.height / 2;
    try { let w = win; while (w !== w.top) { const fr = w.frameElement.getBoundingClientRect(); x += fr.left; y += fr.top; w = w.parent; } } catch (_) { return null; }
    return { x: Math.round(x), y: Math.round(y) };
  };
  const out = { inputs: [], selects: [] };
  document.querySelectorAll("input").forEach((i) => {
    const rr = i.getBoundingClientRect();
    if (rr.width < 20 || rr.height < 10) return;
    const meta = (i.type || "") + (i.placeholder || "") + (i.className || "") + (i.getAttribute("aria-label") || "");
    if (/date|time|시|분|년|월|일|hour|min/i.test(meta) || i.type === "date" || i.type === "time") {
      const pt = toTop(i, window);
      if (pt) out.inputs.push({ pt, meta: meta.slice(0, 30) });
    }
  });
  document.querySelectorAll("select").forEach((s) => {
    const rr = s.getBoundingClientRect();
    if (rr.width < 20 || rr.height < 10) return;
    const pt = toTop(s, window);
    if (pt) out.selects.push({ pt, meta: (s.className || "").slice(0, 30) });
  });
  return out;
}

// 발행 레이어 하단의 최종 '발행' 확정 버튼
function publishConfirmPoint() {
  const toTop = (el, win) => {
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height) return null;
    let x = rr.left + rr.width / 2, y = rr.top + rr.height / 2;
    try { let w = win; while (w !== w.top) { const fr = w.frameElement.getBoundingClientRect(); x += fr.left; y += fr.top; w = w.parent; } } catch (_) { return null; }
    return { x: Math.round(x), y: Math.round(y) };
  };
  const cand = [...document.querySelectorAll('button, [role="button"], a')].filter((b) => {
    const rr = b.getBoundingClientRect();
    if (rr.width < 20 || rr.height < 10) return false;
    const s = (b.textContent || "").trim();
    const meta = (b.getAttribute("class") || "") + (b.getAttribute("data-click-area") || "") + (b.getAttribute("data-testid") || "");
    // 레이어 안의 확정 버튼: 텍스트가 정확히 '발행' 이거나 confirm 계열
    return /^발행$/.test(s) || /confirm|publish.*btn|btn.*publish|submit/i.test(meta);
  });
  // 화면에서 가장 아래쪽(레이어 하단) 것을 확정 버튼으로
  cand.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
  if (!cand.length) {
    const labels = [...document.querySelectorAll('button, [role="button"]')]
      .filter((b) => { const rr = b.getBoundingClientRect(); return rr.width > 0 && rr.height > 0; })
      .map((b) => (b.textContent || "").trim()).filter((t) => t && t.length <= 8).slice(0, 10);
    return { diag: "발행버튼후보:" + labels.join(",") };
  }
  return toTop(cand[0], window);
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

// ---------- 발행 흐름 ----------
// 상단 발행 버튼 → (예약이면 예약 선택 + 시간 설정) → 레이어 하단 발행 확정
async function doPublish(tabId, pub, notes) {
  try {
    await say(tabId, pub.mode === "reserve" ? "예약 발행 처리 중…" : "발행 중…");
    const op = (await execAll(tabId, publishOpenPoint)).filter(Boolean)[0];
    if (!op || typeof op.x !== "number") {
      notes.push("발행:상단버튼없음");
      return "발행 버튼을 못 찾았어요 — 직접 발행해 주세요";
    }
    await clickAt(tabId, op);
    await sleep(1500);

    if (pub.mode === "reserve") {
      // 예약 라디오 클릭
      const rr = (await execAll(tabId, reserveRadioPoint)).filter(Boolean)[0];
      if (rr && typeof rr.x === "number") {
        await clickAt(tabId, rr);
        await sleep(800);
      } else {
        notes.push("발행:예약버튼없음");
        return "발행창은 열렸어요. 예약 시간만 직접 고르고 발행을 눌러주세요";
      }
      // 날짜/시간 입력 시도 (input[type=date/time] 이 있으면 그 값으로)
      const when = (pub.when || "").split("T"); // ["YYYY-MM-DD","HH:MM"]
      const fields = (await execAll(tabId, reserveFieldPoints)).filter(Boolean)[0] || { inputs: [], selects: [] };
      let setOk = false;
      if (fields.inputs && fields.inputs.length && when.length === 2) {
        for (const f of fields.inputs) {
          try {
            await clickAt(tabId, f.pt);
            await sleep(200);
            const isTime = /time|시|분|:/i.test(f.meta);
            const val = isTime ? when[1] : when[0];
            // 전체 선택 후 새 값 입력
            const a = { modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 };
            await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...a });
            await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...a });
            await cdp(tabId, "Input.insertText", { text: val });
            await sleep(200);
            setOk = true;
          } catch (_) {}
        }
      }
      if (!setOk) {
        // 시간 입력칸을 못 다뤘으면 안전하게 멈춤 (엉뚱한 시간 자동발행 방지)
        notes.push("발행:예약시간칸못찾음 in" + (fields.inputs || []).length + " sel" + (fields.selects || []).length);
        return "예약창을 열고 '예약'을 선택했어요. 시간만 직접 맞추고 발행을 눌러주세요";
      }
      await sleep(500);
    }

    // 최종 발행 확정 버튼
    const cfs = (await execAll(tabId, publishConfirmPoint)).filter(Boolean);
    const cf = cfs.find((c) => c && typeof c.x === "number");
    if (!cf) {
      const d = cfs.map((c) => c && c.diag).filter(Boolean).join(" ");
      notes.push("발행:확정버튼없음 " + d);
      return "발행창은 열렸어요. 마지막 발행 버튼만 직접 눌러주세요";
    }
    await clickAt(tabId, cf);
    await sleep(2500);
    return pub.mode === "reserve" ? "예약됨! 그 시간에 자동 발행됩니다" : "발행 완료!";
  } catch (e) {
    notes.push("발행:" + (e && e.message ? e.message : e));
    return "발행 중 문제 — 직접 발행해 주세요";
  }
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

    // 4) 제목: 진짜 마우스 클릭으로 제목칸 포커스 → 전체선택 비우기 → trusted insertText
    //    (본문 오염 방지를 위해 JS 타이핑 예비는 쓰지 않고, 실패 시 클립보드 안내로만)
    let titleOk = false;
    if (payload.title) {
      await say(tabId, "제목 입력 중…");
      if (attached) {
        const results = (await execAll(tabId, titlePoint)).filter(Boolean);
        const pt = results.find((r) => r && typeof r.x === "number");
        if (pt) {
          // ★ 딱 한 번만, 그리고 '커서가 진짜 제목칸에 있을 때만' 넣는다.
          //    (본문에 잘못 들어가 제목/본문이 오염되던 문제 방지 — 확실치 않으면 클립보드 붙여넣기로만)
          try {
            await clickAt(tabId, pt);
            await sleep(350);
            const focusedTitle = (await execAll(tabId, titleFocused)).some(Boolean);
            if (focusedTitle) {
              await cdp(tabId, "Input.insertText", { text: payload.title });
              await sleep(350);
              titleOk = (await execAll(tabId, checkTitle, [payload.title.slice(0, 5)])).some(Boolean);
              if (!titleOk) notes.push("title:입력후확인안됨(" + (pt.tag || "") + ")");
            } else {
              notes.push("title:제목포커스실패(" + (pt.tag || "") + ") → 클립보드로");
            }
          } catch (e) {
            notes.push("title:" + (e && e.message ? e.message : e));
          }
        } else {
          const d = results.map((r) => r && r.diag).filter(Boolean).join("/");
          notes.push("title:좌표없음" + (d ? "(" + d + ")" : ""));
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
              // ★ 타이핑에 성공했으면(어디든 한 번 들어갔으면) 성공으로 간주 → 아래 예비 재입력을 막아 '두 번 써짐' 방지
              const typedIn = (await execAll(tabId, typeHere, [seg.text], notes, "quoteType")).some(Boolean);
              const after = (await execAll(tabId, quoteCount)).filter(Boolean)[0] || { n: 0, lastLen: -1 };
              const boxMade = after.n > (before.n || 0);
              quoteApplied = typedIn; // 텍스트가 들어갔으면 재입력 금지
              if (typedIn) bodyTyped = true;
              if (!boxMade) notes.push("인용:박스안생김(문장은 들어감)");
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

    // 6.4) 하단 연락처 배너 이미지 (글 맨 끝에)
    if (payload.footer && attached) {
      await say(tabId, "하단 연락처 배너 넣는 중…");
      await execAll(tabId, focusBodyEnd);
      await sendEnter(tabId, attached);
      const how = await insertImage(tabId, payload.footer, attached, notes);
      if (!how) notes.push("배너:실패");
      await execAll(tabId, focusBodyEnd);
      await sendEnter(tabId, attached);
    }

    // 6.5) 지도(장소) 첨부 — 설정에서 '지도 자동 첨부'를 켠 경우에만 (실험 기능)
    //   실패하면 엉뚱한 기본 지도가 들어가지 않도록 Esc 로 창을 닫고 아무것도 넣지 않는다.
    const academyName = (payload.academy && payload.academy.name) || "더몬스터학원";
    let mapOk = false;
    let mapTried = false;
    const pressEsc = async () => {
      const k = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
      try {
        await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...k });
        await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...k });
        await sleep(400);
      } catch (_) {}
    };
    if (attached && payload.tryMap) {
      mapTried = true;
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
            await cdp(tabId, "Input.insertText", { text: academyName });
            await sleep(250);
            await pressEnter(tabId);
            await sleep(2200);
            const rp = (await execAll(tabId, mapResultPoint, [academyName.slice(0, 4)])).filter(Boolean)[0];
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
                await pressEsc(); // 확인 못 찾으면 취소 (엉뚱한 지도 방지)
              }
            } else {
              notes.push("지도:검색결과없음(" + academyName + ")");
              await pressEsc(); // 결과 없으면 취소 — 기본 지도 삽입 방지
            }
          } else {
            notes.push("지도:검색창없음");
            await pressEsc();
          }
        } else notes.push("지도:장소버튼없음");
      } catch (e) {
        notes.push("지도:" + (e && e.message ? e.message : e));
        await pressEsc();
      }
    }

    // 6.6) 발행 (바로발행/예약발행) — 사용자가 고른 경우만
    let pubNote = "";
    const pub = payload.publish || { mode: "none" };
    if (pub.mode !== "none" && attached) {
      pubNote = await doPublish(tabId, pub, notes);
    } else if (pub.mode !== "none") {
      pubNote = "발행 자동화는 디버거가 필요해요(F12 닫고 다시 시도)";
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
    const mapNote = !mapTried
      ? ""
      : mapOk
        ? "\n📍 지도 첨부됨 (위치 확인해 주세요)"
        : "\n📍 지도 자동첨부 실패(글은 그대로) — 장소 버튼에서 '" + academyName + "' 직접 검색하세요";
    const closeMsg = pub.mode === "none" ? "내용 확인 후 발행해 주세요." : (pubNote || "발행 처리 완료");
    const hasIssue = (imgTotal > 0 && imgOk < imgTotal) || quoteNotes.length > 0 || (pub.mode !== "none" && !/완료|예약됨/.test(pubNote)) || (mapTried && !mapOk);
    const diagLine = hasIssue ? "\n진단: " + notes.slice(0, 7).join(" | ") : "";
    await say(
      tabId,
      `✅ ${titleNote}${imgNote ? "\n🖼️ " + imgNote : ""}${quoteNote ? "\n💬 " + quoteNote : ""}${mapNote}\n🚀 ${closeMsg}${diagLine}`,
      hasIssue,
      50000
    );
  } catch (e) {
    await say(tabId, "오류: " + (e && e.message ? e.message : e) + "\n" + notes.slice(0, 4).join(" | "), true, 20000);
  } finally {
    if (attached) {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }
}
