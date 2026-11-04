/** Shared by the demo seed and the non-destructive catalog conversion. */
export function basicSpecialtyPackage(specialtyName, branchName) {
  return {
    name: `Gói khám ${specialtyName} cơ bản (${branchName})`,
    description: `Gói khám chuyên khoa ${specialtyName} cơ bản: tiếp nhận thông tin sức khỏe, thăm khám theo nhu cầu và tư vấn các bước chăm sóc tiếp theo.`,
    notes: 'Mang theo hồ sơ sức khỏe và kết quả khám đã có (nếu có). Các chỉ định bổ sung được bác sĩ tư vấn sau khi thăm khám.',
    isFollowUp: false,
    followUpAfterDays: null,
  };
}
