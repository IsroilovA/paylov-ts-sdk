/** Test card numbers, built at runtime so no full PAN literal sits in the source. */

/** `body` followed by its Luhn check digit. */
export function testCardNumber(body: string): string {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body.charAt(body.length - 1 - index));
    const doubled = index % 2 === 0 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}
