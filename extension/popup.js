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

// 학원 정보로 '전용 틀'(시스템 프롬프트)을 자동 생성
function buildTemplate(p) {
  const region = (p.region || "").split(",").map((s) => s.trim()).filter(Boolean).join(", ");
  return `당신은 ${p.name} 원장이 직접 쓰는 것처럼 자연스러운 네이버 블로그 글을 씁니다.

[가장 중요한 출력 규칙]
1. 마크다운 기호를 절대 쓰지 마세요(#, *, **, >, -, ---, 표, 백틱). 네이버는 마크다운을 못 읽어 기호가 그대로 보입니다. 줄바꿈과 평범한 문장으로만 구분하세요.
2. 인용구(핵심 메시지 한 문장)는 그 줄 맨 앞에 [인용] 을 붙여 단독 줄로 넣으세요. 예: [인용] 학원이 문제인가, 아이가 문제인가 (따옴표·기호 없이).
3. AI 티를 내지 마세요: "오늘은 ~알아보겠습니다", "결론적으로" 같은 정형구 금지, 과한 강조·이모지·체크리스트 금지, 같은 문장 구조 반복 금지.
4. 모든 출력은 사람이 손으로 쓴 듯한 평범한 줄글이어야 합니다.

[학원 정보]
- 학원명: ${p.name}
- 소개: ${p.tagline}
- 말투: 친근하되 신뢰감 있게(학부모 대상 존댓말)

[글 구조] 기호 없이 줄글로
1) 제목 한 줄(맨 첫 줄, 기호 없이, 핵심 키워드를 앞쪽에)
2) 도입 문단(학부모 고민에 공감하며 자연스럽게 시작)
3) 아래 묶음을 2~3번 반복:
   - 인용구 한 줄: 줄 맨 앞에 [인용] 을 붙여 핵심 메시지 한 문장
   - 사진 자리: [이미지N] 을 그 줄에 단독으로(사진 올린 개수만큼)
   - 본문 문단: 바로 위 인용구를 풀어 설명(학원 강점을 자연스럽게)
4) 마무리 문단: 따뜻한 한두 문장으로 상담을 권하기.
분량 약 1,500자. [인용]과 [이미지N]은 각각 그 줄에 단독으로 둘 것.

[이미지 설명] 본문에 넣은 [이미지N] 개수만큼, 글 맨 끝에 "이미지N: 설명" 형식으로 한 줄씩 쓸 것.
각 설명은 서로 완전히 다른 장면·소재·구도로 (예: 교실 전경 / 문제집 위의 손 클로즈업 / 칠판 앞 뒷모습 / 상담 테이블). 같은 소재 반복 금지.

[네이버 AEO 규칙] 검색하는 사람의 질문에 바로 답하기
- 핵심 키워드를 제목 앞쪽에 1번, 본문에 자연스럽게 3~5번(억지 반복 금지)
- 도입부에서 독자가 검색했을 질문에 핵심 답을 한두 문장으로 먼저 제시
- 소제목은 실제 검색하는 질문 형태로
- 동의어·관련어를 섞고, 지역 키워드(${region})는 본문에 자연스럽게 포함
- 구체적 롱테일을 노리고, 직접 겪은 사례로 신뢰도를 드러내기

[마무리에서 하지 말 것 — 매우 중요]
전화번호·문자·카카오톡·네이버 톡톡·운영시간·주소·지도 안내를 본문 마무리에 줄줄이 나열하지 마세요.
그 정보는 앱이 글 맨 아래에 '예쁜 배너 이미지'로 깔끔하게 넣습니다. 본문에는 연락처·시간·주소를 반복해서 쓰지 마세요.
마무리는 상담을 권하는 따뜻한 문장으로만 끝내세요.

[최종 출력 순서]
제목 / 본문(도입→본문+[이미지N]→따뜻한 마무리 문장) / 이미지 설명(이미지N: 한 줄씩) / 해시태그(# 붙여 10~15개. 다음을 포함: ${p.hashtags}, ${p.name})`;
}

let uploadedPhotos = []; // [{ media_type, data(base64) }]
let currentProfile = fullProfile(null); // 저장된 학원 정보 (loadSettings 에서 갱신)

// ---------- 설정 저장/불러오기 ----------
const PROFILE_KEYS = ["name", "tagline", "phone", "sms", "kakao", "talktalk", "address", "hours", "region", "hashtags"];

function loadSettings() {
  chrome.storage.local.get(["apiKey", "openaiKey", "template", "profile"], (s) => {
    if (s.apiKey) document.getElementById("apiKey").value = s.apiKey;
    if (s.openaiKey) document.getElementById("openaiKey").value = s.openaiKey;
    if (s.template) document.getElementById("template").value = s.template;
    const p = s.profile || {};
    for (const k of PROFILE_KEYS) {
      const el = document.getElementById("p_" + k);
      if (el && p[k]) el.value = p[k];
    }
    currentProfile = fullProfile(p);
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
  const template = document.getElementById("template").value.trim() || buildTemplate(currentProfile);
  const gltype = document.getElementById("gltype").value;
  const keyword = document.getElementById("keyword").value.trim();
  const core = document.getElementById("core").value.trim();
  const style = document.getElementById("style").value;

  setStatus("글을 작성하는 중...");
  setBusy(true);
  try {
    const text = await callClaude(apiKey, template, gltype, topic, keyword, core, style);
    showResult(text);
    setStatus("완성! 내용을 확인하고 '네이버에 입력'을 누르세요.");
  } catch (err) {
    setStatus("오류: " + (err && err.message ? err.message : err), true);
  } finally {
    setBusy(false);
  }
});

async function callClaude(apiKey, template, gltype, topic, keyword, core, style) {
  let userText =
    "아래 정보로 네이버 블로그 글을 작성해줘.\n\n" +
    `- 글 종류: ${gltype}\n- 주제: ${topic}\n- 핵심(타겟) 키워드: ${keyword}\n` +
    `- 핵심 내용: ${core}\n- 이미지 스타일: ${style}\n`;

  let content;
  if (uploadedPhotos.length > 0) {
    const n = uploadedPhotos.length;
    userText +=
      `\n첨부한 사진 ${n}장을 잘 보고, 사진 내용과 어울리는 글을 써줘.\n` +
      `사진이 들어갈 자리에 [이미지1]부터 [이미지${n}]까지 순서대로 본문에 한 줄씩 단독으로 배치하고,\n` +
      `각 사진에 보이는 것을 자연스럽게 녹여줘. 사진 개수(${n}장)와 [이미지N] 개수를 똑같이 맞출 것.\n` +
      `사진에 실제로 보이는 것만 쓰고, 사진에 없는 내용은 지어내지 마.`;
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
  const styleText =
    style === "실사"
      ? "실제 카메라로 찍은 듯한 자연스러운 사진 느낌(photorealistic). 과장 없이 담백하게."
      : "깔끔하고 따뜻한 플랫 일러스트 스타일. 부드러운 색감.";
  const angles = [
    "밝은 자연광이 드는 넓은 장면",
    "소품 위주의 가까운 클로즈업",
    "위에서 비스듬히 내려다본 구도",
    "창가 또는 칠판을 배경으로 한 장면",
  ];
  const prompt =
    `학원 블로그 글에 넣을 이미지 (${i + 1}번째, 총 ${total}장 중). 장면: ${desc}. ${styleText} ` +
    `구도: ${angles[i % angles.length]}. 같은 글의 다른 이미지들과 소재·구도가 겹치지 않게. ` +
    "사람 얼굴이 알아볼 수 있게 나오면 안 됨(뒷모습·손·소품 위주). 이미지 안에 글자 넣지 말 것.";
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
