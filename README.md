# LLM Collaboration

Codex CLI와 Claude Code CLI를 한 프로젝트 안에서 조율하는 로컬 데스크톱 앱입니다. 두 모델이 서로의 제안을 검토한 뒤 업무를 수행하고, 다른 모델이 결과를 검수합니다. 앱은 각 CLI에 이미 로그인된 구독 계정을 사용하며, 자체 API 키나 별도 모델 API 서버를 요구하지 않습니다.

> 현재 저장소는 초기 MVP입니다. 아래의 **현재 범위와 제한**을 확인한 뒤 중요한 프로젝트에 사용하세요.

## 준비

- Windows 또는 macOS, Node.js와 npm, Git
- 실행 경로(`PATH`)에서 찾을 수 있는 Codex CLI와 Claude Code CLI
- 두 CLI에 각각 로그인할 수 있는 계정과 사용 가능량
- Claude Code v2.1.259 이상 (`--permission-prompts none` 사용)

CLI 설치와 로그인 방법은 각 제품의 공식 문서를 따르세요. Codex는 `codex login`으로 ChatGPT 계정에 로그인하고 `codex login status`로 인증 방식을 확인할 수 있습니다. Claude Code는 `claude auth login`으로 로그인하고 `claude auth status`로 상태를 확인할 수 있습니다. 이 앱은 구독 사용을 위해 Claude Code의 `--bare` 모드를 사용하지 않습니다. [Codex CLI 인증](https://learn.chatgpt.com/docs/auth), [Claude Code CLI 명령](https://code.claude.com/docs/en/cli-reference), [Claude Code 인증](https://code.claude.com/docs/en/authentication)

```sh
codex --version
codex login status
claude --version
claude auth status
git --version
```

Claude Code의 비대화형 실행(`claude -p`)은 `ANTHROPIC_API_KEY`가 설정돼 있으면 구독 로그인보다 해당 API 키를 사용합니다. 앱은 일부 API 및 외부 공급자 환경 변수를 자식 프로세스에서 제외하지만, 사용자의 전체 CLI 설정이나 계정 청구 경로를 대체해 관리하지는 않습니다. 실행 전에 두 CLI의 인증 상태와 설정을 직접 확인하세요. [Claude Code 환경 변수](https://code.claude.com/docs/en/env-vars)

## 개발 실행

Windows PowerShell 또는 macOS 터미널에서 이 저장소의 루트로 이동한 뒤 실행합니다.

```sh
npm ci
npm run dev
```

정적 검사와 빌드:

```sh
npm run typecheck
npm test
npm run build
npm start
```

패키징은 각 대상 OS에서 실행합니다.

```sh
npm run package:win  # Windows: NSIS 설치 파일과 portable 실행 파일
npm run package:mac  # macOS: DMG와 ZIP
```

패키지는 `release/`에 생성됩니다. macOS 배포용 코드 서명과 공증 설정은 아직 포함돼 있지 않습니다. 빌드 명령이 존재하는 것과 해당 OS에서 설치 파일을 검증한 것은 별개입니다.

앱 아이콘의 원본은 `assets/icon.svg`입니다. `npm run icons:png`는 원본에서 `assets/icon.png`를 다시 만들며, 앱 창과 패키지 리소스에 이 PNG를 사용합니다. Windows 패키지에는 `assets/icon.ico`, macOS 패키지에는 `assets/icon.icns`를 사용합니다. ICO·ICNS는 저장소에 포함돼 있으며 `icons:png` 명령으로는 재생성되지 않습니다. 세 형식을 모두 갱신하려면 PNG 생성 뒤 Pillow가 설치된 Python 환경에서 `python scripts/build-icons.py`를 실행하세요.

## 사용 흐름

1. **프로젝트 폴더 지정:** 새 프로젝트에서 이름, 목표, 절대 경로를 입력합니다. 앱은 그 폴더를 Git 저장소로 사용하고 앱 전용 기록을 `.llm-collaboration/`에 저장합니다. Codex·Claude 구독 로그인이 준비돼 있으면 두 CLI에 프로젝트 시작 대화를 만들고 ID를 기록합니다. 생성에 실패해도 프로젝트는 유지되고 오류가 이력에 남습니다. 다른 컴퓨터에서 기록이 담긴 저장소를 클론했다면 같은 폴더를 지정해 기존 프로젝트를 다시 등록할 수 있습니다.
2. **기준 작성:** 프로젝트 헌장에 계속 지켜야 할 목표, 제약과 완료 기준을 적습니다. 앱은 업무 카드와 함께 이를 각 모델 요청에 다시 전달합니다.
3. **업무 만들기:** 제목, 지시, 완료 기준, 선행 업무, 토론 횟수를 직접 입력하거나, 목표에 대한 **업무 계획 자동 생성**을 실행해 여러 업무를 만들 수 있습니다. 자동 생성된 업무는 실행 전에 편집할 수 있습니다. 실행 모델과 검수 모델은 업무별로 직접 지정하거나 자동 선택할 수 있습니다. 세부 모델 이름을 비워 두면 해당 CLI의 기본값을 사용합니다.
4. **논쟁:** 기본값은 2회 왕복이며 화면에서 프로젝트와 업무마다 1~8회로 조절할 수 있습니다. 두 모델의 독립 제안, 반론과 답변 평가를 기록한 뒤 합의점, 남은 이견, 실행 단계와 검증 방법을 담은 결론을 만듭니다. 논쟁 화면에서 질문 대상을 고르고 추가 질문 및 왕복 횟수를 지정해 이어갈 수 있습니다. 1회로 줄이면 상대의 반론에 답하는 중간 단계가 생략될 수 있습니다.
5. **실행과 교차 검수:** 실행 담당 모델이 별도 Git worktree에서 파일을 수정하고, 다른 모델이 완료 기준에 따라 읽기 전용으로 검수합니다. 검수 결과와 산출물 경로를 기록합니다.
6. **기록 검색과 대화 재개:** 전체 이력에서 단계별 이벤트와 CLI 실행 원문 JSONL을 함께 텍스트 검색합니다. 검색 결과나 논쟁 화면의 **CLI 원문 열기**로 해당 호출의 입력·출력 전체를 볼 수 있습니다. 프로젝트·업무의 **CLI에서 이어 열기**로 저장된 세션 ID를 외부 터미널에서 다시 열 수 있습니다. 앱을 닫아도 프로젝트 폴더의 기록은 남습니다.

## CLI 대화 세션

앱은 프로젝트 시작 대화, 업무별 Codex·Claude 토론 대화, 실행 대화, 검수 대화를 구분합니다. 같은 업무의 같은 모델·역할을 다시 호출할 때 저장한 세션 ID로 이어갑니다. 세션 카드는 프로젝트 개요와 각 업무에서 확인할 수 있습니다. **CLI에서 이어 열기**를 누르면 Windows에서는 명령 프롬프트, macOS에서는 Terminal이 열리고 Codex는 `codex resume --include-non-interactive <세션 ID>`, Claude는 `claude --resume <세션 ID>`를 실행합니다. Codex 카드의 **Codex 앱에서 보기**는 `codex://threads/<세션 ID>` 링크로 Codex 데스크톱 앱에서 해당 로컬 대화를 열도록 요청합니다. [Codex CLI 세션 재개](https://learn.chatgpt.com/docs/developer-commands), [Codex 앱 딥 링크](https://learn.chatgpt.com/docs/reference/commands), [Claude Code 세션 재개](https://code.claude.com/docs/en/headless)

이 대화는 앱이 `codex exec`와 `claude -p`로 만든 **외부 CLI 세션**입니다. Codex 데스크톱 앱의 사이드바 채팅으로 자동 등록되는 흐름은 구현돼 있지 않습니다. **Codex 앱에서 보기**는 저장된 ID로 특정 대화를 열어 보는 별도 동작입니다. Claude Code의 `-p` 세션도 Claude Desktop의 채팅이나 일반 세션 목록에 자동 표시되는 것을 전제로 사용하지 않습니다. 두 경우 모두 앱에 표시된 ID와 **CLI에서 이어 열기**를 기준으로 재개하세요. Codex의 비대화형 세션을 일반 CLI 선택기에 포함하려면 `codex resume --include-non-interactive` 옵션이 별도로 있으며, Claude Desktop은 CLI 대화를 가져오는 별도 기능을 안내합니다. [Codex CLI 명령](https://learn.chatgpt.com/docs/developer-commands), [Claude Desktop과 CLI](https://code.claude.com/docs/en/desktop)

세션 ID와 이 앱의 실행 원문은 프로젝트 Git 기록에 저장됩니다. 앱은 Electron 사용자 데이터 폴더에 이 컴퓨터만의 `session-host-id`를 만들고, 세션마다 그 값을 함께 기록합니다. 프로젝트를 다른 컴퓨터에 클론하면 이전 기기 세션의 ID는 이력으로 남지만, 앱은 현재 기기의 세션만 이어 사용하고 누락된 프로젝트 세션은 새로 시작합니다. 다른 기기의 세션 카드는 표시되지만 열기 버튼이 비활성화됩니다. 반면 Codex·Claude가 자체적으로 보관하는 **재개 가능한 로컬 세션 데이터는 Git 산출물이 아닙니다.** 이전 컴퓨터의 CLI 대화를 새 컴퓨터에서 같은 ID로 재개할 수 있다고 가정하지 마세요.

## 파일과 Git 기록

프로젝트를 만들면 지정한 폴더에 다음 구조가 생깁니다.

```text
project-folder/
  .git/
  .llm-collaboration/
    project.json       # 프로젝트 목표와 헌장
    tasks.json         # 업무, 담당 모델, 상태
    events.jsonl       # 대화·논쟁·작업·검수 이벤트
    runs/              # CLI 호출별 입력과 출력 원문(JSONL)
  ...                  # 작업 산출물
```

업무 실행용 worktree는 프로젝트 폴더의 형제 경로인 `<프로젝트폴더명>.llm-worktrees/` 아래에 만듭니다. 프로젝트 메타데이터와 승인된 산출물은 로컬 Git 커밋으로 추적합니다. 검수가 두 번 연속 수정을 요청하면 작업 브랜치를 남겨 둡니다. **원격 저장소 설정과 GitHub/GitLab 푸시는 자동화하지 않습니다.** 필요한 원격은 해당 프로젝트 폴더에서 직접 설정하고 푸시하세요. 이 앱 자체의 소스 저장소와 사용자가 앱에서 만드는 프로젝트 저장소는 서로 다릅니다.

기록에는 사용자 지시와 모델의 입력·출력이 원문으로 포함될 수 있습니다. 비밀번호나 비밀 키를 업무 지시에 넣지 말고, 프로젝트의 원격 저장소 공개 범위를 확인하세요.

## 현재 범위와 제한

- 자동 업무 계획은 한 모델(Codex 사용 가능 시 Codex, 아니면 Claude)이 요청을 여러 업무로 분해합니다. 그 결과를 다른 모델이 계획 단계에서 자동 검수하지는 않습니다. 각 업무의 실행·검수 모델은 키워드와 현재 배정 수를 기준으로 고르는 규칙 기반 선택입니다.
- 서로 다른 업무는 화면에서 동시에 시작할 수 있습니다. 같은 업무는 한 번에 하나의 논쟁 또는 실행만 진행합니다. 각 CLI의 구독 사용량 제한과 파일·Git 작업에 따라 실제 처리 속도는 달라집니다.
- 모델 간 논쟁은 정해진 횟수만큼 순차적으로 실행됩니다. 사용자 질문으로 더 이어갈 수 있지만 실행 중에 끼어들어 발언을 수정하는 방식은 아닙니다.
- 이력 검색은 저장된 이벤트와 CLI 원문 파일의 줄 단위 텍스트 검색입니다. 검색 결과에는 일치한 줄의 발췌가 보이며, 원문 열기에서 전체 파일을 읽을 수 있습니다. 의미 기반 검색이나 오래된 기록의 자동 관련도 순위 기능은 없습니다.
- 긴 대화 대응을 위해 매 호출마다 프로젝트 목표·헌장·업무 카드와 최근 업무 기록을 전달합니다. 전체 과거 기록을 매번 모델에 싣거나 자동으로 관련 과거 기록을 검색해 주입하지는 않습니다.
- CLI 구독에는 각 서비스의 사용량 제한이 적용됩니다. 앱 실행이 무제한 사용이나 일정한 응답 시간을 보장하지 않습니다.
- 자동 검수는 모델 판단입니다. 실제 테스트, 사용자 확인, 배포 전 검토를 대체하지 않습니다.

구조와 데이터 흐름은 [아키텍처 문서](docs/architecture.md)를 참고하세요.
