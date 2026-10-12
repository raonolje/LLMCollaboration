# LLM Collaboration 수정 검증 — 2026-10-02

## 범위와 보존

최신 사용자 지시에 따라 제작에 앞서 앱 수정만 진행했다. 시작 시 TEST-ISSUES의 I-01~I-09, 현재 소스와 미커밋 diff를 대조했다. 기존 버전 0.5.18과 미커밋 변경을 유지했고 원복/커밋하지 않았다.

국호·RFG 원본 프로젝트, 대화, 판정, 실패 기록은 수정하지 않았다. QR/접근 코드 생성·저장·재발급 로직은 이번 수정에서 변경하지 않았다. 실제 모델 토론, 생성 서비스, 설치, 현재 앱 종료·재시작, 배포, 공개/원격 발행은 실행하지 않았다. 자동 서비스 테스트는 주입된 가짜 모델과 임시 프로젝트만 사용한다.

## 항목별 결과

| 항목 | 반영 내용 | 검증 / 잔여 |
|---|---|---|
| I-01 전체 답변·표 중계 | 이견 목록으로 전문을 대체하는 분기 제거. 직전 양쪽 전문과 이견 함께 전달. 전체 회차는 SHA256 고정 스냅샷에 보존 | 기존 8,000자 경계 이후 양쪽 수정표가 다음 요청에 포함되는 서비스 회귀 통과. 실제 모델 읽기·수용은 새 토론 금지로 미실행 |
| I-02 국호 후보 수량 | 제품 결함과 제작자료 미확인 분리, 과거 수량·판정 보존 | 최대112장 상호 확인을 이번 코드 검사로 해결했다고 주장하지 않음 |
| I-03 Markdown | 모바일 native/web 공통 GFM 렌더러. 제목·강조·목록·표·코드·인용. 채팅/이력/모달/헌장/업무 설명 적용. 데스크톱 논쟁·저장 세션 적용 | RN Web 컴포넌트 SSR 통과. 표는 폭 제한과 내부 가로 스크롤. HTML 실행/원격 이미지 자동 요청 없음. 실기기·픽셀 검증은 아래 제한 |
| I-04 최종 결과 | 프로젝트 decision과 업무 debateSummary 대체 표시. 동일 결론 중복 제거, 새 저장 요약 별도 표시. 펼치기/모달 전문, 모바일 5항목 제한 제거 | 마지막 표·6번째 이후 항목·저장/후속 요약 보존 회귀 통과. 원본 데이터 불변 |
| I-05 실행 번들 | build에 모바일 타입 검사 추가. 모바일 export 및 로컬 패키징 확인 | ASAR 모바일 파일 6개와 context 코드가 로컬 빌드와 바이트 단위 일치. 열린 앱/모바일 탭은 전환 금지로 최신 반영 미검증 |
| I-06 첨부 누락/수량 혼입 | 자료 구성 문제로 분리. RFG 원본 첨부·이벤트 보존 | 제작자료 재작성·수량 재판정은 이번 범위에서 수행하지 않음 |
| I-07 보고 모델 | 요청의 “코덱스가 정리해서 보고”, “Claude 최종 요약” 반영. 미지정은 기존 Claude 기본값 | 실제 호출 provider/저장 actor의 가짜 모델 회귀 통과. 자연어 모든 변형을 이해하는 기능은 아님 |
| I-08 합의 판정 | 강조된 없음/범위 설명 지원. 양쪽 최신 응답과 최종 결론 모두 확인돼야 true. 미해결·불확실한 문구는 합의로 취급하지 않음 | true/false/null, 장식 문구, 미해결 혼합, 결론의 새 이견 회귀 통과. 과거 false 소급 수정 없음 |
| I-09 회차 교차 | 양쪽 호출 전에 동일한 이전 회차 스냅샷 고정. 업무 토론/평가에도 적용 | 다음 회차 양쪽 요청 해시 일치와 양쪽 표 포함 통과. 같은 회차 동시 답변은 다음 회차에 평가한다고 명시 |

## 맥락과 입력 제한

- 요청별 원문·표·사용자 요청·공통 기준은 `.llm-collaboration/contexts/<SHA256>.md`에 보존하는 경로를 추가했다. 이번에는 임시 테스트 데이터에서만 생성했다.
- 이벤트 ID로 중복 제거, 동일 내용 파일은 덮어쓰지 않음. 양쪽은 동일한 고정 스냅샷을 받는다.
- 직전 양쪽 전문 합계 48,000자 이하는 그대로 입력에 포함한다. 초과하면 잘린 내용을 전문이라고 표시하지 않고 완전한 파일의 읽기를 요청한다. 읽은 이벤트·표·파일 범위와 읽기 실패/부분 확인을 밝히도록 지시한다. 실제 모델의 읽기를 자동 테스트가 증명하지는 않는다.
- 목표/헌장 인라인 미리보기 각 4,000자, 합의/이견 보조 목록 각 6,000자 제한. 전문은 파일에 보존한다. 이는 문자 제한이며 모델별 토큰 한도 보장이 아니다.
- 업무 토론은 스냅샷을 전달할 때 최근 답변의 잘린 사본을 중복 삽입하지 않는다. 실행/검수의 기존 taskCard 동작은 유지한다.
- 합의를 누적 확정으로 고정하지 않고 직전 양쪽 공통 진술로 갱신, 새 근거의 철회/충돌을 명시하도록 한다.

## 기존 요청 / diff 대조

시작 시 이미 있던 아래 구현은 재구현하지 않고 보존했다. 자동 회귀를 실제 UI 전수 통과로 표현하지 않는다.

| 요청 | 상태 |
|---|---|
| PC/모바일 공통 탭·모바일 프로젝트 생성·고정/접기 입력창 | 기존 구현 보존 |
| 메시지별 펼치기/전체보기·지시별 최종 결과 | 데스크톱 기존 구현 보존, 모바일 전문/결과 보완 |
| 모델/effort 저장·프로젝트 복구/재연결 | 기존 구현과 자동 회귀 보존 |
| 개별/양쪽 송신·채팅에서 업무 생성·교차 검수 | 기존 구현 보존 |
| 프로젝트당 모델별 실행/논쟁 세션 재사용 | 기존 구현과 세션 회귀 보존 |
| 토론 횟수 선택·끝장 최대10회/조기 종료 | 기존 선택 보존, 중계/판정 보완 |
| 여러 첨부·선택/드롭/붙여넣기·용량 경계 | 기존 구현 보존. OS 드래그/이미지 클립보드·iPhone 실기기 검증 미실행 |
| CLI 원문·저장 세션·Claude Desktop 사본 | 기존 구현 보존. 사본을 자동 양방향 동기화로 표현하지 않음 |
| 대기/중단/재시도·모달·알림 | 기존 변경과 회귀 보존. 근거 없는 남은 시간 수치는 만들지 않음 |

## 최종 검증

| 검사 | 결과 |
|---|---|
| npm.cmd run build | 메인/renderer/모바일 타입 검사, 메인 TypeScript, Vite, Expo web export 통과 |
| npm.cmd test | **13개 파일 / 72개 테스트 모두 통과** |
| git diff --check | 통과. CRLF 변환 경고는 결함으로 집계하지 않음 |
| 로컬 Windows 디렉터리 패키징 | 통과. 설치/서명 배포본 생성이 아닌 포함 검사 |
| node scripts/verify-packaged-mobile.cjs | ASAR 모바일 6개 파일과 최신 context 코드 바이트 일치 통과 |
| 모바일 Markdown SSR | 제목·강조·목록·전체 표·추출 CSS의 max-width/overflow-x 검사 통과 |
| 실제 폭/확대·iPhone·열린 앱 UI | 미검증, 아래 제약 |

패키징 기본 시도는 Electron 다운로드 `connect EACCES`로 실패했다. 이미 설치된 로컬 Electron 44.4.5를 사용하여 다운로드 없이 확인했다:

```text
electron-builder --win --dir --publish never
  --config.directories.output=release/fix-verification-20261002
  --config.electronDist=node_modules/electron/dist
  --config.win.signAndEditExecutable=false
```

출력은 `release/fix-verification-20261002/win-unpacked/resources/app.asar`. 실행하지 않았다. 모바일 JS는 `AppEntry-4964abb84ac1fa382e155dfa287cb726.js`. 이는 열린 앱의 업데이트 완료 증거가 아니다.

검증 자료:

- `work/fix-verification-20261002/vitest-results.json`
- `work/fix-verification-20261002/package-evidence.json` — 모바일 파일별 SHA256
- `work/fix-verification-20261002/mobile-markdown.html` — 실제 RN Web 컴포넌트 SSR fixture

## 화면 검증 제약

320/375/430px와 125/150/200% 확인을 위해 사용자 데이터를 로드하지 않는 숨겨진 별도 Electron fixture를 시도했다. Chromium GPU 프로세스 종료 `-1073741515`와 `ERR_FAILED`로 문서 로딩에 실패했다. 작업 폴더 임시 프로필을 사용한 재시도도 실패했다. sandbox/webSecurity 해제나 보안 설정 변경으로 우회하지 않았다.

실제 뷰포트/확대 스크린샷, iPhone Safari/native, 현재 열린 앱 최종 UI는 **미검증**이다. SSR 구조 검사를 실제 화면 통과로 집계하지 않는다. 공식 Computer Use는 이번 작업에서 사용하지 않았고 다른 앱·서버·탭은 조작하지 않았다.

## 변경 파일

이번 추가/수정: `mobile/MarkdownText.tsx`, `mobile/results.ts`, `mobile/App.tsx`, `mobile/api.ts`, `src/main/services/discussion-context.ts`, `services/index.ts`, `services/prompts.ts`, `src/shared/debate-summary.ts`, `src/renderer/App.tsx`, `styles.css`, `package.json`, `package-lock.json`, `tests/discussion-context.test.ts`, `tests/mobile-markdown.test.tsx`, `tests/mobile-results.test.ts`, `tests/service.test.ts`, `scripts/check-markdown-layout.cjs`, `scripts/verify-packaged-mobile.cjs`, 이 보고 및 결함 기록.

시작 시 있던 main/preload/remote, conversation-import, shared/types, 기존 테스트 변경도 보존했다. 설치·재시작·배포·실제 모델 검증은 수행하지 않았으므로 전체 운영 검증 완료라고 하지 않는다.
