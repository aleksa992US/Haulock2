export function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (s < 60) return s <= 5 ? 'Just now' : `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
