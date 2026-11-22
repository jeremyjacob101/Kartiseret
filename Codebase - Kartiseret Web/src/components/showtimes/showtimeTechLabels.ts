export function formatScreeningTechLabel(value: string): string {
  return value.replace(/\bInfinity\s+Vision\b/gi, "Inf. Vision");
}

export function getShowtimeTechLabel(screeningTech: string): string | null {
  const normalizedValue = screeningTech.trim().replace(/\s+/g, " ");

  if (!normalizedValue) {
    return null;
  }

  const strippedValue = normalizedValue.replace(/^2D\b[\s/-]*/i, "").trim();
  const comparableValue = strippedValue.toUpperCase();

  if (!strippedValue || comparableValue === "REGULAR") {
    return null;
  }

  return formatScreeningTechLabel(strippedValue);
}
