// popup.js — 확장 팝업의 두뇌
// 설정 저장 → 사진 읽기 → Claude API로 글 생성 → 네이버 글쓰기 화면으로 전송

const MODEL = "claude-sonnet-4-6";

// 학원 정보 기본값 (설정에서 비워두면 이걸 사용 = 더몬스터학원)
const DEFAULT_PROFILE = {
  name: "더몬스터학원",
  tagline: "광주 동구 계림동 · 초등3학년~고3 수학·교과 전문",
  phone: "062-653-1599",
  sms: "010-7627-1003",
  kakao: "http://pf.kakao.com/_WNxezn",
  talktalk: "",
  address: "광주광역시 동구 경양로234 118동상가 716호",
  hours: "평일 오후 2시~밤 10시 / 토요일 오전 9시~오후 8시 30분",
  region: "계림동, 광주 동구, 광주",
  hashtags: "계림동수학학원, 광주수학학원, 동구수학학원",
};

// 저장된 값과 기본값을 합쳐 완전한 프로필로
function fullProfile(p) {
  const out = Object.assign({}, DEFAULT_PROFILE);
  if (p) for (const k in DEFAULT_PROFILE) if (p[k] && String(p[k]).trim()) out[k] = String(p[k]).trim();
  return out;
}

let uploadedPhotos = []; // [{ media_type, data(base64) }]
let currentProfile = fullProfile(null); // 저장된 학원 정보 (loadSettings 에서 갱신)
let recentHooks = [];

// ---------- 설정 저장/불러오기 ----------
const PROFILE_KEYS = ["name", "tagline", "phone", "sms", "kakao", "talktalk", "address", "hours", "region", "hashtags"];

function loadSettings() {
  chrome.storage.local.get(["apiKey", "openaiKey", "template", "profile", "recentHooks"], (s) => {
    if (s.apiKey) document.getElementById("apiKey").value = s.apiKey;
    if (s.openaiKey) document.getElementById("openaiKey").value = s.openaiKey;
    if (s.template) document.getElementById("template").value = s.template;
    const p = s.profile || {};
    for (const k of PROFILE_KEYS) {
      const el = document.getElementById("p_" + k);
      if (el && p[k]) el.value = p[k];
    }
    currentProfile = fullProfile(p);
    recentHooks = PromptHooks.normalizeHistory(s.recentHooks).slice(-50);
    updateHookRecommendation();
    // 키가 아직 없으면 설정을 펼쳐서 안내
    if (!s.apiKey) document.getElementById("settings").open = true;
  });
}

document.getElementById("saveSettings").addEventListener("click", () => {
  const profile = {};
  for (const k of PROFILE_KEYS) {
    const el = document.getElementById("p_" + k);
    if (el) profile[k] = el.value.trim();
  }
  currentProfile = fullProfile(profile);
  chrome.storage.local.set(
    {
      apiKey: document.getElementById("apiKey").value.trim(),
      openaiKey: document.getElementById("openaiKey").value.trim(),
      template: document.getElementById("template").value,
      profile,
    },
    () => setStatus("설정을 저장했습니다. (학원 정보가 글·배너에 반영됩니다)")
  );
});

// 근거가 필요한 훅은 입력칸을 필수로 표시한다. 자동 추천에서는 선택 사항이다.
function updateHookEvidenceUI() {
  const type = document.getElementById("hookType").value;
  const classificationUsesEvidence = document.getElementById("classificationUsesEvidence").checked;
  const required = PromptHooks.requiresEvidence(type, classificationUsesEvidence);
  document.getElementById("classificationEvidenceOption").style.display = type === "classification" ? "flex" : "none";
  document.getElementById("hookEvidenceBox").style.display = (type === "auto" || required) ? "block" : "none";
  document.getElementById("hookEvidenceLabel").textContent = required
    ? "확인된 실제 근거 (필수)"
    : "확인된 실제 근거 (선택)";
  document.getElementById("hookEvidenceHint").textContent = required
    ? "입력한 사실만 사용합니다. 근거가 없으면 이 훅으로 글을 생성할 수 없습니다."
    : "근거가 있으면 자동 추천의 선택 폭이 넓어집니다. 입력하지 않은 사례나 수치는 생성하지 않습니다.";
}
function hookInput() {
  return {
    gltype: document.getElementById("gltype").value,
    topic: document.getElementById("topic").value.trim(),
    keyword: document.getElementById("keyword").value.trim(),
    core: document.getElementById("core").value.trim(),
    evidence: document.getElementById("hookEvidence").value.trim(),
  };
}

function updateHookRecommendation() {
  const result = PromptHooks.recommend(hookInput(), recentHooks);
  document.getElementById("recommendedHook").textContent = PromptHooks.HOOKS[result.type].label;
  document.getElementById("recommendationReason").textContent = result.reason;
  document.getElementById("hookRecommendation").style.display =
    document.getElementById("hookType").value === "auto" ? "block" : "none";
}

function refreshHookUI() {
  updateHookEvidenceUI();
  updateHookRecommendation();
}
document.getElementById("hookType").addEventListener("change", refreshHookUI);
document.getElementById("classificationUsesEvidence").addEventListener("change", refreshHookUI);
for (const id of ["gltype", "topic", "keyword", "core", "hookEvidence"]) {
  document.getElementById(id).addEventListener("input", updateHookRecommendation);
}
updateHookEvidenceUI();
updateHookRecommendation();

// ---------- 사진 읽기 ----------
document.getElementById("photos").addEventListener("change", async (e) => {
  uploadedPhotos = [];
  const preview = document.getElementById("photoPreview");
  preview.innerHTML = "";
  for (const file of e.target.files) {
    const dataUrl = await fileToDataURL(file);
    const base64 = dataUrl.split(",")[1];
    uploadedPhotos.push({ media_type: file.type || "image/jpeg", data: base64 });
    const img = document.createElement("img");
    img.src = dataUrl;
    preview.appendChild(img);
  }
});

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// 발행 방식이 '예약'일 때만 시간 입력칸 보이기
document.getElementById("pubmode").addEventListener("change", (e) => {
  const show = e.target.value === "reserve";
  document.getElementById("pubwhen").style.display = show ? "block" : "none";
  document.getElementById("pubhint").style.display = show ? "block" : "none";
});

// ---------- 글 생성 ----------
document.getElementById("generate").addEventListener("click", async () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!apiKey) {
    setStatus("설정에서 Claude API 키를 먼저 저장하세요.", true);
    document.getElementById("settings").open = true;
    return;
  }
  const topic = document.getElementById("topic").value.trim();
  if (!topic) {
    setStatus("주제를 입력하세요.", true);
    return;
  }
  const template = PromptBody.buildSystemPrompt(
    currentProfile,
    document.getElementById("template").value
  );
  const gltype = document.getElementById("gltype").value;
  const keyword = document.getElementById("keyword").value.trim();
  const core = document.getElementById("core").value.trim();
  const style = document.getElementById("style").value;
  const hook = PromptHooks.resolve(
    document.getElementById("hookType").value,
    document.getElementById("hookEvidence").value,
    recentHooks,
    {
      input: hookInput(),
      classificationUsesEvidence: document.getElementById("classificationUsesEvidence").checked,
    }
  );
  if (hook.error) {
    setStatus(hook.error, true);
    document.getElementById("hookEvidence").focus();
    return;
  }

  setStatus(`글을 작성하는 중... (도입부: ${hook.label})`);
  setBusy(true);
  try {
    const text = await callClaude(apiKey, template, gltype, topic, keyword, core, style, hook);
    showResult(text);
    recentHooks = recentHooks.concat({ type: hook.type, usedAt: new Date().toISOString() }).slice(-50);
    chrome.storage.local.set({ recentHooks });
    updateHookRecommendation();
    setStatus("완성! 내용을 확인하고 '네이버에 입력'을 누르세요.");
  } catch (err) {
    setStatus("오류: " + (err && err.message ? err.message : err), true);
  } finally {
    setBusy(false);
  }
});

async function callClaude(apiKey, template, gltype, topic, keyword, core, style, hook) {
  const input = { gltype, topic, keyword, core, style };
  const userText = PromptBridge.compose(input, hook, uploadedPhotos.length);

  let content;
  if (uploadedPhotos.length > 0) {
    content = uploadedPhotos.map((p) => ({
      type: "image",
      source: { type: "base64", media_type: p.media_type, data: p.data },
    }));
    content.push({ type: "text", text: userText });
  } else {
    content = userText;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: template,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try {
      const j = await res.json();
      if (j.error && j.error.message) msg = j.error.message;
    } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ---------- 결과 표시 ----------
function showResult(text) {
  const lines = text.split("\n");
  let titleIdx = lines.findIndex((l) => l.trim() !== "");
  let title = titleIdx >= 0 ? lines[titleIdx].replace(/^#+\s*/, "").trim() : "제목 없음";
  const body = lines.slice(titleIdx + 1).join("\n").trim();
  document.getElementById("outTitle").value = title;
  document.getElementById("outBody").value = body;
  document.getElementById("resultBox").style.display = "block";
}

// ---------- 복사 ----------
document.getElementById("copyBtn").addEventListener("click", () => {
  const body = document.getElementById("outBody").value;
  navigator.clipboard.writeText(body).then(() => setStatus("본문을 복사했습니다."));
});

// ---------- 카드 이미지 자동 생성 (사진을 안 올렸을 때 [이미지N] 자리용) ----------
// 인용구/제목 문장을 넣은 깔끔한 카드 그림을 만든다. API·비용 없이 항상 동작.
function drawCard(text, pal) {
  const c1 = pal[0], c2 = pal[1], tc = pal[2];
  const W = 1000, H = 640;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 글자 줄바꿈 (한글은 아무 데서나 줄바꿈 가능 — 글자 단위)
  ctx.font = "bold 46px 'Malgun Gothic', sans-serif";
  const maxW = W - 280;
  const lines = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur.trim());
      cur = ch === " " ? "" : ch;
    } else cur += ch;
  }
  if (cur.trim()) lines.push(cur.trim());
  const shown = lines.slice(0, 4);
  const lh = 68;
  const blockH = shown.length * lh;
  const y0 = (H - blockH) / 2;
  // 왼쪽 세로 포인트 바
  ctx.fillStyle = tc;
  ctx.fillRect(100, y0 - 14, 7, blockH + 18);
  // 본문
  ctx.textBaseline = "top";
  shown.forEach((l, i) => ctx.fillText(l, 136, y0 + i * lh));
  // 아래 학원명
  ctx.font = "22px 'Malgun Gothic', sans-serif";
  ctx.globalAlpha = 0.75;
  ctx.fillText("더몬스터학원 · 광주 동구 계림동", 100, H - 72);
  ctx.globalAlpha = 1;
  return new Promise((resolve) => {
    cv.toBlob((b) => {
      const r = new FileReader();
      r.onload = () => resolve({ media_type: "image/png", data: r.result.split(",")[1] });
      r.readAsDataURL(b);
    }, "image/png");
  });
}

async function makeCardImages(body, title) {
  const imgRe = /^\[이미지\s*(\d+)\]\s*$/;
  const quoteRe = /^\[인용\]\s*(.*)$/;
  const texts = []; // 이미지 번호(0부터) → 카드에 넣을 문장
  let lastQuote = "";
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    let m;
    if ((m = line.match(quoteRe))) lastQuote = m[1];
    else if ((m = line.match(imgRe))) texts[parseInt(m[1], 10) - 1] = lastQuote || title;
  }
  const palettes = [
    ["#eef7f0", "#cfe8d6", "#245c37"],
    ["#eef3fb", "#d3e3f6", "#1f4e79"],
    ["#fdf3ec", "#f5ddc7", "#8a4b2d"],
    ["#f3f0fb", "#dfd6f2", "#4a3d7a"],
  ];
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] == null) continue;
    out[i] = await drawCard(texts[i], palettes[i % palettes.length]);
  }
  return out;
}

// ---------- 하단 연락처 배너 이미지 (글자 나열 대신 예쁜 카드로) ----------
// 학원 정보(profile)를 받아, 값이 있는 항목만 깔끔하게 배치
function drawFooterBanner(p) {
  // 표시할 항목 (값 있는 것만)
  const rows = [];
  if (p.hours) rows.push(["운영시간", p.hours]);
  if (p.phone) rows.push(["전화", p.phone]);
  if (p.sms) rows.push(["문자", p.sms]);
  if (p.kakao) rows.push(["카카오톡", "채널: " + p.name + " 검색"]);
  if (p.talktalk) rows.push(["네이버 톡톡", "블로그에서 톡톡 버튼으로 연결"]);
  if (p.address) rows.push(["주소", p.address]);

  const top = 210;      // 헤더 영역 높이
  const rowH = 58;
  const W = 1000;
  const H = top + rows.length * rowH + 60;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  // 배경 그라데이션 (브랜드 그린)
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0f3d24");
  g.addColorStop(1, "#1c6b3f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 왼쪽 포인트 바
  ctx.fillStyle = "#8fe0b0";
  ctx.fillRect(66, 56, 8, H - 112);
  ctx.textBaseline = "top";
  // 학원명
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px 'Malgun Gothic', sans-serif";
  ctx.fillText(p.name, 104, 60);
  // 한 줄 소개
  if (p.tagline) {
    ctx.font = "25px 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#d9f2e3";
    ctx.fillText(p.tagline, 106, 138);
  }
  // 구분선
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(106, 190);
  ctx.lineTo(W - 70, 190);
  ctx.stroke();
  // 항목들
  let y = top;
  for (const [k, v] of rows) {
    ctx.font = "bold 26px 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#8fe0b0";
    ctx.fillText(k, 106, y);
    ctx.font = "26px 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#ffffff";
    // 너무 길면 잘라 표시
    let text = v;
    while (ctx.measureText(text).width > W - 340 && text.length > 4) text = text.slice(0, -2);
    if (text !== v) text = text.trimEnd() + "…";
    ctx.fillText(text, 300, y);
    y += rowH;
  }
  return new Promise((resolve) => {
    cv.toBlob((b) => {
      const r = new FileReader();
      r.onload = () => resolve({ media_type: "image/png", data: r.result.split(",")[1] });
      r.readAsDataURL(b);
    }, "image/png");
  });
}

// ---------- AI 이미지 생성 (OpenAI — 키가 있을 때) ----------
// 본문 끝의 "이미지N: 설명" 줄을 읽어 프롬프트로 쓰고, 그 줄들은 본문에서 제거한다.
function extractImagePrompts(body) {
  const prompts = {};
  const kept = [];
  for (const raw of body.split("\n")) {
    const m = raw.trim().match(/^이미지\s*(\d+)\s*[::]\s*(.+)$/);
    if (m) prompts[parseInt(m[1], 10) - 1] = m[2].trim();
    else kept.push(raw);
  }
  return { prompts, body: kept.join("\n") };
}

// "이미지N: 설명" 줄이 없을 때 예비: 마커 주변 문맥(앞 인용구 + 뒤 문단)으로 프롬프트를 만든다
function markerContexts(body, title) {
  const lines = body.split("\n").map((l) => l.trim());
  const ctx = {};
  let lastQuote = "";
  for (let i = 0; i < lines.length; i++) {
    const q = lines[i].match(/^\[인용\]\s*(.*)$/);
    if (q) {
      lastQuote = q[1];
      continue;
    }
    const m = lines[i].match(/^\[이미지\s*(\d+)\]\s*$/);
    if (m) {
      let next = "";
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] && !/^\[/.test(lines[j])) {
          next = lines[j].slice(0, 80);
          break;
        }
      }
      ctx[parseInt(m[1], 10) - 1] = ((lastQuote ? lastQuote + ". " : "") + next).trim() || title;
    }
  }
  return ctx;
}

async function genOpenAiImage(openaiKey, desc, style, i, total) {
  const styleText = style === "교육현장 다큐멘터리"
    ? "한국 소규모 초등·중등 수학학원의 실제 수업을 순간 포착한 교육현장 다큐멘터리 사진. 광고나 스톡사진처럼 연출하지 말고 자연광과 현실적인 학원 실내조명, 생활감 있는 색과 질감을 유지할 것."
    : style === "실사"
      ? "실제 카메라로 찍은 듯한 자연스럽고 담백한 사진."
      : "깔끔하고 따뜻한 플랫 일러스트 스타일. 부드러운 색감.";
  const roles = [
    "대표 이미지: 한국 학생이 책상에서 수학 문제를 고민하는 실제 수업 장면. 얼굴 정면 클로즈업 대신 옆모습이나 뒷모습과 손을 중심으로",
    "학습 디테일: 지우고 다시 푼 오답 흔적이 남은 수학 문제집, 연필과 지우개, 연필을 잡은 학생 손을 가까이 기록",
    "상호작용: 선생님이 학생 옆에서 문제집의 풀이 과정을 함께 확인하는 자연스러운 순간. 두 사람의 시선은 풀이에 향하고 얼굴은 두드러지지 않게",
    "공간 기록: 수업 뒤 교재, 연필, 지우개와 필기 흔적이 남아 있는 책상 및 소규모 교실의 현실적인 전경",
  ];
  const prompt =
    `학원 블로그 이미지 (${i + 1}번째, 총 ${total}장 중). 장면 맥락: ${desc}. ${styleText} ` +
    `이번 이미지의 고유 역할: ${roles[i % roles.length]}. 다른 이미지와 역할·행동·소재·공간을 반복하지 말 것. ` +
    "한국 학생의 실제 연령대와 평범한 복장, 사용감 있는 문제집·연필·지우개·필기·오답 흔적을 자연스럽게 표현할 것. " +
    "과한 HDR, 영화식 색보정, 완벽하게 정돈된 광고 세트, 플라스틱 같은 AI 피부나 질감을 금지. " +
    "얼굴 정면 클로즈업을 피하고 손·옆모습·뒷모습 중심으로 구성. 이미지 안에 읽을 수 있는 글자, 로고, 워터마크를 넣지 말 것.";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + openaiKey,
    },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1 }),
  });
  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try {
      const j = await res.json();
      if (j.error && j.error.message) msg = j.error.message;
    } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error("이미지 응답이 비어 있음");
  return { media_type: "image/png", data: b64 };
}

// ---------- 네이버에 입력 (백그라운드에 위임 — 팝업이 닫혀도 끝까지 진행) ----------
document.getElementById("sendNaver").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/naver\.com/.test(tab.url || "")) {
    setStatus("네이버 블로그 글쓰기 화면을 먼저 연 뒤 눌러주세요.", true);
    return;
  }
  // "이미지N: 설명" 줄은 프롬프트로만 쓰고 본문에서는 뺀다
  const ex = extractImagePrompts(document.getElementById("outBody").value);
  const payload = {
    title: document.getElementById("outTitle").value,
    body: ex.body,
    images: uploadedPhotos.map((p) => ({ media_type: p.media_type, data: p.data })),
  };
  // 사진을 안 올렸으면: OpenAI 키가 있으면 AI 이미지 생성, 없으면 카드 이미지
  if (payload.images.length === 0 && /\[이미지\s*\d+\]/.test(payload.body)) {
    const openaiKey = document.getElementById("openaiKey").value.trim();
    const style = document.getElementById("style").value;
    const markers = [...payload.body.matchAll(/^\[이미지\s*(\d+)\]\s*$/gm)].map((m) => parseInt(m[1], 10) - 1);
    if (openaiKey) {
      const ctxMap = markerContexts(payload.body, payload.title);
      const imgs = [];
      let failMsg = "";
      for (let i = 0; i < markers.length; i++) {
        const idx = markers[i];
        setStatus(`AI 이미지 생성 중… (${i + 1}/${markers.length}) 장당 10~30초 걸려요.`);
        try {
          imgs[idx] = await genOpenAiImage(openaiKey, ex.prompts[idx] || ctxMap[idx] || payload.title, style, i, markers.length);
        } catch (e) {
          failMsg = e && e.message ? e.message : String(e);
          break;
        }
      }
      if (failMsg) {
        setStatus("AI 이미지 실패(" + failMsg + ") → 카드 이미지로 대신 넣습니다.", true);
        try {
          payload.images = await makeCardImages(payload.body, payload.title);
        } catch (_) {}
      } else {
        payload.images = imgs;
      }
    } else {
      setStatus("사진이 없어 카드 이미지를 만드는 중… (설정에 OpenAI 키를 넣으면 AI 실사/일러스트 생성)");
      try {
        payload.images = await makeCardImages(payload.body, payload.title);
      } catch (_) {}
    }
  }
  // 하단 연락처 배너 이미지 (글 맨 끝에 예쁘게 — 저장된 학원 정보 사용)
  try {
    payload.footer = await drawFooterBanner(currentProfile);
  } catch (_) {}
  // 지도 검색·톡톡에 쓸 학원 정보
  payload.academy = { name: currentProfile.name, talktalk: currentProfile.talktalk || "" };
  payload.tryMap = document.getElementById("trymap").checked;
  // 발행 방식
  const pubmode = document.getElementById("pubmode").value;
  payload.publish = { mode: pubmode, when: document.getElementById("pubwhen").value || "" };
  if (pubmode === "reserve" && !payload.publish.when) {
    setStatus("예약 발행을 고르셨어요. 예약 시간을 먼저 선택해 주세요.", true);
    return;
  }
  // 제목은 미리 클립보드에도 복사 (만일의 붙여넣기용)
  try {
    await navigator.clipboard.writeText(payload.title);
  } catch (_) {}
  chrome.runtime.sendMessage({ type: "fillNaver", tabId: tab.id, payload });
  const pubMsg =
    pubmode === "now" ? " (입력 후 바로 발행합니다)" : pubmode === "reserve" ? " (입력 후 예약 발행합니다)" : "";
  setStatus(
    "입력을 시작했습니다!" + pubMsg + " 글쓰기 화면 오른쪽 위 초록 상자로 진행 상황이 보입니다.\n" +
      "※ 위쪽에 '디버깅을 시작했습니다' 표시가 떠도 정상입니다. '취소'는 누르지 마세요."
  );
});

// ---------- 화면 진단 (실제 네이버 DOM 구조를 뽑아 복사) ----------
document.getElementById("diag").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/naver\.com/.test(tab.url || "")) {
    setStatus("네이버 글쓰기 화면을 연 상태에서 눌러주세요.", true);
    return;
  }
  setStatus("화면 구조를 읽는 중…");
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: dumpEditor,
    });
    const text = res.map((r) => r && r.result).filter(Boolean).join("\n---\n");
    await navigator.clipboard.writeText(text);
    setStatus("진단을 복사했습니다. 대화창에 붙여넣기(Ctrl+V) 해서 보내주세요.\n\n" + text.slice(0, 1200));
  } catch (e) {
    setStatus("진단 실패: " + (e && e.message ? e.message : e), true);
  }
});

// 각 프레임에서 실행 — 제목/본문/인용/장소 관련 요소 구조를 요약
function dumpEditor() {
  const tc = (e) =>
    e ? "<" + e.tagName + " ." + ((typeof e.className === "string" ? e.className : "").trim().split(/\s+/).slice(0, 2).join(".")) +
      (e.getAttribute && e.getAttribute("data-placeholder") ? " ph=" + e.getAttribute("data-placeholder") : "") +
      (e.getAttribute && e.getAttribute("aria-label") ? " al=" + e.getAttribute("aria-label") : "") + ">" : "null";
  const out = [];
  out.push("FRAME top=" + (window === window.top ? 1 : 0) + " url=" + location.href.slice(0, 60));
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  out.push("editable(" + eds.length + "): " + eds.slice(0, 4).map(tc).join(" "));
  // 제목 후보
  const titleCands = [...document.querySelectorAll('input[placeholder*="제목"], textarea[placeholder*="제목"], [data-placeholder*="제목"], [aria-label*="제목"], [class*="documentTitle"]')];
  out.push("title후보(" + titleCands.length + "): " + titleCands.slice(0, 4).map(tc).join(" "));
  // 인용구 버튼 후보
  const qbtn = [...document.querySelectorAll("button,[role=button]")].filter((b) => /인용|quot/i.test((b.getAttribute("aria-label") || "") + (b.getAttribute("title") || "") + (b.className || "") + b.textContent));
  out.push("인용버튼(" + qbtn.length + "): " + qbtn.slice(0, 4).map(tc).join(" "));
  // 인용 스타일 옵션(드롭다운 열려있을 때만)
  const qopt = [...document.querySelectorAll('[class*="toolbar-option"], [class*="quotation"]')].filter((e) => e.getBoundingClientRect().width > 0);
  out.push("인용옵션(" + qopt.length + "): " + qopt.slice(0, 6).map((e) => (typeof e.className === "string" ? e.className : "").slice(0, 40)).join(" | "));
  // 장소/지도 관련
  const mapBtn = [...document.querySelectorAll("button")].filter((b) => /장소|지도|map|place/i.test((b.getAttribute("aria-label") || "") + (b.className || "") + b.textContent));
  out.push("장소버튼(" + mapBtn.length + "): " + mapBtn.slice(0, 3).map(tc).join(" "));
  // 지도 검색창이 열려 있으면: 보이는 입력칸 + 결과 항목 구조도 (장소창 열고 검색 후 진단 누르면 잡힘)
  const vin = [...document.querySelectorAll("input")].filter((i) => i.getBoundingClientRect().width > 20);
  if (vin.length) out.push("입력칸(" + vin.length + "): " + vin.slice(0, 5).map((i) => "[" + (i.type || "") + " ph=" + (i.placeholder || "") + " cls=" + (i.className || "").slice(0, 20) + "]").join(" "));
  const listItems = [...document.querySelectorAll('li, [class*="item"], [class*="result"], [class*="place"]')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 40 && r.height > 20 && r.height < 160 && (e.textContent || "").trim().length > 2;
  });
  if (listItems.length) out.push("목록항목(" + listItems.length + "): " + listItems.slice(0, 4).map((e) => (typeof e.className === "string" ? e.className : "").slice(0, 30) + "『" + (e.textContent || "").trim().slice(0, 14) + "』").join(" | "));
  return out.join("\n");
}

// ---------- 보조 ----------
function setStatus(msg, isError) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status" + (isError ? " error" : "");
}
function setBusy(b) {
  document.getElementById("generate").disabled = b;
}

loadSettings();

// 팝업 제목에 버전 표시 — 업데이트가 적용됐는지 한눈에 확인용
try {
  const v = chrome.runtime.getManifest().version;
  const h1 = document.querySelector("h1");
  if (h1) h1.textContent = "📝 블로그 자동화 v" + v;
} catch (_) {}
