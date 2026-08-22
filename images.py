# images.py — 이미지 생성 (OpenAI gpt-image-1)
import base64
import re
from openai import OpenAI

MODEL = "gpt-image-1"  # 그림 생성용 모델 (필요시 gpt-image-1.5 등으로 변경 가능)

ROLE_PROMPTS = [
    "대표 이미지: 학생이 책상에서 수학 문제를 고민하는 실제 수업 장면",
    "학습 디테일: 오답 흔적이 남은 문제집, 연필과 지우개, 연필을 잡은 손",
    "상호작용: 선생님이 학생 옆에서 풀이 과정을 확인하는 자연스러운 순간",
    "공간 기록: 교재와 필기 흔적이 남은 책상과 소규모 교실",
]

# 스타일 전환: 같은 그림 설명이라도 앞에 붙는 지시문으로 일러스트/실사를 바꾼다
STYLE_PREFIX = {
    "일러스트": "깔끔한 플랫 일러스트레이션 스타일, 부드러운 색감, 글자(텍스트) 없이. ",
    "실사": "사실적인 사진 스타일, 자연스러운 조명, 글자(텍스트) 없이. ",
    "교육현장 다큐멘터리": (
        "한국 소규모 초등·중등 수학학원의 실제 수업을 순간 포착한 교육현장 다큐멘터리 사진. "
        "광고·스톡사진 같은 연출, 과한 HDR와 영화 색보정, 플라스틱 같은 AI 질감을 피하고 "
        "자연광과 현실적인 실내조명, 사용감 있는 문제집·연필·지우개·필기·오답 흔적을 담을 것. "
        "한국 학생의 손·옆모습·뒷모습 중심, 얼굴 정면 클로즈업 없이, 글자·로고·워터마크 없이. "
    ),
}


def generate_image(api_key, description, style, out_path, size="1536x1024", quality="medium"):
    """그림 설명(description)과 스타일로 이미지 1장을 만들어 out_path에 저장."""
    client = OpenAI(api_key=api_key)
    match = re.search(r"이미지(\d+)", str(out_path))
    role_index = (int(match.group(1)) - 1) % len(ROLE_PROMPTS) if match else 0
    prompt = (
        STYLE_PREFIX.get(style, "")
        + ROLE_PROMPTS[role_index]
        + ". 다른 이미지와 역할·행동·소재를 반복하지 말 것. "
        + description
        + " (학생 얼굴 등 식별 가능한 실제 인물, 읽을 수 있는 글자, 로고, 워터마크는 만들지 말 것)"
    )
    result = client.images.generate(
        model=MODEL,
        prompt=prompt,
        size=size,
        quality=quality,
    )
    b64 = result.data[0].b64_json  # gpt-image 계열은 항상 base64로 반환
    with open(out_path, "wb") as f:
        f.write(base64.b64decode(b64))
    return out_path
