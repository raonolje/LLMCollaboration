# 0.5.24 · 직접 작업과 CLI 도구 전달 수정

## 실제 실패 원인

타로2 요청 `34b90a1f-8813-4603-9948-a96028f0adaa`는 “Codex 파일 생성 → Claude 검수” 지시였다. 그러나 0.5.23의 이벤트는 target=both, outputDirectory=null, discussion=true, discussionRounds=4로 저장됐고 실제 `project-discussion-*` 호출은 읽기 전용이었다. 0.5.23의 설치 반영은 사실이지만 이 요청 방식을 처리하는 기능은 부족했다. 사용자 잘못으로 처리하지 않는다. 기존 이벤트/답변/실패/합의 판정은 그대로 보존한다.

## 변경과 권한 범위

- PC·모바일의 일반 메시지는 기본 **직접 작업**이다. 직접 작업에서는 실제 작업 요청을 도구로 수행하며, “토론 최종 결과”라는 문구를 포함해도 자동으로 새 읽기 전용 토론에 보내지 않는다. 사용자가 토론·검토를 선택한 경우에는 읽기 전용으로 유지한다.
- “Codex는 생성, Claude는 Codex가 수정한 파일을 검수”라는 실제 원문 형태를 판별한다. 생성 담당이 끝난 다음 검수 담당을 호출한다. 두 모델 병렬 파일 쓰기를 하지 않는다. 역할을 명시하지 않은 양쪽 직접 요청도 순서대로 수행한다.
- 직접 작업에서 기존 전체 프로젝트 대화와 직전 작성자의 전체 본문·표를 context 파일/참조로 전달한다. 최신 지시와 헌장이 우선이며 과거 발화는 참고 자료이다. 출력 폴더가 명시되지 않아도 사용자 지시와 대화의 실제 경로에서 폴더를 만들 수 있다. 임의 경로 추정·원본 덮어쓰기·미승인 유료 생성/외부 게시/보안 변경을 지시하지 않는다.
- Codex 직접 작업은 앱의 read-only/workspace-write 강제 옵션 대신 기존 CLI 설정을 사용한다. 기존 Codex sandbox/approval 설정 값은 변경하지 않았다. 별도 선택 저장 폴더가 있으면 기존 제한된 쓰기 경로를 사용한다. 검토/교차 검수는 계속 read-only이다.
- Claude의 내장 도구 선택은 `--tools default`로 복원한다. 기존에 앱이 Read/Glob/Grep 등으로 도구를 제한해 WebFetch/WebSearch/Bash/Skill 등의 사용 경로를 없애던 문제를 제거한다. 일반 직접 작업은 기본 manual 승인 흐름, 검토는 plan, 기존 업무 수행은 acceptEdits를 유지한다. 이전 plan 세션을 재개해도 직접 작업의 모드를 명시적으로 전달한다.
- Claude 승인 요청은 공식 stream-json host/stdio control 규격으로 연결한다. 앱이 무조건 거부하거나 bypassPermissions로 우회하지 않는다. 사용자는 PC·모바일에서 실제 도구명/인수를 읽고 **이 호출 한 번만** 승인·거부할 수 있다. AskUserQuestion 답변도 전달하며 임의 다른 도구의 인수를 바꾸는 답변은 허용하지 않는다.
- 취소/프로세스 종료/CLI control_cancel_request는 미결 승인도 정리한다. 결과 하나가 왔다고 백그라운드 작업이나 승인 채널을 즉시 닫지 않는다. 모델 상태에 도구 승인 대기를 표시한다. 업데이트가 승인 대기 작업을 기다릴 때에도 승인 응답 API는 살아 있어야 하므로 관련 경로를 유지한다.

## AI 영상 스토리지 연결

- Claude의 기존 로컬 aimoviestorage stdio 등록이 가리키는 설치된 EXE를 사용했다. 정상 `codex mcp add aimoviestorage -- <기존 EXE> --mcp`로 Codex에도 등록했다. 기존 config 사본은 Git 제외 work 폴더에 보존한다. OAuth/자격증명/QR/토큰을 복사·재발급하거나 승인 정책을 변경하지 않았다.
- Codex MCP 목록에서 aimoviestorage enabled=true 확인. auth_status=unsupported는 해당 stdio 서버가 OAuth 인증 상태 기능을 제공하지 않는 값이며 연결 실패 판정으로 쓰지 않는다.
- 같은 설치 서버에 initialize → tools/list만 수행해 117개 실제 도구 제공을 확인했다. 제작 데이터 쓰기·이미지/영상/음성·Magnific/Suno 생성·결제·게시 도구는 호출하지 않았다. 제공됨과 모든 도구의 실제 사용 성공은 별개이다.

## 검증과 실제 적용

- 21개 Vitest 파일·119테스트 통과. 파일 생성 후 상대 검수의 순서·읽기/쓰기 모드·전체 맥락 전달, 승인/거부/취소/질문 답변, 백그라운드 작업 유지, 인증된 모바일 승인 및 업데이트 대기 중 승인 경로 등을 분리 데이터/가짜 모델로 검증했다.
- 실제 설치 Claude CLI에 user/model 프롬프트를 보내지 않고 initialize만 보내 host control 응답 success를 확인했다. 실제 모델 생성·원고 생성 성공 검증은 아니다.
- main/renderer/mobile 타입 검사·빌드·Windows portable/NSIS 패키징 통과. 모바일 6개 정적 파일 및 전체 맥락 코드의 ASAR 바이트 일치를 확인했다.
- 사용자 최신 업데이트 승인의 후속 수정으로 기존 앱의 양쪽 응답 완료, 빈 입력, 모델 자식 프로세스 없음을 확인한 뒤 정상 종료하고 고정 portable를 교체했다. 새로운 원고 작업/토론은 보내지 않았다.
- 실제 실행: `D:\02_CodexAI\03_LLMcollaboration\portable\LLM Collaboration.exe`, 버전 0.5.24.0, launcher/main PID 58448/47748. 실행 추출 경로 `C:\Users\RAONOLJE\AppData\Local\Temp\3KbG19raVuQW7fVUgkAdtA7mVHM\LLM Collaboration.exe`.
- Portable SHA256: `82317B724F8326A5F00F5FAE01157B3AD3C5E80DE7B98982A16EA64BC516F82C`. 설치 EXE: `4F01D864EDE763A8A7FED9EB98859B09E8C44F1D557137F1CA061118C82560A1`.
- 실행 ASAR와 검증 패키지는 SHA256 `B31E335367D121C63BCA9518682F177AB56E9C2BA538853DEC540F3A1F03284A`로 동일하다.
- 기존 서버가 실제 제공하는 모바일 번들 `AppEntry-f46e0d3a68b08cb648c4002809a4c712.js`는 로컬 빌드와 SHA256 `2938B7901EF473AE0E623C5ABEC94BF5E9F914525128AFA6E909A7C5D6B076E2`로 동일하다. 기존 주소/QR/접근 코드는 유지했다.
- 프로젝트·대화·설정 파일 19개 전환 전후 SHA256 동일. 실제 새 화면에서 기본 작업 방식이 직접 작업이고 두 모델 선택에서도 저장 폴더 선택이 활성화된 것을 확인했다. 타로2 및 기존 프로젝트가 그대로 표시됐다. 다른 앱/서버는 종료하지 않았다.

## 남은 검증과 동등성 제한

실제 새 Codex/Claude 작업으로 원고 파일을 생성하고 검수하는 검증은 하지 않았다. 사용자의 기존 생성 요청도 자동 재송신하지 않았다. 실제 승인/질문 팝업 회귀는 가짜 CLI 프로토콜 테스트이며, 실제 CLI의 초기 연결 성공과 구별한다. iPhone 실기기 검증은 미실행이다.

일반 CLI의 실행·도구·승인 경로를 복원한 것이며 **모든 데스크톱 전용 도구와 외부 서비스까지 동일하게 검증된 것은 아니다**. Codex 앱에서만 공급하는 도구, CLI에 등록되지 않은 연결, Gmail/Drive 등 별도 OAuth 또는 제공자 권한이 필요한 서비스는 정상 연결/인증이 필요하다. 과거 모델의 인증 필요 보고와 실제 OAuth 오류 검증은 구분한다. 임의 토큰 복사나 숨겨진 서버의 강제 활성화로 우회하지 않는다. 서비스 비용 상한 승인 대기와 Magnific MCP 제작 제외 조건은 유지한다.

공식 프로토콜 근거: [Anthropic SDK control query](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py), [stdio 권한 콜백 설정](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py), [CLI transport](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py). 특정 구현 검증에는 설치 CLI의 --help와 초기 연결 응답도 사용했다.
