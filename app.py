# app.py — 더몬스터학원 블로그 자동화 (통합 화면)
# 실행: 터미널에서  streamlit run app.py
#
# 흐름: (사진 올리기) → 글 만들기 → 이미지·썸네일 → 네이버 올리기(임시저장) → 사람이 발행
# 각 부분은 generator.py / images.py / thumbnail.py / naver_robot.py 에 들어있습니다.

import json
from pathlib import Path

import streamlit as st

import generator
import images as imagegen
import thumbnail as thumb

HERE = Path(__file__).parent
SETTINGS_FILE = HERE / "settings.json"
TEMPLATE_FILE = HERE / "전용틀.md"
OUT_DIR = HERE / "output"
OUT_DIR.mkdir(exist_ok=True)

DEFAULT_SETTINGS = {
    "anthropic_api_key": "",   # 글 (Claude)
    "openai_api_key": "",      # 그림 (ChatGPT) — 사진을 안 올릴 때만 사용
    "naver_id": "",            # 네이버 아이디 (올리기)
    "naver_pw": "",            # 네이버 비밀번호 (올리기)
    "thumbnail_bg": "",        # 썸네일 배경 이미지 경로 (.png/.jpg)
    "thumbnail_font": "",      # 한글 폰트 경로 (.ttf)
}


def load_settings():
    if SETTINGS_FILE.exists():
        try:
            return {**DEFAULT_SETTINGS, **json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))}
        except Exception:
            return dict(DEFAULT_SETTINGS)
    return dict(DEFAULT_SETTINGS)


def save_settings(s):
    SETTINGS_FILE.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")


def load_template():
    return TEMPLATE_FILE.read_text(encoding="utf-8") if TEMPLATE_FILE.exists() else ""


st.set_page_config(page_title="더몬스터학원 블로그 자동화", page_icon="📝")
st.title("📝 더몬스터학원 블로그 자동화")

settings = load_settings()
tab_write, tab_image, tab_naver, tab_set = st.tabs(
    ["✍️ 글 만들기", "🖼️ 이미지·썸네일", "🚀 네이버 올리기", "⚙️ 설정"]
)

# ===== 설정 =====
with tab_set:
    st.caption("입력 내용은 이 컴퓨터의 settings.json 에만 저장됩니다. 외부 전송 없음.")
    a_key = st.text_input("앤트로픽(Claude) API 키 — 글", value=settings["anthropic_api_key"], type="password")
    o_key = st.text_input("OpenAI(ChatGPT) API 키 — 그림 (사진을 안 올릴 때만 필요)", value=settings["openai_api_key"], type="password")
    st.divider()
    n_id = st.text_input("네이버 아이디", value=settings["naver_id"])
    n_pw = st.text_input("네이버 비밀번호", value=settings["naver_pw"], type="password")
    st.divider()
    bg = st.text_input("썸네일 배경 이미지 경로 (.png/.jpg)", value=settings["thumbnail_bg"])
    font = st.text_input("썸네일 한글 폰트 경로 (.ttf)", value=settings["thumbnail_font"])
    if st.button("💾 저장"):
        save_settings({
            "anthropic_api_key": a_key.strip(), "openai_api_key": o_key.strip(),
            "naver_id": n_id.strip(), "naver_pw": n_pw,
            "thumbnail_bg": bg.strip(), "thumbnail_font": font.strip(),
        })
        st.success("저장했습니다. (화면을 새로고침하면 반영됩니다)")

# ===== 글 만들기 =====
with tab_write:
    template = load_template()
    if not template:
        st.warning("같은 폴더에 '전용틀.md' 파일이 있어야 합니다.")
    gltype = st.selectbox("글 종류", ["교육정보", "학원·과목 특징", "특강 안내"])
    topic = st.text_input("주제 (예: 학원 다녀도 성적이 안 오르는 이유)")
    keyword = st.text_input("핵심(타겟) 검색 키워드 (예: 광주 동구 중등 수학학원)")
    core = st.text_area("핵심 내용", height=120)

    st.markdown("**📷 사진 올리기 (직접 찍은 사진 — 여러 장 가능)**")
    st.caption("사진을 올리면 Claude가 사진을 보고 글을 쓰고, 그 사진을 본문에 자동 배치합니다. "
               "(사진을 올리면 AI 이미지 생성은 필요 없어요. 네이버 검색에도 직접 찍은 사진이 더 유리합니다.)")
    uploaded_photos = st.file_uploader(
        "사진 선택", type=["png", "jpg", "jpeg"], accept_multiple_files=True, label_visibility="collapsed"
    )

    style = st.radio("이미지 스타일 (사진 없이 AI 그림으로 만들 때만)", ["일러스트", "실사"], horizontal=True)
    st.session_state["style"] = style

    if st.button("✨ 글 생성", type="primary"):
        if not settings["anthropic_api_key"]:
            st.error("설정 탭에서 앤트로픽 키를 먼저 저장하세요.")
        elif not topic.strip():
            st.error("주제를 입력하세요.")
        else:
            # 올린 사진 읽어서 (media_type, bytes) 목록 만들고, output 폴더에 저장
            photo_list = []
            saved_paths = {}
            for i, f in enumerate(uploaded_photos or [], 1):
                data = f.getvalue()
                media_type = f.type or "image/jpeg"
                photo_list.append((media_type, data))
                ext = ".png" if "png" in media_type else ".jpg"
                p = OUT_DIR / f"이미지{i}{ext}"
                p.write_bytes(data)
                saved_paths[f"이미지{i}"] = str(p)

            with st.spinner("글을 작성하는 중..."):
                try:
                    text = generator.generate_post(
                        settings["anthropic_api_key"], template, gltype, topic, keyword, core, style,
                        photos=photo_list or None,
                    )
                    st.session_state["post_text"] = text
                    st.session_state["title"] = generator.extract_title(text)
                    st.session_state["image_prompts"] = generator.extract_image_prompts(text)
                    # 사진을 올렸으면 그 사진을 본문 이미지로 사용, 아니면 비워둠(나중에 AI 생성)
                    st.session_state["image_paths"] = saved_paths
                    st.session_state["photo_mode"] = bool(photo_list)
                    st.session_state["thumb_path"] = ""
                except Exception as e:
                    st.error(f"오류: {e}")

    if st.session_state.get("post_text"):
        st.divider()
        st.subheader("완성된 글")
        st.text_area("결과 (복사해서 네이버에 붙여넣기)", st.session_state["post_text"], height=450)

# ===== 이미지·썸네일 =====
with tab_image:
    if not st.session_state.get("post_text"):
        st.info("먼저 '글 만들기'에서 글을 생성하세요.")
    else:
        st.subheader("본문 이미지")
        if st.session_state.get("photo_mode"):
            # 사진 업로드 모드 — 올린 사진을 그대로 사용 (AI 이미지 생성 불필요)
            st.success("올려주신 사진을 본문 이미지로 사용합니다. (AI 이미지 생성 안 함)")
            for label, path in st.session_state.get("image_paths", {}).items():
                st.image(path, caption=label, width=320)
        else:
            # 사진을 안 올렸을 때만 AI 이미지 생성
            prompts = st.session_state.get("image_prompts", [])
            if not prompts:
                st.write("글에서 이미지 설명을 찾지 못했어요. (전용틀의 '이미지 설명' 형식을 확인하거나, 글 만들기에서 사진을 올리세요.)")
            if st.button("🖼️ 이미지 생성 (AI 그림)", type="primary"):
                if not settings["openai_api_key"]:
                    st.error("설정 탭에서 OpenAI 키를 먼저 저장하세요. (또는 글 만들기에서 사진을 올리면 이 단계가 필요 없습니다.)")
                else:
                    paths = {}
                    with st.spinner("이미지를 만드는 중... (장당 시간이 좀 걸립니다)"):
                        for label, desc in prompts:
                            out = OUT_DIR / f"{label}.png"
                            try:
                                imagegen.generate_image(
                                    settings["openai_api_key"], desc,
                                    st.session_state.get("style", "일러스트"), str(out)
                                )
                                paths[label] = str(out)
                            except Exception as e:
                                st.error(f"{label} 생성 오류: {e}")
                    st.session_state["image_paths"] = paths
            for label, path in st.session_state.get("image_paths", {}).items():
                st.image(path, caption=label, width=320)

        st.divider()
        st.subheader("썸네일")
        if st.button("🎨 썸네일 생성"):
            if not settings["thumbnail_bg"]:
                st.error("설정 탭에서 '썸네일 배경 이미지 경로'를 먼저 넣어주세요.")
            else:
                try:
                    out = OUT_DIR / "thumbnail.png"
                    thumb.make_thumbnail(
                        settings["thumbnail_bg"], st.session_state.get("title", ""),
                        str(out), font_path=settings["thumbnail_font"] or None
                    )
                    st.session_state["thumb_path"] = str(out)
                except Exception as e:
                    st.error(f"썸네일 오류: {e}")
        if st.session_state.get("thumb_path"):
            st.image(st.session_state["thumb_path"], caption="썸네일", width=320)

# ===== 네이버 올리기 =====
with tab_naver:
    if not st.session_state.get("post_text"):
        st.info("먼저 글을 생성하세요.")
    else:
        st.warning(
            "이 단계는 크롬 창을 자동으로 띄워 네이버에 '임시저장'까지만 합니다. "
            "발행은 사장님이 직접 확인 후 누르세요. 캡차가 뜨면 직접 풀어야 할 수 있어요."
        )
        if st.button("🚀 네이버에 임시저장", type="primary"):
            if not (settings["naver_id"] and settings["naver_pw"]):
                st.error("설정 탭에서 네이버 아이디/비밀번호를 먼저 저장하세요.")
            else:
                try:
                    import naver_robot  # selenium 등은 이 단계에서만 필요
                    title = st.session_state.get("title", "")
                    body = st.session_state.get("post_text", "")
                    image_paths = list(st.session_state.get("image_paths", {}).values())
                    st.info("크롬 창이 곧 열립니다. 창을 건드리지 말고 지켜봐 주세요.")
                    naver_robot.publish_draft(
                        settings["naver_id"], settings["naver_pw"], title, body, image_paths
                    )
                    st.success("임시저장 시도 완료. 네이버 블로그 '임시저장 글'을 확인하세요.")
                except Exception as e:
                    st.error(f"오류: {e}")
