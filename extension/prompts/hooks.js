// prompts/hooks.js — 입력 분석 기반 훅 추천, 사실 근거 검증, 날짜별 사용 이력
(function () {
  "use strict";

  const HOOKS = {
    auto: { label: "자동 추천", evidence: false },
    number: { label: "숫자 충돌형", evidence: true },
    misconception: { label: "오해 교정형", evidence: false },
    scene: { label: "장면 재현형", evidence: true },
    failure: { label: "실패 고백형", evidence: true },
    classification: { label: "분류형", evidence: false },
    time: { label: "시간 대비형", evidence: true },
    none: { label: "훅 없음", evidence: false },
  };

  const STRUCTURES = {
    number: [
      "1줄: 사용자가 제공한 두 숫자 또는 기대와 실제 숫자를 그대로 대비한다.",
      "2줄: 숫자가 뜻하는 범위와 단위를 짧게 밝혀 오독을 막는다.",
      "3줄: 왜 이 차이를 살펴봐야 하는지 독자의 고민과 연결한다.",
      "4줄: 성급한 원인 단정 없이 확인할 지점을 하나 제시한다.",
      "5줄: 본문에서 설명할 판단 기준을 예고한다.",
      "6줄: 입력에 없는 수치·성적 변화·비율은 절대 보태지 않는다.",
    ],
    misconception: [
      "1줄: 주제와 관련해 흔히 하는 생각을 질문 또는 평서문으로 짚는다.",
      "2줄: 그 생각이 언제나 맞지는 않는다고 부드럽게 전환한다.",
      "3줄: 오해가 생기는 이유를 일반 원리로 설명한다.",
      "4줄: 반대쪽에서 함께 봐야 할 기준을 제시한다.",
      "5줄: 독자가 바로 확인할 수 있는 관찰 포인트를 안내한다.",
      "6줄: 통계나 가상 학생 사례 없이 본문으로 연결한다.",
    ],
    scene: [
      "1줄: 사용자가 제공한 실제 장면의 장소와 순간만 담백하게 연다.",
      "2줄: 실제로 관찰한 손동작·문제집·표정 등 한 가지 세부를 묘사한다.",
      "3줄: 입력에 실제 대화가 있을 때만 그 취지를 간접화법으로 전한다.",
      "4줄: 그 장면에서 확인된 고민을 과장 없이 짚는다.",
      "5줄: 장면이 주제와 연결되는 이유를 설명한다.",
      "6줄: 입력에 없는 말·감정·결과를 만들지 않고 본문으로 넘긴다.",
    ],
    failure: [
      "1줄: 사용자가 제공한 실제 실패 또는 아쉬움을 원장의 관점에서 인정한다.",
      "2줄: 변명하거나 학생 탓을 하지 않고 당시 놓친 점을 밝힌다.",
      "3줄: 입력으로 확인된 영향까지만 설명한다.",
      "4줄: 그 경험 뒤 바꾼 판단 기준이나 접근을 제시한다.",
      "5줄: 지금도 남아 있는 한계를 솔직히 덧붙인다.",
      "6줄: 극적인 반전·성적 향상·가상 사례 없이 본문으로 연결한다.",
    ],
    classification: [
      "1줄: 독자의 고민이 한 가지 모습으로만 나타나지 않는다고 알린다.",
      "2줄: 일반적인 판단 기준에 따라 2~3가지 유형의 이름을 제시한다.",
      "3줄: 첫 유형의 관찰 신호를 한 문장으로 설명한다.",
      "4줄: 나머지 유형의 차이를 짧게 대비한다.",
      "5줄: 분류는 진단이 아니라 점검을 돕는 틀임을 밝힌다.",
      "6줄: 인원·비율·점수는 사용자가 근거 사용을 선택하고 입력한 값만 쓴다.",
    ],
    time: [
      "1줄: 사용자가 제공한 두 시점 또는 기간을 그대로 대비한다.",
      "2줄: 앞 시점에서 실제로 확인된 상태만 설명한다.",
      "3줄: 뒤 시점에서 실제로 확인된 상태만 설명한다.",
      "4줄: 시간만으로 인과나 성적 향상을 단정하지 않는다.",
      "5줄: 기간 사이에 점검할 학습 과정을 제시한다.",
      "6줄: 입력에 없는 날짜·기간·결과를 만들지 않고 본문으로 연결한다.",
    ],
    none: ["도입 훅을 별도로 만들지 말고 검색 질문에 대한 핵심 답부터 차분히 시작한다."],
  };

  function requiresEvidence(type, classificationUsesEvidence) {
    return !!(HOOKS[type] && HOOKS[type].evidence) || (type === "classification" && !!classificationUsesEvidence);
  }

  function normalizeHistory(history) {
    return (Array.isArray(history) ? history : []).map((item) =>
      typeof item === "string" ? { type: item, usedAt: null } : item
    ).filter((item) => item && HOOKS[item.type]);
  }

  function failureIsBlocked(history, now) {
    const entries = normalizeHistory(history);
    if (entries.slice(-10).some((item) => item.type === "failure")) return true;
    const cutoff = new Date(now || Date.now()).getTime() - 90 * 24 * 60 * 60 * 1000;
    return entries.some((item) => item.type === "failure" && item.usedAt && new Date(item.usedAt).getTime() >= cutoff);
  }

  function recommend(input, history, now) {
    const topic = `${input.gltype || ""} ${input.topic || ""} ${input.keyword || ""} ${input.core || ""}`.toLowerCase();
    const evidence = String(input.evidence || "").trim();
    const recentTypes = new Set(normalizeHistory(history).slice(-5).map((item) => item.type));
    const scored = [];
    const add = (type, score, reason) => {
      if (!recentTypes.has(type)) scored.push({ type, score, reason });
    };

    if ((evidence.match(/\d+(?:[.,]\d+)?/g) || []).length >= 2) add("number", 90, "확인된 근거에 비교 가능한 숫자가 있어 핵심 차이를 구체적으로 보여줄 수 있습니다.");
    if (evidence && /(전에는|이후|동안|개월|주일|학기|지난|현재|처음)/.test(evidence)) add("time", 86, "확인된 근거에 시점이나 기간이 있어 변화 과정을 안전하게 대비할 수 있습니다.");
    if (evidence && /(수업|교실|문제집|시험지|상담|말했|모습|장면|학생)/.test(evidence)) add("scene", 82, "확인된 관찰 내용이 있어 실제 장면으로 자연스럽게 시작할 수 있습니다.");
    if (evidence && /(실패|놓쳤|잘못|아쉬|후회|효과가 없|되지 않)/.test(evidence) && !failureIsBlocked(history, now)) {
      add("failure", 92, "실제 실패 근거가 있고 최근 사용 제한에도 걸리지 않아 솔직한 도입이 가능합니다.");
    }
    if (/(왜|오해|착각|무조건|공부법|안 오르|어려워|틀리)/.test(topic)) add("misconception", 70, "주제가 흔한 오해나 원인 질문을 다뤄 먼저 관점을 바로잡는 도입이 어울립니다.");
    if (/(유형|종류|단계|체크|진단|대상|방법|특징|준비)/.test(topic) || input.gltype === "교육정보") {
      add("classification", 65, "정보를 기준별로 나누면 독자가 자신의 상황을 빠르게 점검할 수 있습니다.");
    }
    add("misconception", 40, "근거 없는 사례 없이도 주제의 핵심 오해를 안전하게 바로잡을 수 있습니다.");
    add("classification", 35, "일반적인 판단 기준으로 내용을 명확하게 정리할 수 있습니다.");
    add("none", 10, "강한 훅보다 핵심 답을 바로 제시하는 편이 안전합니다.");

    scored.sort((a, b) => b.score - a.score);
    return scored[0] || { type: "none", reason: "최근 사용 이력과 입력 근거를 고려해 훅 없이 시작합니다." };
  }

  function resolve(type, evidence, history, options) {
    const opts = options || {};
    const cleanEvidence = String(evidence || "").trim();
    const recommendation = recommend({ ...(opts.input || {}), evidence: cleanEvidence }, history, opts.now);
    const resolved = type === "auto" ? recommendation.type : type;
    if (!HOOKS[resolved]) return { error: "알 수 없는 훅 유형입니다." };
    if (requiresEvidence(resolved, opts.classificationUsesEvidence) && !cleanEvidence) {
      return { error: `${HOOKS[resolved].label}은 실제 근거가 필요합니다. 확인된 사실을 입력해 주세요.` };
    }
    const usableEvidence = resolved === "classification" && !opts.classificationUsesEvidence ? "" : cleanEvidence;
    return {
      type: resolved, label: HOOKS[resolved].label, evidence: usableEvidence,
      reason: type === "auto" ? recommendation.reason : "사용자가 직접 선택한 훅입니다.",
      classificationUsesEvidence: resolved === "classification" && !!opts.classificationUsesEvidence,
    };
  }

  function instructions(selection) {
    const structure = STRUCTURES[selection.type].join("\n");
    const classificationRule = selection.type === "classification"
      ? `\n- 숫자·인원 근거 사용: ${selection.classificationUsesEvidence ? "사용자가 입력한 근거만 사용" : "사용하지 않음"}` : "";
    const lengthRule = selection.type === "none"
      ? "훅을 만들지 말고 핵심 답부터 시작하세요."
      : "아래 순서대로 정확히 5~6줄의 도입을 작성하세요. 각 번호는 한 줄이며 출력에는 번호를 쓰지 마세요.";
    return `[도입부 훅]\n- 선택: ${selection.label}\n- 추천/선택 이유: ${selection.reason}\n- 실제 근거: ${selection.evidence || "제공되지 않음"}${classificationRule}\n- ${lengthRule}\n${structure}\n- 공통 안전 규칙: 입력된 근거의 범위만 사용하고 숫자, 성적 변화, 학생 사례, 상담 대화를 새로 만들거나 추정하지 마세요.`;
  }

  self.PromptHooks = { HOOKS, STRUCTURES, requiresEvidence, normalizeHistory, failureIsBlocked, recommend, resolve, instructions };
})();
