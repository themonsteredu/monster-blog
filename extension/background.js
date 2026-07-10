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

// 본문 프레임에서만 동작: 줄들을 한 글자씩 입력 (실시간 써지는 효과). 빈 줄("")은 줄바꿈만.
async function typeLines(lines) {
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
  for (const line of lines) {
    for (const ch of line) {
      document.execCommand("insertText", false, ch);
      await sleep(8);
    }
    document.execCommand("insertParagraph", false, null);
    await sleep(40);
  }
  return true;
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

// 본문 프레임에서만 동작: 인용 문장을 입력하고, 그 문단만 정확히 선택해 네이버 인용구(세로줄) 적용.
// 실패해도 문장은 이미 들어가 있어 글이 망가지지 않는다.
async function applyQuote(text) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tSel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(tSel)) return null;
  const bodyEl = document.querySelector('[contenteditable="true"]');
  if (!bodyEl) return null;
  const diag = [];
  const toEnd = () => {
    bodyEl.focus();
    const r = document.createRange();
    r.selectNodeContents(bodyEl);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };
  // 1) 본문 끝에 인용 문장 + 다음 빈 문단
  toEnd();
  for (const ch of text) {
    document.execCommand("insertText", false, ch);
    await sleep(8);
  }
  document.execCommand("insertParagraph", false, null);
  await sleep(120);
  // 2) 방금 쓴 인용 문단만 정확히 선택
  let s = window.getSelection();
  let node = s.anchorNode;
  let p = node && (node.nodeType === 1 ? node : node.parentElement);
  p = p && p.closest(".se-text-paragraph, p");
  const prev = p && p.previousElementSibling;
  if (!prev || (prev.textContent || "").indexOf(text.slice(0, 4)) === -1) {
    return { ok: false, diag: "선택실패" };
  }
  const r = document.createRange();
  r.selectNodeContents(prev);
  s.removeAllRanges();
  s.addRange(r);
  await sleep(120);
  // 3) 인용구 버튼 클릭 (이 프레임 → 바깥 프레임)
  const btnSel =
    '[data-name="quotation"], button[data-log*="quotation"], button[aria-label*="인용"], button[title*="인용"], button[class*="quotation"]';
  let btn = document.querySelector(btnSel);
  let doc = document;
  if (!btn) {
    try {
      btn = window.top.document.querySelector(btnSel);
      doc = window.top.document;
    } catch (_) {}
  }
  if (!btn) return { ok: false, diag: "버튼없음" };
  btn.click();
  await sleep(400);
  // 4) 스타일 목록이 떴으면 '세로줄(line)' 스타일 선택
  let picked = "";
  for (const d of [doc, document]) {
    const opts = [...d.querySelectorAll('button, [role="button"], li')].filter((x) => {
      if (x === btn) return false;
      const idv =
        (typeof x.className === "string" ? x.className : "") +
        (x.getAttribute("data-value") || "") +
        (x.getAttribute("data-name") || "") +
        (x.getAttribute("data-log") || "");
      return /quotation/i.test(idv);
    });
    let o = opts.find((x) => {
      const idv =
        (typeof x.className === "string" ? x.className : "") +
        (x.getAttribute("data-value") || "") +
        (x.getAttribute("data-name") || "") +
        (x.getAttribute("data-log") || "");
      return /line|vertical/i.test(idv);
    });
    if (!o && opts.length) o = opts[Math.min(1, opts.length - 1)];
    if (o) {
      o.click();
      picked =
        (o.getAttribute("data-value") || o.getAttribute("data-name") || (typeof o.className === "string" ? o.className : "")).slice(0, 24);
      break;
    }
  }
  await sleep(300);
  // 5) 커서를 인용 블록 밖(본문 끝)으로
  toEnd();
  document.execCommand("insertParagraph", false, null);
  return { ok: true, diag: "스타일:" + (picked || "기본") };
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

    // 4) 제목: trusted insertText → 안 되면 기존 방식 → 그래도 안 되면 클립보드 안내
    let titleOk = false;
    if (payload.title) {
      await say(tabId, "제목 입력 중…");
      const focusedArr = await execAll(tabId, focusTitle, [], notes, "titleFocus");
      const focused = focusedArr.some(Boolean);
      if (focused && attached) {
        try {
          await cdp(tabId, "Input.insertText", { text: payload.title });
          await sleep(300);
          titleOk = (await execAll(tabId, checkTitle, [payload.title.slice(0, 5)])).some(Boolean);
        } catch (e) {
          notes.push("title:" + (e && e.message ? e.message : e));
        }
      }
      if (!titleOk && focused) {
        titleOk = (await execAll(tabId, typeTitleFallback, [payload.title])).some(Boolean);
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
        const typed = (await execAll(tabId, typeLines, [seg.lines], notes, "type")).some(Boolean);
        if (typed) bodyTyped = true;
        else notes.push("type:무반응");
        // 첫 문단부터 아예 안 써지면 바로 원인 표시하고 중단
        if (!bodyTyped) {
          await say(tabId, "본문이 안 써졌어요. 화면을 새로고침(F5)한 뒤 다시 시도해 주세요.\n진단: " + scan + "\n" + notes.slice(0, 5).join(" | "), true, 30000);
          return;
        }
      } else if (seg.t === "quote") {
        await say(tabId, "인용구 넣는 중…");
        const rs = (await execAll(tabId, applyQuote, [seg.text], notes, "quote")).filter(Boolean);
        const q = rs.find((x) => x && x.ok);
        if (q) bodyTyped = true;
        else notes.push("인용:" + (rs.map((x) => x && x.diag).filter(Boolean).join("/") || "무반응"));
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
        : `사진 ${imgOk}/${imgTotal}장 (진단: ${notes.slice(0, 4).join(" | ")})`
      : "";
    await say(
      tabId,
      `✅ ${titleNote}${imgNote ? "\n🖼️ " + imgNote : ""}\n내용 확인 후 발행해 주세요.`,
      imgTotal > 0 && imgOk < imgTotal,
      30000
    );
  } catch (e) {
    await say(tabId, "오류: " + (e && e.message ? e.message : e) + "\n" + notes.slice(0, 4).join(" | "), true, 20000);
  } finally {
    if (attached) {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }
}
