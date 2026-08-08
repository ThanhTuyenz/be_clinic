export function buildReceptionSystemPrompt(specialtyNames?: any[]): string;
export function parseChuyenKhoaJson(rawContent: any): {
    chuyen_khoa: string;
};
export function callOllamaForChuyenKhoa({ userText, specialtyNames }: {
    userText: any;
    specialtyNames: any;
}): Promise<{
    chuyen_khoa: string;
}>;
export function extractChuyenKhoaFromMessage({ userText, specialtyNames, provider }: {
    userText: any;
    specialtyNames: any;
    provider?: string;
}): Promise<{
    chuyen_khoa: string;
}>;
