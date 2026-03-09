function parseCssTimeValue(value: string): number | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  if (trimmedValue.endsWith("ms")) {
    const parsed = Number.parseFloat(trimmedValue.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (trimmedValue.endsWith("s")) {
    const parsed = Number.parseFloat(trimmedValue.slice(0, -1));
    return Number.isFinite(parsed) ? parsed * 1000 : null;
  }

  const parsed = Number.parseFloat(trimmedValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getCssTimeMs(
  propertyName: string,
  fallback: number,
  element: Element | null = null,
): number {
  if (typeof window === "undefined") {
    return fallback;
  }

  const target = element ?? document.documentElement;
  const value = getComputedStyle(target).getPropertyValue(propertyName);
  const parsedValue = parseCssTimeValue(value);

  return parsedValue ?? fallback;
}
