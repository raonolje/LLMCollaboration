# 실제 CLI 작업 상태 표시 수정 — 0.5.20

## 실제 적용 추기

사용자 승인에 따라 작업 종료/오류 종료를 확인한 뒤 고정 portable 경로에 0.5.20을 적용하고 실행했다. 프로젝트 전환·완료/유휴 상태·초안/설정 복원·모바일 제공 번들 일치와 원본 보존을 실제 확인했다. 아래 “현재 앱에 미적용”은 수정본 준비 당시 기록이며 최신 상태는 [APPLY-0.5.20-2026-10-12.md](APPLY-0.5.20-2026-10-12.md)의 실제 적용 결과를 따른다.

## 확정 원인

기존 `src/renderer/PendingReply.tsx`의 `maximumAge = 60 * 60_000`과 `if (clockMs - started >= maximumAge) return null` 때문에 요청 1시간 후 표시가 무조건 사라졌다. 실제 CLI 종료·중단과 관계없는 UI 제한이었다. 타로2 16:53 요청의 표시가 17:53 이후 사라진 직접 원인이다. 직전 진단의 “정확한 renderer 전환 미확정”을 이 코드 확인으로 보완한다.

## 수정

- 시간에 따른 숨김 및 채팅 답변만으로 실행을 추정하는 조건을 제거했다.
- 메인 `ModelActivities`가 프로젝트 경로·모델·호출 ID·업무 ID·단계·PID·시작/마지막 출력 시각을 관리한다. 상태는 대기/연결/실행/저장/취소 요청/취소 완료/오류/응답 완료이다.
- 실제 CLI 시작, stdout/stderr 스트림, 도구 실행, thinking 신호, 맥락 압축, 공급자 제한, 종료를 연결했다. 모델의 추론 본문·프롬프트·도구 입력은 상태 API로 전달하지 않는다.
- 취소 요청만으로 종료됐다고 표시하지 않는다. CLI close 확인 후 취소 완료로 구분한다. 시간만으로 멈춤을 추정하거나 모델을 자동 종료하지 않는다.
- `listModelActivities` IPC와 기존 인증을 사용하는 `/v1/model-activities` API를 추가했다. QR/접근 코드 발급·저장·원격 설정은 변경하지 않았다.
- PC/모바일은 2초마다 상태를 조회한다. 프로젝트 전환과 무관하게 전체 상태를 유지하고, PC 사이드바에서도 각 프로젝트·모델 상태를 표시한다.
- PC 상태 카드는 채팅 스크롤 밖에 고정한다. 1시간이 넘어도 유지된다. 진행 단계, 경과 시간, 마지막 CLI 활동 시각을 보여 준다.
- 상태 조회가 10초 안에 응답하지 않으면 연결 불명으로 표시한다. 이는 화면 조회 제한이며 CLI 요청을 취소하지 않는다. 중복 조회가 누적되지 않도록 처리했다.
- 완료/취소/오류는 최신 상태로 남는다. 터미널 상태 기록은 최대200개 보존하며 활성 호출을 잘라내지 않는다. 서비스 메모리 상태이므로 앱 종료 이후의 과거 활동을 재구성한다고 보장하지 않는다.
- 보관된 작업 사본의 테스트가 잘못 실행되지 않도록 Vitest 범위를 `tests/**/*.test.{ts,tsx}`로 지정했다. 원본 테스트를 삭제/비활성화하지 않았다.

## 검증

| 검사 | 결과 |
|---|---|
| 전체 자동 회귀 | 16개 파일, 91개 테스트 통과 |
| 메인/renderer/모바일 타입 검사 | 통과 |
| 공식 build 및 Windows NSIS/portable | 통과 |
| 3개 프로젝트·양쪽 모델 독립 상태 | 상태 저장소/컴포넌트 SSR 통과 |
| 2시간 경과 표시 유지 | SSR 통과 |
| 실제 CLI shim 시작/출력/종료 콜백 | 로컬 shim 테스트 통과 |
| 2개 임시 프로젝트 실행·완료·취소 상태 | 주입 모델 서비스 통합 테스트 통과 |
| 모바일 API 인증 및 상태 응답 | 분리된 로컬 서버 테스트 통과 |
| UI 조회 단절과 모델 취소 분리 | 통과 |
| 패키지 내 상태 코드·모바일 파일 일치 | 바이트 검사 통과 |
| 실행 중 사용자 앱 전환/새 모델 토론/실기기 | 수행하지 않음 |

결과 자료는 `work/cli-state-20261012/vitest-results.json`, `package-evidence.json`에 있다. 첫 검사에서는 과거 `work/local-apply-20261002/source-backup`의 불완전한 검사 사본도 검색돼 0-test import 오류가 발생했다. 테스트 경로를 정본 tests 폴더로 제한한 뒤 전체 91개를 다시 실행해 통과했다.

## 산출물과 적용 상태

- Portable: `release/cli-state-20261012/LLM Collaboration 0.5.20.exe`
- 설치 파일: `release/cli-state-20261012/LLM Collaboration Setup 0.5.20.exe`
- Portable SHA256: `63712d7998b8d41b614ddd0f65948b94297fb196813ee3600363428010e4bfe1`
- 모바일 번들: `AppEntry-2b44abbd1214498cdfa1dc4fa502a32d.js`
- 모바일 SHA256: `9ea95d29ff16aecc7d8fc21954e09b8f237b4dbc87b6a152845d8fca65289794`

실행 중인 0.5.19의 메인 프로세스·추출 ASAR·CLI·프로젝트 데이터를 교체하거나 종료하지 않았다. 따라서 **소스 수정/검증/새 실행 파일 준비 완료이며 현재 앱에 적용 완료는 아니다.** 현재 메인 프로세스는 새 상태 API를 동적으로 로드하지 않는다. 작업을 강제로 끊지 않기 위해 앱 전환을 보류했다. 사용자 원본은 변경하지 않았고 실제 토론 재요청/외부 공개/과금 생성도 없다.

이번 변경 파일: `src/shared/model-activity.ts`, `activity-query.ts`, `types.ts`, `src/main/services/model-activities.ts`, `cli.ts`, `index.ts`, `src/main/main.ts`, `preload.ts`, `remote.ts`, `src/renderer/PendingReply.tsx`, `App.tsx`, `styles.css`, `mobile/App.tsx`, `package.json`, `package-lock.json`, `vitest.config.mts`, `tests/model-activities.test.tsx`, `cli.test.ts`, `service.test.ts`, `remote.test.ts`. 기존 미커밋 변경을 보존했다.
