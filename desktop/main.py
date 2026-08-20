# desktop/main.py — 더몬스터학원 블로그 자동화 (설치형 데스크톱 프로그램)
#
# 확장프로그램 없이 쓰는 버전: 카톡처럼 프로그램을 켜서 네이버 아이디로 로그인하고,
# 주제를 넣으면 글을 만들어 네이버에 자동 입력 → 임시저장/바로발행/예약발행까지 한다.
# 화면은 customtkinter(모던 UI) — 전체가 스크롤되므로 작은 화면에서도 잘리지 않는다.
#
# 실행(개발): pip install customtkinter selenium anthropic pillow → python desktop/main.py
# 배포: build_exe.bat 로 .exe 를 만들고, installer.iss(Inno Setup)로 설치파일을 만든다.

import json
import queue
import threading
import traceback
from datetime import datetime, timedelta
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox

import customtkinter as ctk

import banner
import generate
import robot

APP_NAME = "몬스터 블로그"
VERSION = "2.4.0"

APP_DIR = Path.home() / ".monster_blog"
SETTINGS_FILE = APP_DIR / "settings.json"
OUT_DIR = APP_DIR / "output"

# 브랜드 색 (네이버 그린 계열)
GREEN = "#03c75a"
GREEN_DARK = "#02a94d"
INK = "#1a1a1a"
SUB = "#6b7280"

DEFAULT_SETTINGS = {
    "anthropic_api_key": "",
    "naver_id": "",
    "naver_pw": "",
    "profile": {},        # 학원 정보 (비우면 더몬스터학원 기본값)
    "template": "",       # 전용 틀 직접 수정용 (비우면 자동 생성)
    "try_map": False,     # 지도 자동 첨부 (실험 기능)
    "make_cards": False,  # 사진이 없을 때 인용구 카드 이미지 생성 (기본 끔)
}


def load_settings():
    if SETTINGS_FILE.exists():
        try:
            s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            return {**DEFAULT_SETTINGS, **s}
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)


def save_settings(s):
    APP_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        ctk.set_appearance_mode("light")
        self.title(f"{APP_NAME}  v{VERSION}")
        self.geometry("820x860")
        self.minsize(700, 600)
        self.configure(fg_color="#eef1f4")
        self.settings = load_settings()
        self.photo_paths = []
        self.logq = queue.Queue()
        self.busy = False

        # 폰트 (윈도우 한글은 맑은 고딕이 제일 깔끔)
        self.f_title = ctk.CTkFont(family="Malgun Gothic", size=21, weight="bold")
        self.f_section = ctk.CTkFont(family="Malgun Gothic", size=14, weight="bold")
        self.f_body = ctk.CTkFont(family="Malgun Gothic", size=13)
        self.f_small = ctk.CTkFont(family="Malgun Gothic", size=11)
        self.f_btn = ctk.CTkFont(family="Malgun Gothic", size=13, weight="bold")

        self._build_ui()
        self.after(150, self._drain_log)
        if not self.settings["anthropic_api_key"]:
            self.log("⚙️ 먼저 오른쪽 위 [설정]에서 Claude API 키를 저장하세요.")

    # ---------- 공통 위젯 ----------

    def _card(self, parent, title, subtitle=""):
        f = ctk.CTkFrame(parent, corner_radius=14, fg_color="#ffffff")
        f.pack(fill="x", padx=4, pady=6)
        head = ctk.CTkFrame(f, fg_color="transparent")
        head.pack(fill="x", padx=16, pady=(12, 0))
        ctk.CTkLabel(head, text=title, font=self.f_section, text_color=INK).pack(side="left")
        if subtitle:
            ctk.CTkLabel(head, text=subtitle, font=self.f_small, text_color=SUB).pack(side="left", padx=10)
        return f

    def _entry(self, parent, placeholder="", width=None, show=None):
        kw = dict(font=self.f_body, height=34, corner_radius=8,
                  border_color="#d7dce3", placeholder_text=placeholder)
        if width:
            kw["width"] = width
        if show:
            kw["show"] = show
        return ctk.CTkEntry(parent, **kw)

    # ---------- 화면 구성 ----------

    def _build_ui(self):
        # 상단 헤더 (고정)
        header = ctk.CTkFrame(self, corner_radius=0, fg_color="#ffffff", height=64)
        header.pack(fill="x")
        ctk.CTkLabel(header, text="📝", font=ctk.CTkFont(size=24)).pack(side="left", padx=(18, 6), pady=14)
        ctk.CTkLabel(header, text=APP_NAME, font=self.f_title, text_color=INK).pack(side="left")
        ctk.CTkLabel(header, text=f"v{VERSION}", font=self.f_small, text_color=SUB).pack(side="left", padx=8)
        ctk.CTkButton(header, text="⚙️ 설정", width=90, height=34, corner_radius=8,
                      font=self.f_btn, fg_color="#f0f2f5", hover_color="#e3e6ea",
                      text_color=INK, command=self.on_settings).pack(side="right", padx=16)

        # 본문 전체 스크롤 (작은 화면에서도 안 잘림)
        body = ctk.CTkScrollableFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=12, pady=8)

        # ── 1. 네이버 로그인 ──
        lf = self._card(body, "🔑 네이버 로그인",
                        "처음 한 번만 캡차가 뜰 수 있어요 — 크롬 창에서 풀면 다음부터는 자동")
        row = ctk.CTkFrame(lf, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=(8, 14))
        self.e_id = self._entry(row, "네이버 아이디", width=180)
        self.e_id.pack(side="left")
        if self.settings["naver_id"]:
            self.e_id.insert(0, self.settings["naver_id"])
        self.e_pw = self._entry(row, "비밀번호", width=180, show="•")
        self.e_pw.pack(side="left", padx=8)
        if self.settings["naver_pw"]:
            self.e_pw.insert(0, self.settings["naver_pw"])
        self.btn_login = ctk.CTkButton(row, text="로그인", width=100, height=34, corner_radius=8,
                                       font=self.f_btn, fg_color=GREEN, hover_color=GREEN_DARK,
                                       command=self.on_login)
        self.btn_login.pack(side="left", padx=4)
        self.lbl_login = ctk.CTkLabel(row, text="", font=self.f_body, text_color=GREEN_DARK)
        self.lbl_login.pack(side="left", padx=10)

        # ── 2. 글 만들기 ──
        gf = self._card(body, "✍️ 글 만들기")
        r1 = ctk.CTkFrame(gf, fg_color="transparent")
        r1.pack(fill="x", padx=16, pady=(8, 4))
        self.cb_type = ctk.CTkComboBox(r1, values=["교육정보", "학원·과목 특징", "특강 안내"],
                                       state="readonly", width=150, height=34, corner_radius=8,
                                       font=self.f_body, dropdown_font=self.f_body,
                                       button_color=GREEN, button_hover_color=GREEN_DARK)
        self.cb_type.set("교육정보")
        self.cb_type.pack(side="left")
        ctk.CTkButton(r1, text="📷 사진 선택", width=110, height=34, corner_radius=8,
                      font=self.f_body, fg_color="#f0f2f5", hover_color="#e3e6ea",
                      text_color=INK, command=self.on_pick_photos).pack(side="left", padx=8)
        self.lbl_photos = ctk.CTkLabel(r1, text="사진 없음", font=self.f_small, text_color=SUB)
        self.lbl_photos.pack(side="left", padx=4)

        self.e_topic = self._entry(gf, "주제  (예: 예비 고1 지금 해야 할 일)")
        self.e_topic.pack(fill="x", padx=16, pady=4)
        self.e_keyword = self._entry(gf, "핵심 검색 키워드  (예: 광주 동구 수학학원)")
        self.e_keyword.pack(fill="x", padx=16, pady=4)
        self.t_core = ctk.CTkTextbox(gf, height=64, corner_radius=8, font=self.f_body,
                                     border_width=1, border_color="#d7dce3")
        self.t_core.pack(fill="x", padx=16, pady=4)
        ctk.CTkLabel(gf, text="↑ 핵심 내용 (강조하고 싶은 것들을 자유롭게)",
                     font=self.f_small, text_color=SUB).pack(anchor="w", padx=18)
        self.btn_gen = ctk.CTkButton(gf, text="✨ 글 생성", width=140, height=38, corner_radius=8,
                                     font=self.f_btn, fg_color=GREEN, hover_color=GREEN_DARK,
                                     command=self.on_generate)
        self.btn_gen.pack(anchor="w", padx=16, pady=(6, 14))

        # ── 3. 결과 ──
        rf = self._card(body, "📄 결과", "제목·본문은 직접 고칠 수 있어요")
        self.e_title = self._entry(rf, "제목 (글을 생성하면 여기 채워집니다)")
        self.e_title.pack(fill="x", padx=16, pady=(8, 4))
        self.t_body = ctk.CTkTextbox(rf, height=240, corner_radius=8, font=self.f_body,
                                     border_width=1, border_color="#d7dce3", wrap="word")
        self.t_body.pack(fill="x", padx=16, pady=(0, 14))

        # ── 4. 네이버에 올리기 ──
        pf = self._card(body, "🚀 네이버에 올리기",
                        "예약 발행은 네이버 서버가 처리 — 그 시간에 컴퓨터를 꺼도 됩니다")
        pr = ctk.CTkFrame(pf, fg_color="transparent")
        pr.pack(fill="x", padx=16, pady=(8, 4))
        self.pub_mode = tk.StringVar(value="draft")
        for val, txt in (("draft", "임시저장 (안전)"), ("now", "바로 발행"), ("reserve", "예약 발행")):
            ctk.CTkRadioButton(pr, text=txt, variable=self.pub_mode, value=val,
                               font=self.f_body, fg_color=GREEN, hover_color=GREEN_DARK,
                               command=self._toggle_when).pack(side="left", padx=(0, 14))
        self.when_frame = ctk.CTkFrame(pf, fg_color="transparent")
        tomorrow = datetime.now() + timedelta(days=1)
        ctk.CTkLabel(self.when_frame, text="날짜", font=self.f_body, text_color=SUB).pack(side="left")
        self.e_date = self._entry(self.when_frame, "", width=110)
        self.e_date.insert(0, tomorrow.strftime("%Y-%m-%d"))
        self.e_date.pack(side="left", padx=(4, 10))
        ctk.CTkLabel(self.when_frame, text="시", font=self.f_body, text_color=SUB).pack(side="left")
        self.cb_hour = ctk.CTkComboBox(self.when_frame, values=[f"{h:02d}" for h in range(24)],
                                       state="readonly", width=70, height=34, font=self.f_body,
                                       button_color=GREEN, button_hover_color=GREEN_DARK)
        self.cb_hour.set("10")
        self.cb_hour.pack(side="left", padx=(4, 10))
        ctk.CTkLabel(self.when_frame, text="분", font=self.f_body, text_color=SUB).pack(side="left")
        self.cb_min = ctk.CTkComboBox(self.when_frame, values=[f"{m:02d}" for m in range(0, 60, 10)],
                                      state="readonly", width=70, height=34, font=self.f_body,
                                      button_color=GREEN, button_hover_color=GREEN_DARK)
        self.cb_min.set("00")
        self.cb_min.pack(side="left", padx=4)
        self.btn_post = ctk.CTkButton(pf, text="🚀 네이버에 올리기", height=44, corner_radius=10,
                                      font=ctk.CTkFont(family="Malgun Gothic", size=15, weight="bold"),
                                      fg_color=GREEN, hover_color=GREEN_DARK, command=self.on_post)
        self.btn_post.pack(fill="x", padx=16, pady=(8, 14))

        # ── 5. 진행 상황 ──
        logf = self._card(body, "📡 진행 상황")
        self.t_log = ctk.CTkTextbox(logf, height=120, corner_radius=8,
                                    font=ctk.CTkFont(family="Malgun Gothic", size=12),
                                    fg_color="#f6f8fa", text_color="#374151", wrap="word")
        self.t_log.pack(fill="x", padx=16, pady=(6, 14))
        self.t_log.configure(state="disabled")
        self._toggle_when()

    def _toggle_when(self):
        if self.pub_mode.get() == "reserve":
            self.when_frame.pack(fill="x", padx=16, pady=4, before=self.btn_post)
        else:
            self.when_frame.pack_forget()

    # ---------- 로그 ----------

    def log(self, msg):
        self.logq.put(str(msg))

    def _drain_log(self):
        try:
            while True:
                msg = self.logq.get_nowait()
                self.t_log.configure(state="normal")
                self.t_log.insert("end", msg + "\n")
                self.t_log.see("end")
                self.t_log.configure(state="disabled")
        except queue.Empty:
            pass
        self.after(150, self._drain_log)

    def _run_bg(self, fn):
        """버튼 작업을 백그라운드 스레드로 (화면 멈춤 방지). 동시에 하나만."""
        if self.busy:
            self.log("이미 작업이 진행 중입니다. 끝날 때까지 기다려 주세요.")
            return

        def wrap():
            self.busy = True
            try:
                fn()
            except Exception as e:
                self.log("❌ 오류: " + str(e))
                self.log(traceback.format_exc(limit=3))
            finally:
                self.busy = False

        threading.Thread(target=wrap, daemon=True).start()

    # ---------- 동작 ----------

    def on_login(self):
        nid, npw = self.e_id.get().strip(), self.e_pw.get()
        if not nid or not npw:
            messagebox.showwarning(APP_NAME, "네이버 아이디와 비밀번호를 입력하세요.")
            return
        self.settings["naver_id"], self.settings["naver_pw"] = nid, npw
        save_settings(self.settings)

        def work():
            self.log("크롬을 열어 로그인합니다…")
            ok = robot.ensure_login(nid, npw, log=self.log)
            # Tk 위젯은 메인 스레드에서만 만져야 안전하다
            self.after(0, lambda: self.lbl_login.configure(
                text="✓ 로그인됨" if ok else "로그인 실패",
                text_color=GREEN_DARK if ok else "#dc2626"))
        self._run_bg(work)

    def on_pick_photos(self):
        paths = filedialog.askopenfilenames(
            title="사진 선택 (여러 장 가능)",
            filetypes=[("사진", "*.png *.jpg *.jpeg"), ("모든 파일", "*.*")])
        self.photo_paths = list(paths)
        n = len(self.photo_paths)
        self.lbl_photos.configure(
            text=f"사진 {n}장 선택됨 ✓" if n else "사진 없음",
            text_color=GREEN_DARK if n else SUB)

    def on_generate(self):
        api_key = self.settings["anthropic_api_key"]
        if not api_key:
            messagebox.showwarning(APP_NAME, "[설정]에서 Claude API 키를 먼저 저장하세요.")
            return
        topic = self.e_topic.get().strip()
        if not topic:
            messagebox.showwarning(APP_NAME, "주제를 입력하세요.")
            return
        gltype = self.cb_type.get()
        keyword = self.e_keyword.get().strip()
        core = self.t_core.get("1.0", "end").strip()
        profile = generate.full_profile(self.settings.get("profile"))
        template = self.settings.get("template", "").strip() or generate.build_template(profile)
        photos = list(self.photo_paths)

        def work():
            self.log("✨ 글을 작성하는 중… (30초 정도 걸립니다)")
            title, body = generate.generate_post(api_key, template, gltype, topic, keyword, core, photos)

            def show():  # Tk 위젯은 메인 스레드에서만
                self.e_title.delete(0, "end")
                self.e_title.insert(0, title)
                self.t_body.delete("1.0", "end")
                self.t_body.insert("1.0", body)
            self.after(0, show)
            self.log("완성! 내용을 확인·수정하고 '네이버에 올리기'를 누르세요.")
        self._run_bg(work)

    def on_post(self):
        title = self.e_title.get().strip()
        body = self.t_body.get("1.0", "end").strip()
        if not body:
            messagebox.showwarning(APP_NAME, "먼저 글을 생성하세요.")
            return
        mode = self.pub_mode.get()
        when = ""
        if mode == "reserve":
            when = f"{self.e_date.get().strip()}T{self.cb_hour.get()}:{self.cb_min.get()}"
            try:
                dt = datetime.strptime(when, "%Y-%m-%dT%H:%M")
                if dt <= datetime.now():
                    messagebox.showwarning(APP_NAME, "예약 시간이 이미 지났습니다. 미래 시간으로 고쳐주세요.")
                    return
            except ValueError:
                messagebox.showwarning(APP_NAME, "날짜는 2026-08-20 형식으로 입력하세요.")
                return
        if mode == "now" and not messagebox.askyesno(
                APP_NAME, "정말 바로 발행할까요?\n(임시저장으로 먼저 확인하는 걸 추천합니다)"):
            return

        profile = generate.full_profile(self.settings.get("profile"))
        photos = list(self.photo_paths)
        try_map = bool(self.settings.get("try_map"))

        def work():
            OUT_DIR.mkdir(parents=True, exist_ok=True)
            # 사진이 없을 때: 설정에서 켠 경우에만 [이미지N] 자리에 인용구 카드 이미지 생성
            # (끄면 [이미지N] 자리는 그냥 건너뛴다)
            images = photos
            if not images and self.settings.get("make_cards"):
                try:
                    region = (profile.get("region") or "").split(",")[0].strip()
                    footer_text = profile.get("name", "") + (" · " + region if region else "")
                    cards = banner.make_card_images(body, title, OUT_DIR, footer_text)
                    images = [p for p in cards if p]
                    if images:
                        self.log(f"인용구 카드 이미지 {len(images)}장 생성")
                except Exception as e:
                    self.log(f"카드 이미지 생략: {e}")
            # 하단 연락처 배너
            footer = None
            try:
                footer = banner.draw_footer_banner(profile, str(OUT_DIR / "footer.png"))
            except Exception as e:
                self.log(f"배너 생략: {e}")

            # 로그인 확인 후 입력
            if not robot.ensure_login(self.settings["naver_id"], self.settings["naver_pw"], log=self.log):
                self.log("❌ 로그인이 안 됐습니다. 위의 [로그인]을 먼저 눌러주세요.")
                return
            result = robot.post(
                title, body,
                image_paths=images, footer_path=footer,
                publish_mode=mode, publish_when=when,
                academy_name=profile.get("name", ""), try_map=try_map,
                log=self.log,
            )
            self.log("✅ " + result)
        self._run_bg(work)

    # ---------- 설정 창 ----------

    def on_settings(self):
        win = ctk.CTkToplevel(self)
        win.title("설정")
        win.geometry("600x720")
        win.transient(self)
        win.configure(fg_color="#eef1f4")
        win.after(200, win.lift)  # 창이 뒤로 숨는 것 방지

        scroll = ctk.CTkScrollableFrame(win, fg_color="transparent")
        scroll.pack(fill="both", expand=True, padx=10, pady=10)

        c1 = ctk.CTkFrame(scroll, corner_radius=14, fg_color="#ffffff")
        c1.pack(fill="x", pady=6)
        ctk.CTkLabel(c1, text="🔑 Claude(앤트로픽) API 키 — 글 생성",
                     font=self.f_section, text_color=INK).pack(anchor="w", padx=16, pady=(12, 4))
        e_key = self._entry(c1, "sk-ant-…", show="•")
        e_key.pack(fill="x", padx=16, pady=(0, 14))
        if self.settings["anthropic_api_key"]:
            e_key.insert(0, self.settings["anthropic_api_key"])

        c2 = ctk.CTkFrame(scroll, corner_radius=14, fg_color="#ffffff")
        c2.pack(fill="x", pady=6)
        ctk.CTkLabel(c2, text="🏫 우리 학원 정보", font=self.f_section, text_color=INK).pack(anchor="w", padx=16, pady=(12, 0))
        ctk.CTkLabel(c2, text="비워두면 더몬스터학원 기본값이 사용됩니다. 글·배너·지도에 반영돼요.",
                     font=self.f_small, text_color=SUB).pack(anchor="w", padx=16, pady=(0, 6))
        labels = [("name", "학원명"), ("tagline", "한 줄 소개"), ("phone", "전화"),
                  ("sms", "문자"), ("kakao", "카카오톡 채널 주소"), ("talktalk", "네이버 톡톡 주소"),
                  ("address", "주소"), ("hours", "운영시간"), ("region", "지역 키워드(쉼표)"),
                  ("hashtags", "해시태그(쉼표)")]
        entries = {}
        grid = ctk.CTkFrame(c2, fg_color="transparent")
        grid.pack(fill="x", padx=16, pady=(0, 14))
        prof = self.settings.get("profile") or {}
        for i, (k, lab) in enumerate(labels):
            ctk.CTkLabel(grid, text=lab, width=140, anchor="w", font=self.f_body,
                         text_color=INK).grid(row=i, column=0, sticky="w", pady=3)
            e = self._entry(grid)
            e.grid(row=i, column=1, sticky="ew", pady=3)
            if prof.get(k, ""):
                e.insert(0, prof.get(k, ""))
            entries[k] = e
        grid.columnconfigure(1, weight=1)

        c3 = ctk.CTkFrame(scroll, corner_radius=14, fg_color="#ffffff")
        c3.pack(fill="x", pady=6)
        v_map = tk.BooleanVar(value=bool(self.settings.get("try_map")))
        ctk.CTkCheckBox(c3, text="글 끝에 지도(장소) 자동 첨부 — 실험 기능", variable=v_map,
                        font=self.f_body, fg_color=GREEN, hover_color=GREEN_DARK).pack(anchor="w", padx=16, pady=(12, 4))
        v_cards = tk.BooleanVar(value=bool(self.settings.get("make_cards")))
        ctk.CTkCheckBox(c3, text="사진이 없을 때 [이미지N] 자리에 인용구 카드 이미지 넣기", variable=v_cards,
                        font=self.f_body, fg_color=GREEN, hover_color=GREEN_DARK).pack(anchor="w", padx=16, pady=(0, 12))

        c4 = ctk.CTkFrame(scroll, corner_radius=14, fg_color="#ffffff")
        c4.pack(fill="x", pady=6)
        ctk.CTkLabel(c4, text="📐 전용 틀 직접 수정 (웬만하면 비워두세요 — 비우면 학원 정보로 자동 생성)",
                     font=self.f_small, text_color=SUB).pack(anchor="w", padx=16, pady=(12, 4))
        t_tpl = ctk.CTkTextbox(c4, height=140, corner_radius=8, font=self.f_body,
                               border_width=1, border_color="#d7dce3", wrap="word")
        t_tpl.pack(fill="x", padx=16, pady=(0, 14))
        t_tpl.insert("1.0", self.settings.get("template", ""))

        def do_save():
            self.settings["anthropic_api_key"] = e_key.get().strip()
            self.settings["profile"] = {k: e.get().strip() for k, e in entries.items()}
            self.settings["try_map"] = bool(v_map.get())
            self.settings["make_cards"] = bool(v_cards.get())
            self.settings["template"] = t_tpl.get("1.0", "end").strip()
            save_settings(self.settings)
            self.log("설정을 저장했습니다. (이 컴퓨터에만 저장 — 외부 전송 없음)")
            win.destroy()

        ctk.CTkButton(scroll, text="💾 저장", height=40, corner_radius=10, font=self.f_btn,
                      fg_color=GREEN, hover_color=GREEN_DARK, command=do_save).pack(fill="x", pady=8)


if __name__ == "__main__":
    App().mainloop()
