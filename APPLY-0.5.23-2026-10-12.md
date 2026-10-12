# LLM Collaboration 0.5.23 최종 로컬 적용과 Git 반영

## 소스 및 검증

- 로컬 미커밋 변경 전체를 fef031f로 보존한 뒤 GitHub 원격 main의 ac10e85까지 병합했다. 충돌 파일은 각 원격 diff를 대조했고 원격의 업데이트/복구 수정이 이미 로컬 코드에 포함되어 있음을 확인했다. 병합 9e41253의 파일 트리는 fef031f와 동일하다. 원격 변경과 로컬 개발 이력을 모두 보존했다.
- GitHub `raonolje/LLMCollaboration`과 GitLab `raonolje/llmcollaboration`의 main에 9e41253 업로드 완료. 강제 푸시하지 않았다. 태그/공개 바이너리 릴리스는 생성하지 않았다.
- 최종 package 0.5.23 기준 19개 테스트 파일, 111개 테스트 통과. main/renderer/mobile 타입 검사와 Windows portable/NSIS 패키징 통과. 모바일 정적 파일 6개와 전체 맥락 전달 코드의 ASAR 포함·바이트 일치 확인.
- portable와 release/work 및 실제 사용자 프로필/QR 토큰은 Git 업로드 대상에서 제외한다.

## 진행 작업과 데이터 보존

- 타로2 최근 요청 `0588281f-7f73-4ee8-9725-6737f0c4e1eb`의 최종 결론 `a75a6230-4e79-45ad-b5d7-5486b6bcedb1`은 2026-10-12 23:08:43 KST에 저장됐다. CLI 결과의 성공/turn.completed, GUI 양쪽 응답 완료, LLM 앱의 모델 자식 프로세스 없음, 빈 입력창을 확인한 뒤 정상 Alt+F4로 기존 앱만 종료했다. 토론 중단/새 토론/재요청을 하지 않았다.
- 운영 프로젝트 5개와 profile의 projects.json/backup, remote-settings.json, session-host-id 및 각 project/tasks/events 파일 총 19개의 전환 전후 SHA256이 동일하다. 원본 삭제·이동·초기화·설정 변경을 하지 않았다.
- 기존 portable EXE와 프로필 사본은 Git 제외 경로 work/final-0.5.23-20261012에 보존했다. 접근 코드는 보고서/커밋에 기록하지 않는다.

## 실제 실행 증거

| 항목 | 값 |
|---|---|
| 고정 실행 경로 | D:\02_CodexAI\03_LLMcollaboration\portable\LLM Collaboration.exe |
| 이전 버전 및 SHA256 | 0.5.21 · A85C43EB4D63570A25A353C2BF5EA94D4A7D12336E6608BA299F2ABA22023AB4 |
| 최종 portable SHA256 | BA312061EDCABE11B45456C880599E35517CF79DE72AF574446C1B46DC69AEFF |
| 최종 설치 파일 SHA256 | 2C314950811BDAEE203EB5A65A2B97F26965F78B1C7D1EB325659DE7CC0EC935 |
| launcher/main PID | 35676 / 10944 |
| 실행 runtime 경로 | C:\Users\RAONOLJE\AppData\Local\Temp\3Kb9WWEERbioeKnfa5XaYy4QX6V\LLM Collaboration.exe |
| runtime ProductVersion | 0.5.23.0 |
| runtime/package ASAR SHA256 | D447EF82C03A504616DB51BC2A8EB26C9BF110776376D9D11B86CEF793F37AE8 · 일치 |
| 실제 모바일 번들 | AppEntry-6b56c9265065992e860bf107cf24b543.js |
| 제공/local JS SHA256 | EC20B0C5904E1676222D7B877A9726D6B9965D5F2642888E98B48641CE7F8781 · 일치 |

모바일 서버는 기존 Tailscale 주소와 48721 포트를 유지한다. 새 main PID가 서버를 소유하며 정적 HTML/JS HTTP 200을 확인했다. Bearer API·토큰 재발급을 하지 않았다. localhost는 바인딩 주소가 아니어서 첫 정적 확인이 연결 거부였으며 실제 기존 바인딩 주소로 정상 확인했다.

## 화면 확인과 제한

- 공식 Computer Use로 실제 새 실행 앱을 확인했다. 타로2 → RFG → 국호 → QA 순으로 최근 활동 정렬이 표시됐으며 타로2 저장 토론 결과와 읽기 전용 검토/파일 저장 폴더 선택 UI가 보였다.
- portable 추출 지연으로 최초 launch가 targetable window 미노출을 반환했지만 중복 실행하지 않았다. 프로세스와 새 창 재조회로 실행을 확인했다.
- 사용자가 새 앱에서 메시지를 작성 중인 것을 확인하여 추가 프로젝트 전환/입력 조작을 종료했다. 다른 앱/서버를 종료하지 않았다. 정상 작동 중인 새 앱을 유지하며 Computer Use 입력 작업을 마쳤다.
- 실제 새 파일 생성/진행 중 중단/새 토론 생성 회귀는 운영 데이터에서 실행하지 않았다. 이에 대한 검증은 분리된 가짜 모델·UI 렌더 테스트이다. 실제 iPhone 검증은 미실행이다.
- Codex AIStorage MCP 미등록과 Claude 실제 데이터 변경 권한/호출 검증은 이번 로컬 업데이트로 해결됐다고 주장하지 않는다. 연결/보안 설정을 변경하지 않았다.
