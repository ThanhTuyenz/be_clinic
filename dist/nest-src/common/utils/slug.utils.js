"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateUniqueSlug = generateUniqueSlug;
exports.removeVietnameseTones = removeVietnameseTones;
async function generateUniqueSlug(input, repository, options) {
    const baseSlug = removeVietnameseTones(input.trim());
    if (!baseSlug) {
        throw new Error('Slug không thể rỗng');
    }
    let slug = baseSlug;
    let count = 0;
    while (true) {
        const existing = await repository.findOneBy({
            slug,
        });
        if (!existing ||
            (options?.excludeId &&
                existing._id &&
                existing._id.toString() === options.excludeId.toString())) {
            return slug;
        }
        count += 1;
        slug = `${baseSlug}-${count}`;
    }
}
function removeVietnameseTones(str) {
    if (!str)
        return '';
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a');
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e');
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, 'i');
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o');
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u');
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y');
    str = str.replace(/đ/g, 'd');
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, 'A');
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, 'E');
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, 'I');
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, 'O');
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, 'U');
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, 'Y');
    str = str.replace(/Đ/g, 'D');
    str = str.replace(/[^a-zA-Z0-9 ]/g, ' ');
    str = str.replace(/\s+/g, '-');
    str = str.toLowerCase();
    str = str.replace(/^-+|-+$/g, '');
    return str;
}
//# sourceMappingURL=slug.utils.js.map