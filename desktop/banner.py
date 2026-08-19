# desktop/banner.py — 하단 연락처 배너 + 카드 이미지 (Pillow)
# 확장 popup.js 의 캔버스 그리기(drawFooterBanner / drawCard)를 파이썬으로 옮긴 것.
# 사진을 안 올렸을 때 [이미지N] 자리에 들어갈 '인용구 카드'와,
# 글 맨 아래에 붙는 '연락처 배너'를 API·비용 없이 만든다.

import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 한글 폰트 후보 (OS별) — 처음 발견되는 것을 쓴다
FONT_CANDIDATES = [
    "C:/Windows/Fonts/malgunbd.ttf",   # 윈도우 맑은고딕 굵게
    "C:/Windows/Fonts/malgun.ttf",     # 윈도우 맑은고딕
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",  # 맥
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",  # 리눅스
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
]


def _font(size):
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    raise RuntimeError("한글 폰트를 찾지 못했습니다 (맑은고딕 등). 배너/카드 생성을 건너뜁니다.")


def _gradient(w, h, c1, c2):
    """왼쪽위→오른쪽아래 그라데이션 배경."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(0, w, 4):  # 4픽셀 단위로 칠해 속도 확보
            t = (x / w + y / h) / 2
            col = tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))
            for dx in range(min(4, w - x)):
                px[x + dx, y] = col
    return img


def _wrap(draw, text, font, max_w):
    """한글은 아무 데서나 줄바꿈 가능 — 글자 단위로 자른다 (확장과 동일)."""
    lines, cur = [], ""
    for ch in text:
        if draw.textlength(cur + ch, font=font) > max_w and cur:
            lines.append(cur.strip())
            cur = "" if ch == " " else ch
        else:
            cur += ch
    if cur.strip():
        lines.append(cur.strip())
    return lines


CARD_PALETTES = [
    ((0xEE, 0xF7, 0xF0), (0xCF, 0xE8, 0xD6), (0x24, 0x5C, 0x37)),
    ((0xEE, 0xF3, 0xFB), (0xD3, 0xE3, 0xF6), (0x1F, 0x4E, 0x79)),
    ((0xFD, 0xF3, 0xEC), (0xF5, 0xDD, 0xC7), (0x8A, 0x4B, 0x2D)),
    ((0xF3, 0xF0, 0xFB), (0xDF, 0xD6, 0xF2), (0x4A, 0x3D, 0x7A)),
]


def draw_card(text, out_path, palette_idx=0, footer_text=""):
    """인용구/제목 문장을 넣은 깔끔한 카드 그림 한 장."""
    c1, c2, tc = CARD_PALETTES[palette_idx % len(CARD_PALETTES)]
    W, H = 1000, 640
    img = _gradient(W, H, c1, c2)
    draw = ImageDraw.Draw(img)
    font = _font(46)
    lines = _wrap(draw, text, font, W - 280)[:4]
    lh = 68
    block_h = len(lines) * lh
    y0 = (H - block_h) // 2
    draw.rectangle([100, y0 - 14, 107, y0 + block_h + 4], fill=tc)  # 왼쪽 세로 포인트 바
    for i, l in enumerate(lines):
        draw.text((136, y0 + i * lh), l, font=font, fill=tc)
    if footer_text:
        small = _font(22)
        draw.text((100, H - 72), footer_text, font=small, fill=tc)
    img.save(out_path, "PNG")
    return out_path


def make_card_images(body, title, out_dir, footer_text=""):
    """사진이 없을 때: 본문의 [이미지N] 자리마다 바로 위 [인용] 문장으로 카드 생성.
    돌려주는 값: 이미지 번호 순서의 파일 경로 목록 (0번 = [이미지1])."""
    img_re = re.compile(r"^\[이미지\s*(\d+)\]\s*$")
    quote_re = re.compile(r"^\[인용\]\s*(.*)$")
    texts = {}
    last_quote = ""
    for raw in (body or "").split("\n"):
        line = raw.strip()
        m_q, m_i = quote_re.match(line), img_re.match(line)
        if m_q:
            last_quote = m_q.group(1)
        elif m_i:
            texts[int(m_i.group(1)) - 1] = last_quote or title
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i in range(max(texts.keys()) + 1 if texts else 0):
        if i not in texts:
            paths.append(None)
            continue
        p = out_dir / f"card{i + 1}.png"
        draw_card(texts[i], str(p), palette_idx=i, footer_text=footer_text)
        paths.append(str(p))
    return paths


def draw_footer_banner(profile, out_path):
    """학원 정보로 하단 연락처 배너 — 값이 있는 항목만 깔끔하게 배치 (브랜드 그린)."""
    p = profile
    rows = []
    if p.get("hours"):
        rows.append(("운영시간", p["hours"]))
    if p.get("phone"):
        rows.append(("전화", p["phone"]))
    if p.get("sms"):
        rows.append(("문자", p["sms"]))
    if p.get("kakao"):
        rows.append(("카카오톡", "채널: " + p.get("name", "") + " 검색"))
    if p.get("talktalk"):
        rows.append(("네이버 톡톡", "블로그에서 톡톡 버튼으로 연결"))
    if p.get("address"):
        rows.append(("주소", p["address"]))

    top, row_h, W = 210, 58, 1000
    H = top + len(rows) * row_h + 60
    img = _gradient(W, H, (0x0F, 0x3D, 0x24), (0x1C, 0x6B, 0x3F))
    draw = ImageDraw.Draw(img)
    draw.rectangle([66, 56, 74, H - 56], fill=(0x8F, 0xE0, 0xB0))  # 왼쪽 포인트 바
    draw.text((104, 60), p.get("name", ""), font=_font(56), fill=(255, 255, 255))
    if p.get("tagline"):
        draw.text((106, 138), p["tagline"], font=_font(25), fill=(0xD9, 0xF2, 0xE3))
    draw.line([106, 190, W - 70, 190], fill=(255, 255, 255, 64), width=2)
    label_font, val_font = _font(24), _font(26)
    y = top
    for k, v in rows:
        draw.text((106, y + 12), k, font=label_font, fill=(0x8F, 0xE0, 0xB0))
        draw.text((280, y + 10), v, font=val_font, fill=(255, 255, 255))
        y += row_h
    img.save(out_path, "PNG")
    return out_path
