# 0.5.20 실제 로컬 적용과 프로젝트 전환 확인

## 적용 전 작업 상태

- 기존 LLM 메인 PID 43240의 모델/Git 자식 프로세스가 없는 것을 재확인한 뒤 정상 Alt+F4로 종료했다. 강제 종료·취소·재요청은 하지 않았다.
- RFG는 2026-10-12 18:24 KST 최종 결론 `cc8917e7-f399-48fd-af9a-a19b289dcb79`까지 저장돼 있었다.
- 타로2는 2회차 Codex CLI 로그 `72503faa-39b0-43bb-95b9-659b592eea01.jsonl`의 18:47 KST `turn.failed`에서 `Selected model is at capacity. Please try a different model.`로 종료됐다. Claude 2회차 답변은 18:36 KST 저장됐다. **토론 성공 완료가 아니라 오류 종료이며 최종 결론은 없다.** 이 실패 기록을 변경하거나 토론을 재시작하지 않았다.
- 국호의 현재 요청도 CLI가 종료된 상태였고, 별도 원래 Codex/Claude 데스크톱과 다른 앱 프로세스는 종료하지 않았다. 오래된 미완결 요청을 실행 중이라고 소급 추정하지 않았다.

## 실제 적용 증거

사용자가 실행하던 고정 portable 경로를 사용했다. 기존 파일은 `work/apply-0.5.20-20261012/LLM Collaboration before 0.5.20.exe`에 보존했다.

| 항목 | 확인값 |
|---|---|
| 실행 launcher | `D:\02_CodexAI\03_LLMcollaboration\portable\LLM Collaboration.exe` |
| 이전 launcher SHA256 | `322051874ca87ad56454ab3fba118fda393644f68032418402280c20ec468d93` |
| 적용 launcher SHA256 | `63712d7998b8d41b614ddd0f65948b94297fb196813ee3600363428010e4bfe1` |
| 실제 FileVersion/ProductVersion | `0.5.20` |
| launcher / main PID | 19128 / 46748 |
| 실행된 추출 경로 | `C:\Users\RAONOLJE\AppData\Local\Temp\3KaeCvrr3tdX3h3Z4ctTWORwNwe\LLM Collaboration.exe` |
| 실행 ASAR 버전 | `0.5.20` |
| 실행 ASAR SHA256 | `0ca2d0dc01f473cd037ebc9e2ff88b45916a15eec77254a52dba9340cf22d2c2` |
| 실행 ASAR / 검증 패키지 비교 | `release/cli-state-20261012/win-unpacked/resources/app.asar`와 바이트 일치 |

portable 압축 해제 때문에 공식 Computer Use의 첫 launch 호출에는 “targetable window 없음”이 반환됐으나, 후속 창/프로세스 재조회로 새 앱 실행을 확인했다. 중복 실행을 반복하지 않았다.

## 모바일 서버

기존 서버 주소/접근 코드를 변경하지 않았다. 서버의 공개 정적 HTML과 JS만 읽었고 Bearer API 호출이나 토큰 재발급은 하지 않았다.

- 현재 서버 소유 PID: 46748, 포트 48721.
- 정적 HTML 및 JS HTTP 200.
- 제공 번들: `/_expo/static/js/web/AppEntry-2b44abbd1214498cdfa1dc4fa502a32d.js`.
- 제공 JS SHA256: `9ea95d29ff16aecc7d8fc21954e09b8f237b4dbc87b6a152845d8fca65289794`.
- 검증된 모바일 빌드와 일치. **iPhone 실기기 확인은 수행하지 않았다.**

## 실제 화면 검증

공식 Computer Use로 원본 프로젝트의 버튼을 사용했다. 새 업무나 토론 메시지를 송신하지 않았다.

| 경로 | 실제 확인 |
|---|---|
| 국호 → RFG → 국호 | 양쪽 상태 카드가 각각 “현재 CLI 작업 없음”, 사이드바에서도 각 모델 상태 유지 |
| 타로2 정상 기존 프로젝트 재연결 | 원본 `C:\Users\RAONOLJE\Downloads`의 프로젝트 ID `95aa7b8a-dd16-477e-96c8-63df3fa1d488` 재사용. 새 프로젝트로 대체하지 않음 |
| 국호 → 타로2 | 현재 프로필 ID와 기존 타로2 세션의 host ID가 달라 앱의 정상 openProject가 초기 연결 확인 호출 2건을 자동 수행. 업무/토론 재실행 아님 |
| 타로2 → RFG | 타로2 Codex·Claude의 “이번 응답 완료” 상태가 사이드바에 남고 RFG의 양쪽 “현재 CLI 작업 없음” 유지 |
| RFG → 타로2 재방문 | 두 모델의 완료 상태 및 마지막 활동/PID 필드 유지, 다시 사라지지 않음. 재방문에서 초기 호출 반복 없음 |

초기 확인의 PID는 Codex 1476, Claude 9072이며 두 응답은 19:38:55/19:39:00 KST에 정상 저장됐다. 화면에서 완료 상태를 확인했다. 호출이 짧아 **실제 진행 중 화면을 별도로 재현했다고 주장하지 않는다.** 진행 중·대기·맥락 압축·취소 요청/완료·실패·2시간 유지의 검증은 앞선 91개 자동 테스트 및 로컬 shim 검증이다. 현재 완료 배지는 초기 연결 응답의 완료이며, 이전 타로2 원고 토론 전체 완료를 뜻하지 않는다.

## 데이터·초안 보존

- 화면 목록과 디스크 등록 목록의 차이를 확인했다. 기존 프로젝트 연결의 정상 폴더 선택 경로로 타로2 등록을 복구했다. 국호/RFG/QA 등 기존 등록은 삭제하지 않았다.
- 원본 작업 폴더·Word 파일·기존 프로젝트 ID를 삭제/이동/초기화하지 않았다.
- 국호/RFG의 project/tasks/events 파일과 타로2 tasks 파일은 적용 전 해시와 같다. 타로2 기존 9개 이벤트 전문의 prefix SHA256이 적용 전 전체 해시와 일치한다. 새 앱의 자동 초기 확인 2건만 추가됐다. 타로2 project.json은 정상 앱 동작으로 현재 호스트 세션 2개와 갱신 시각이 추가됐고 이전 세션은 보존됐다.
- `remote-settings.json`과 `session-host-id`는 적용 전후 바이트 해시가 같다. QR/접근 코드/원격 보안 설정을 바꾸지 않았다.
- 실패 후 입력창에 돌아와 있던 사용자 요청을 정확히 캡처·보관하고 타로2 입력창에 복원했다. 송신하지 않았다. 대상 both, Codex GPT-6.1-Sol/max, Claude opus/max, 토론 켜짐·2회 왕복을 기존 화면과 맞췄다.
- 호환되는 update-draft를 저장해 전환에 대비했고, 실제 GUI에서 동일한 초안 복원을 확인한 뒤 복구 helper로 임시 파일만 정리했다. 초안 사본은 work의 `saved-draft.json`에 보존했다.
- 기존 미커밋 소스는 수정·원복하지 않았다. 제품 실행 파일과 local evidence/report만 이번 적용 단계에서 변경했다.

## 근거 자료와 종료

`work/apply-0.5.20-20261012/`의 `baseline-hashes.json`, `after-hashes.json`, `saved-draft.json`, `ui-checks.json`, `mobile-served-evidence.json`, `profile-before/`에 로컬 근거를 남겼다. profile 사본의 접근 코드는 공개하지 않았다.

현재 앱은 0.5.20으로 실행된 채 유지했다. 공식 Computer Use의 입력 작업을 종료했다. 다른 앱·서버·브라우저 탭에는 종료 명령을 보내지 않았다. iPhone 실기기·과거 오류 상태의 재시작 후 자동 복원·새 업무 중 상태의 실제 생성 검증은 수행하지 않았다.
