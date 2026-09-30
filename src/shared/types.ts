export type Provider = 'codex' | 'claude';

export type ModelChoice = Readonly<{
  provider: Provider;
  model: string;
  effort?: string;
}>;

export type ChatModelSettings = Readonly<{ model: string; effort: string }>;
export type ChatAttachment = Readonly<{ name: string; path: string; size: number }>;
export type ChatFileInput = string | Readonly<{ name: string; data: string }>;
export type ModelOption = Readonly<{
  id: string;
  label: string;
  description: string;
  efforts: string[];
  defaultEffort?: string;
  requiresCredits?: boolean;
}>;
export type ModelCatalog = Readonly<{
  provider: Provider;
  source: string;
  cliVersion: string;
  refreshedAt: string;
  models: ModelOption[];
  warning?: string;
}>;
export type AppUpdateCheck = Readonly<{
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseUrl: string;
  assetName?: string;
}>;
export type RemoteStatus = Readonly<{
  enabled: boolean;
  url?: string;
  token?: string;
  error?: string;
}>;

export type ExternalSession = Readonly<{
  hostId: string;
  provider: Provider;
  sessionId: string;
  purpose: 'project' | 'debate' | 'execution' | 'review';
  cwd: string;
  createdAt: string;
  updatedAt: string;
  handedOffAt?: string;
}>;

export type SessionTurn = Readonly<{
  event: CollaborationEvent;
  prompt: string;
}>;

export type ConversationTurn = Readonly<{ role: 'user' | 'assistant'; text: string; timestamp?: string }>;
export type ConversationCandidate = Readonly<{
  provider: Provider;
  sessionId: string;
  filePath: string;
  title: string;
  cwd?: string;
  updatedAt: string;
  turnCount: number;
}>;
export type LaunchRequest = Readonly<{ provider: Provider; sessionId: string }>;
export type ImportedConversation = Readonly<{
  id: string;
  provider: Provider;
  sessionId: string;
  title: string;
  importedAt: string;
  updatedAt: string;
  turnCount: number;
}>;

export type TaskStatus =
  | 'draft'
  | 'debating'
  | 'ready'
  | 'running'
  | 'reviewing'
  | 'changes_requested'
  | 'approved'
  | 'failed';

export type AssignmentMode = 'manual' | 'automatic';

export type TaskInput = Readonly<{
  title: string;
  description: string;
  acceptanceCriteria: string[];
  mode: AssignmentMode;
  executor: ModelChoice;
  reviewer: ModelChoice;
  dependsOn: string[];
  debateRounds: number;
  sourceConversationIds?: string[];
  sourceContext?: string;
}>;

export type Task = TaskInput & Readonly<{
  id: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  debateSummary?: string;
  reviewSummary?: string;
  branch?: string;
  artifacts: string[];
  sessions?: ExternalSession[];
}>;

export type Project = Readonly<{
  id: string;
  name: string;
  path: string;
  goal: string;
  charter: string;
  defaultDebateRounds: number;
  chatModels?: Partial<Record<Provider, ChatModelSettings>>;
  createdAt: string;
  updatedAt: string;
  sessions?: ExternalSession[];
  importedConversations?: ImportedConversation[];
}>;

export type ProjectInput = Readonly<{
  path: string;
  name: string;
  goal: string;
  defaultDebateRounds?: number;
  initialConversation?: Readonly<{ provider: Provider; filePath: string }>;
}>;

export type DebateFollowUp = Readonly<{
  message: string;
  target: Provider | 'both';
  additionalRounds: number;
}>;

export type EventType =
  | 'system'
  | 'proposal'
  | 'critique'
  | 'response'
  | 'evaluation'
  | 'decision'
  | 'execution'
  | 'review'
  | 'status'
  | 'error'
  | 'artifact'
  | 'chat';

export type CollaborationEvent = Readonly<{
  id: string;
  projectId: string;
  taskId?: string;
  type: EventType;
  actor: Provider | 'system' | 'user';
  message: string;
  timestamp: string;
  round?: number;
  metadata?: Record<string, string | number | boolean | null>;
}>;

export type CliStatus = Readonly<{
  provider: Provider;
  installed: boolean;
  version?: string;
  authentication?: string;
  executable?: string;
  configured?: boolean;
}>;

export type Bootstrap = Readonly<{
  projects: Project[];
  missingProjectPaths: string[];
  unavailableProjectPaths: ReadonlyArray<{ path: string; reason: string }>;
  cli: CliStatus[];
}>;

export type ProjectSnapshot = Readonly<{
  project: Project;
  tasks: Task[];
  events: CollaborationEvent[];
  localHostId: string;
}>;

export type CollaborationAPI = Readonly<{
  bootstrap: () => Promise<Bootstrap>;
  chooseDirectory: () => Promise<string | null>;
  chooseCliExecutable: () => Promise<string | null>;
  setCliExecutable: (provider: Provider, filePath: string | null) => Promise<CliStatus[]>;
  refreshCliStatus: () => Promise<CliStatus[]>;
  refreshModelCatalogs: () => Promise<ModelCatalog[]>;
  checkAppUpdate: () => Promise<AppUpdateCheck>;
  downloadAppUpdate: () => Promise<string>;
  remoteStatus: () => Promise<RemoteStatus>;
  setRemoteEnabled: (enabled: boolean) => Promise<RemoteStatus>;
  rotateRemoteToken: () => Promise<RemoteStatus>;
  createProject: (input: ProjectInput) => Promise<ProjectSnapshot>;
  reconnectProject: (projectPath: string) => Promise<ProjectSnapshot>;
  chooseChatFiles: () => Promise<string[]>;
  sendProjectMessage: (projectPath: string, message: string, target: Provider | 'both', models: Partial<Record<Provider, ChatModelSettings>>, files?: ChatFileInput[], discussion?: boolean) => Promise<ProjectSnapshot>;
  continueProjectDiscussion: (projectPath: string, messageId: string) => Promise<ProjectSnapshot>;
  cancelProjectMessage: (projectPath: string) => Promise<void>;
  listLocalConversations: (target?: LaunchRequest) => Promise<ConversationCandidate[]>;
  consumeLaunchRequest: () => Promise<LaunchRequest | null>;
  onLaunchRequest: (listener: (request: LaunchRequest) => void) => () => void;
  installChatSkills: () => Promise<string[]>;
  importConversation: (projectPath: string, provider: Provider, filePath: string) => Promise<ProjectSnapshot>;
  readImportedConversation: (projectPath: string, conversationId: string) => Promise<ConversationTurn[]>;
  readImportedConversationRaw: (projectPath: string, conversationId: string) => Promise<string>;
  chooseConversationFile: () => Promise<string | null>;
  deleteProject: (projectPath: string, projectId: string, confirmation: string) => Promise<'trashed' | 'unregistered'>;
  unregisterProjectOnly: (projectPath: string, projectId: string, confirmation: string) => Promise<void>;
  forgetMissingProject: (projectPath: string) => Promise<void>;
  openProject: (projectPath: string) => Promise<ProjectSnapshot>;
  updateCharter: (projectPath: string, charter: string) => Promise<ProjectSnapshot>;
  updateProjectRounds: (projectPath: string, rounds: number) => Promise<ProjectSnapshot>;
  updateProjectChatModel: (projectPath: string, provider: Provider, settings: ChatModelSettings) => Promise<void>;
  createTask: (projectPath: string, input: TaskInput) => Promise<ProjectSnapshot>;
  planTasks: (projectPath: string, request: string) => Promise<ProjectSnapshot>;
  updateTask: (projectPath: string, task: Task) => Promise<ProjectSnapshot>;
  autoAssign: (projectPath: string, taskId: string) => Promise<ProjectSnapshot>;
  runDebate: (projectPath: string, taskId: string) => Promise<void>;
  continueDebate: (projectPath: string, taskId: string, followUp: DebateFollowUp) => Promise<void>;
  executeTask: (projectPath: string, taskId: string) => Promise<void>;
  cancelRun: (projectPath: string, taskId: string) => Promise<void>;
  search: (projectPath: string, query: string) => Promise<CollaborationEvent[]>;
  readTranscript: (projectPath: string, transcript: string) => Promise<string>;
  readSessionHistory: (projectPath: string, sessionId: string) => Promise<SessionTurn[]>;
  openSession: (projectPath: string, sessionId: string) => Promise<void>;
  handoffClaudeSession: (projectPath: string, sessionId: string) => Promise<void>;
  openDesktopSession: (projectPath: string, sessionId: string, provider: Provider) => Promise<void>;
  onEvent: (listener: (event: CollaborationEvent) => void) => () => void;
}>;

declare global {
  interface Window {
    collab: CollaborationAPI;
  }
}
