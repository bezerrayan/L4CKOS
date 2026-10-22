/** Validation only: never generates or logs buyer documents. Numeric CPF/CNPJ contract. */
export function normalizeBuyerDocument(value: string): string | null {
  const s = value.trim();
  if (!/^(?:\d{11}|\d{14}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (/^(\d)\1+$/.test(digits)) return null;
  const check = (body: string, weights: number[]) => {
    const remainder = [...body].reduce((sum, n, i) => sum + Number(n) * weights[i], 0) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const weights = digits.length === 11 ? [10,9,8,7,6,5,4,3,2] : [5,4,3,2,9,8,7,6,5,4,3,2];
  const body = digits.slice(0, -2);
  const first = check(body, weights);
  const second = check(body + first, digits.length === 11 ? [11,...weights] : [6,...weights]);
  return digits.endsWith(String(first) + second) ? digits : null;
}
