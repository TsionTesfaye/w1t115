export function maskExceptLast(value: string, visibleCount: number): string {
  if (!value || value.length <= visibleCount) return value;
  const visible = value.slice(-visibleCount);
  const masked = value.slice(0, -visibleCount).replace(/[a-zA-Z0-9]/g, '*');
  return masked + visible;
}

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 1) return email;
  return local[0] + '***@' + domain;
}
