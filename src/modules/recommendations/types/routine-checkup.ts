/** General checkups must be identified by their contents, not just a broad specialty name. */
export function isRoutineCheckupPackage(pkg: { name: string; description?: string | null; symptoms?: string[]; isFollowUp?: boolean }): boolean {
  if (pkg.isFollowUp) return false;
  const name = pkg.name.normalize('NFC').toLowerCase();
  const text = [pkg.description, ...(pkg.symptoms || [])].join(' ').normalize('NFC').toLowerCase();
  return /khám nội tổng quát|gói khám nội tổng quát|khám sức khỏe tổng quát/.test(name)
    && /(?:kiểm tra|khám|tầm soát) sức khỏe định kỳ/.test(text);
}
