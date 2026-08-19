# desktop/main.py — 더몬스터학원 블로그 자동화 (설치형 데스크톱 프로그램)
#
# 확장프로그램 없이 쓰는 버전: 카톡처럼 프로그램을 켜서 네이버 아이디로 로그인하고,
# 주제를 넣으면 글을 만들어 네이버에 자동 입력 → 임시저장/바로발행/예약발행까지 한다.
#
# 실행(개발): python desktop/main.py
# 배포: build_exe.bat 로 .exe 를 만들고, installer.iss(Inno Setup)로 설치파일을 만든다.

import json
import queue
import threading
import traceback
from datetime import datetime, timedelta
from pathlib import Path

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

import banner
import generate
import robot

APP_NAME = "더몬스터학원 블로그 자동화"
VERSION = "2.0.0"

APP_DIR = Path.home() / ".monster_blog"
SETTINGS_FILE = APP_DIR / "settings.json"
OUT_DIR = APP_DIR / "output"

DEFAULT_SETTINGS = {
    "anthropic_api_key": "",
    "naver_id": "",
    "naver_pw": "",
    "profile": {},        # 학원 정보 (비우면 더몬스터학원 기본값)
    "template": "",       # 전용 틀 직접 수정용 (비우면 자동 생성)
    "try_map": False,     # 지도 자동 첨부 (실험 기능)
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


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"{APP_NAME} v{VERSION}")
        self.geometry("760x860")
        self.minsize(680, 700)
        self.settings = load_settings()
        self.photo_paths = []
        self.logq = queue.Queue()
        self.busy = False
        self._build_ui()
        self.after(150, self._drain_log)
        if not self.settings["anthropic_api_key"]:
            self.log("⚙️ 먼저 [설정]에서 Claude API 키를 저장하세요.")

    # ---------- 화면 구성 ----------

    def _build_ui(self):
        pad = {"padx": 10, "pady": 4}

        # 상단: 로그인 (카톡처럼 아이디/비번 → 로그인)
        lf = ttk.LabelFrame(self, text=" 🔑 네이버 로그인 ")
        lf.pack(fill="x", **pad)
        row = ttk.Frame(lf); row.pack(fill="x", padx=8, pady=6)
        ttk.Label(row, text="아이디").pack(side="left")
        self.e_id = ttk.Entry(row, width=18)
        self.e_id.pack(side="left", padx=(4, 10))
        self.e_id.insert(0, self.settings["naver_id"])
        ttk.Label(row, text="비밀번호").pack(side="left")
        self.e_pw = ttk.Entry(row, width=18, show="*")
        self.e_pw.pack(side="left", padx=(4, 10))
        self.e_pw.insert(0, self.settings["naver_pw"])
        self.btn_login = ttk.Button(row, text="로그인", command=self.on_login)
        self.btn_login.pack(side="left", padx=4)
        self.lbl_login = ttk.Label(row, text="", foreground="#03794a")
        self.lbl_login.pack(side="left", padx=8)
        ttk.Label(lf, text="※ 처음 한 번은 캡차가 뜰 수 있어요 — 그때만 열린 크롬 창에서 직접 로그인하면, 다음부터는 자동입니다.",
                  foreground="#777").pack(anchor="w", padx=8, pady=(0, 6))

        # 가운데: 글 만들기
        gf = ttk.LabelFrame(self, text=" ✍️ 글 만들기 ")
        gf.pack(fill="x", **pad)
        r1 = ttk.Frame(gf); r1.pack(fill="x", padx=8, pady=3)
        ttk.Label(r1, text="글 종류").pack(side="left")
        self.cb_type = ttk.Combobox(r1, values=["교육정보", "학원·과목 특징", "특강 안내"],
                                    state="readonly", width=14)
        self.cb_type.current(0)
        self.cb_type.pack(side="left", padx=(4, 14))
        self.btn_photos = ttk.Button(r1, text="📷 사진 선택…", command=self.on_pick_photos)
        self.btn_photos.pack(side="left")
        self.lbl_photos = ttk.Label(r1, text="사진 없음 (없으면 인용구 카드 이미지로 대체)")
        self.lbl_photos.pack(side="left", padx=6)

        r2 = ttk.Frame(gf); r2.pack(fill="x", padx=8, pady=3)
        ttk.Label(r2, text="주제").pack(side="left")
        self.e_topic = ttk.Entry(r2)
        self.e_topic.pack(side="left", fill="x", expand=True, padx=4)

        r3 = ttk.Frame(gf); r3.pack(fill="x", padx=8, pady=3)
        ttk.Label(r3, text="키워드").pack(side="left")
        self.e_keyword = ttk.Entry(r3)
        self.e_keyword.pack(side="left", fill="x", expand=True, padx=4)

        ttk.Label(gf, text="핵심 내용").pack(anchor="w", padx=8)
        self.t_core = tk.Text(gf, height=3)
        self.t_core.pack(fill="x", padx=8, pady=(0, 4))

        r4 = ttk.Frame(gf); r4.pack(fill="x", padx=8, pady=4)
        self.btn_gen = ttk.Button(r4, text="✨ 글 생성", command=self.on_generate)
        self.btn_gen.pack(side="left")
        self.btn_settings = ttk.Button(r4, text="⚙️ 설정", command=self.on_settings)
        self.btn_settings.pack(side="right")

        # 결과 (수정 가능)
        rf = ttk.LabelFrame(self, text=" 📄 결과 (제목·본문은 직접 고칠 수 있어요) ")
        rf.pack(fill="both", expand=True, **pad)
        rr = ttk.Frame(rf); rr.pack(fill="x", padx=8, pady=3)
        ttk.Label(rr, text="제목").pack(side="left")
        self.e_title = ttk.Entry(rr)
        self.e_title.pack(side="left", fill="x", expand=True, padx=4)
        self.t_body = tk.Text(rf, height=12)
        self.t_body.pack(fill="both", expand=True, padx=8, pady=(0, 6))

        # 발행 방식 + 올리기
        pf = ttk.LabelFrame(self, text=" 🚀 네이버에 올리기 ")
        pf.pack(fill="x", **pad)
        pr = ttk.Frame(pf); pr.pack(fill="x", padx=8, pady=4)
        self.pub_mode = tk.StringVar(value="draft")
        ttk.Radiobutton(pr, text="임시저장 (안전)", variable=self.pub_mode,
                        value="draft", command=self._toggle_when).pack(side="left")
        ttk.Radiobutton(pr, text="바로 발행", variable=self.pub_mode,
                        value="now", command=self._toggle_when).pack(side="left", padx=8)
        ttk.Radiobutton(pr, text="예약 발행", variable=self.pub_mode,
                        value="reserve", command=self._toggle_when).pack(side="left")
        self.when_frame = ttk.Frame(pr)
        tomorrow = datetime.now() + timedelta(days=1)
        ttk.Label(self.when_frame, text="날짜").pack(side="left", padx=(12, 2))
        self.e_date = ttk.Entry(self.when_frame, width=11)
        self.e_date.insert(0, tomorrow.strftime("%Y-%m-%d"))
        self.e_date.pack(side="left")
        ttk.Label(self.when_frame, text="시").pack(side="left", padx=(8, 2))
        self.cb_hour = ttk.Combobox(self.when_frame, values=[f"{h:02d}" for h in range(24)],
                                    state="readonly", width=4)
        self.cb_hour.set("10")
        self.cb_hour.pack(side="left")
        ttk.Label(self.when_frame, text="분").pack(side="left", padx=(8, 2))
        self.cb_min = ttk.Combobox(self.when_frame, values=[f"{m:02d}" for m in range(0, 60, 10)],
                                   state="readonly", width=4)
        self.cb_min.set("00")
        self.cb_min.pack(side="left")

        pr2 = ttk.Frame(pf); pr2.pack(fill="x", padx=8, pady=(0, 6))
        self.btn_post = ttk.Button(pr2, text="🚀 네이버에 올리기", command=self.on_post)
        self.btn_post.pack(side="left")
        ttk.Label(pr2, text="예약 발행은 네이버 서버가 처리 — 그 시간에 컴퓨터를 꺼도 됩니다.",
                  foreground="#777").pack(side="left", padx=10)

        # 하단: 로그
        logf = ttk.LabelFrame(self, text=" 진행 상황 ")
        logf.pack(fill="both", **pad)
        self.t_log = tk.Text(logf, height=7, state="disabled", background="#f6f6f6")
        self.t_log.pack(fill="both", expand=True, padx=8, pady=6)
        self._toggle_when()

    def _toggle_when(self):
        if self.pub_mode.get() == "reserve":
            self.when_frame.pack(side="left")
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
                foreground="#03794a" if ok else "#c62828"))
        self._run_bg(work)

    def on_pick_photos(self):
        paths = filedialog.askopenfilenames(
            title="사진 선택 (여러 장 가능)",
            filetypes=[("사진", "*.png *.jpg *.jpeg"), ("모든 파일", "*.*")])
        self.photo_paths = list(paths)
        n = len(self.photo_paths)
        self.lbl_photos.configure(text=f"사진 {n}장 선택됨" if n else "사진 없음 (없으면 인용구 카드 이미지로 대체)")

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
            # 사진이 없으면 [이미지N] 자리에 인용구 카드 이미지를 만들어 사용
            images = photos
            if not images:
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
        win = tk.Toplevel(self)
        win.title("설정")
        win.geometry("560x640")
        win.transient(self)

        frm = ttk.Frame(win); frm.pack(fill="both", expand=True, padx=12, pady=10)
        ttk.Label(frm, text="Claude(앤트로픽) API 키 — 글 생성").pack(anchor="w")
        e_key = ttk.Entry(frm, show="*")
        e_key.pack(fill="x", pady=(0, 8))
        e_key.insert(0, self.settings["anthropic_api_key"])

        ttk.Label(frm, text="🏫 우리 학원 정보 (비워두면 더몬스터학원 기본값)").pack(anchor="w", pady=(4, 2))
        labels = [("name", "학원명"), ("tagline", "한 줄 소개"), ("phone", "전화"),
                  ("sms", "문자"), ("kakao", "카카오톡 채널 주소"), ("talktalk", "네이버 톡톡 주소"),
                  ("address", "주소"), ("hours", "운영시간"), ("region", "지역 키워드(쉼표)"),
                  ("hashtags", "해시태그(쉼표)")]
        entries = {}
        grid = ttk.Frame(frm); grid.pack(fill="x")
        prof = self.settings.get("profile") or {}
        for i, (k, lab) in enumerate(labels):
            ttk.Label(grid, text=lab, width=16).grid(row=i, column=0, sticky="w", pady=1)
            e = ttk.Entry(grid)
            e.grid(row=i, column=1, sticky="ew", pady=1)
            e.insert(0, prof.get(k, ""))
            entries[k] = e
        grid.columnconfigure(1, weight=1)

        v_map = tk.BooleanVar(value=bool(self.settings.get("try_map")))
        ttk.Checkbutton(frm, text="글 끝에 지도(장소) 자동 첨부 — 실험 기능",
                        variable=v_map).pack(anchor="w", pady=6)

        ttk.Label(frm, text="전용 틀 직접 수정 (비워두면 학원 정보로 자동 생성 — 웬만하면 비워두세요)").pack(anchor="w")
        t_tpl = tk.Text(frm, height=8)
        t_tpl.pack(fill="both", expand=True, pady=(0, 8))
        t_tpl.insert("1.0", self.settings.get("template", ""))

        def do_save():
            self.settings["anthropic_api_key"] = e_key.get().strip()
            self.settings["profile"] = {k: e.get().strip() for k, e in entries.items()}
            self.settings["try_map"] = bool(v_map.get())
            self.settings["template"] = t_tpl.get("1.0", "end").strip()
            save_settings(self.settings)
            self.log("설정을 저장했습니다. (이 컴퓨터에만 저장 — 외부 전송 없음)")
            win.destroy()

        ttk.Button(frm, text="💾 저장", command=do_save).pack(anchor="e")


if __name__ == "__main__":
    App().mainloop()
