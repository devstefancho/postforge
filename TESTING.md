# PostForge Testing Checklist

## 1. Server 기본 동작

- [x] `npm run dev`로 서버 시작 시 `http://localhost:8788` 정상 리스닝
- [x] 첫 실행 시 `data/postforge.db` 자동 생성
- [x] 첫 실행 시 마이그레이션 자동 적용 (콘솔 로그 확인)
- [x] 두 번째 실행 시 마이그레이션 중복 실행 안 됨

## 2. Post API

### 생성
- [x] `POST /api/posts` — 새 포스트 생성 → `201` + `isNew: true`
- [x] slug 유효성 검사: 대문자/특수문자 포함 시 `400` 에러
- [x] title 없이 요청 시 `400` 에러
- [x] Authorization 헤더 없이 요청 시 `401` 에러

### 조회
- [x] `GET /api/posts` — Published 포스트만 반환 (Draft 제외)
- [x] `GET /api/posts?drafts=true` — Draft 포함 전체 반환
- [x] `GET /api/posts?category=blog` — 카테고리 필터링
- [x] `GET /api/posts/:slug` — 단건 조회 (content 포함)
- [x] `GET /api/posts/:slug` — 없는 slug 요청 시 `404`
- [x] tags 필드가 JSON 배열로 파싱되어 반환

### 수정
- [x] 같은 slug로 `POST /api/posts` → `isNew: false` + `updated_date` 설정됨
- [x] isDraft 값 변경 (Draft → Published, Published → Draft)

### 삭제
- [x] `DELETE /api/posts/:slug` → `200` + 포스트 삭제 확인
- [x] 삭제 시 연관 이미지 파일도 함께 삭제됨
- [x] 없는 slug 삭제 시 `404`

## 3. Tags API

- [x] `GET /api/posts/tags` — Published 포스트의 태그만 수집
- [x] 중복 태그 제거 + 알파벳 정렬
- [x] Draft 포스트의 태그는 포함되지 않음

## 4. Image API

### 업로드
- [x] `POST /api/images/upload` — base64 이미지 업로드 성공
- [x] `data/images/posts/{slug}/{filename}` 경로에 파일 저장 확인
- [x] slug/filename/data 누락 시 `400` 에러
- [x] Authorization 없이 요청 시 `401`

### 서빙
- [x] `GET /api/images/posts/{slug}/{filename}` — 이미지 정상 반환
- [x] Content-Type 헤더가 파일 확장자에 맞게 설정 (png → image/png)
- [x] Cache-Control 헤더 설정 확인
- [x] 없는 이미지 요청 시 `404`

## 5. Desktop App (Electron)

### 앱 시작
- [x] `cd desktop && npm start`로 앱 실행 (크래시 없음)
- [x] 앱 시작 시 Express 서버 자동 시작 (localhost:8788)
- [x] 대시보드가 기본 화면으로 표시

### 대시보드
- [x] 포스트 카드 그리드 정상 렌더링
- [x] "All Posts" 필터 — 전체 포스트 표시
- [x] "Drafts" 필터 — Draft만 표시
- [x] "Published" 필터 — Published만 표시
- [x] 검색 — 제목/slug/설명으로 필터링
- [x] "Create New Post" 버튼 → 에디터로 이동
- [x] 포스트 카드 클릭 → Read-only 뷰로 이동
- [ ] Hero 이미지가 있는 카드에 썸네일 표시 *(이미지 업로드 UI 테스트 미진행)*

### Read-only 뷰
- [x] 포스트 제목/카테고리/날짜/태그 표시
- [x] 마크다운 본문 렌더링
- [ ] Hero 이미지 표시 *(이미지 업로드 UI 테스트 미진행)*
- [x] "Edit" 버튼 → 에디터로 전환 (데이터 로드)
- [x] "Delete" 버튼 → 확인 다이얼로그 → 삭제 → 대시보드로 이동
- [x] "← Dashboard" 버튼으로 돌아가기

### 에디터
- [x] 제목/slug/카테고리/설명 입력
- [x] 태그 추가 (Enter) / 삭제 (×)
- [x] 태그 자동완성 (기존 태그 제안)
- [x] 마크다운 Edit/Preview 탭 전환
- [x] Preview에서 마크다운 정상 렌더링
- [ ] Hero 이미지 업로드 (Choose File 버튼) *(네이티브 다이얼로그 - 자동 테스트 제한)*
- [ ] 이미지 드래그 앤 드롭 → 마크다운 삽입 *(드래그 - 자동 테스트 제한)*
- [x] "Save Draft" → Draft로 저장 (is_draft=1)
- [x] "Publish" → Published로 저장 (is_draft=0)
- [x] 저장 후 성공 메시지 표시
- [x] "← Dashboard" 버튼으로 돌아가기
- [ ] localStorage 자동 저장/복원 *(간접 확인)*

### 키보드 단축키
- [x] Cmd+N — 새 포스트 (에디터)
- [x] Cmd+S — 저장 *(Publish 테스트로 확인)*
- [ ] Cmd+O — 포스트 불러오기 다이얼로그
- [x] Cmd+D — 대시보드로 이동 *(← Dashboard 버튼으로 확인)*
- [x] Cmd+, — Settings 다이얼로그

### Settings
- [x] Local / Production 환경 전환
- [x] API Base URL 설정
- [x] API Token 설정
- [x] 설정 저장 후 env badge 업데이트
- [ ] 앱 재시작 시 설정 유지 *(Electron config 파일에 저장됨 확인)*

## 6. Edge Cases

- [x] 포스트 0개 상태에서 대시보드 empty state 표시
- [x] 매우 긴 제목의 포스트 생성/저장 정상 동작
- [x] 동시에 같은 slug로 중복 생성 시도 → 에러 없이 update 처리
- [x] 대용량 이미지 업로드 (5MB) 정상 동작
- [x] 서버 미실행 상태에서 connection refused

## 버그 수정 내역

- **[FIXED]** `newPost()` 호출 시 Preview 탭이 활성화된 상태면 이전 내용이 남는 버그 → Edit 탭으로 리셋 추가
