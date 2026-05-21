/** Builds the Authorization header for outgoing HTTP requests. */
export function buildAuthorizationHeader(token: string): string {
  const prefix = "Authorization";
  return `${prefix}: Bearer ${token}`;
}

export class RetryBackoff {
  nextDelay(attempt: number): number {
    return Math.min(1000 * attempt, 10_000);
  }
}
