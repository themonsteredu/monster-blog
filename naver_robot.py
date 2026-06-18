# naver_robot.py — 네이버 블로그 자동 배치 (임시저장까지만, 발행은 사람이)
#
# ★★ 정직한 주의사항 ★★
# - 이 부분이 전체에서 가장 깨지기 쉬운 코드입니다.
# - 네이버가 글쓰기 화면 구조를 바꾸면 아래 '선택자'(CSS/XPath)를 수정해야 합니다.
# - 처음 한 번은 로그인 창에서 사람이 직접 로그인(캡차 포함)해야 할 수 있고,
#   그 뒤부터는 전용 크롬 프로필에 세션이 저장돼 자동 로그인됩니다.
# - 처음 실행은 반드시 옆에서 지켜보며 하세요.

import os
import re
import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

try:
    import pyperclip
except Exception:
    pyperclip = None

NAVER_HOME = "https://www.naver.com"
NAVER_LOGIN = "https://nid.naver.com/nidlogin.login"
BLOG_WRITE = "https://blog.naver.com/GoBlogWrite.naver"

# 로그인 세션을 저장할 전용 크롬 프로필 (한 번 로그인하면 다음부턴 자동 로그인)
PROFILE_DIR = os.path.join(os.path.expanduser("~"), ".monster_blog_chrome")


def _make_driver():
    """크롬 충돌을 줄인 안정적인 옵션으로 드라이버를 만든다."""
    options = webdriver.ChromeOptions()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--remote-allow-origins=*")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    # 세션 유지용 전용 프로필
    os.makedirs(PROFILE_DIR, exist_ok=True)
    options.add_argument(f"--user-data-dir={PROFILE_DIR}")
    driver = webdriver.Chrome(options=options)
    try:
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"},
        )
    except Exception:
        pass
    return driver


def _paste(driver, element, text):
    """네이버는 자동 타이핑을 막으므로, 가능하면 클립보드 복사 후 붙여넣기로 입력."""
    element.click()
    time.sleep(0.3)
    if pyperclip is not None:
        pyperclip.copy(text)
        element.send_keys(Keys.CONTROL, "v")  # 맥에서는 Keys.COMMAND
    else:
        element.send_keys(text)
    time.sleep(0.5)


def _type_slow(driver, text, delay=0.02):
    """본문/제목에 한 글자씩 천천히 입력 (봇 감지 완화)."""
    actions = ActionChains(driver)
    for ch in text:
        actions.send_keys(ch)
        actions.pause(delay)
    actions.perform()


def _looks_logged_in(driver):
    """네이버 메인에서 로그인 상태인지 대략 판별."""
    driver.get(NAVER_HOME)
    time.sleep(2)
    # 로그아웃 링크가 보이면 로그인된 것으로 본다 (선택자는 바뀔 수 있음)
    logout = driver.find_elements(By.XPATH, "//*[contains(text(),'로그아웃')]")
    return len(logout) > 0


def _ensure_logged_in(driver, naver_id, naver_pw, manual_wait=180):
    """이미 로그인돼 있으면 통과. 아니면 자동 로그인 시도 → 안 되면 사람이 직접 로그인할 시간을 준다."""
    if _looks_logged_in(driver):
        print("이미 로그인되어 있습니다. (저장된 세션 사용)")
        return

    driver.get(NAVER_LOGIN)
    time.sleep(2)
    # 1) 자동 로그인 시도 (아이디/비번이 있으면)
    if naver_id and naver_pw:
        try:
            _paste(driver, driver.find_element(By.ID, "id"), naver_id)
            _paste(driver, driver.find_element(By.ID, "pw"), naver_pw)
            driver.find_element(By.ID, "log.login").click()
            time.sleep(3)
        except Exception as e:
            print(f"자동 로그인 입력 중 문제(수동 로그인으로 진행): {e}")

    # 2) 캡차/보안인증 등으로 자동이 막힐 수 있음 → 사람이 직접 로그인할 시간을 준다
    print("로그인 확인 중... 캡차나 추가 인증이 뜨면 '크롬 창에서 직접' 로그인해 주세요.")
    end = time.time() + manual_wait
    while time.time() < end:
        cur = driver.current_url
        if "nid.naver.com" not in cur:  # 로그인 페이지를 벗어났으면 성공으로 간주
            time.sleep(1)
            if _looks_logged_in(driver):
                print("로그인 완료.")
                return
        time.sleep(2)
    print("로그인 대기 시간이 지났습니다. 그래도 계속 진행을 시도합니다.")


def _open_writer(driver):
    """글쓰기 페이지로 들어가 iframe 전환 후 방해 팝업을 닫는다."""
    driver.get(BLOG_WRITE)
    time.sleep(3)
    # 글쓰기 창은 iframe(mainFrame) 안에 있음
    WebDriverWait(driver, 20).until(
        EC.frame_to_be_available_and_switch_to_it((By.ID, "mainFrame"))
    )
    time.sleep(2)
    # 방해 팝업 닫기 ("작성 중인 글", "도움말" 등) — 있으면 닫고 없으면 무시
    for sel in (
        ".se-popup-button-cancel",
        ".se-popup-button-close",
        ".se-help-panel-close-button",
        "button.se-popup-button-cancel",
    ):
        try:
            driver.find_element(By.CSS_SELECTOR, sel).click()
            time.sleep(0.5)
        except Exception:
            pass


def _upload_image(driver, path):
    """현재 커서 위치에 이미지 파일을 업로드(삽입)한다.
    네이버 글쓰기의 숨은 <input type='file'> 에 경로를 보내는 방식."""
    abspath = os.path.abspath(path)
    if not os.path.exists(abspath):
        print(f"이미지 파일 없음, 건너뜀: {abspath}")
        return
    inputs = driver.find_elements(By.CSS_SELECTOR, "input[type='file']")
    if not inputs:
        print("파일 업로드 input 을 못 찾음 — 이미지 삽입 건너뜀 (화면 보며 선택자 보완 필요).")
        return
    try:
        inputs[-1].send_keys(abspath)  # OS 파일창을 거치지 않고 바로 업로드
        time.sleep(3)
    except Exception as e:
        print(f"이미지 업로드 실패({path}): {e}")


def _insert_body_with_images(driver, body, image_paths):
    """본문을 [이미지N] 기준으로 쪼개어, 텍스트는 타이핑하고 그 자리에 이미지를 업로드한다."""
    body_area = driver.find_element(By.CSS_SELECTOR, ".se-section-text")
    body_area.click()
    time.sleep(0.5)

    # parts: [텍스트0, "1", 텍스트1, "2", 텍스트2, ...]
    parts = re.split(r"\[이미지\s*(\d+)\]", body)
    for i, seg in enumerate(parts):
        if i % 2 == 0:
            if seg.strip():
                _type_slow(driver, seg)
                time.sleep(0.4)
        else:
            idx = int(seg) - 1
            if 0 <= idx < len(image_paths):
                print(f"[이미지{seg}] 자리에 이미지 업로드: {image_paths[idx]}")
                _upload_image(driver, image_paths[idx])
                # 이미지 삽입 후 다시 본문 영역에 포커스
                try:
                    driver.find_element(By.CSS_SELECTOR, ".se-section-text").click()
                except Exception:
                    pass
                time.sleep(0.5)


def publish_draft(naver_id, naver_pw, title, body, image_paths=None):
    """네이버에 로그인 → 글쓰기 → 제목·본문·이미지 입력 → 임시저장. 발행은 하지 않음."""
    image_paths = image_paths or []
    driver = _make_driver()
    wait = WebDriverWait(driver, 20)
    try:
        # 1) 로그인 (저장된 세션 우선, 안 되면 자동 → 수동 대기)
        _ensure_logged_in(driver, naver_id, naver_pw)

        # 2) 글쓰기 진입 + iframe + 팝업 닫기
        _open_writer(driver)

        # 3) 제목 입력
        title_area = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, ".se-section-documentTitle"))
        )
        title_area.click()
        time.sleep(0.5)
        _type_slow(driver, title)
        time.sleep(1)

        # 4) 본문 + 이미지 입력
        _insert_body_with_images(driver, body, image_paths)
        time.sleep(1)

        # 5) 임시저장 (발행 아님!) — 단축키 시도
        try:
            ActionChains(driver).key_down(Keys.CONTROL).key_down(Keys.SHIFT) \
                .send_keys("s").key_up(Keys.SHIFT).key_up(Keys.CONTROL).perform()
        except Exception:
            pass
        time.sleep(3)

        print("임시저장을 시도했습니다. 네이버 블로그 '임시저장 글'을 열어 확인 후 직접 발행하세요.")
        time.sleep(40)  # 사람이 화면을 확인할 시간
    finally:
        driver.quit()
