export interface ProfileHealthContext {
  familyHistory?: string | null;
  smokingStatus?: string | null;
  alcoholUse?: string | null;
  activityLevel?: string | null;
  pregnancyStatus?: string | null;
  isBreastfeeding?: boolean | null;
}

export function profileEvidenceText(profile: ProfileHealthContext & { medicalHistory: string; age?: number | null; gender?: string; bmi?: number | null }): string {
  const labels: Record<string, string> = {
    NEVER: 'Không sử dụng', FORMER: 'Đã ngừng hút thuốc', OCCASIONAL: 'Thỉnh thoảng', DAILY: 'Hút thuốc hằng ngày',
    FREQUENT: 'Thường xuyên', LOW: 'Ít vận động', MODERATE: 'Vận động trung bình', HIGH: 'Vận động thường xuyên',
  };
  return [profile.medicalHistory, profile.familyHistory,
    profile.age != null ? `Tuổi: ${profile.age}` : '',
    profile.gender ? `Giới tính: ${profile.gender}` : '',
    profile.bmi != null ? `BMI: ${profile.bmi}` : '',
    profile.smokingStatus && labels[profile.smokingStatus] ? `Hút thuốc: ${labels[profile.smokingStatus]}` : '',
    profile.alcoholUse && labels[profile.alcoholUse] ? `Rượu bia: ${labels[profile.alcoholUse]}` : '',
    profile.activityLevel && labels[profile.activityLevel] ? `Vận động: ${labels[profile.activityLevel]}` : '',
  ].filter(Boolean).join('\n');
}
