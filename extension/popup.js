// popup.js — 확장 팝업의 두뇌
// 설정 저장 → 사진 읽기 → Claude API로 글 생성 → 네이버 글쓰기 화면으로 전송

const MODEL = "claude-sonnet-4-6";

// 기본 전용 틀 (설정에서 비워두면 이걸 사용)
const DEFAULT_TEMPLATE = `당신은 더몬스터학원 원장이 직접 쓰는 것처럼 자연스러운 네이버 블로그 글을 씁니다.

[가장 중요한 출력 규칙]
1. 마크다운 기호를 절대 쓰지 마세요(#, *, **, >, -, ---, 표, 백틱). 네이버는 마크다운을 못 읽어 기호가 그대로 보입니다. 줄바꿈과 평범한 문장으로만 구분하세요.
2. 인용구(따옴표로 한 문장 강조) 방식을 쓰지 말고, 자연스러운 문단으로 풀어 쓰세요.
3. AI 티를 내지 마세요: "오늘은 ~알아보겠습니다", "결론적으로" 같은 정형구 금지, 과한 강조·이모지·체크리스트 금지, 같은 문장 구조 반복 금지.
4. 모든 출력은 사람이 손으로 쓴 듯한 평범한 줄글이어야 합니다.

[학원 정보]
- 학원명: 더몬스터학원 / 전화 062-653-1599 / 문자 010-7627-1003
- 주소: 광주광역시 동구 경양로234 118동상가 716호
- 카카오톡 채널: http://pf.kakao.com/_WNxezn
- 말투: 친근하되 신뢰감 있게(학부모 대상 존댓말)
- 고정 해시태그: 계림동수학학원, 광주수학학원, 동구수학학원, 더몬스터학원

[글 구조] 기호 없이 줄글로
1) 제목 한 줄(맨 첫 줄, 기호 없이, 핵심 키워드를 앞쪽에)
2) 도입 문단(학부모 고민에 공감하며 자연스럽게 시작)
3) 본문 문단 3~5개(모바일 기준 한 문단 3~4줄)
4) 사진이 들어갈 자리에는 그 줄에 [이미지1]처럼 표시만 단독으로
5) 마무리(전화·문자·카카오톡으로 상담 안내)
분량 약 1,500자.

[네이버 AEO 규칙] 검색하는 사람의 질문에 바로 답하기
- 핵심 키워드를 제목 앞쪽에 1번, 본문에 자연스럽게 3~5번(억지 반복 금지)
- 도입부에서 독자가 검색했을 질문에 핵심 답을 한두 문장으로 먼저 제시
- 소제목은 실제 검색하는 질문 형태로
- 동의어·관련어를 섞고, 지역 키워드(계림동, 광주 동구, 광주)는 항상 포함
- 구체적 롱테일을 노리고, 직접 겪은 사례로 신뢰도를 드러내기

[글 끝에 항상 붙이는 학원 소개] 기호 없이 평문으로
더몬스터학원은 광주 동구에 자리한 수학·교과 전문 학원입니다. 암기가 아니라 개념을 스스로 이해하는 데서 진짜 실력이 나온다고 믿고, 학생 한 명 한 명을 끝까지 책임지고 관리합니다. 대상은 초등 3학년부터 고등 3학년까지, 평일 오후 2시~밤 10시, 토요일 오전 9시~오후 8시 30분 운영합니다. 오시는 길은 광주광역시 동구 경양로234 118동상가 716호입니다. 전화 062-653-1599, 문자 010-7627-1003, 카카오톡 채널 http://pf.kakao.com/_WNxezn 로 상담하세요.

[최종 출력 순서]
제목 / 본문(도입→본문+[이미지N]→마무리) / 학원 소개 / 해시태그(# 붙여 10~15개)`;

let uploadedPhotos = []; // [{ media_type, data(base64) }]

// ---------- 설정 저장/불러오기 ----------
function loadSettings() {
  chrome.storage.local.get(["apiKey", "template"], (s) => {
    if (s.apiKey) document.getElementById("apiKey").value = s.apiKey;
    if (s.template) document.getElementById("template").value = s.template;
    // 키가 아직 없으면 설정을 펼쳐서 안내
    if (!s.apiKey) document.getElementById("settings").open = true;
  });
}

document.getElementById("saveSettings").addEventListener("click", () => {
  chrome.storage.local.set(
    {
      apiKey: document.getElementById("apiKey").value.trim(),
      template: document.getElementById("template").value,
    },
    () => setStatus("설정을 저장했습니다.")
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
  const template = document.getElementById("template").value.trim() || DEFAULT_TEMPLATE;
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

// ---------- 네이버에 입력 ----------
document.getElementById("sendNaver").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/blog\.naver\.com/.test(tab.url || "")) {
    setStatus("네이버 블로그 글쓰기 화면을 먼저 연 뒤 눌러주세요.", true);
    return;
  }
  setStatus("네이버 글쓰기 화면에 입력 중...");
  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "fill",
      title: document.getElementById("outTitle").value,
      body: document.getElementById("outBody").value,
      images: uploadedPhotos.map((p) => ({ media_type: p.media_type, data: p.data })),
    },
    (resp) => {
      if (chrome.runtime.lastError) {
        setStatus("연결 실패: 글쓰기 화면을 새로고침한 뒤 다시 시도하세요.\n(" + chrome.runtime.lastError.message + ")", true);
      } else if (resp && resp.ok) {
        setStatus("입력 시도 완료! 화면을 확인하세요. 발행은 직접 눌러주세요.");
      } else {
        setStatus("입력은 했지만 일부가 안 들어갔을 수 있어요. 화면을 확인해 주세요." + (resp && resp.msg ? "\n" + resp.msg : ""), true);
      }
    }
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
