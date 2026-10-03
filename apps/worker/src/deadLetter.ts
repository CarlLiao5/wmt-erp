export interface DeadLetter { id: string; attempts: number; payload: unknown; }
export function replayDeadLetter(job: DeadLetter, enqueue: (payload: unknown) => Promise<unknown>) { return enqueue(job.payload); }
