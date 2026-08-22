// prompts/hooks.js — 도입부 훅 선택, 근거 검증, 최근 사용 이력
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
  const SAFE_AUTO = ["misconception", "classification", "none"];
  const EVIDENCE_AUTO = ["number", "scene", "time"];

  function requiresEvidence(type) {
    return !!(HOOKS[type] && HOOKS[type].evidence);
  }

  function chooseAuto(recent, hasEvidence, randomFn) {
    const blocked = new Set((recent || []).slice(-5));
    let candidates = SAFE_AUTO.concat(hasEvidence ? EVIDENCE_AUTO : []).filter((type) => !blocked.has(type));
    if (!candidates.length) candidates = SAFE_AUTO.concat(hasEvidence ? EVIDENCE_AUTO : []);
    const random = randomFn || Math.random;
    const roll = random();
    // 실패 고백형은 실제 근거가 있을 때만, 자동 추천의 최대 5%로 제한한다.
    if (hasEvidence && !blocked.has("failure") && roll < 0.05) return "failure";
    const normalized = roll < 0.05 ? 0 : (roll - 0.05) / 0.95;
    return candidates[Math.floor(normalized * candidates.length)] || "misconception";
  }

  function resolve(type, evidence, recent, randomFn) {
    const cleanEvidence = String(evidence || "").trim();
    const resolved = type === "auto" ? chooseAuto(recent, !!cleanEvidence, randomFn) : type;
    if (!HOOKS[resolved]) return { error: "알 수 없는 훅 유형입니다." };
    if (requiresEvidence(resolved) && !cleanEvidence) {
      return { error: `${HOOKS[resolved].label}은 실제 근거가 필요합니다. 확인된 사실을 입력해 주세요.` };
    }
    return { type: resolved, label: HOOKS[resolved].label, evidence: cleanEvidence };
  }

  function instructions(selection) {
    const common = "입력된 근거의 범위만 사용하고 숫자, 성적 변화, 학생 사례, 상담 대화를 새로 만들거나 추정하지 마세요.";
    const rules = {
      number: "첫 문장에서 검증된 숫자 사이의 예상 밖 차이를 보여 주세요. 숫자의 단위와 맥락을 바꾸지 마세요.",
      misconception: "흔한 오해 하나를 짚고 과장 없이 바로잡아 주세요. 통계나 사례를 덧붙이지 마세요.",
      scene: "제공된 실제 관찰 장면만 짧게 재현하세요. 입력에 없는 학생의 말이나 상담 대화를 직접 인용하지 마세요.",
      failure: "제공된 실제 실패 경험과 배운 점만 담담히 고백하세요. 학생 탓으로 돌리거나 극적인 결과를 만들지 마세요.",
      classification: "독자의 고민을 일반적인 2~3가지 유형으로 나누되 가상의 학생 사례는 쓰지 마세요.",
      time: "제공된 실제 기간·시점만 대비하세요. 성적 또는 결과 변화를 추정하지 마세요.",
      none: "별도의 훅을 만들지 말고 주제의 핵심 답부터 차분히 시작하세요.",
    };
    return `[도입부 훅]\n- 선택: ${selection.label}\n- 규칙: ${rules[selection.type]}\n- 실제 근거: ${selection.evidence || "제공되지 않음"}\n- 안전 규칙: ${common}`;
  }

  self.PromptHooks = { HOOKS, requiresEvidence, chooseAuto, resolve, instructions };
})();
