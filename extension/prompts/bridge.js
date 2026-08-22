// prompts/bridge.js — UI 입력과 훅·본문 규칙을 Claude 요청으로 연결
(function () {
  "use strict";

  const TRANSITIONS = {
    number: "이 차이가 생기는 지점을 본문에서 학습 과정 순서대로 살펴보겠습니다.",
    misconception: "그렇다면 실제로 무엇을 기준으로 판단해야 하는지 본문에서 짚어보겠습니다.",
    scene: "이 장면이 보여주는 학습 신호를 본문에서 하나씩 풀어보겠습니다.",
    failure: "같은 아쉬움을 되풀이하지 않기 위해 바꾼 기준을 본문에서 설명하겠습니다.",
    classification: "각 유형을 구분하는 관찰 기준과 대응 방법을 본문에서 살펴보겠습니다.",
    time: "두 시점 사이에서 확인해야 할 학습 과정을 본문에서 차근차근 살펴보겠습니다.",
    none: "",
  };

  function compose(input, hookSelection, photoCount) {
    let text = "아래 정보로 네이버 블로그 글을 작성해줘.\n\n" +
      `- 글 종류: ${input.gltype}\n- 주제: ${input.topic}\n- 핵심(타겟) 키워드: ${input.keyword}\n` +
      `- 핵심 내용: ${input.core}\n- 이미지 스타일: ${input.style}\n\n` +
      PromptHooks.instructions(hookSelection) + "\n\n" +
      `[훅에서 본문으로 잇는 문장]\n${TRANSITIONS[hookSelection.type] || ""}\n위 문장을 도입 마지막에 자연스럽게 적용하되 별도 표시는 출력하지 마세요.\n\n` +
      "핵심 내용과 실제 근거에 명시되지 않은 숫자, 성적 변화, 학생 사례, 상담 대화는 본문 어디에도 만들지 마세요. 자료가 없으면 일반적인 설명으로 쓰세요.";
    if (photoCount > 0) {
      text += `\n\n첨부한 사진 ${photoCount}장을 보고 [이미지1]부터 [이미지${photoCount}]까지 본문에 같은 개수로 배치하세요. ` +
        "사진에 실제로 보이는 것만 쓰고, 없는 내용은 지어내지 마세요.";
    }
    return text;
  }

  self.PromptBridge = { TRANSITIONS, compose };
})();
