export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^\x00-\x7F]/g, "").replace(/[^a-z0-9]/g, "");
}

export function reverseString(value: string): string {
  return [...value].reverse().join("");
}

export function rootIdForPath(pathname: string): string {
  return normalizeName(pathname).slice(-48) || "root";
}
