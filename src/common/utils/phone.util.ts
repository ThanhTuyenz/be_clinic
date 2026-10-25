/**
 * Chuẩn hóa một số điện thoại thô thành tất cả các biến thể có thể có.
 * Ví dụ: "0912345678" → ["+84912345678", "0912345678"]
 *         "+84912345678" → ["+84912345678", "0912345678"]
 *
 * @returns Mảng các biến thể duy nhất (đã loại trùng lặp)
 */
export function normalizePhoneVariants(raw: string): string[] {
  const cleaned = (raw || '').trim();
  if (!cleaned) return [];

  const withPlus = cleaned.startsWith('0')
    ? `+84${cleaned.slice(1)}`
    : cleaned;

  const withZero = cleaned.startsWith('+84')
    ? `0${cleaned.slice(3)}`
    : cleaned;

  // Dedup: loại bỏ biến thể trùng nhau
  return [...new Set([cleaned, withPlus, withZero])];
}

/**
 * Chuẩn hóa số điện thoại về dạng +84xxx (quốc tế).
 * Trả về nguyên bản nếu không nhận dạng được.
 */
export function toInternationalPhone(raw: string): string {
  const cleaned = (raw || '').trim();
  if (cleaned.startsWith('0')) return `+84${cleaned.slice(1)}`;
  return cleaned;
}
