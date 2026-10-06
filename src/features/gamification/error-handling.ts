/**
 * Error handling for XP awards and streak updates.
 * Only swallows expected idempotent duplicate errors.
 * All other errors are re-thrown after logging.
 */

export function isExpectedDuplicateXpError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  
  const err = error as { code?: string; constraint?: string; message?: string };
  
  // PostgreSQL unique_violation error code
  if (err.code !== '23505') return false;

  // Expected constraints for once-ever XP awards
  // - lecture completion XP (unique partial index on xp_log)
  // - clinical case completion XP (unique partial index on xp_log)
  if (err.constraint === 'xp_log_user_lecture_complete_unique') return true;
  if (err.constraint === 'xp_log_user_case_complete_unique') return true;

  return false;
}

export function isExpectedDuplicateStreakError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  
  const err = error as { code?: string; constraint?: string; message?: string };
  
  // PostgreSQL unique_violation error code
  if (err.code !== '23505') return false;
  
  // Streak uses user_profile upsert - duplicate would be on user_id primary key
  // but that's handled by ON CONFLICT, so this shouldn't normally happen
  return false;
}

export async function safeAwardXp(
  awardFn: () => Promise<any>,
  logger?: (msg: string, err?: Error) => void
): Promise<any> {
  try {
    return await awardFn();
  } catch (error) {
    if (isExpectedDuplicateXpError(error)) {
      // Expected idempotent duplicate - log and return null to indicate no-op
      logger?.('XP award skipped: duplicate lecture/case completion', error as Error);
      return null;
    }
    
    // Unexpected error - log and re-throw
    logger?.('XP award failed with unexpected error', error as Error);
    throw error;
  }
}

export async function safeUpdateStreak(
  streakFn: () => Promise<any>,
  logger?: (msg: string, err?: Error) => void
): Promise<any> {
  try {
    return await streakFn();
  } catch (error) {
    if (isExpectedDuplicateStreakError(error)) {
      logger?.('Streak update skipped: duplicate', error as Error);
      return null;
    }
    
    logger?.('Streak update failed with unexpected error', error as Error);
    throw error;
  }
}

export async function safeAwardXpGeneral(
  awardFn: () => Promise<any>,
  logger?: (msg: string, err?: Error) => void
): Promise<any> {
  try {
    return await awardFn();
  } catch (error) {
    logger?.('XP award failed with unexpected error', error as Error);
    throw error;
  }
}