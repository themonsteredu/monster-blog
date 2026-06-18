# images.py — 이미지 생성 (OpenAI gpt-image-1)
import base64
from openai import OpenAI

MODEL = "gpt-image-1"  # 그림 생성용 모델 (필요시 gpt-image-1.5 등으로 변경 가능)

# 스타일 전환: 같은 그림 설명이라도 앞에 붙는 지시문으로 일러스트/실사를 바꾼다
STYLE_PREFIX = {
    "일러스트": "깔끔한 플랫 일러스트레이션 스타일, 부드러운 색감, 글자(텍스트) 없이. ",
    "실사": "사실적인 사진 스타일, 자연스러운 조명, 글자(텍스트) 없이. ",
}


def generate_image(api_key, description, style, out_path, size="1536x1024", quality="medium"):
    """그림 설명(description)과 스타일로 이미지 1장을 만들어 out_path에 저장."""
    client = OpenAI(api_key=api_key)
    prompt = (
        STYLE_PREFIX.get(style, "")
        + description
        + " (학생 얼굴 등 식별 가능한 실제 인물은 그리지 말 것)"
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
