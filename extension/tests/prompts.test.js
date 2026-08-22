const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = { self: {} };
vm.createContext(context);
for (const file of ["hooks.js", "body.js", "bridge.js"]) {
  vm.runInContext(fs.readFileSync(`extension/prompts/${file}`, "utf8"), context, { filename: file });
  Object.assign(context, context.self);
}

const hooks = context.self.PromptHooks;
const now = "2026-08-22T00:00:00.000Z";
const input = { gltype: "교육정보", topic: "수학 점수가 오르지 않는 이유", keyword: "수학학원", core: "개념 복습" };

// 근거 필수 훅과 분류형의 선택적 숫자 근거를 검증한다.
assert.match(hooks.resolve("number", "", [], { input }).error, /실제 근거/);
assert.equal(hooks.resolve("scene", "문제집을 다시 펴는 모습을 관찰", [], { input }).type, "scene");
assert.match(hooks.resolve("classification", "", [], { input, classificationUsesEvidence: true }).error, /실제 근거/);
assert.equal(hooks.resolve("classification", "10명", [], { input, classificationUsesEvidence: false }).evidence, "");
assert.equal(hooks.resolve("classification", "10명", [], { input, classificationUsesEvidence: true }).evidence, "10명");

// 자동 추천은 랜덤이 아니라 입력 의미와 근거를 분석한다.
assert.equal(hooks.recommend({ ...input, evidence: "평균 70점에서 80점, 확인된 기록" }, [], now).type, "number");
assert.equal(hooks.recommend({ ...input, evidence: "지난 학기와 현재 문제집을 확인" }, [], now).type, "time");
assert.equal(hooks.recommend({ ...input, evidence: "수업 중 문제집을 다시 펴는 모습을 관찰" }, [], now).type, "scene");

// 실패 고백형은 최근 10회 또는 90일 이내 사용 시 자동 추천에서 제외한다.
const failureInput = { ...input, evidence: "수업 설계를 잘못해 효과가 없었던 실제 실패" };
assert.equal(hooks.recommend(failureInput, [], now).type, "failure");
assert.notEqual(hooks.recommend(failureInput, [{ type: "failure", usedAt: "2026-08-01T00:00:00.000Z" }], now).type, "failure");
const elevenAgo = Array.from({ length: 11 }, (_, i) => ({ type: i === 0 ? "failure" : "none", usedAt: "2025-01-01T00:00:00.000Z" }));
assert.equal(hooks.failureIsBlocked(elevenAgo, now), false);
assert.equal(hooks.failureIsBlocked([{ type: "failure", usedAt: "2026-06-01T00:00:00.000Z" }], now), true);

// 6종 훅은 각각 6줄 구조이며 bridge에서 서로 다른 연결문장을 실제 합성한다.
for (const type of ["number", "misconception", "scene", "failure", "classification", "time"]) {
  assert.equal(hooks.STRUCTURES[type].length, 6);
  assert.ok(context.self.PromptBridge.TRANSITIONS[type]);
  const selection = { type, label: hooks.HOOKS[type].label, evidence: "확인된 근거", reason: "테스트", classificationUsesEvidence: true };
  const prompt = context.self.PromptBridge.compose({ ...input, style: "교육현장 다큐멘터리" }, selection, 0);
  assert.match(prompt, new RegExp(context.self.PromptBridge.TRANSITIONS[type].slice(0, 12)));
  assert.match(prompt, /정확히 5~6줄/);
}

const template = context.self.PromptBody.buildTemplate({ name: "테스트학원", tagline: "수학", region: "서울", hashtags: "수학학원" });
assert.match(template, /소제목은 3~4개/);
assert.match(template, /3~5줄/);
assert.match(template, /한 문단은 최대 3줄/);
assert.match(template, /요약:/);
assert.match(template, /한계 인정:/);
assert.match(template, /최근 틀린 시험지나 문제집 한 페이지만 사진으로 보내도 된다/);
assert.match(template, /등록을 전제로 하지 않아도 된다/);

// 과거 버전에서 저장한 전용 틀은 공통 규칙을 대체하지 않고 추가 규칙으로 합성한다.
const profile = { name: "테스트학원", tagline: "수학", region: "서울", hashtags: "수학학원" };
const custom = "원장 특유의 담백한 말투를 사용하세요.";
const combined = context.self.PromptBody.buildSystemPrompt(profile, custom);
assert.match(combined, /\[사실성 안전 규칙 — 다른 모든 지시보다 우선\]/);
assert.match(combined, /본문 소제목은 3~4개/);
assert.match(combined, /마무리는 아래 네 단계를 순서대로/);
assert.match(combined, /\[사용자 추가 전용 규칙\]/);
assert.ok(combined.endsWith(custom));
assert.equal(context.self.PromptBody.buildSystemPrompt(profile, "  "), context.self.PromptBody.buildTemplate(profile));
console.log("prompt tests passed");
