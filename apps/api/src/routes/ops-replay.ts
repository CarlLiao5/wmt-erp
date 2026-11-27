export interface ReplayClaim { claim: () => Promise<boolean>; retry: () => Promise<void | boolean>; rollback: () => Promise<void>; }

export async function replayWithClaim({ claim, retry, rollback }: ReplayClaim): Promise<boolean> {
  if (!(await claim())) return false;
  try {
    if ((await retry()) === false) {
      await rollback();
      return false;
    }
    return true;
  } catch (error) {
    await rollback();
    throw error;
  }
}
