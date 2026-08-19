# 더몬스터학원 블로그 자동화

주제 한 줄을 넣으면 더몬스터학원 양식의 네이버 블로그 글 + 이미지 + 썸네일을 만들고,
네이버에 **임시저장**까지 해주는 도구입니다. (발행은 사람이 마지막에 직접 확인 후 누름)

## 설치

### 윈도우 — 한 줄 자동 설치 (권장)

**윈도우키 + R** → `cmd` → Enter → 아래 한 줄을 통째로 붙여넣고 Enter:

```
mkdir C:\blog-desktop 2>nul & cd /d C:\blog-desktop & curl.exe -L -o install-desktop.bat "https://raw.githubusercontent.com/themonsteredu/monster-blog/main/install-desktop.bat" & install-desktop.bat
```

파일이 `C:\blog-desktop`에 자동으로 받아지고 프로그램이 바로 켜집니다.
파이썬이 없는 컴퓨터면 파이썬 다운로드 페이지가 대신 열립니다 —
설치할 때 **"Add python.exe to PATH" 체크**를 꼭 켜고, 끝나면 `C:\blog-desktop`의
`install-desktop.bat`을 더블클릭하면 이어서 설치됩니다.

업데이트도 같은 방법: `install-desktop.bat` 더블클릭 (설정은 그대로 유지됩니다).

### 수동 설치

```bash
pip install -r requirements.txt
```

네이버 임시저장(로봇) 단계는 크롬 브라우저가 필요합니다.

## 실행

```bash
streamlit run app.py
```

## 사용 순서

1. **⚙️ 설정** 탭 — Claude / OpenAI API 키, 네이버 계정, 썸네일 배경(.png)·폰트(.ttf) 경로 입력 후 저장
2. **✍️ 글 만들기** 탭 — 글 종류·주제·키워드·핵심 내용 입력 → "글 생성"
3. **🖼️ 이미지·썸네일** 탭 — 본문 이미지·썸네일 생성
4. **🚀 네이버 올리기** 탭 — 임시저장 실행 → 네이버에서 직접 확인 후 발행

## 파일 구성

| 파일 | 역할 | 도구 |
|------|------|------|
| `app.py` | 전체 화면(탭) | Streamlit |
| `generator.py` | 글 생성 | Anthropic Claude |
| `images.py` | 이미지 생성 | OpenAI gpt-image-1 |
| `thumbnail.py` | 고정 패턴 썸네일 | Pillow |
| `naver_robot.py` | 네이버 임시저장 | Selenium |
| `전용틀.md` | 글 작성 규칙(말투·구조·학원 소개·SEO) | — |
| `계획.md` | 전체 구상·계획 문서 | — |

자세한 설계·한계·배포 계획은 `계획.md`를 참고하세요.

## 보안 메모

- API 키와 네이버 비밀번호는 `settings.json`(이 컴퓨터)에만 저장되며 외부로 전송되지 않습니다.
- `settings.json`과 `output/`은 `.gitignore`로 제외되어 깃에 올라가지 않습니다.
- 학생 등 미성년자 사진은 보호자 동의 없이 공개·업로드하지 않습니다.
