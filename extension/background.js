// background.js — 백그라운드 오케스트레이터 (v1.3.0 핵심)
//
// 왜 이 파일이 필요한가:
// 지금까지 사진 자동삽입이 안 된 근본 원인은, 자바스크립트로 만든 가짜 이벤트(드래그/파일선택)를
// 브라우저가 isTrusted=false 로 표시해 네이버 에디터가 무시하기 때문이다.
// 그래서 chrome.debugger(CDP)로 "진짜 사용자 입력과 완전히 동일한(trusted)" Ctrl+V 를 만들어
// 클립보드에 올린 사진을 실제 붙여넣기 경로로 통과시킨다.
// 팝업이 닫혀도 여기(서비스워커)서 끝까지 진행하고, 진행 상황은 글쓰기 화면 위 초록 상자로 보여준다.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "fillNaver") fillNaver(msg.tabId, msg.payload);
});

function cdp(tabId, method, params) {
  return chrome.debugger.sendCommand({ tabId }, method, params || {});
}

// 특정 프레임에서 함수 실행, 첫 결과 반환
async function exec1(tabId, frameId, func, args) {
  try {
    const res = await chrome.scripting.executeScript({
      target: frameId == null ? { tabId } : { tabId, frameIds: [frameId] },
      func,
      args: args || [],
    });
    return res && res[0] ? res[0].result : null;
  } catch (_) {
    return null;
  }
}

// 글쓰기 화면 오른쪽 위에 진행 상황 상자 표시
async function say(tabId, text, isError, hideAfter) {
  await exec1(tabId, null, (t, e, h) => {
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
  }, [text, !!isError, hideAfter || 0]);
}

// ---------- 페이지 안에서 실행되는 함수들 (외부 변수 참조 금지 — 각자 selector 를 갖고 있음) ----------

function scanFrame() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  const eds = document.querySelectorAll('[contenteditable="true"]').length;
  const titleEl = document.querySelector(sel);
  return { hasTitle: !!titleEl, hasBody: !titleEl && eds > 0, eds };
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

// 본문 프레임에서: 커서를 본문 끝으로
function focusBodyEnd() {
  const sel =
    'input[placeholder*="제목"], textarea[placeholder*="제목"], [contenteditable="true"][data-placeholder*="제목"], [aria-label*="제목"]';
  if (document.querySelector(sel)) return false; // 제목 프레임이면 건드리지 않음
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

// 본문 프레임에서: 줄들을 한 글자씩 입력 (실시간 써지는 효과). 빈 줄("")은 줄바꿈만.
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

// 본문 프레임의 사진 개수 (삽입 성공 판정용)
function countImages() {
  return {
    res: document.querySelectorAll(".se-image-resource").length,
    img: document.querySelectorAll("img").length,
  };
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

async function waitMoreImages(tabId, frameId, before, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(500);
    const now = await exec1(tabId, frameId, countImages);
    if (now && before && (now.res > before.res || now.img > before.img)) {
      await sleep(1200); // 업로드 마무리 여유
      return true;
    }
  }
  return false;
}

async function insertImage(tabId, frameId, im, attached, notes) {
  const before = (await exec1(tabId, frameId, countImages)) || { res: 0, img: 0 };

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
        await exec1(tabId, frameId, focusBodyEnd);
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
        if (await waitMoreImages(tabId, frameId, before, 12000)) return "A";
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
    await exec1(tabId, frameId, syntheticPaste, [im.data, im.media_type]);
    if (await waitMoreImages(tabId, frameId, before, 5000)) return "B";
    notes.push("B:무반응");
  } catch (_) {}

  // C) 예비: 가짜 드래그&드롭
  try {
    await exec1(tabId, frameId, syntheticDrop, [im.data, im.media_type]);
    if (await waitMoreImages(tabId, frameId, before, 5000)) return "C";
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

    // 1) 프레임 파악: 제목 프레임(바깥) / 본문 프레임(안쪽 iframe)
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scanFrame,
    });
    const titleFrame = frames.find((f) => f.result && f.result.hasTitle) || null;
    const bodyFrame =
      frames.filter((f) => f.result && f.result.hasBody).sort((a, b) => b.result.eds - a.result.eds)[0] || null;
    if (!bodyFrame) {
      await say(tabId, "본문칸을 못 찾았어요. 글쓰기 화면을 새로고침(F5)한 뒤 다시 눌러주세요.", true, 10000);
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
      const tf = titleFrame ? titleFrame.frameId : null;
      const focused = await exec1(tabId, tf, focusTitle);
      if (focused && attached) {
        try {
          await cdp(tabId, "Input.insertText", { text: payload.title });
          await sleep(300);
          titleOk = !!(await exec1(tabId, tf, checkTitle, [payload.title.slice(0, 5)]));
        } catch (e) {
          notes.push("title:" + (e && e.message ? e.message : e));
        }
      }
      if (!titleOk && focused) {
        titleOk = !!(await exec1(tabId, tf, typeTitleFallback, [payload.title]));
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
          buf.push("", m[1], "");
        } else if (line !== "") {
          buf.push(line);
        }
      }
      if (buf.length) segs.push({ t: "text", lines: buf });
    }

    // 6) 순서대로 입력 (글 → 사진 → 글 …)
    const images = payload.images || [];
    let imgOk = 0, imgTotal = 0;
    for (const seg of segs) {
      if (seg.t === "text") {
        await say(tabId, "본문 입력 중… (실시간으로 써집니다)");
        await exec1(tabId, bodyFrame.frameId, typeLines, [seg.lines]);
      } else {
        const im = images[seg.idx];
        if (!im) continue;
        imgTotal++;
        await say(tabId, `사진 ${seg.idx + 1} 넣는 중… (클립보드 붙여넣기)`);
        const how = await insertImage(tabId, bodyFrame.frameId, im, attached, notes);
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
        : `사진 ${imgOk}/${imgTotal}장 (실패: ${notes.slice(0, 4).join(" | ")})`
      : "";
    await say(
      tabId,
      `✅ ${titleNote}${imgNote ? "\n🖼️ " + imgNote : ""}\n내용 확인 후 발행해 주세요.`,
      imgTotal > 0 && imgOk < imgTotal,
      20000
    );
  } catch (e) {
    await say(tabId, "오류: " + (e && e.message ? e.message : e) + "\n" + notes.slice(0, 4).join(" | "), true, 15000);
  } finally {
    if (attached) {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }
}
