# launcher/launcher.py — 몬스터 블로그 (확장을 품은 실행기)
#
# 왜 이 방식인가:
#   확장프로그램은 '크롬 안에서' 돌기 때문에 로그인·에디터 접근 문제가 아예 없다.
#   그래서 프로그램은 글을 대신 쓰지 않고, '확장이 심어진 크롬'을 띄워주기만 한다.
#   → 크롬드라이버·셀레늄·자동 로그인이 전부 필요 없어져 고장날 곳이 거의 없다.
#
# 고객 입장: 설치파일 하나 실행 → 바탕화면 아이콘 클릭 → 크롬이 열림 → 확장으로 글쓰기.
#   개발자 모드도, 폴더 로드도 필요 없다.

import os
import subprocess
import sys
from pathlib import Path

import customtkinter as ctk
from tkinter import messagebox

APP_NAME = "몬스터 블로그"
VERSION = "3.1.0"

# 확장 전용 크롬 프로필 (평소 쓰는 크롬과 분리 — 서로 방해하지 않는다)
PROFILE_DIR = Path.home() / ".monster_blog" / "chrome"
WRITE_URL = "https://blog.naver.com/GoBlogWrite.naver"

GREEN = "#03c75a"
GREEN_DARK = "#02a94d"
INK = "#1a1a1a"
SUB = "#6b7280"


def resource_dir():
    """개발 중이든 exe 로 포장됐든 '확장 폴더'가 있는 위치를 찾는다."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def extension_dir():
    d = resource_dir() / "extension"
    if (d / "manifest.json").exists():
        return d
    # 개발 중 예비 경로
    alt = Path(__file__).resolve().parent.parent / "extension"
    return alt if (alt / "manifest.json").exists() else None


# 확장을 두는 고정 위치 (프로그램을 업데이트해도 경로가 바뀌지 않는다)
INSTALLED_EXT = Path.home() / ".monster_blog" / "extension"


def install_extension():
    """포장된 확장을 고정 경로로 복사(갱신)하고 그 경로를 돌려준다."""
    src = extension_dir()
    if src is None:
        return None
    try:
        import shutil
        INSTALLED_EXT.parent.mkdir(parents=True, exist_ok=True)
        if INSTALLED_EXT.exists():
            shutil.rmtree(INSTALLED_EXT, ignore_errors=True)
        shutil.copytree(src, INSTALLED_EXT)
        return INSTALLED_EXT
    except Exception:
        return src if (src / "manifest.json").exists() else None


def find_chrome():
    """설치된 크롬 실행 파일 찾기."""
    cands = []
    for env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        base = os.environ.get(env)
        if base:
            cands.append(Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe")
    # 레지스트리에 등록된 경로도 확인
    try:
        import winreg
        for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(
                    root, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
                ) as k:
                    p = Path(winreg.QueryValue(k, None))
                    if p.exists():
                        cands.insert(0, p)
            except OSError:
                pass
    except ImportError:
        pass  # 윈도우가 아닌 환경
    # 맥/리눅스 (개발용)
    cands += [
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        Path("/usr/bin/google-chrome"),
    ]
    for c in cands:
        if c and c.exists():
            return c
    return None


def launch_chrome(url=WRITE_URL):
    """확장을 심은 채로 크롬을 띄운다. (성공 여부, 메시지) 반환."""
    chrome = find_chrome()
    if chrome is None:
        return False, "크롬이 설치되어 있지 않습니다.\ngoogle.com/chrome 에서 설치 후 다시 실행해 주세요."

    ext = install_extension()
    if ext is None:
        return False, "확장 폴더를 찾지 못했습니다. 프로그램을 다시 설치해 주세요."

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        str(chrome),
        f"--user-data-dir={PROFILE_DIR}",
        f"--load-extension={ext}",
        # 최신 크롬(2025~)은 보안상 --load-extension 을 기본 차단한다. 그 차단을 끈다.
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-search-engine-choice-screen",
        "--start-maximized",
        url,
    ]
    try:
        subprocess.Popen(args, close_fds=True)
        return True, "크롬을 열었습니다."
    except Exception as e:
        return False, f"크롬 실행 실패: {e}"


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        ctk.set_appearance_mode("light")
        self.title(f"{APP_NAME}  v{VERSION}")
        self.geometry("600x700")
        self.minsize(540, 620)
        self.configure(fg_color="#eef1f4")

        f_title = ctk.CTkFont(family="Malgun Gothic", size=22, weight="bold")
        f_head = ctk.CTkFont(family="Malgun Gothic", size=14, weight="bold")
        f_body = ctk.CTkFont(family="Malgun Gothic", size=13)
        f_small = ctk.CTkFont(family="Malgun Gothic", size=11)
        f_btn = ctk.CTkFont(family="Malgun Gothic", size=15, weight="bold")

        head = ctk.CTkFrame(self, corner_radius=0, fg_color="#ffffff", height=68)
        head.pack(fill="x")
        ctk.CTkLabel(head, text="📝", font=ctk.CTkFont(size=26)).pack(side="left", padx=(18, 6), pady=16)
        ctk.CTkLabel(head, text=APP_NAME, font=f_title, text_color=INK).pack(side="left")
        ctk.CTkLabel(head, text=f"v{VERSION}", font=f_small, text_color=SUB).pack(side="left", padx=8)

        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=16, pady=14)

        card = ctk.CTkFrame(body, corner_radius=14, fg_color="#ffffff")
        card.pack(fill="x")
        ctk.CTkLabel(card, text="블로그 글쓰기 시작하기", font=f_head,
                     text_color=INK).pack(anchor="w", padx=18, pady=(14, 2))
        ctk.CTkLabel(card, text="아래 버튼을 누르면 글쓰기 도구가 들어있는 크롬이 열립니다.",
                     font=f_small, text_color=SUB).pack(anchor="w", padx=18)
        ctk.CTkButton(card, text="🚀 글쓰기 시작", height=48, corner_radius=10,
                      font=f_btn, fg_color=GREEN, hover_color=GREEN_DARK,
                      command=self.on_start).pack(fill="x", padx=18, pady=(10, 16))

        guide = ctk.CTkFrame(body, corner_radius=14, fg_color="#ffffff")
        guide.pack(fill="both", expand=True, pady=(12, 0))
        ctk.CTkLabel(guide, text="처음 한 번만 해주세요", font=f_head,
                     text_color=INK).pack(anchor="w", padx=18, pady=(14, 6))
        steps = (
            "1.  크롬이 열리면 네이버에 로그인하세요. (이후 계속 유지됩니다)\n\n"
            "2.  주소창 오른쪽 퍼즐(🧩) → '더몬스터학원 블로그 자동화' 옆\n"
            "     압정(📌)을 눌러 고정하세요.\n\n"
            "3.  글쓰기 화면에서 그 아이콘을 누르면 도구가 열립니다."
        )
        ctk.CTkLabel(guide, text=steps, font=f_body, text_color=INK,
                     justify="left", anchor="w").pack(anchor="w", padx=18, pady=(0, 8))

        ctk.CTkLabel(guide, text="🧩 목록에 도구가 안 보이면 (크롬 보안정책 때문)",
                     font=f_head, text_color=INK).pack(anchor="w", padx=18, pady=(6, 4))
        manual = (
            "크롬 주소창에 chrome://extensions 입력 → 우측 상단 '개발자 모드' 켜기\n"
            "→ '압축해제된 확장 프로그램 로드' → 아래 버튼으로 열리는 폴더 선택.\n"
            "한 번만 하면 계속 유지됩니다."
        )
        ctk.CTkLabel(guide, text=manual, font=f_small, text_color=SUB,
                     justify="left", anchor="w").pack(anchor="w", padx=18)
        btns = ctk.CTkFrame(guide, fg_color="transparent")
        btns.pack(fill="x", padx=18, pady=(8, 14))
        ctk.CTkButton(btns, text="📂 확장 폴더 열기", height=36, corner_radius=8,
                      font=f_body, fg_color="#f0f2f5", hover_color="#e3e6ea",
                      text_color=INK, command=self.on_open_ext).pack(side="left")
        ctk.CTkButton(btns, text="📋 폴더 경로 복사", height=36, corner_radius=8,
                      font=f_body, fg_color="#f0f2f5", hover_color="#e3e6ea",
                      text_color=INK, command=self.on_copy_path).pack(side="left", padx=8)

        self.status = ctk.CTkLabel(body, text="", font=f_small, text_color=SUB)
        self.status.pack(anchor="w", pady=(10, 0))

    def on_open_ext(self):
        """확장 폴더를 탐색기로 연다 (수동 등록할 때 이 폴더를 고르면 된다)."""
        p = install_extension()
        if p is None:
            messagebox.showerror(APP_NAME, "확장 폴더를 찾지 못했습니다.")
            return
        try:
            if sys.platform.startswith("win"):
                os.startfile(str(p))
            else:
                subprocess.Popen(["xdg-open", str(p)])
            self.status.configure(text=f"✓ 확장 폴더를 열었습니다: {p}", text_color=GREEN_DARK)
        except Exception as e:
            messagebox.showinfo(APP_NAME, f"확장 폴더 위치:\n{p}\n\n({e})")

    def on_copy_path(self):
        """폴더 경로를 클립보드에 복사 (탐색기 주소창에 붙여넣기용)."""
        p = install_extension()
        if p is None:
            messagebox.showerror(APP_NAME, "확장 폴더를 찾지 못했습니다.")
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(str(p))
            self.status.configure(text=f"✓ 경로를 복사했습니다: {p}", text_color=GREEN_DARK)
        except Exception:
            messagebox.showinfo(APP_NAME, f"확장 폴더 위치:\n{p}")

    def on_start(self):
        ok, msg = launch_chrome()
        self.status.configure(text=("✓ " if ok else "⚠ ") + msg.replace("\n", " "),
                              text_color=GREEN_DARK if ok else "#dc2626")
        if not ok:
            messagebox.showerror(APP_NAME, msg)


if __name__ == "__main__":
    App().mainloop()
