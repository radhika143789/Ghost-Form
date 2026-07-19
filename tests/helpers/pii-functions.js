export function isValidCreditCard(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  const BIN_PATTERNS = [
    /^4\d{12}(?:\d{3})?$/,
    /^5[1-5]\d{14}$/,
    /^2(?:2[2-9][1-9]|[3-6]\d{2}|7[01]\d|720)\d{12}$/,
    /^3[47]\d{13}$/,
    /^6(?:011|22(?:1(?:2[6-9]|[3-9]\d)|[2-8]\d{2}|9(?:[01]\d|2[0-5]))|4[4-9]\d|5\d{2})\d{12}$/,
    /^62\d{14,17}$/,
  ];
  if (!BIN_PATTERNS.some(pattern => pattern.test(digits))) return false;
  let sum = 0;
  let isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

export function isPIIPhone(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return false;
  if (/^1?[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return true;
  if (/^(?:91)?[6-9]\d{9}$/.test(digits)) return true;
  if (/^(?:44)?(?:7\d{9}|[12]\d{9})$/.test(digits)) return true;
  if (value.trim().startsWith('+') && /^\+\d{7,15}$/.test(value.replace(/[\s-]/g, ''))) return true;
  return false;
}

export function isSSN(value) {
  if (!/^\d{9}$/.test(value) && !/^\d{3}-\d{2}-\d{4}$/.test(value)) return false;
  const clean = value.replace(/\D/g, '');
  if (clean.length !== 9) return false;
  const area = parseInt(clean.substring(0, 3), 10);
  const group = parseInt(clean.substring(3, 5), 10);
  const serial = parseInt(clean.substring(5, 9), 10);
  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;
  return true;
}
