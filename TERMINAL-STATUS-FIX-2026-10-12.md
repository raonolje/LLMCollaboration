# 0.5.21 — 완료된 응답의 시간 표시 제거

## 변경

- 완료/실패/중단/작업 없음/상태 조회 단절에서는 경과 시간·마지막 신호 시간·PID를 숨긴다.
- 실제 연결된 활성 호출에만 1초 타이머를 등록하고, 활성 상태가 끝나면 interval을 정리한다.
- 활성 호출의 문구는 `마지막 CLI 신호 이후 N초 경과`로 변경했다. 기존 `N초 전`은 lastOutputAt이 N초 전이라는 뜻으로 계산 자체가 역방향인 것은 아니었으나 이중 시간 표시가 혼동을 만들었다.
- 프로젝트 초기 연결 응답은 `연결 확인 완료`, 실제 검토/토론 응답은 `이번 응답 완료`로 구분한다.
- 실패는 `응답 실패 · 재시도 필요`로 표시한다. CLI stdout의 error/turn.failed 메시지를 보존해 공급자 오류를 단순 프로세스 종료 문구로 가리지 않는다.
- 모바일 역시 완료 응답에 마지막 CLI 활동 시간을 붙이지 않는다.

## 타로2 실패 확인

`72503faa-39b0-43bb-95b9-659b592eea01.jsonl`은 Codex project-discussion-2 호출이다. 마지막 error 및 turn.failed 메시지는 `Selected model is at capacity. Please try a different model.`이다. 공급자가 선택된 모델의 처리 용량 부족을 반환한 것이며 UI 시간 제한이나 앱/이 에이전트의 취소 명령으로 종료한 것이 아니다.

Claude 같은 회차의 `731adc6e-4f2a-41d4-8964-36b0b95f8322.jsonl`은 result subtype=success, is_error=false로 끝났다. 답변은 18:36 KST에 저장됐다. Claude는 정상적으로 응답을 완료했고 해당 CLI 호출이 끝난 것이다. Codex 실패 때문에 후속 토론 회차/최종 결론은 진행되지 않았다. 대화·세션·성공한 Claude 답변을 삭제하지 않았다.

혼잡 실패에 대한 자동 재시도/대기 재개를 이번 변경에서 추가하지 않았고, 실패했던 실토론을 재요청하지 않았다. 다른 모델을 임의 선택하거나 추가 과금을 활성화하지 않았다.

## 검증 및 실제 적용

- 전체 16개 테스트 파일 / 93개 테스트 통과.
- 메인·renderer·모바일 타입 검사 및 공식 Windows portable/NSIS 빌드 통과.
- terminal 상태의 SSR 출력에 경과/마지막 CLI/PID가 없고 활성 상태에는 새 문구가 존재하는 회귀 통과.
- 로컬 Codex shim으로 stdout capacity 오류가 그대로 전달되는 회귀 통과. 실제 모델 요청을 테스트에 쓰지 않았다.
- 현재 LLM 메인 46748에 활성 CLI/Git 자식이 없는 것을 확인한 뒤 정상 종료했다. 입력 초안을 호환 recovery helper로 보존했다.
- 고정 실행 파일 `D:\02_CodexAI\03_LLMcollaboration\portable\LLM Collaboration.exe`를 0.5.21로 교체하고 실행했다. 0.5.20은 work/terminal-status-20261012에 보존했다.
- 실행 main PID 56984, 추출 경로 `C:\Users\RAONOLJE\AppData\Local\Temp\3Kak61Xcfeh1ns6hEq6LFCkJ1qe\LLM Collaboration.exe`.
- 실제 ASAR의 package version=0.5.21이고 검증 패키지와 바이트 일치.
- Portable SHA256 `a85c43eb4d63570a25a353c2bf5ea94d4a7d12336e6608ba299f2aba22023ab4`.
- ASAR SHA256 `a1c2619202c32df07e75c676beb44e9c0f88aaad86eaabd9fbfa7912d6985f37`.
- 공식 Computer Use 화면에서 두 모델이 `현재 CLI 작업 없음`, 시간/PID 필드는 0개임을 확인했다. 초안은 동일한 내용으로 자동 복원됐고 송신하지 않았다. 새 연결 확인 호출/새 토론은 생성하지 않았다.
- 완료/오류/취소 상태 자체의 화면은 자동 SSR 회귀로 확인했다. 현재 실제 앱에 해당 상태를 만들기 위한 새 모델 요청은 하지 않았다. iPhone 실기기 검증도 미실행이다.

자료: `work/terminal-status-20261012/vitest-results.json`, `saved-draft.json`, `applied-package.json`. 원본 제작 데이터와 기존 실패 기록, QR/원격 설정을 변경하지 않았다. 화면 제어를 종료했고 다른 앱·프로세스는 종료하지 않았다.
