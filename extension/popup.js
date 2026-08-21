// popup.js — 확장 팝업의 두뇌
// 설정 저장 → 사진 읽기 → Claude API로 글 생성 → 네이버 글쓰기 화면으로 전송


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
  model: "claude-opus-5",        // 글 생성 모델 (설정에서 선택)
  imgmodel: "gpt-image-1",       // 이미지 생성 모델 (설정에서 선택)
  imgrule: "따뜻하고 깔끔한 분위기. 실제 학원·공부 현장 느낌. 사람 얼굴이 알아볼 수 있게 나오면 안 됨(뒷모습·손·소품 위주). 그림 안에 글자를 넣지 말 것.",
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
const PROFILE_KEYS = ["name", "tagline", "phone", "sms", "kakao", "talktalk", "address", "hours", "region", "hashtags", "imgrule", "model", "imgmodel"];
let thumbTemplate = "";                       // 썸네일 템플릿 이미지 (dataURL, 설정에 저장)
let thumbBox = { left: 8.5, right: 91.5, top: 78, bottom: 93.5 };   // 제목 박스 위치(%)
let footerImage = "";                         // 글 맨 끝에 붙일 하단 배너 (dataURL, 설정에 저장)

function loadSettings() {
  chrome.storage.local.get(["apiKey", "openaiKey", "template", "profile", "thumbTemplate", "thumbBox", "footerImage"], (s) => {
    if (s.apiKey) document.getElementById("apiKey").value = s.apiKey;
    if (s.openaiKey) document.getElementById("openaiKey").value = s.openaiKey;
    if (s.template) document.getElementById("template").value = s.template;
    const p = s.profile || {};
    for (const k of PROFILE_KEYS) {
      const el = document.getElementById("p_" + k);
      if (el && p[k]) el.value = p[k];
    }
    currentProfile = fullProfile(p);
    if (s.thumbTemplate) {
      thumbTemplate = s.thumbTemplate;
      const prev = document.getElementById("myPhotoPreview");
      if (prev) prev.innerHTML = '<img src="' + thumbTemplate + '" alt="썸네일 템플릿">';
    }
    if (s.footerImage) {
      footerImage = s.footerImage;
      const fp = document.getElementById("footerPreview");
      if (fp) fp.innerHTML = '<img src="' + footerImage + '" alt="하단 배너">';
    }
    if (s.thumbBox) thumbBox = Object.assign(thumbBox, s.thumbBox);
    for (const k of ["left", "right", "top", "bottom"]) {
      const el = document.getElementById("tb_" + k);
      if (el) el.value = thumbBox[k];
    }
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
  for (const k of ["left", "right", "top", "bottom"]) {
    const el = document.getElementById("tb_" + k);
    const v = el ? parseFloat(el.value) : NaN;
    if (!isNaN(v)) thumbBox[k] = v;
  }
  chrome.storage.local.set(
    {
      apiKey: document.getElementById("apiKey").value.trim(),
      openaiKey: document.getElementById("openaiKey").value.trim(),
      template: document.getElementById("template").value,
      profile,
      thumbTemplate,
      thumbBox,
      footerImage,
    },
    () => setStatus("설정을 저장했습니다. (학원 정보·썸네일 템플릿이 글과 이미지에 반영됩니다)")
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

// 설정: 썸네일 템플릿 이미지 업로드 (한 번 넣어두면 계속 사용)
const myPhotoInput = document.getElementById("myPhoto");
if (myPhotoInput) {
  myPhotoInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    thumbTemplate = await fileToDataURL(file);
    const prev = document.getElementById("myPhotoPreview");
    if (prev) prev.innerHTML = '<img src="' + thumbTemplate + '" alt="썸네일 템플릿">';
    setStatus("템플릿을 불러왔습니다. [🔍 썸네일 미리보기]로 확인하고 [설정 저장]을 누르세요.");
  });
}

// 설정: 통째로 파일로 내보내기 / 가져오기
// (다른 컴퓨터로 옮기거나, 확장을 지웠다 다시 깔 때를 위한 안전장치)
const exportBtn = document.getElementById("exportSettings");
if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    chrome.storage.local.get(null, (all) => {
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "몬스터블로그-설정.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setStatus("설정 파일을 저장했습니다. ⚠ API 키가 들어 있으니 남에게 주지 마세요.");
    });
  });
}

const importInput = document.getElementById("importSettings");
if (importInput) {
  importInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || typeof data !== "object") throw new Error("형식이 올바르지 않습니다");
        chrome.storage.local.set(data, () => {
          setStatus("설정을 불러왔습니다. 팝업을 닫았다 다시 열면 모두 반영됩니다.");
          loadSettings();
        });
      } catch (err) {
        setStatus("설정 파일을 읽지 못했습니다: " + (err && err.message ? err.message : err), true);
      }
    };
    r.readAsText(file);
  });
}

// 설정: 하단 배너 이미지 업로드 (글 맨 끝에 항상 붙는 그림)
const footerInput = document.getElementById("footerImg");
if (footerInput) {
  footerInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    footerImage = await shrinkIfHuge(await fileToDataURL(file), 1200);
    const fp = document.getElementById("footerPreview");
    if (fp) fp.innerHTML = '<img src="' + footerImage + '" alt="하단 배너">';
    setStatus("하단 배너를 불러왔습니다. [설정 저장]을 눌러 보관하세요.");
  });
}

// 설정: 썸네일 미리보기 — 지금 입력된 주제/제목으로 그려서 바로 보여준다
const thumbPrevBtn = document.getElementById("previewThumb");
if (thumbPrevBtn) {
  thumbPrevBtn.addEventListener("click", async () => {
    if (!thumbTemplate) {
      setStatus("먼저 썸네일 템플릿 이미지를 올려주세요.", true);
      return;
    }
    for (const k of ["left", "right", "top", "bottom"]) {
      const el = document.getElementById("tb_" + k);
      const v = el ? parseFloat(el.value) : NaN;
      if (!isNaN(v)) thumbBox[k] = v;
    }
    const text =
      document.getElementById("topic").value.trim() ||
      document.getElementById("outTitle").value.trim() ||
      "여기에 글 제목이 들어갑니다";
    try {
      const img = await drawThumbnail(thumbTemplate, text, thumbBox);
      const box = document.getElementById("thumbPreview");
      if (box) box.innerHTML = '<img src="data:image/png;base64,' + img.data + '" alt="썸네일 미리보기">';
      setStatus("미리보기입니다. 글자 위치가 어긋나면 아래 숫자(%)를 조절하세요.");
    } catch (err) {
      setStatus("미리보기 실패: " + (err && err.message ? err.message : err), true);
    }
  });
}

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
      model: currentProfile.model,
      // 최신 모델은 '생각 과정' 토큰도 이 한도를 함께 쓴다. 4000이면 글이 중간에 잘릴 수 있어 넉넉히.
      max_tokens: 16000,
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

// ---------- 대표 썸네일 (내 사진 + 글 주제) ----------
// 네이버는 '본문 첫 이미지'를 대표 이미지로 잡는다. 그래서 이 그림을 글 맨 앞에 넣는다.
// AI로 만들면 얼굴이 재현되지 않으므로, 설정에 저장한 내 사진 위에 주제를 얹어 직접 그린다.
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
}

// 한글은 아무 데서나 줄바꿈 가능 — 글자 단위로 자른다
function wrapText(ctx, text, maxW) {
  const lines = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur.trim());
      cur = ch === " " ? "" : ch;
    } else cur += ch;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

// 제목 박스 기본 위치 (템플릿 이미지 크기 대비 비율 %)
const DEFAULT_THUMB_BOX = { left: 8.5, right: 91.5, top: 78, bottom: 93.5 };

// 템플릿 이미지를 배경으로 깔고, 빈 네모 박스 자리에 '제목만' 그려 넣는다.
// 디자인은 사장님이 만든 템플릿 그대로 — 코드는 글자만 얹는다.
async function drawThumbnail(templateDataUrl, text, box) {
  if (!templateDataUrl) return null;
  const b = Object.assign({}, DEFAULT_THUMB_BOX, box || {});
  const im = await loadImage(templateDataUrl);

  // 템플릿 원본 크기 그대로 (비율·화질 유지)
  const W = im.naturalWidth || im.width;
  const H = im.naturalHeight || im.height;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.drawImage(im, 0, 0, W, H);

  // 제목이 들어갈 영역
  const x0 = (b.left / 100) * W;
  const x1 = (b.right / 100) * W;
  const y0 = (b.top / 100) * H;
  const y1 = (b.bottom / 100) * H;
  const boxW = x1 - x0;
  const boxH = y1 - y0;
  const title = (text || "").trim();
  if (!title || boxW <= 0 || boxH <= 0) {
    return canvasToImage(cv);
  }

  // 최대 2줄에 들어오고 박스 높이도 넘지 않도록 글자 크기를 자동으로 줄인다
  ctx.textBaseline = "top";
  ctx.fillStyle = "#2b2b2b";
  let size = Math.round(H * 0.07);
  const minSize = Math.round(H * 0.028);
  let lines = [];
  for (; size >= minSize; size -= 2) {
    ctx.font = "bold " + size + "px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
    lines = wrapText(ctx, title, boxW);
    if (lines.length <= 2 && lines.length * (size * 1.3) <= boxH) break;
  }
  lines = lines.slice(0, 2);

  // 박스 안에서 가로·세로 모두 가운데
  const lh = Math.round(size * 1.3);
  const startY = y0 + (boxH - lines.length * lh) / 2;
  lines.forEach((l, i) => {
    const w = ctx.measureText(l).width;
    ctx.fillText(l, x0 + (boxW - w) / 2, startY + i * lh);
  });

  return canvasToImage(cv);
}

// dataURL 을 네이버 삽입용 형태로 (insertImage 가 기대하는 모양)
function dataUrlToImage(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

// 너무 큰 원본은 가로 기준으로 줄인다 (저장·붙여넣기 속도 확보)
async function shrinkIfHuge(dataUrl, maxW) {
  try {
    const im = await loadImage(dataUrl);
    const w = im.naturalWidth || im.width;
    const h = im.naturalHeight || im.height;
    if (w <= maxW) return dataUrl;
    const cv = document.createElement("canvas");
    cv.width = maxW;
    cv.height = Math.round((h * maxW) / w);
    cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  } catch (_) {
    return dataUrl;
  }
}

function canvasToImage(cv) {
  return new Promise((resolve) => {
    cv.toBlob((blob) => {
      const r = new FileReader();
      r.onload = () => resolve({ media_type: "image/png", data: r.result.split(",")[1] });
      r.readAsDataURL(blob);
    }, "image/png");
  });
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

async function genOpenAiImage(openaiKey, desc, style, i, total, rule) {
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
    (rule || "");   // ← 설정의 '이미지 규칙'이 여기에 붙는다
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + openaiKey,
    },
    body: JSON.stringify({ model: currentProfile.imgmodel || "gpt-image-1", prompt, size: "1536x1024", n: 1 }),
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
  // 이미지 방식: photo(올린 사진 우선) / ai(무조건 AI 생성) / none(그림 없음)
  const imgMode = document.getElementById("imgmode").value;
  if (imgMode === "none") {
    payload.images = [];
  } else if (imgMode === "ai") {
    payload.images = [];   // 올린 사진이 있어도 AI로 새로 만든다
  }

  if (imgMode !== "none" && payload.images.length === 0 && /\[이미지\s*\d+\]/.test(payload.body)) {
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
          imgs[idx] = await genOpenAiImage(
            openaiKey, ex.prompts[idx] || ctxMap[idx] || payload.title, style, i, markers.length, currentProfile.imgrule
          );
        } catch (e) {
          failMsg = e && e.message ? e.message : String(e);
          break;
        }
      }
      if (failMsg) {
        setStatus("AI 이미지 실패(" + failMsg + ") — 그림 없이 글만 넣습니다.", true);
      } else {
        payload.images = imgs;
      }
    } else {
      setStatus("사진·OpenAI 키가 없어 그림 없이 글만 넣습니다. (설정에 OpenAI 키를 넣으면 자동 생성)");
    }
  }

  // 그림이 없는 [이미지N] 자리는 본문에서 지운다 (마커 글자가 그대로 남지 않도록)
  payload.body = payload.body
    .split("\n")
    .filter((l) => {
      const m = l.trim().match(/^\[이미지\s*(\d+)\]\s*$/);
      return !m || (payload.images && payload.images[parseInt(m[1], 10) - 1]);
    })
    .join("\n");

  // 대표 썸네일: 내 사진 + 글 주제. 글 맨 앞에 넣어야 네이버가 대표 이미지로 잡는다.
  if (document.getElementById("usethumb").checked) {
    try {
      const topic = document.getElementById("topic").value.trim() || payload.title;
      payload.thumb = await drawThumbnail(thumbTemplate, topic, thumbBox);
      if (!payload.thumb) setStatus("썸네일 템플릿이 없어 대표 이미지는 건너뜁니다. (설정에서 등록)");
    } catch (e) {
      setStatus("썸네일 생성 실패 — 그냥 진행합니다. (" + (e && e.message ? e.message : e) + ")", true);
    }
  }

  // 하단 배너: 올린 이미지가 있으면 그걸 그대로, 없으면 예전 방식(학원 정보로 그린 배너)
  if (document.getElementById("usefooter").checked) {
    try {
      payload.footer = footerImage ? dataUrlToImage(footerImage) : await drawFooterBanner(currentProfile);
    } catch (_) {}
  }
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
