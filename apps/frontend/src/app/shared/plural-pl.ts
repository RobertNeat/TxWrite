/** Polish plural form selection for "N <singular>/<few>/<many>" (e.g. błąd/błędy/błędów). */
export function pluralPl(n: number, singular: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    n === 1 ? singular : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many;
  return `${n} ${word}`;
}
