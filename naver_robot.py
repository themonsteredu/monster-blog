# naver_robot.py — 네이버 블로그 자동 배치 (임시저장까지만, 발행은 사람이)
#
# ★★ 정직한 주의사항 ★★
# - 이 부분이 전체에서 가장 깨지기 쉬운 코드입니다.
# - 네이버가 글쓰기 화면 구조를 바꾸면 아래 '선택자'(CSS/XPath)를 수정해야 합니다.
# - 로그인 중 캡차/보안 인증이 뜨면, 그 순간 사람이 직접 창에서 풀어야 합니다.
# - 이미지를 정확한 위치에 끼워넣는 부분은 실제 화면을 보며 한 번 다듬어야 합니다.
#   (그래서 아래 본문 입력은 우선 '텍스트 먼저', 이미지 삽입은 TODO로 표시해 뒀습니다.)
# - 처음 실행은 반드시 옆에서 지켜보며 하세요.

import time

import pyperclip
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

NAVER_LOGIN = "https://nid.naver.com/nidlogin.login"
BLOG_WRITE = "https://blog.naver.com/GoBlogWrite.naver"


def _paste(driver, element, text):
    """네이버는 자동 타이핑을 막으므로, 클립보드 복사 후 붙여넣기로 입력."""
    pyperclip.copy(text)
    element.click()
    time.sleep(0.3)
    element.send_keys(Keys.CONTROL, "v")  # 맥에서는 Keys.COMMAND 로 바꾸세요
    time.sleep(0.5)


def _type_slow(driver, text, delay=0.02):
    """본문/제목에 한 글자씩 천천히 입력 (봇 감지 완화)."""
    actions = ActionChains(driver)
    for ch in text:
        actions.send_keys(ch)
        actions.pause(delay)
    actions.perform()


def publish_draft(naver_id, naver_pw, title, body, image_paths=None):
    """네이버에 로그인 → 글쓰기 → 제목·본문 입력 → 임시저장. 발행은 하지 않음."""
    image_paths = image_paths or []
    driver = webdriver.Chrome()
    wait = WebDriverWait(driver, 15)
    try:
        # 1) 로그인 (클립보드 붙여넣기 방식)
        driver.get(NAVER_LOGIN)
        time.sleep(2)
        _paste(driver, driver.find_element(By.ID, "id"), naver_id)
        _paste(driver, driver.find_element(By.ID, "pw"), naver_pw)
        driver.find_element(By.ID, "log.login").click()
        time.sleep(3)
        # ※ 캡차/추가 인증 화면이 뜨면 여기서 사람이 직접 처리한 뒤 진행됩니다.

        # 2) 글쓰기 페이지 진입
        driver.get(BLOG_WRITE)
        time.sleep(3)

        # 3) 글쓰기 창은 iframe(mainFrame) 안에 있음 → 포커스 전환
        WebDriverWait(driver, 15).until(
            EC.frame_to_be_available_and_switch_to_it((By.ID, "mainFrame"))
        )
        time.sleep(2)

        # 4) 방해 팝업 닫기 ("작성 중인 글", "도움말" 등) — 있으면 닫고 없으면 무시
        for sel in (".se-popup-button-cancel", ".se-help-panel-close-button"):
            try:
                driver.find_element(By.CSS_SELECTOR, sel).click()
                time.sleep(0.5)
            except Exception:
                pass

        # 5) 제목 입력
        title_area = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, ".se-section-documentTitle"))
        )
        title_area.click()
        time.sleep(0.5)
        _type_slow(driver, title)
        time.sleep(1)

        # 6) 본문 입력 (우선 텍스트만)
        body_area = driver.find_element(By.CSS_SELECTOR, ".se-section-text")
        body_area.click()
        time.sleep(0.5)
        _type_slow(driver, body)
        time.sleep(1)

        # 7) TODO(라이브 튜닝): 이미지 끼워넣기
        #    - 본문의 [이미지N] 위치마다 image_paths[N-1] 파일을 업로드해야 함.
        #    - 보통 사진 버튼(파일 input)에 경로를 send_keys 하는 방식:
        #        file_input = driver.find_element(By.CSS_SELECTOR, "input[type='file']")
        #        file_input.send_keys(image_path)
        #    - 실제 버튼/입력창 선택자는 화면을 보며 확인해 채우세요.
        #    - 우선은 텍스트 글이 임시저장되는지부터 확인하는 것을 권장합니다.

        # 8) 임시저장 (발행 아님!) — 단축키 또는 저장 버튼
        time.sleep(1)
        try:
            ActionChains(driver).key_down(Keys.CONTROL).key_down(Keys.SHIFT) \
                .send_keys("s").key_up(Keys.SHIFT).key_up(Keys.CONTROL).perform()
        except Exception:
            pass
        time.sleep(3)

        print("임시저장을 시도했습니다. 네이버 블로그 '임시저장 글'을 열어 확인 후 직접 발행하세요.")
        time.sleep(30)  # 사람이 화면을 확인할 시간
    finally:
        driver.quit()
