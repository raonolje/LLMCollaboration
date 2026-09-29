export type Provider = 'codex' | 'claude';

export type ModelChoice = Readonly<{
  provider: Provider;
  model: string;
}>;

export type ExternalSession = Readonly<{
  hostId: string;
  provider: Provider;
  sessionId: string;
  purpose: 'project' | 'debate' | 'execution' | 'review';
  cwd: string;
  createdAt: string;
  updatedAt: string;
}>;

export type SessionTurn = Readonly<{
  event: CollaborationEvent;
  prompt: string;
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
  createdAt: string;
  updatedAt: string;
  sessions?: ExternalSession[];
}>;

export type ProjectInput = Readonly<{
  path: string;
  name: string;
  goal: string;
  defaultDebateRounds?: number;
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
  | 'artifact';

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
  createProject: (input: ProjectInput) => Promise<ProjectSnapshot>;
  deleteProject: (projectPath: string, projectId: string, confirmation: string) => Promise<void>;
  openProject: (projectPath: string) => Promise<ProjectSnapshot>;
  updateCharter: (projectPath: string, charter: string) => Promise<ProjectSnapshot>;
  updateProjectRounds: (projectPath: string, rounds: number) => Promise<ProjectSnapshot>;
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
  openDesktopSession: (projectPath: string, sessionId: string, provider: Provider) => Promise<void>;
  onEvent: (listener: (event: CollaborationEvent) => void) => () => void;
}>;

declare global {
  interface Window {
    collab: CollaborationAPI;
  }
}
