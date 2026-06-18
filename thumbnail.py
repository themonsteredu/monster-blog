# thumbnail.py — 고정 패턴 썸네일 만들기 (배경 이미지 + 제목 글자)
from PIL import Image, ImageDraw, ImageFont


def make_thumbnail(
    bg_path,
    title,
    out_path,
    font_path=None,
    font_size=72,
    text_color=(255, 255, 255),
    box=(80, 250, 880, 620),  # 글자가 들어갈 영역 (left, top, right, bottom)
):
    """배경 이미지(bg_path) 위에 제목(title)을 얹어 썸네일을 만든다.
    배경과 글자 위치가 고정이라 매번 같은 패턴이 나온다."""
    img = Image.open(bg_path).convert("RGB")
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    x0, y0, x1, y1 = box
    max_w = x1 - x0

    # 한글은 띄어쓰기가 적을 수 있어 글자 단위로 줄바꿈
    lines, cur = [], ""
    for ch in title:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        test = cur + ch
        if draw.textlength(test, font=font) <= max_w:
            cur = test
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)

    y = y0
    line_h = int(font_size * 1.3)
    for line in lines:
        draw.text((x0, y), line, font=font, fill=text_color)
        y += line_h

    img.save(out_path)
    return out_path
