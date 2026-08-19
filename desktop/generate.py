# desktop/generate.py — 글 생성 (앤트로픽 Claude)
# 확장 popup.js 의 전용 틀(buildTemplate)과 요청 문구를 파이썬으로 옮긴 것.
# 사진을 올리면 Claude 가 사진을 '보고' 글을 쓰고, 사진 자리에 [이미지N] 을 배치한다.

import base64
from pathlib import Path

from anthropic import Anthropic

MODEL = "claude-sonnet-4-6"

# 학원 정보 기본값 (설정에서 비워두면 이걸 사용 = 더몬스터학원)
DEFAULT_PROFILE = {
    "name": "더몬스터학원",
    "tagline": "광주 동구 계림동 · 초등3학년~고3 수학·교과 전문",
    "phone": "062-653-1599",
    "sms": "010-7627-1003",
    "kakao": "http://pf.kakao.com/_WNxezn",
    "talktalk": "",
    "address": "광주광역시 동구 경양로234 118동상가 716호",
    "hours": "평일 오후 2시~밤 10시 / 토요일 오전 9시~오후 8시 30분",
    "region": "계림동, 광주 동구, 광주",
    "hashtags": "계림동수학학원, 광주수학학원, 동구수학학원",
}

PROFILE_KEYS = list(DEFAULT_PROFILE.keys())


def full_profile(p):
    """저장된 값과 기본값을 합쳐 완전한 프로필로."""
    out = dict(DEFAULT_PROFILE)
    for k in PROFILE_KEYS:
        v = (p or {}).get(k, "")
        if str(v).strip():
            out[k] = str(v).strip()
    return out


def build_template(p):
    """학원 정보로 '전용 틀'(시스템 프롬프트)을 자동 생성 — 확장 popup.js 와 동일 규칙."""
    region = ", ".join(s.strip() for s in (p.get("region") or "").split(",") if s.strip())
    return f"""당신은 {p['name']} 원장이 직접 쓰는 것처럼 자연스러운 네이버 블로그 글을 씁니다.

[가장 중요한 출력 규칙]
1. 마크다운 기호를 절대 쓰지 마세요(#, *, **, >, -, ---, 표, 백틱). 네이버는 마크다운을 못 읽어 기호가 그대로 보입니다. 줄바꿈과 평범한 문장으로만 구분하세요.
2. 인용구(핵심 메시지 한 문장)는 그 줄 맨 앞에 [인용] 을 붙여 단독 줄로 넣으세요. 예: [인용] 학원이 문제인가, 아이가 문제인가 (따옴표·기호 없이).
3. AI 티를 내지 마세요: "오늘은 ~알아보겠습니다", "결론적으로" 같은 정형구 금지, 과한 강조·이모지·체크리스트 금지, 같은 문장 구조 반복 금지.
4. 모든 출력은 사람이 손으로 쓴 듯한 평범한 줄글이어야 합니다.

[학원 정보]
- 학원명: {p['name']}
- 소개: {p['tagline']}
- 말투: 친근하되 신뢰감 있게(학부모 대상 존댓말)

[글 구조] 기호 없이 줄글로
1) 제목 한 줄(맨 첫 줄, 기호 없이, 핵심 키워드를 앞쪽에)
2) 도입 문단(학부모 고민에 공감하며 자연스럽게 시작)
3) 아래 묶음을 2~3번 반복:
   - 인용구 한 줄: 줄 맨 앞에 [인용] 을 붙여 핵심 메시지 한 문장
   - 사진 자리: [이미지N] 을 그 줄에 단독으로(사진 올린 개수만큼)
   - 본문 문단: 바로 위 인용구를 풀어 설명(학원 강점을 자연스럽게)
4) 마무리 문단: 따뜻한 한두 문장으로 상담을 권하기.
분량 약 1,500자. [인용]과 [이미지N]은 각각 그 줄에 단독으로 둘 것.

[이미지 설명] 본문에 넣은 [이미지N] 개수만큼, 글 맨 끝에 "이미지N: 설명" 형식으로 한 줄씩 쓸 것.
각 설명은 서로 완전히 다른 장면·소재·구도로 (예: 교실 전경 / 문제집 위의 손 클로즈업 / 칠판 앞 뒷모습 / 상담 테이블). 같은 소재 반복 금지.

[네이버 AEO 규칙] 검색하는 사람의 질문에 바로 답하기
- 핵심 키워드를 제목 앞쪽에 1번, 본문에 자연스럽게 3~5번(억지 반복 금지)
- 도입부에서 독자가 검색했을 질문에 핵심 답을 한두 문장으로 먼저 제시
- 소제목은 실제 검색하는 질문 형태로
- 동의어·관련어를 섞고, 지역 키워드({region})는 본문에 자연스럽게 포함
- 구체적 롱테일을 노리고, 직접 겪은 사례로 신뢰도를 드러내기

[마무리에서 하지 말 것 — 매우 중요]
전화번호·문자·카카오톡·네이버 톡톡·운영시간·주소·지도 안내를 본문 마무리에 줄줄이 나열하지 마세요.
그 정보는 앱이 글 맨 아래에 '예쁜 배너 이미지'로 깔끔하게 넣습니다. 본문에는 연락처·시간·주소를 반복해서 쓰지 마세요.
마무리는 상담을 권하는 따뜻한 문장으로만 끝내세요.

[최종 출력 순서]
제목 / 본문(도입→본문+[이미지N]→따뜻한 마무리 문장) / 이미지 설명(이미지N: 한 줄씩) / 해시태그(# 붙여 10~15개. 다음을 포함: {p['hashtags']}, {p['name']})"""


def generate_post(api_key, template, gltype, topic, keyword, core, photo_paths=None):
    """글 전체를 생성해 (제목, 본문) 으로 돌려준다. photo_paths: 사진 파일 경로 목록."""
    client = Anthropic(api_key=api_key)
    photo_paths = photo_paths or []

    user_text = (
        "아래 정보로 네이버 블로그 글을 작성해줘.\n\n"
        f"- 글 종류: {gltype}\n- 주제: {topic}\n- 핵심(타겟) 키워드: {keyword}\n"
        f"- 핵심 내용: {core}\n"
    )
    if photo_paths:
        n = len(photo_paths)
        user_text += (
            f"\n첨부한 사진 {n}장을 잘 보고, 사진 내용과 어울리는 글을 써줘.\n"
            f"사진이 들어갈 자리에 [이미지1]부터 [이미지{n}]까지 순서대로 본문에 한 줄씩 단독으로 배치하고,\n"
            f"각 사진에 보이는 것을 자연스럽게 녹여줘. 사진 개수({n}장)와 [이미지N] 개수를 똑같이 맞출 것.\n"
            "사진에 실제로 보이는 것만 쓰고, 사진에 없는 내용은 지어내지 마."
        )
        content = []
        for p in photo_paths:
            data = Path(p).read_bytes()
            ext = Path(p).suffix.lower()
            mt = "image/png" if ext == ".png" else "image/jpeg"
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": mt,
                           "data": base64.standard_b64encode(data).decode()},
            })
        content.append({"type": "text", "text": user_text})
    else:
        content = user_text

    resp = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=template,
        messages=[{"role": "user", "content": content}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")

    # 첫 줄 = 제목, 나머지 = 본문 (확장 showResult 와 동일)
    lines = text.split("\n")
    idx = next((i for i, l in enumerate(lines) if l.strip()), -1)
    title = lines[idx].lstrip("#").strip() if idx >= 0 else "제목 없음"
    body = "\n".join(lines[idx + 1:]).strip()
    return title, body
