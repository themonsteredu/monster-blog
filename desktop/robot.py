# desktop/robot.py — 네이버 블로그 로봇 (설치형 데스크톱 버전)
#
# 확장프로그램(background.js v1.9.x)에서 검증된 방식을 셀레늄으로 옮긴 것.
# 셀레늄의 클릭/키입력은 브라우저 입장에서 '진짜 사용자 입력(trusted)'이라
# 확장에서 CDP 디버거로 어렵게 만들던 것들이 여기서는 기본으로 통과된다.
#
# ★★ 정직한 주의사항 ★★
# - 네이버가 글쓰기 화면 구조를 바꾸면 아래 JS 선택자를 손봐야 한다 (확장과 동일한 한계).
# - 처음 로그인은 캡차/기기등록 때문에 사람이 크롬 창에서 직접 마무리해야 할 수 있다.
#   그 뒤부터는 전용 크롬 프로필에 세션이 저장돼 자동 로그인된다.
# - 예약 시간 입력칸을 못 다루면 창을 열어둔 채 멈춘다 (엉뚱한 시간 자동발행 방지).

import base64
import json
import os
import re
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains

NAVER_HOME = "https://www.naver.com"
NAVER_LOGIN = "https://nid.naver.com/nidlogin.login"
BLOG_WRITE = "https://blog.naver.com/GoBlogWrite.naver"

APP_DIR = Path.home() / ".monster_blog"
PROFILE_DIR = APP_DIR / "chrome_profile"  # 로그인 세션 저장용 전용 크롬 프로필

_driver = None  # 프로그램이 살아있는 동안 크롬 창 하나를 계속 재사용


# ---------- 드라이버 ----------

def _make_driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    options.add_argument(f"--user-data-dir={PROFILE_DIR}")
    d = webdriver.Chrome(options=options)
    d.set_script_timeout(120)  # 한 글자씩 타이핑하는 비동기 스크립트용
    try:
        d.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"},
        )
    except Exception:
        pass
    return d


def get_driver():
    """살아있는 크롬 창을 돌려주고, 죽었으면 새로 띄운다."""
    global _driver
    if _driver is not None:
        try:
            _ = _driver.current_url  # 살아있는지 확인
            return _driver
        except Exception:
            _driver = None
    _driver = _make_driver()
    return _driver


def close_driver():
    global _driver
    if _driver is not None:
        try:
            _driver.quit()
        except Exception:
            pass
        _driver = None


def _insert_text(d, text):
    """현재 포커스 위치에 trusted 텍스트 입력 (한글 완벽 지원 — 확장과 같은 CDP 방식)."""
    d.execute_cdp_cmd("Input.insertText", {"text": text})


def _press(d, key):
    ActionChains(d).send_keys(key).perform()


def _select_all_delete(d):
    ActionChains(d).key_down(Keys.CONTROL).send_keys("a").key_up(Keys.CONTROL).perform()
    time.sleep(0.15)
    _press(d, Keys.DELETE)
    time.sleep(0.15)


# ---------- 로그인 ----------

def _logged_in(d):
    d.get(NAVER_HOME)
    time.sleep(2)
    return len(d.find_elements(By.XPATH, "//*[contains(text(),'로그아웃')]")) > 0


def ensure_login(naver_id, naver_pw, log=print, manual_wait=240):
    """프로그램 안에서 받은 아이디/비번으로 로그인. 세션이 남아있으면 그대로 통과.
    캡차 등으로 자동이 막히면, 열려있는 크롬 창에서 사람이 직접 마무리할 시간을 준다."""
    d = get_driver()
    if _logged_in(d):
        log("이미 로그인되어 있습니다. (저장된 세션 사용)")
        return True

    d.get(NAVER_LOGIN)
    time.sleep(2)
    if naver_id and naver_pw:
        try:
            # 셀레늄 기본 타이핑(send_keys)이 가장 확실하다. 안 되면 CDP insertText 로 보강.
            eid = d.find_element(By.CSS_SELECTOR, "#id")
            eid.click(); time.sleep(0.2)
            eid.send_keys(naver_id)
            if not (eid.get_attribute("value") or ""):
                _insert_text(d, naver_id)
            time.sleep(0.3)
            epw = d.find_element(By.CSS_SELECTOR, "#pw")
            epw.click(); time.sleep(0.2)
            epw.send_keys(naver_pw)
            if not (epw.get_attribute("value") or ""):
                _insert_text(d, naver_pw)
            time.sleep(0.3)
            if not (eid.get_attribute("value") or ""):
                log("⚠ 아이디 입력이 안 됩니다 — 크롬 창에서 직접 로그인해 주세요.")
            d.find_element(By.CSS_SELECTOR, "[id='log.login'], .btn_login").click()
            time.sleep(3)
        except Exception as e:
            log(f"자동 입력이 막혔습니다 — 크롬 창에서 직접 로그인해 주세요. ({e})")

    log("로그인 확인 중... 캡차/기기등록이 뜨면 '크롬 창에서 직접' 진행해 주세요.")
    end = time.time() + manual_wait
    while time.time() < end:
        try:
            if "nid.naver.com" not in d.current_url:
                time.sleep(1)
                if _logged_in(d):
                    log("로그인 완료. (다음부터는 자동 로그인됩니다)")
                    return True
        except Exception:
            return False
        time.sleep(2)
    log("로그인 대기 시간이 지났습니다.")
    return False


# ---------- 프레임 탐색 ----------
# 글쓰기 화면은 시기/경로에 따라 iframe(mainFrame) 안일 수도, 바로일 수도 있다.
# '본문 편집칸이 있는 프레임'을 찾아 기억해두고, 그 프레임 안에서 모든 작업을 한다.

JS_HAS_BODY = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const all = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => !isTitle(e));
  if (!all.length) return null;
  const vis = e => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.getComputedStyle(e);
    return !(st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0);
  };
  const area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const shown = all.filter(vis);
  const pool = shown.length ? shown : all;     // 보이는 게 없으면 최후수단으로 전체
  pool.sort((a, b) => area(b) - area(a));
  return pool[0];
}

const b = __vb();
if (!b) return false;
const r = b.getBoundingClientRect();
const st = window.getComputedStyle(b);
if (st.visibility === 'hidden' || st.display === 'none') return false;
return r.width > 0 && r.height > 0;
"""

JS_FOCUS_BODY_END = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const c = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => {
    if (isTitle(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 100 || r.height < 15) return false;          // 크기 0 = 안 보이는 가짜
    const st = window.getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
    return true;
  });
  c.sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
  return c[0] || null;
}

const b = __vb();
if (!b) return false;
b.focus();
const r = document.createRange(); r.selectNodeContents(b); r.collapse(false);
const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
return true;
"""

JS_FIND_TITLE = """
function __vt(){
  const inToolbar = el => !!el.closest('[class*="toolbar"], [class*="Toolbar"], [role="toolbar"]');
  const vis = e => {
    const r = e.getBoundingClientRect();
    if (r.width < 50 || r.height < 10) return false;
    const st = window.getComputedStyle(e);
    return !(st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0);
  };
  const sels = ['input[placeholder*="제목"]', 'textarea[placeholder*="제목"]',
    '[contenteditable="true"][data-placeholder*="제목"]', '.se-documentTitle [contenteditable="true"]',
    '.se-section-documentTitle [contenteditable="true"]', '[class*="documentTitle"] [contenteditable="true"]'];
  for (const s of sels) {
    const f = [...document.querySelectorAll(s)].filter(e => !inToolbar(e) && vis(e));
    f.sort((a,b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    if (f[0]) return f[0];
  }
  return null;
}
return __vt();"""

JS_TITLE_FOCUSED = """
const ae = document.activeElement;
if (!ae) return false;
if (ae.closest && ae.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')) return true;
const ph = (ae.getAttribute && ((ae.getAttribute('placeholder')||'') + (ae.getAttribute('data-placeholder')||'') + (ae.getAttribute('aria-label')||''))) || '';
return /제목/.test(ph);
"""

JS_CHECK_TITLE = """
function __vt(){
  const inToolbar = el => !!el.closest('[class*="toolbar"], [class*="Toolbar"], [role="toolbar"]');
  const vis = e => {
    const r = e.getBoundingClientRect();
    if (r.width < 50 || r.height < 10) return false;
    const st = window.getComputedStyle(e);
    return !(st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0);
  };
  const sels = ['input[placeholder*="제목"]', 'textarea[placeholder*="제목"]',
    '[contenteditable="true"][data-placeholder*="제목"]', '.se-documentTitle [contenteditable="true"]',
    '.se-section-documentTitle [contenteditable="true"]', '[class*="documentTitle"] [contenteditable="true"]'];
  for (const s of sels) {
    const f = [...document.querySelectorAll(s)].filter(e => !inToolbar(e) && vis(e));
    f.sort((a,b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    if (f[0]) return f[0];
  }
  return null;
}

const t = __vt();
if (!t) return false;
const v = typeof t.value === 'string' ? t.value : (t.textContent || '');
return v.indexOf(arguments[0]) !== -1;
"""

JS_COUNT_IMAGES = """
return { res: document.querySelectorAll('.se-image-resource').length,
         img: document.querySelectorAll('img').length };
"""

JS_HAS_BODY_LOOSE = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const all = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => !isTitle(e));
  if (!all.length) return null;
  const vis = e => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.getComputedStyle(e);
    return !(st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0);
  };
  const area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const shown = all.filter(vis);
  const pool = shown.length ? shown : all;     // 보이는 게 없으면 최후수단으로 전체
  pool.sort((a, b) => area(b) - area(a));
  return pool[0];
}
return !!__vb();"""


JS_CLICK_TARGET = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const all = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => !isTitle(e));
  if (!all.length) return null;
  const vis = e => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.getComputedStyle(e);
    return !(st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0);
  };
  const area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const shown = all.filter(vis);
  const pool = shown.length ? shown : all;     // 보이는 게 없으면 최후수단으로 전체
  pool.sort((a, b) => area(b) - area(a));
  return pool[0];
}

const b = __vb();
if (!b) return null;
const ps = b.querySelectorAll('.se-text-paragraph, p');
for (let i = ps.length - 1; i >= 0; i--) {
  const r = ps[i].getBoundingClientRect();
  if (r.width > 0 && r.height > 0) return ps[i];
}
return b;
"""


JS_DIAG = """
const out = [];
document.querySelectorAll('[contenteditable="true"]').forEach(e => {
  const r = e.getBoundingClientRect();
  const st = window.getComputedStyle(e);
  const cls = String(e.className || '').trim().split(/\s+/)[0] || '';
  out.push(e.tagName + '.' + cls.slice(0, 22)
    + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
    + (st.visibility === 'hidden' ? ' HID' : '')
    + (st.display === 'none' ? ' NONE' : '')
    + ((e.getAttribute('data-placeholder') || e.getAttribute('placeholder')) ? ' ph=' + (e.getAttribute('data-placeholder') || e.getAttribute('placeholder')).slice(0, 6) : ''));
});
return out.length ? out.join(' / ') : '(편집칸없음)';
"""


JS_FIND_BODY = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const all = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => !isTitle(e));
  if (!all.length) return null;
  const vis = e => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.getComputedStyle(e);
    return !(st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0);
  };
  const area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const shown = all.filter(vis);
  const pool = shown.length ? shown : all;     // 보이는 게 없으면 최후수단으로 전체
  pool.sort((a, b) => area(b) - area(a));
  return pool[0];
}
return __vb();"""

JS_BODY_LEN = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const c = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => {
    if (isTitle(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 100 || r.height < 15) return false;          // 크기 0 = 안 보이는 가짜
    const st = window.getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
    return true;
  });
  c.sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
  return c[0] || null;
}
const b = __vb(); return b ? (b.textContent||'').length : -1;"""

JS_QUOTE_LASTLEN = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const c = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => {
    if (isTitle(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 100 || r.height < 15) return false;          // 크기 0 = 안 보이는 가짜
    const st = window.getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
    return true;
  });
  c.sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
  return c[0] || null;
}

const b = __vb();
if (!b) return -1;
const qs = b.querySelectorAll(".se-quotation, .se-component-quotation, .se-quote, blockquote, [class*='quotation']");
const last = qs[qs.length - 1];
return last ? (last.textContent||'').trim().length : -1;
"""

# 본문 한 줄을 '에디터 안에서' 한 글자씩 타이핑 (확장 background.js 의 검증된 방식).
# CDP insertText 는 네이버 본문 에디터가 무시하는 경우가 있어 execCommand 로 입력한다.
JS_TYPE_LINE = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const c = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => {
    if (isTitle(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 100 || r.height < 15) return false;          // 크기 0 = 안 보이는 가짜
    const st = window.getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
    return true;
  });
  c.sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
  return c[0] || null;
}

const line = arguments[0];
const done = arguments[arguments.length - 1];
const b = __vb();
if (!b) { done(false); return; }
b.focus();
const r = document.createRange(); r.selectNodeContents(b); r.collapse(false);
const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
let i = 0;
(function step() {
  if (i >= line.length) { done(true); return; }
  document.execCommand('insertText', false, line[i++]);
  setTimeout(step, 4);
})();
"""

# 커서 위치 그대로 타이핑 (빈 인용구 박스 '안'에 문장을 넣을 때 — 끝으로 이동하지 않음)
JS_TYPE_HERE = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const c = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => {
    if (isTitle(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 100 || r.height < 15) return false;          // 크기 0 = 안 보이는 가짜
    const st = window.getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
    return true;
  });
  c.sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
  return c[0] || null;
}

const text = arguments[0];
const done = arguments[arguments.length - 1];
const b = __vb();
const s = window.getSelection();
if (!b || !s || !s.anchorNode || !b.contains(s.anchorNode)) { done(false); return; }
let i = 0;
(function step() {
  if (i >= text.length) { done(true); return; }
  document.execCommand('insertText', false, text[i++]);
  setTimeout(step, 4);
})();
"""

# 제목 예비 입력 (클릭+insertText 가 실패했을 때): 제목칸에 직접 넣고 이벤트를 쏜다
JS_TITLE_FALLBACK = """
function __vt(){
  const inToolbar = el => !!el.closest('[class*="toolbar"], [class*="Toolbar"], [role="toolbar"]');
  const vis = e => {
    const r = e.getBoundingClientRect();
    if (r.width < 50 || r.height < 10) return false;
    const st = window.getComputedStyle(e);
    return !(st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0);
  };
  const sels = ['input[placeholder*="제목"]', 'textarea[placeholder*="제목"]',
    '[contenteditable="true"][data-placeholder*="제목"]', '.se-documentTitle [contenteditable="true"]',
    '.se-section-documentTitle [contenteditable="true"]', '[class*="documentTitle"] [contenteditable="true"]'];
  for (const s of sels) {
    const f = [...document.querySelectorAll(s)].filter(e => !inToolbar(e) && vis(e));
    f.sort((a,b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    if (f[0]) return f[0];
  }
  return null;
}

const title = arguments[0];
const t = __vt();
if (!t) return false;
t.focus();
if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
  try {
    const proto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(t, title);
  } catch (_) { t.value = title; }
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.dispatchEvent(new Event('change', { bubbles: true }));
} else {
  const r = document.createRange(); r.selectNodeContents(t);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('insertText', false, title);
}
const v = typeof t.value === 'string' ? t.value : (t.textContent || '');
return v.indexOf(title.slice(0, 5)) !== -1;
"""

JS_QUOTE_BTN = """
const btnSel = '[data-name="quotation"], button[data-log*="quotation"], button[aria-label*="인용"], button[title*="인용"], button[class*="quotation"]';
let btn = document.querySelector(btnSel);
if (!btn) btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '인용구');
if (!btn) return null;
let arrow = null;
const wrap = btn.parentElement;
if (wrap) {
  const others = [...wrap.querySelectorAll("button, [role='button']")].filter(
    b => b !== btn && !btn.contains(b) && !b.contains(btn) && b.getBoundingClientRect().width > 0);
  if (others[0]) arrow = others[0];
}
return [btn, arrow];
"""

JS_QUOTE_STYLE = """
const idv = (x) => (typeof x.className === 'string' ? x.className : '') + (x.getAttribute('data-value')||'')
  + (x.getAttribute('data-name')||'') + (x.getAttribute('data-log')||'') + (x.getAttribute('aria-label')||'') + (x.getAttribute('title')||'');
const els = [...document.querySelectorAll("button, [role='button'], li, a")].filter(x => {
  const rr = x.getBoundingClientRect();
  if (!rr.width || !rr.height) return false;
  return /quotation|인용/i.test(idv(x)) || /세로/.test((x.textContent||'').trim());
});
let o = els.find(x => /line|vertical/i.test(idv(x)) || /세로/.test(idv(x) + (x.textContent||'')));
if (!o) {
  const opts = els.filter(x => /option|list|layer/i.test(idv(x)) || x.tagName === 'LI');
  if (opts.length > 1) o = opts[1]; else if (opts.length === 1) o = opts[0];
}
return o || null;
"""

JS_QUOTE_CITE = """
function __vb(){
  const isTitle = (e) => !!(e.closest('.se-documentTitle, .se-section-documentTitle, [class*="documentTitle"]')
    || /제목/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + (e.getAttribute('aria-label')||'')));
  const c = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => {
    if (isTitle(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 100 || r.height < 15) return false;          // 크기 0 = 안 보이는 가짜
    const st = window.getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
    return true;
  });
  c.sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
  return c[0] || null;
}

const sameText = arguments[0];
const b = __vb();
if (!b) return null;
const boxes = b.querySelectorAll(".se-quotation, .se-component-quotation, blockquote, [class*='quotation']");
const box = boxes[boxes.length - 1];
const scope = box || b;
const cites = [...scope.querySelectorAll('[data-placeholder], [contenteditable="true"]')].filter(e => {
  const ph = (e.getAttribute('data-placeholder')||'') + (typeof e.className === 'string' ? e.className : '');
  return /출처|cite|source/i.test(ph);
});
const bad = cites.find(c => (c.textContent||'').trim() && (!sameText || (c.textContent||'').indexOf(sameText.slice(0,6)) !== -1));
return bad || null;
"""

JS_MAP_BTN = """
const sel = '[data-name="map"], button[data-log*="map"], button[aria-label*="장소"], button[title*="장소"]';
let btn = document.querySelector(sel);
if (!btn) btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '장소');
return btn || null;
"""

JS_MAP_SEARCH = """
const ins = [...document.querySelectorAll('input')].filter(i => {
  const rr = i.getBoundingClientRect();
  if (!rr.width || !rr.height) return false;
  const ph = (i.placeholder||'') + (i.getAttribute('aria-label')||'') + (i.className||'');
  return /장소|위치|검색|place|search/i.test(ph);
});
return ins[0] || null;
"""

JS_MAP_RESULT = """
const q = arguments[0];
const vis = el => { const rr = el.getBoundingClientRect(); return rr.width > 4 && rr.height > 4; };
let items = [...document.querySelectorAll('li, [class*="item"], [class*="result"], [class*="place"], [class*="search"] a, [class*="list"] > *')]
  .filter(x => vis(x) && (x.textContent||'').indexOf(q) !== -1)
  .filter(x => x.getBoundingClientRect().height < 160);
items.sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
let it = items[0];
if (!it) {
  const anyList = [...document.querySelectorAll('li, [class*="item"]')].filter(vis).filter(x => {
    const h = x.getBoundingClientRect().height; return h > 24 && h < 160;
  });
  anyList.sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  it = anyList[0];
  if (!it) return null;
}
const addBtn = [...it.querySelectorAll('button, a, [role="button"]')].find(b => /추가|선택|등록|확인/.test((b.textContent||'').trim()));
const titleLink = it.querySelector('a, [class*="title"], strong, [class*="name"]');
return addBtn || titleLink || it;
"""

JS_MAP_CONFIRM = """
const vis = b => { const rr = b.getBoundingClientRect(); return rr.width > 0 && rr.height > 0; };
const all = [...document.querySelectorAll('button, [role="button"], a')].filter(vis);
// 1순위: 텍스트가 정확히 '확인'인 버튼 (지도 팝업 하단의 확정 버튼)
let cands = all.filter(b => (b.textContent||'').trim() === '확인');
// 2순위: 확인 계열 텍스트/속성
if (!cands.length) cands = all.filter(b => {
  const s = (b.textContent||'').trim() + (b.getAttribute('aria-label')||'') + (b.getAttribute('title')||'') + (b.className||'');
  return /확인|추가|완료|등록|삽입|적용|apply|confirm|submit/i.test(s);
});
// 팝업/레이어 안에 있는 것 우선, 그다음 화면 아래쪽(팝업 하단) 우선
const inLayer = b => !!b.closest('[class*="popup"], [class*="layer"], [class*="Layer"], [role="dialog"]');
cands.sort((a, b) => (inLayer(b) - inLayer(a)) || (b.getBoundingClientRect().top - a.getBoundingClientRect().top));
return cands[0] || null;
"""

JS_SAVE_BTN = """
const cand = [...document.querySelectorAll('button, [role="button"], a')].filter(b => {
  const rr = b.getBoundingClientRect();
  if (rr.width < 16 || rr.height < 10) return false;
  return /^저장/.test((b.textContent||'').trim());
});
cand.sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
return cand[0] || null;
"""

JS_PUBLISH_OPEN = """
const cand = [...document.querySelectorAll('button, [role="button"], a')].filter(b => {
  const rr = b.getBoundingClientRect();
  if (rr.width < 20 || rr.height < 10) return false;
  const s = (b.textContent||'').trim() + (b.getAttribute('class')||'') + (b.getAttribute('data-click-area')||'') + (b.getAttribute('data-log')||'');
  return /발행|publish/i.test(s);
});
cand.sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
return cand[0] || null;
"""

JS_RESERVE_RADIO = """
return [...document.querySelectorAll('label, button, [role="radio"], span, a')].find(b => {
  const rr = b.getBoundingClientRect();
  return rr.width > 0 && rr.height > 0 && /^예약/.test((b.textContent||'').trim());
}) || null;
"""

JS_RESERVE_FIELDS = """
const out = { inputs: [], selects: [] };
document.querySelectorAll('input').forEach(i => {
  const rr = i.getBoundingClientRect();
  if (rr.width < 20 || rr.height < 10) return;
  const meta = (i.type||'') + (i.placeholder||'') + (i.className||'') + (i.getAttribute('aria-label')||'');
  if (/date|time|시|분|년|월|일|hour|min/i.test(meta) || i.type === 'date' || i.type === 'time')
    out.inputs.push([i, meta.slice(0, 30)]);
});
document.querySelectorAll('select').forEach(s => {
  const rr = s.getBoundingClientRect();
  if (rr.width < 20 || rr.height < 10) return;
  out.selects.push([s, (s.className||'').slice(0, 30)]);
});
if (!out.inputs.length && !out.selects.length) return null;
return [out.inputs, out.selects];
"""

JS_PUBLISH_CONFIRM = """
const cand = [...document.querySelectorAll('button, [role="button"], a')].filter(b => {
  const rr = b.getBoundingClientRect();
  if (rr.width < 20 || rr.height < 10) return false;
  const s = (b.textContent||'').trim();
  const meta = (b.getAttribute('class')||'') + (b.getAttribute('data-click-area')||'') + (b.getAttribute('data-testid')||'');
  return /^발행$/.test(s) || /confirm|publish.*btn|btn.*publish|submit/i.test(meta);
});
cand.sort((a,b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
return cand[0] || null;
"""


def _frame_paths(d):
    """최상위 + iframe(2단계까지)의 프레임 경로 목록. 예: [] , [0], [0,1]"""
    paths = [[]]
    d.switch_to.default_content()
    n = len(d.find_elements(By.TAG_NAME, "iframe"))
    for i in range(n):
        paths.append([i])
        try:
            d.switch_to.default_content()
            d.switch_to.frame(d.find_elements(By.TAG_NAME, "iframe")[i])
            for j in range(len(d.find_elements(By.TAG_NAME, "iframe"))):
                paths.append([i, j])
        except Exception:
            pass
    d.switch_to.default_content()
    return paths


def _goto(d, path):
    d.switch_to.default_content()
    for idx in path:
        frames = d.find_elements(By.TAG_NAME, "iframe")
        if idx >= len(frames):
            raise RuntimeError("프레임 구조가 바뀌었습니다")
        d.switch_to.frame(frames[idx])


def _find_in_frames(d, js, *args):
    """모든 프레임에서 js 를 실행해 처음 참(비어있지 않은) 값을 낸 (경로, 결과)를 돌려준다."""
    for path in _frame_paths(d):
        try:
            _goto(d, path)
            res = d.execute_script(js, *args)
            if res:
                return path, res
        except Exception:
            continue
    return None, None


def _find_all_frames(d, js, *args):
    """js 가 참을 내는 '모든' 프레임 경로 목록. (본문 편집칸이 여러 프레임에
    있을 수 있고, 그중 보이지 않는 가짜가 섞여 있어 하나만 고르면 조용히 실패한다.
    확장프로그램이 '모든 프레임에 뿌리는' 방식을 쓰는 이유가 이것.)"""
    out = []
    for path in _frame_paths(d):
        try:
            _goto(d, path)
            if d.execute_script(js, *args):
                out.append(path)
        except Exception:
            continue
    return out


# ---------- 글쓰기 ----------

def _open_writer(d, log):
    d.get(BLOG_WRITE)
    time.sleep(4)
    # '보이는' 본문칸이 있는 프레임을 먼저 찾고(최대 20초), 하나도 없으면 느슨한 기준으로
    body_paths = []
    for _ in range(10):
        body_paths = _find_all_frames(d, JS_HAS_BODY)
        if body_paths:
            break
        time.sleep(2)
    if not body_paths:
        body_paths = _find_all_frames(d, JS_HAS_BODY_LOOSE)
        if body_paths:
            log("⚠ 보이는 본문칸을 못 찾아 예비 기준으로 진행합니다")
    if not body_paths:
        raise RuntimeError("글쓰기 화면(본문칸)을 찾지 못했습니다. 네이버에 로그인돼 있는지 확인하세요.")
    log(f"본문칸 프레임 {len(body_paths)}개 발견")
    # 화면 구조를 한 번 기록 (문제 생겼을 때 원인 파악용)
    try:
        for i, p in enumerate(body_paths):
            _goto(d, p)
            log(f"  f{i}: {d.execute_script(JS_DIAG)}")
    except Exception:
        pass
    # 방해 팝업 닫기 ("작성 중인 글", 도움말 등) — 모든 프레임에서. 팝업이 남아있으면
    # 제목 클릭이 가로막혀 제목 입력이 실패한다.
    for path in _frame_paths(d):
        try:
            _goto(d, path)
            for sel in (".se-popup-button-cancel", ".se-popup-button-close", ".se-help-panel-close-button"):
                for el in d.find_elements(By.CSS_SELECTOR, sel):
                    try:
                        el.click()
                        time.sleep(0.4)
                    except Exception:
                        pass
        except Exception:
            pass
    _goto(d, body_paths[0])
    log("글쓰기 화면 준비 완료")
    return body_paths


def _fill_title(d, body_path, title, notes, log):
    log("제목 입력 중…")
    path, el = _find_in_frames(d, JS_FIND_TITLE)
    if el is None:
        notes.append("title:제목칸못찾음")
        return False
    # 1차: 셀레늄 기본 타이핑 (가장 확실)
    try:
        el.click()
        time.sleep(0.3)
        el.send_keys(title)
        time.sleep(0.4)
        if d.execute_script(JS_CHECK_TITLE, title[:5]):
            return True
        notes.append("title:send_keys무반응")
    except Exception as e:
        notes.append(f"title:keys {type(e).__name__}")
    # 2차: 진짜 클릭 + trusted insertText
    try:
        _goto(d, path)
        el.click()
        time.sleep(0.3)
        _insert_text(d, title)
        time.sleep(0.4)
        if d.execute_script(JS_CHECK_TITLE, title[:5]):
            return True
        notes.append("title:insertText무반응")
    except Exception as e:
        notes.append(f"title:{type(e).__name__}")
    # 3차: 클릭된 상태에서 클립보드 + 진짜 Ctrl+V
    try:
        _goto(d, path)
        if _clip_text(d, title):
            el.click()
            time.sleep(0.3)
            ActionChains(d).key_down(Keys.CONTROL).send_keys("v").key_up(Keys.CONTROL).perform()
            time.sleep(0.4)
            if d.execute_script(JS_CHECK_TITLE, title[:5]):
                notes.append("title:붙여넣기로 성공")
                return True
            notes.append("title:붙여넣기무반응")
    except Exception as e:
        notes.append(f"title:붙여넣기 {type(e).__name__}")
    # 4차 예비: 제목칸에 직접 넣기 (확장 typeTitleFallback 과 동일)
    try:
        _goto(d, path)
        ok = bool(d.execute_script(JS_TITLE_FALLBACK, title))
        if not ok:
            notes.append("title:예비도실패")
        return ok
    except Exception as e:
        notes.append(f"title:예비 {type(e).__name__}")
        return False


def _focus_body_end(d, body_path):
    _goto(d, body_path)
    return bool(d.execute_script(JS_FOCUS_BODY_END))


def _bring_front(d):
    """크롬 창을 화면 앞으로. 창이 뒤에 있으면 키 입력을 에디터가 무시할 수 있다."""
    try:
        d.execute_cdp_cmd("Page.bringToFront", {})
    except Exception:
        pass
    try:
        d.switch_to.window(d.current_window_handle)
    except Exception:
        pass


def _cursor_body_end(d, body_path):
    """진짜 클릭으로 본문에 포커스를 주고 Ctrl+End 로 커서를 글 끝으로."""
    _goto(d, body_path)
    try:
        el = d.execute_script(JS_FIND_BODY)
        if el is not None:
            try:
                el.click()
            except Exception:
                d.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
                time.sleep(0.2)
                el.click()
            time.sleep(0.15)
    except Exception:
        pass
    try:
        ActionChains(d).key_down(Keys.CONTROL).send_keys(Keys.END).key_up(Keys.CONTROL).perform()
        time.sleep(0.1)
    except Exception:
        pass
    d.execute_script(JS_FOCUS_BODY_END)


def _body_len(d, body_path):
    _goto(d, body_path)
    try:
        return int(d.execute_script(JS_BODY_LEN))
    except Exception:
        return -1


def _body_len_all(d, paths):
    """후보 프레임 전체의 본문 글자수 합. 어느 프레임에 들어가든 '늘어남'을 잡아낸다."""
    total = 0
    for p in paths:
        n = _body_len(d, p)
        if n > 0:
            total += n
    return total


def _cur_path(state, paths):
    """지금까지 입력에 성공한 프레임(없으면 첫 후보)."""
    return state.get("path") or paths[0]


def _clip_text(d, text):
    """시스템 클립보드에 텍스트를 올린다 (페이지 쪽 API 이용)."""
    try:
        d.execute_cdp_cmd("Browser.grantPermissions",
                          {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]})
    except Exception:
        pass
    w = d.execute_cdp_cmd("Runtime.evaluate", {
        "expression": "navigator.clipboard.writeText(" + json.dumps(text) + ").then(()=>'ok').catch(e=>'err:'+e)",
        "awaitPromise": True, "returnByValue": True, "userGesture": True,
    })
    return (w.get("result") or {}).get("value") == "ok"


def _try_type_once(d, path, text, method):
    """한 프레임에 한 방식으로 입력 시도 (성공 여부는 밖에서 글자수로 판정)."""
    if method == "keys":
        # 셀레늄 기본 타이핑 — 브라우저 입장에서 가장 '사람다운' 입력
        _goto(d, path)
        el = d.execute_script(JS_CLICK_TARGET) or d.execute_script(JS_FIND_BODY)
        if el is None:
            return False
        try:
            el.click()
        except Exception:
            d.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
            time.sleep(0.2)
            el.click()
        time.sleep(0.15)
        el.send_keys(text)
    elif method == "chain":
        # 클릭 후 키보드로 직접 (커서가 잡힌 곳에 그대로)
        _cursor_body_end(d, path)
        ActionChains(d).send_keys(text).perform()
    elif method == "cdp":
        _cursor_body_end(d, path)
        _insert_text(d, text)
    elif method == "js":
        _goto(d, path)
        d.execute_async_script(JS_TYPE_LINE, text)
    else:  # paste
        if not _clip_text(d, text):
            return False
        _cursor_body_end(d, path)
        ActionChains(d).key_down(Keys.CONTROL).send_keys("v").key_up(Keys.CONTROL).perform()
    return True


def _type_text(d, paths, text, notes, state):
    """본문 끝에 텍스트 한 덩이 입력.
    '어느 프레임 × 어느 방식'이 실제로 먹히는지 한 번 찾아내고, 그 조합을 계속 쓴다.
    (네이버 화면엔 보이지 않는 가짜 편집칸이 섞여 있어 프레임을 하나만 골라 쓰면
     아무 반응 없이 실패한다 — 확장프로그램이 '모든 프레임에 뿌리는' 이유.)
    방식: cdp = 진짜 클릭+insertText / js = 에디터 안 타이핑 / paste = 클립보드+Ctrl+V"""
    # 이미 찾은 조합이 있으면 그것부터
    combos = []
    if state.get("path") and state.get("best"):
        combos.append((state["path"], state["best"]))
    for m in ("keys", "chain", "cdp", "js", "paste"):
        for p in paths:
            if (p, m) not in combos:
                combos.append((p, m))

    for path, method in combos:
        before = _body_len_all(d, paths)
        try:
            if not _try_type_once(d, path, text, method):
                continue
            time.sleep(0.25)
            if _body_len_all(d, paths) > before:
                if state.get("best") != method or state.get("path") != path:
                    state["best"], state["path"] = method, path
                    notes.append(f"입력성공: 프레임{path} 방식{method}")
                return True
        except Exception as e:
            notes.append(f"type-{method}:{type(e).__name__}")
    notes.append("입력실패: 모든 프레임·방식 무반응")
    try:
        for i, p in enumerate(paths):
            _goto(d, p)
            notes.append(f"진단f{i}: {d.execute_script(JS_DIAG)}")
    except Exception:
        pass
    return False


def _enter(d, body_path):
    """진짜 Enter (문단 나누기). 커서는 직전 입력 위치에 있다."""
    _press(d, Keys.ENTER)
    time.sleep(0.08)


def _count_images(d, body_path):
    _goto(d, body_path)
    c = d.execute_script(JS_COUNT_IMAGES)
    return c or {"res": 0, "img": 0}


def _wait_more_images(d, body_path, before, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(0.5)
        now = _count_images(d, body_path)
        if now["res"] > before["res"] or now["img"] > before["img"]:
            time.sleep(1.5)  # 업로드 마무리 여유
            return True
    return False


def _clip_expr(b64, media_type):
    # 확장과 동일: 사진을 클립보드에 올리는 페이지 쪽 코드 (PNG 변환 포함)
    return (
        "(async () => { try {"
        f'const r = await fetch("data:{media_type};base64,{b64}");'
        "let b = await r.blob();"
        'if (b.type !== "image/png") {'
        "  const bmp = await createImageBitmap(b);"
        "  const c = new OffscreenCanvas(bmp.width, bmp.height);"
        '  c.getContext("2d").drawImage(bmp, 0, 0);'
        '  b = await c.convertToBlob({ type: "image/png" });'
        "}"
        'await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);'
        'return "ok";'
        '} catch (e) { return "err:" + (e && e.message ? e.message : e); } })()'
    )


def _insert_image(d, body_path, image_path, notes):
    """이미지 한 장을 본문 끝에 삽입. A) 숨은 파일 input B) 클립보드 + 진짜 Ctrl+V"""
    abspath = os.path.abspath(image_path)
    if not os.path.exists(abspath):
        notes.append(f"img:파일없음 {abspath}")
        return False
    before = _count_images(d, body_path)

    # A) 파일 input 에 경로 직접 전달 (OS 파일창 없이 업로드)
    _focus_body_end(d, body_path)
    try:
        _goto(d, body_path)
        inputs = d.find_elements(By.CSS_SELECTOR, "input[type='file']")
        if inputs:
            inputs[-1].send_keys(abspath)
            if _wait_more_images(d, body_path, before, 12):
                return True
            notes.append("img:A무반응")
        else:
            notes.append("img:A input없음")
    except Exception as e:
        notes.append(f"img:A {e}")

    # B) 클립보드에 사진을 올리고 진짜 Ctrl+V (확장의 검증된 경로)
    try:
        data = Path(abspath).read_bytes()
        b64 = base64.standard_b64encode(data).decode()
        ext = Path(abspath).suffix.lower()
        mt = "image/png" if ext == ".png" else "image/jpeg"
        try:
            d.execute_cdp_cmd("Browser.grantPermissions",
                              {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]})
        except Exception:
            pass
        w = d.execute_cdp_cmd("Runtime.evaluate", {
            "expression": _clip_expr(b64, mt),
            "awaitPromise": True, "returnByValue": True, "userGesture": True,
        })
        wv = (w.get("result") or {}).get("value")
        if wv == "ok":
            _cursor_body_end(d, body_path)
            time.sleep(0.3)
            ActionChains(d).key_down(Keys.CONTROL).send_keys("v").key_up(Keys.CONTROL).perform()
            if _wait_more_images(d, body_path, before, 12):
                return True
            notes.append("img:B무반응")
        else:
            notes.append(f"img:B {wv}")
    except Exception as e:
        notes.append(f"img:B {e}")
    return False


def _insert_quote(d, paths, text, notes, state):
    """인용구 박스(세로줄 우선)를 만들고 그 안에 문장을 넣는다. 실패하면 일반 문단으로."""
    body_path = _cur_path(state, paths)
    _cursor_body_end(d, body_path)
    _enter(d, body_path)  # 인용 앞 여백
    applied = False
    try:
        path, pair = _find_in_frames(d, JS_QUOTE_BTN)
        if pair:
            btn, arrow = pair[0], pair[1]
            _cursor_body_end(d, body_path)
            _goto(d, path)
            opened = False
            if arrow is not None:
                arrow.click()
                time.sleep(0.6)
                opt = d.execute_script(JS_QUOTE_STYLE)
                if opt is not None:
                    opt.click()
                    time.sleep(0.6)
                    opened = True
            if not opened:
                btn.click()
                time.sleep(0.6)
                opt = d.execute_script(JS_QUOTE_STYLE)
                if opt is not None:
                    opt.click()
                    time.sleep(0.6)
            # 커서가 새 빈 박스 안 → 그 자리에 입력하고 '실제로 들어갔는지' 확인
            # 1차: trusted insertText (박스를 진짜 클릭으로 만들었으니 포커스가 박스 안)
            _goto(d, body_path)
            try:
                ActionChains(d).send_keys(text).perform()
            except Exception:
                pass
            time.sleep(0.25)
            if int(d.execute_script(JS_QUOTE_LASTLEN)) > 0:
                applied = True
            else:
                _insert_text(d, text)
                time.sleep(0.25)
                applied = int(d.execute_script(JS_QUOTE_LASTLEN)) > 0
            if not applied:
                # 2차: 에디터 안 execCommand 타이핑
                d.execute_async_script(JS_TYPE_HERE, text)
                time.sleep(0.25)
                applied = int(d.execute_script(JS_QUOTE_LASTLEN)) > 0
                if not applied:
                    notes.append("인용:문장입력무반응")
            if applied:
                # 출처칸에 같은 문장이 복제됐으면 비운다
                cite = d.execute_script(JS_QUOTE_CITE, text)
                if cite is not None:
                    cite.click()
                    time.sleep(0.2)
                    _select_all_delete(d)
            # 박스 밖으로 탈출 (본문 진짜 클릭 + 아래 방향키)
            _cursor_body_end(d, body_path)
            _press(d, Keys.ARROW_DOWN)
            time.sleep(0.15)
        else:
            notes.append("인용:버튼못찾음")
    except Exception as e:
        notes.append(f"인용:{e}")
    if not applied:
        _type_text(d, paths, text, notes, state)  # 문장을 일반 문단으로라도 남긴다
    _enter(d, _cur_path(state, paths))
    return applied


def _attach_map(d, body_path, academy_name, notes, log):
    """장소(지도) 첨부 — 실패하면 Esc 로 닫고 아무것도 넣지 않는다 (엉뚱한 지도 방지)."""
    log("지도(장소) 첨부 중…")
    try:
        path, btn = _find_in_frames(d, JS_MAP_BTN)
        if btn is None:
            notes.append("지도:장소버튼없음")
            return False
        _focus_body_end(d, body_path)
        _goto(d, path)
        btn.click()
        time.sleep(1.5)
        spath, sinput = _find_in_frames(d, JS_MAP_SEARCH)
        if sinput is None:
            notes.append("지도:검색창없음")
            _press(d, Keys.ESCAPE)
            return False
        sinput.click()
        time.sleep(0.25)
        _insert_text(d, academy_name)
        time.sleep(0.25)
        _press(d, Keys.ENTER)
        time.sleep(2.2)
        rpath, item = _find_in_frames(d, JS_MAP_RESULT, academy_name[:4])
        if item is None:
            notes.append(f"지도:검색결과없음({academy_name})")
            _press(d, Keys.ESCAPE)
            return False
        item.click()
        time.sleep(1.0)
        cpath, cf = _find_in_frames(d, JS_MAP_CONFIRM)
        if cf is None:
            notes.append("지도:확인버튼없음")
            _press(d, Keys.ESCAPE)
            return False
        cf.click()
        time.sleep(1.4)
        return True
    except Exception as e:
        notes.append(f"지도:{e}")
        try:
            _press(d, Keys.ESCAPE)
        except Exception:
            pass
        return False


def _do_publish(d, mode, when, notes, log):
    """mode: 'now' | 'reserve', when: 'YYYY-MM-DDTHH:MM' (reserve 일 때)"""
    log("예약 발행 처리 중…" if mode == "reserve" else "발행 중…")
    path, op = _find_in_frames(d, JS_PUBLISH_OPEN)
    if op is None:
        notes.append("발행:상단버튼없음")
        return "발행 버튼을 못 찾았어요 — 크롬 창에서 직접 발행해 주세요"
    _goto(d, path)
    op.click()
    time.sleep(1.5)

    if mode == "reserve":
        rpath, rr = _find_in_frames(d, JS_RESERVE_RADIO)
        if rr is None:
            notes.append("발행:예약버튼없음")
            return "발행창은 열렸어요. 예약 시간을 직접 고르고 발행을 눌러주세요"
        _goto(d, rpath)
        rr.click()
        time.sleep(0.8)

        date_s, time_s = (when.split("T") + [""])[:2]  # "YYYY-MM-DD", "HH:MM"
        hh, mm = (time_s.split(":") + ["0"])[:2]
        set_ok = False
        fpath, fields = _find_in_frames(d, JS_RESERVE_FIELDS)
        inputs, selects = (fields or [[], []])[0], (fields or [[], []])[1]
        for el, meta in inputs:
            try:
                el.click()
                time.sleep(0.2)
                is_time = bool(re.search(r"time|시|분|:", meta, re.I))
                val = time_s if is_time else date_s
                _select_all_delete(d)
                _insert_text(d, val)
                time.sleep(0.2)
                set_ok = True
            except Exception:
                pass
        # 시/분 드롭다운(select)이면 옵션 텍스트/값으로 맞춘다 (분은 10분 단위 내림)
        try:
            from selenium.webdriver.support.ui import Select
            mm10 = str(int(mm) // 10 * 10).zfill(2)
            for k, (el, _meta) in enumerate(selects[:2]):
                want = [hh, str(int(hh))] if k == 0 else [mm10, str(int(mm10))]
                sel = Select(el)
                for o in sel.options:
                    if o.get_attribute("value") in want or o.text.strip().rstrip("시분") in want:
                        sel.select_by_visible_text(o.text)
                        set_ok = True
                        break
        except Exception:
            pass
        if not set_ok:
            # 시간 입력칸을 못 다뤘으면 안전하게 멈춤 (엉뚱한 시간 자동발행 방지)
            notes.append(f"발행:예약시간칸못찾음 in{len(inputs)} sel{len(selects)}")
            return "예약창을 열고 '예약'을 선택했어요. 시간만 직접 맞추고 발행을 눌러주세요"
        time.sleep(0.5)

    cpath, cf = _find_in_frames(d, JS_PUBLISH_CONFIRM)
    if cf is None:
        notes.append("발행:확정버튼없음")
        return "발행창은 열렸어요. 마지막 발행 버튼만 직접 눌러주세요"
    _goto(d, cpath)
    cf.click()
    time.sleep(2.5)
    return "예약됨! 그 시간에 네이버가 자동 발행합니다 (컴퓨터를 꺼도 됩니다)" if mode == "reserve" else "발행 완료!"


def _save_draft(d, notes, log):
    log("임시저장 중…")
    path, btn = _find_in_frames(d, JS_SAVE_BTN)
    if btn is None:
        notes.append("저장:버튼없음")
        return "저장 버튼을 못 찾았어요 — 크롬 창에서 '저장'을 직접 눌러주세요"
    _goto(d, path)
    btn.click()
    time.sleep(2)
    return "임시저장 완료! 네이버 '저장 글'에서 확인 후 발행하세요"


def post(title, body, image_paths=None, footer_path=None, publish_mode="draft",
         publish_when="", academy_name="", try_map=False, log=print):
    """글 한 편을 네이버 글쓰기 화면에 입력하고 임시저장/발행/예약발행한다.
    publish_mode: 'draft'(임시저장) | 'now'(바로 발행) | 'reserve'(예약 발행)
    body 규칙은 확장과 동일: [이미지N] 줄 = 사진 자리, [인용] 문장 = 인용구."""
    image_paths = image_paths or []
    notes = []
    d = get_driver()
    paths = _open_writer(d, log)          # 본문칸이 있는 '모든' 후보 프레임
    state = {}                            # 실제로 먹히는 (프레임, 입력방식) 기억

    # 크롬 창을 앞으로 — 창이 뒤에 있으면 에디터가 키 입력을 무시할 수 있다
    _bring_front(d)
    log("⚠ 입력이 끝날 때까지 크롬 창과 마우스·키보드를 건드리지 마세요!")
    time.sleep(0.5)

    title_ok = _fill_title(d, paths[0], title, notes, log) if title else False

    # 본문을 세그먼트로: 텍스트 / [이미지N] / [인용] (확장 background.js 와 같은 규칙)
    img_re = re.compile(r"^\[이미지\s*(\d+)\]\s*$")
    quote_re = re.compile(r"^\[인용\]\s*(.*)$")
    segs, buf = [], []
    for raw in (body or "").split("\n"):
        line = raw.strip()
        m_img, m_q = img_re.match(line), quote_re.match(line)
        if m_img:
            if buf:
                segs.append(("text", buf)); buf = []
            segs.append(("img", int(m_img.group(1)) - 1))
        elif m_q:
            if buf:
                segs.append(("text", buf)); buf = []
            segs.append(("quote", m_q.group(1)))
        elif line != "":
            buf.append(line)
        elif buf and buf[-1] != "":
            buf.append("")  # 문단 사이 빈 줄 (한 번만)
    if buf:
        segs.append(("text", buf))

    log("본문 입력 중… (크롬 창에 실시간으로 써집니다)")
    img_ok = img_total = 0
    _cursor_body_end(d, paths[0])
    for kind, val in segs:
        if kind == "text":
            for line in val:
                if line == "":
                    _enter(d, _cur_path(state, paths))
                    continue
                if not _type_text(d, paths, line, notes, state):
                    raise RuntimeError(
                        "본문이 안 써졌어요. 크롬 창을 건드리지 말고 다시 시도해 주세요.\n"
                        "진단: " + " | ".join(notes[-6:]))
                _enter(d, _cur_path(state, paths))
        elif kind == "quote":
            log("인용구 넣는 중…")
            _insert_quote(d, paths, val, notes, state)
        else:
            if 0 <= val < len(image_paths):
                img_total += 1
                log(f"사진 {val + 1} 넣는 중…")
                if _insert_image(d, _cur_path(state, paths), image_paths[val], notes):
                    img_ok += 1
                _cursor_body_end(d, _cur_path(state, paths))  # 이미지 뒤 커서 복귀

    # 하단 연락처 배너 (글 맨 끝)
    if footer_path:
        log("하단 연락처 배너 넣는 중…")
        bp = _cur_path(state, paths)
        _cursor_body_end(d, bp)
        _enter(d, bp)
        if not _insert_image(d, bp, footer_path, notes):
            notes.append("배너:실패")
        _cursor_body_end(d, bp)
        _enter(d, bp)

    # 지도(장소) 첨부 — 설정에서 켠 경우에만 (실험 기능)
    map_note = ""
    if try_map and academy_name:
        ok = _attach_map(d, _cur_path(state, paths), academy_name, notes, log)
        map_note = "지도 첨부됨 (위치 확인)" if ok else f"지도 자동첨부 실패 — '장소' 버튼에서 '{academy_name}' 직접 검색"

    # 마무리: 발행 방식대로
    if publish_mode == "draft":
        pub_note = _save_draft(d, notes, log)
    else:
        pub_note = _do_publish(d, "reserve" if publish_mode == "reserve" else "now",
                               publish_when, notes, log)

    d.switch_to.default_content()
    result = []
    result.append("제목·본문 입력 완료" if title_ok else "본문 입력 완료 (제목은 직접 확인해 주세요)")
    if img_total:
        result.append(f"사진 {img_ok}/{img_total}장")
    if map_note:
        result.append(map_note)
    result.append(pub_note)
    if notes:
        result.append("진단: " + " | ".join(notes[-6:]))
    return "\n".join(result)
