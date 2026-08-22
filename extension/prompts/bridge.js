// prompts/bridge.js — UI 입력과 훅·본문 규칙을 Claude 요청으로 연결
(function () {
  "use strict";

  function compose(input, hookSelection, photoCount) {
    let text = "아래 정보로 네이버 블로그 글을 작성해줘.\n\n" +
      `- 글 종류: ${input.gltype}\n- 주제: ${input.topic}\n- 핵심(타겟) 키워드: ${input.keyword}\n` +
      `- 핵심 내용: ${input.core}\n- 이미지 스타일: ${input.style}\n\n` +
      PromptHooks.instructions(hookSelection) + "\n\n" +
      "핵심 내용과 실제 근거에 명시되지 않은 숫자, 성적 변화, 학생 사례, 상담 대화는 본문 어디에도 만들지 마세요. 자료가 없으면 일반적인 설명으로 쓰세요.";
    if (photoCount > 0) {
      text += `\n\n첨부한 사진 ${photoCount}장을 보고 [이미지1]부터 [이미지${photoCount}]까지 본문에 같은 개수로 배치하세요. ` +
        "사진에 실제로 보이는 것만 쓰고, 없는 내용은 지어내지 마세요.";
    }
    return text;
  }

  self.PromptBridge = { compose };
})();
