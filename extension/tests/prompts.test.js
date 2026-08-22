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
assert.equal(hooks.resolve("number", "", []).error.includes("실제 근거"), true);
assert.equal(hooks.resolve("scene", "관찰한 수업 장면", []).type, "scene");
assert.equal(hooks.chooseAuto(["misconception"], false, () => 0.5), "classification");
assert.equal(hooks.chooseAuto([], true, () => 0.01), "failure");
assert.notEqual(hooks.chooseAuto(["failure"], true, () => 0.01), "failure");

const selection = hooks.resolve("misconception", "", []);
const prompt = context.self.PromptBridge.compose({
  gltype: "교육정보", topic: "수학 공부", keyword: "수학학원", core: "개념 복습", style: "교육현장 다큐멘터리",
}, selection, 0);
assert.match(prompt, /학생 사례, 상담 대화는 본문 어디에도 만들지 마세요/);
assert.match(context.self.PromptBody.buildTemplate({ name: "테스트학원", tagline: "수학", region: "서울", hashtags: "수학학원" }), /사실성 안전 규칙/);
console.log("prompt tests passed");
