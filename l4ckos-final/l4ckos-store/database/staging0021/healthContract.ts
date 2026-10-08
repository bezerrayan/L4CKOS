export function isExpectedStagingHealth(
  status: number,
  body: unknown,
): boolean {
  if (
    status !== 200 ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return false;
  }

  const value = body as Record<string, unknown>;

  if (value.ok !== true) return false;

  if (value.service === "backend") return true;

  return (
    value.service === "staging-maintenance" &&
    value.maintenance === true
  );
}
