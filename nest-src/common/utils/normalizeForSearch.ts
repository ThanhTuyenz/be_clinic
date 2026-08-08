export function normalizeText(str: string): {
  normalized: string;
  withDiacritics: string;
} {
  if (!str) return { normalized: '', withDiacritics: '' };

  // Chuẩn hóa cơ bản (giữ dấu)
  const withDiacritics = str.toLowerCase().trim().replace(/\s+/g, ' '); // Chuẩn hóa khoảng trắng

  // Chuẩn hóa không dấu
  const normalized = withDiacritics
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ dấu tiếng Việt
    .replace(/[đĐ]/g, 'd'); // thay đ -> d

  return { normalized, withDiacritics };
}

export function normalizeForSearch(str: string): {
  normalized: string;
  withDiacritics: string;
} {
  const { normalized, withDiacritics } = normalizeText(str);
  return {
    normalized: normalized.replace(/[^a-zA-Z0-9\s]/g, ''), // bỏ ký tự đặc biệt, giữ khoảng trắng
    withDiacritics: withDiacritics.replace(
      /[^a-zA-Z0-9\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g,
      '',
    ), // chỉ giữ chữ, số, khoảng trắng và dấu tiếng Việt
  };
}
