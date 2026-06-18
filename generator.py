# generator.py — 글 생성 (앤트로픽 Claude)
import re
from anthropic import Anthropic

MODEL = "claude-sonnet-4-6"  # 글 작성용 모델


def generate_post(api_key, template, gltype, topic, keyword, core, style):
    """전용 틀(template)을 규칙으로, 입력값을 받아 블로그 글 전체를 만든다."""
    client = Anthropic(api_key=api_key)
    user_msg = (
        "아래 정보로 네이버 블로그 글을 작성해줘.\n\n"
        f"- 글 종류: {gltype}\n"
        f"- 주제: {topic}\n"
        f"- 핵심(타겟) 키워드: {keyword}\n"
        f"- 핵심 내용: {core}\n"
        f"- 이미지 스타일: {style}\n"
    )
    resp = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=template,  # 전용 틀 = 작성 규칙
        messages=[{"role": "user", "content": user_msg}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")


def extract_title(text):
    """글에서 제목 한 줄을 뽑는다 (맨 위 # 제목 또는 첫 줄)."""
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip()
        if s:
            return s
    return "제목 없음"


def extract_image_prompts(text):
    """'이미지1: ...' / '**이미지1**: ...' 형태의 그림 설명을 [(라벨, 설명)] 으로 뽑는다."""
    prompts = []
    pattern = re.compile(r"이미지\s*(\d+)\s*\**\s*[::]\s*(.+)")
    for raw in text.splitlines():
        line = raw.strip().lstrip("-* ")
        m = pattern.search(line)
        if m:
            prompts.append((f"이미지{m.group(1)}", m.group(2).strip().rstrip("*").strip()))
    # 중복 라벨 제거 (먼저 나온 것 유지)
    seen, result = set(), []
    for label, desc in prompts:
        if label not in seen:
            seen.add(label)
            result.append((label, desc))
    return result
