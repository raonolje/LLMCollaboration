import type { ModelActivity } from './model-activity';

/** Activity timestamps only: opening a project or polling its status is not activity. */
export const newestTimestamp = (...values: (string | undefined)[]): string | undefined => values
  .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
  .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

export const recentProjects = <T extends { createdAt?: string; lastActivityAt?: string }>(projects: readonly T[]): T[] =>
  [...projects].sort((left, right) => (Date.parse(right.lastActivityAt ?? right.createdAt ?? '') || 0)
    - (Date.parse(left.lastActivityAt ?? left.createdAt ?? '') || 0));

export const projectsWithLiveActivity = <T extends { path: string; createdAt?: string; lastActivityAt?: string }>(projects: readonly T[], activities: readonly ModelActivity[]): T[] =>
  recentProjects(projects.map((project) => ({ ...project, lastActivityAt: activities
    .filter((activity) => activity.projectPath.toLowerCase() === project.path.toLowerCase())
    .reduce((timestamp, activity) => newestTimestamp(timestamp, activity.startedAt, activity.lastOutputAt), project.lastActivityAt) })));
