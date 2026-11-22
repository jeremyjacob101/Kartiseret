export function stripEdgeDoubleQuotes(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && value[start] === '"') start++;
  while (end > start && value[end - 1] === '"') end--;

  return value.slice(start, end);
}
