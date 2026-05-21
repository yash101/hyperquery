import { buildAuthorizationHeader, RetryBackoff } from "./auth";

export function startServer(token: string): string {
  const retry = new RetryBackoff();
  retry.nextDelay(2);
  return buildAuthorizationHeader(token);
}
