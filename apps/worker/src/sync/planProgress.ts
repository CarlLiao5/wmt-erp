export interface PlanProgress {
  status: 'planned' | 'running' | 'partial' | 'completed';
  total: number;
  completed: number;
  failed: number;
}

export function summarizePlanWindows(statuses: string[]): PlanProgress {
  const currentStatuses = statuses.filter((status) => status !== 'superseded');
  const completed = currentStatuses.filter((status) => status === 'completed').length;
  const failed = currentStatuses.filter((status) => status === 'failed').length;
  const active = currentStatuses.some((status) => status === 'planned' || status === 'queued' || status === 'running');
  const status = completed === currentStatuses.length && currentStatuses.length > 0
    ? 'completed'
    : active
      ? 'running'
      : failed > 0
        ? 'partial'
        : 'planned';
  return { status, total: currentStatuses.length, completed, failed };
}
