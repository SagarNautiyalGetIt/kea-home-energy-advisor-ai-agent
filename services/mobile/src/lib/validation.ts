export const isEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());

export function validateRequired(value: string, label: string) {
  return value.trim() ? undefined : `${label} is required.`;
}

export function validateEmail(value: string) {
  if (!value.trim()) return 'Email is required.';
  return isEmail(value) ? undefined : 'Enter a valid email address.';
}

export function validatePhone(value: string) {
  if (!value.trim()) return 'Contact number is required.';
  const normalized = value.replace(/[\s()-]/g, '');
  return /^(?:\+?64|0)(?:2\d{7,9}|[3-9]\d{7})$/.test(normalized)
    ? undefined
    : 'Enter a valid New Zealand phone number.';
}

export function validateNewPassword(value: string) {
  if (!value) return 'Password is required.';
  return value.length >= 8 ? undefined : 'Use at least 8 characters.';
}
