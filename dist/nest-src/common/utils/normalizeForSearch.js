"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
exports.normalizeForSearch = normalizeForSearch;
function normalizeText(str) {
    if (!str)
        return { normalized: '', withDiacritics: '' };
    const withDiacritics = str.toLowerCase().trim().replace(/\s+/g, ' ');
    const normalized = withDiacritics
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd');
    return { normalized, withDiacritics };
}
function normalizeForSearch(str) {
    const { normalized, withDiacritics } = normalizeText(str);
    return {
        normalized: normalized.replace(/[^a-zA-Z0-9\s]/g, ''),
        withDiacritics: withDiacritics.replace(/[^a-zA-Z0-9\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g, ''),
    };
}
//# sourceMappingURL=normalizeForSearch.js.map