# generator.py — 글 생성 (앤트로픽 Claude)
# - 사진을 올리면 Claude 가 사진을 '보고' 글을 쓰고, 사진 자리에 [이미지N] 을 배치한다.
# - 사진이 없으면 주제만으로 글을 쓰고, 끝에 이미지 설명(이미지N: ~)을 남긴다.
import base64
import re

from anthropic import Anthropic

MODEL = "claude-sonnet-4-6"  # 글 작성용 모델 (사진 이해 기능 있음)


def generate_post(api_key, template, gltype, topic, keyword, core, style, photos=None):
    """전용 틀(template)을 규칙으로, 입력값(+선택: 사진)을 받아 블로그 글 전체를 만든다.

    photos: [(media_type, bytes), ...] 형태의 업로드 사진 목록 (없으면 None).
    """
    client = Anthropic(api_key=api_key)
    photos = photos or []

    base_msg = (
        "아래 정보로 네이버 블로그 글을 작성해줘.\n\n"
        f"- 글 종류: {gltype}\n"
        f"- 주제: {topic}\n"
        f"- 핵심(타겟) 키워드: {keyword}\n"
        f"- 핵심 내용: {core}\n"
        f"- 이미지 스타일: {style}\n"
    )

    if photos:
        # ── 사진 업로드 모드: Claude 가 사진을 보고 글을 쓴다 ──
        n = len(photos)
        photo_msg = base_msg + (
            f"\n첨부한 사진 {n}장을 잘 보고, 사진 내용과 어울리는 블로그 글을 써줘.\n"
            f"사진이 들어갈 자리에 [이미지1]부터 [이미지{n}]까지 순서대로 본문에 한 줄씩 단독으로 배치하고,\n"
            "각 사진에 보이는 것을 글 속에 자연스럽게 녹여줘.\n"
            f"사진 개수({n}장)와 [이미지N] 개수를 똑같이 맞출 것.\n"
            "사진에 실제로 보이는 것만 쓰고, 사진에 없는 내용은 지어내지 마.\n"
            "사진은 이미 준비돼 있으니, 맨 끝의 '이미지 설명(이미지1: ~)' 부분은 쓰지 않아도 돼."
        )
        content = []
        for media_type, data in photos:
            b64 = base64.standard_b64encode(data).decode("utf-8")
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            })
        content.append({"type": "text", "text": photo_msg})
        messages = [{"role": "user", "content": content}]
    else:
        # ── 주제만으로 글쓰기 (끝에 이미지 설명 남김) ──
        messages = [{"role": "user", "content": base_msg}]

    resp = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=template,  # 전용 틀 = 작성 규칙
        messages=messages,
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
    """'이미지1: ...' / '**이미지1**: ...' 형태의 그림 설명을 [(라벨, 설명)] 으로 뽑는다.
    (사진 업로드 모드에선 보통 비어 있음 — 그땐 올린 사진을 그대로 쓴다.)"""
    prompts = []
    pattern = re.compile(r"이미지\s*(\d+)\s*\**\s*[::]\s*(.+)")
    for raw in text.splitlines():
        line = raw.strip().lstrip("-* ")
        m = pattern.search(line)
        if m:
            prompts.append((f"이미지{m.group(1)}", m.group(2).strip().rstrip("*").strip()))
    seen, result = set(), []
    for label, desc in prompts:
        if label not in seen:
            seen.add(label)
            result.append((label, desc))
    return result
