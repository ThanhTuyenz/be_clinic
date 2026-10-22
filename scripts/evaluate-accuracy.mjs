// Synthetic cases for repeatable technical evaluation; not clinician-reviewed labels.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_CASES = [
  // Nhóm 1: Tim mạch & Tăng huyết áp
  {
    id: 'TC-01',
    category: 'Tim mạch - Huyết áp',
    profile: {
      fullName: 'Trần Văn Mạnh',
      age: 56,
      gender: 'MALE',
      bmi: 26.5,
      medicalHistory: 'Tăng huyết áp 5 năm, thỉnh thoảng đau thắt ngực khi gắng sức, mỡ máu cao',
      allergies: 'Không',
    },
    expectedKeywords: ['tim mạch', 'huyết áp'],
    forbiddenKeywords: ['phụ khoa', 'sản', 'nhi khoa'],
    expectedSpecialties: ['Tim mạch'],
  },
  {
    id: 'TC-02',
    category: 'Tim mạch - Huyết áp',
    profile: {
      fullName: 'Lê Thị Thu',
      age: 62,
      gender: 'FEMALE',
      bmi: 24.1,
      medicalHistory: 'Hồi hộp đánh trống ngực, rối loạn nhịp tim nhẹ, tiền sử thiếu máu cơ tim',
      allergies: 'Penicillin',
    },
    expectedKeywords: ['tim mạch'],
    forbiddenKeywords: ['nam khoa', 'tuyến tiền liệt', 'nhi khoa'],
    expectedSpecialties: ['Tim mạch'],
  },

  // Nhóm 2: Nội tiết & Đái tháo đường & Rối loạn chuyển hóa
  {
    id: 'TC-03',
    category: 'Nội tiết - Chuyển hóa',
    profile: {
      fullName: 'Nguyễn Hoàng Long',
      age: 48,
      gender: 'MALE',
      bmi: 28.4,
      medicalHistory: 'Đái tháo đường tuýp 2, khát nhiều, tiểu nhiều về đêm, BMI thừa cân',
      allergies: 'Không',
    },
    expectedKeywords: ['tiểu đường', 'nội tiết', 'đái tháo đường', 'chuyển hóa', 'tổng quát'],
    forbiddenKeywords: ['phụ khoa', 'sản'],
    expectedSpecialties: ['Nội tiết – Đái tháo đường', 'Nội tổng quát'],
  },
  {
    id: 'TC-04',
    category: 'Nội tiết - Chuyển hóa',
    profile: {
      fullName: 'Phạm Thị Lan',
      age: 51,
      gender: 'FEMALE',
      bmi: 27.2,
      medicalHistory: 'Hội chứng chuyển hóa, gan nhiễm mỡ độ 2, tăng men gan, mỡ máu triglyceride cao',
      allergies: 'Hải sản',
    },
    expectedKeywords: ['tiêu hóa', 'gan mật', 'nội tiết', 'chuyển hóa', 'tổng quát'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Tiêu hóa – Gan mật', 'Nội tiết – Đái tháo đường', 'Nội tổng quát'],
  },

  // Nhóm 3: Tiêu hóa & Gan mật
  {
    id: 'TC-05',
    category: 'Tiêu hóa - Gan mật',
    profile: {
      fullName: 'Vũ Đức Thịnh',
      age: 42,
      gender: 'MALE',
      bmi: 23.0,
      medicalHistory: 'Đau thượng vị âm ỉ sau ăn, ợ chua, viêm loét dạ dày tá tràng có HP',
      allergies: 'Không',
    },
    expectedKeywords: ['tiêu hóa', 'gan mật', 'dạ dày'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Tiêu hóa – Gan mật'],
  },
  {
    id: 'TC-06',
    category: 'Tiêu hóa - Gan mật',
    profile: {
      fullName: 'Đỗ Văn Thành',
      age: 54,
      gender: 'MALE',
      bmi: 24.5,
      medicalHistory: 'Tiền sử viêm gan B mạn tính 8 năm, ăn uống khó tiêu, men gan tăng',
      allergies: 'Không',
    },
    expectedKeywords: ['tiêu hóa', 'gan mật'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Tiêu hóa – Gan mật'],
  },

  // Nhóm 4: Hô hấp
  {
    id: 'TC-07',
    category: 'Hô hấp',
    profile: {
      fullName: 'Bùi Quang Hải',
      age: 58,
      gender: 'MALE',
      bmi: 21.8,
      medicalHistory: 'Ho kéo dài trên 1 tháng, khó thở nhẹ về sáng, tiền sử hút thuốc lá 20 năm',
      allergies: 'Bụi nhà',
    },
    expectedKeywords: ['hô hấp', 'phổi'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Hô hấp'],
  },
  {
    id: 'TC-08',
    category: 'Hô hấp',
    profile: {
      fullName: 'Nguyễn Thị Mai',
      age: 35,
      gender: 'FEMALE',
      bmi: 20.5,
      medicalHistory: 'Hen phế quản nhẹ từ nhỏ, thỉnh thoảng khò khè khi thay đổi thời tiết',
      allergies: 'Phấn hoa',
    },
    expectedKeywords: ['hô hấp'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Hô hấp'],
  },

  // Nhóm 5: Sản - Phụ khoa
  {
    id: 'TC-09',
    category: 'Sản - Phụ khoa',
    profile: {
      fullName: 'Đặng Thanh Thảo',
      age: 29,
      gender: 'FEMALE',
      bmi: 21.3,
      medicalHistory: 'Chu kỳ kinh không đều, đau bụng kinh nhiều, chuẩn bị kết hôn cần kiểm tra sức khỏe sinh sản',
      allergies: 'Không',
    },
    expectedKeywords: ['sản', 'phụ khoa', 'nữ'],
    forbiddenKeywords: ['nam khoa', 'tuyến tiền liệt'],
    expectedSpecialties: ['Sản – Phụ khoa'],
  },
  {
    id: 'TC-10',
    category: 'Sản - Phụ khoa',
    profile: {
      fullName: 'Lê Mai Anh',
      age: 38,
      gender: 'FEMALE',
      bmi: 22.8,
      medicalHistory: 'Cần khám phụ khoa định kỳ hàng năm và tầm soát ung thư cổ tử cung',
      allergies: 'Không',
    },
    expectedKeywords: ['phụ khoa', 'sản', 'nữ'],
    forbiddenKeywords: ['nam khoa', 'tuyến tiền liệt'],
    expectedSpecialties: ['Sản – Phụ khoa'],
  },

  // Nhóm 6: Cơ xương khớp & Chấn thương chỉnh hình
  {
    id: 'TC-11',
    category: 'Cơ xương khớp',
    profile: {
      fullName: 'Nguyễn Văn Định',
      age: 64,
      gender: 'MALE',
      bmi: 25.4,
      medicalHistory: 'Thoái hóa khớp gối hai bên, lục cục khớp khi đi lại, đau lưng vùng thắt lưng',
      allergies: 'Không',
    },
    expectedKeywords: ['chấn thương', 'chỉnh hình', 'khớp', 'ngoại'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Ngoại Chấn thương Chỉnh hình'],
  },
  {
    id: 'TC-12',
    category: 'Cơ xương khớp',
    profile: {
      fullName: 'Trương Thị Nga',
      age: 59,
      gender: 'FEMALE',
      bmi: 26.0,
      medicalHistory: 'Loãng xương, đau mỏi cột sống cổ và vai gáy, tê bì cánh tay',
      allergies: 'Không',
    },
    expectedKeywords: ['chấn thương', 'chỉnh hình', 'thần kinh'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Ngoại Chấn thương Chỉnh hình', 'Thần kinh'],
  },

  // Nhóm 7: Thần kinh
  {
    id: 'TC-13',
    category: 'Thần kinh',
    profile: {
      fullName: 'Hoàng Văn Phúc',
      age: 47,
      gender: 'MALE',
      bmi: 23.5,
      medicalHistory: 'Đau đầu nửa đầu kéo dài (migraine), mất ngủ kinh niên, chóng mặt khi thay đổi tư thế',
      allergies: 'Không',
    },
    expectedKeywords: ['thần kinh'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Thần kinh'],
  },
  {
    id: 'TC-14',
    category: 'Thần kinh',
    profile: {
      fullName: 'Nguyễn Thu Trang',
      age: 33,
      gender: 'FEMALE',
      bmi: 19.8,
      medicalHistory: 'Hội chứng tiền đình, chóng mặt hoa mắt buồn nôn, căng thẳng stress công việc',
      allergies: 'Không',
    },
    expectedKeywords: ['thần kinh'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Thần kinh'],
  },

  // Nhóm 8: Mắt & Khúc xạ & Đáy mắt
  {
    id: 'TC-15',
    category: 'Mắt - Nhãn khoa',
    profile: {
      fullName: 'Trần Minh Trí',
      age: 26,
      gender: 'MALE',
      bmi: 21.0,
      medicalHistory: 'Cận thị tiến triển, nhìn mờ mắt trái, mỏi điều tiết khi làm việc máy tính nhiều',
      allergies: 'Không',
    },
    expectedKeywords: ['mắt'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Mắt'],
  },
  {
    id: 'TC-16',
    category: 'Mắt - Nhãn khoa',
    profile: {
      fullName: 'Võ Thị Lệ',
      age: 67,
      gender: 'FEMALE',
      bmi: 23.8,
      medicalHistory: 'Mắt mờ như có màn sương che, nghi ngờ đục thủy tinh thể (cườm khô), tiền sử cườm nước',
      allergies: 'Không',
    },
    expectedKeywords: ['mắt', 'cườm', 'võng mạc'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Mắt'],
  },

  // Nhóm 9: Tai Mũi Họng
  {
    id: 'TC-17',
    category: 'Tai Mũi Họng',
    profile: {
      fullName: 'Ngô Quốc Bảo',
      age: 31,
      gender: 'MALE',
      bmi: 22.4,
      medicalHistory: 'Nghẹt mũi mạn tính, viêm xoang hàm tái phát, chảy dịch mũi sau gây vướng họng',
      allergies: 'Mạt bụi',
    },
    expectedKeywords: ['tai mũi họng', 'xoang', 'họng'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Tai Mũi Họng'],
  },
  {
    id: 'TC-18',
    category: 'Tai Mũi Họng',
    profile: {
      fullName: 'Phan Thị Diễm',
      age: 24,
      gender: 'FEMALE',
      bmi: 20.1,
      medicalHistory: 'Viêm amidan hốc mủ tái đi tái lại nhiều lần trong năm, đau rát họng nuốt vướng',
      allergies: 'Không',
    },
    expectedKeywords: ['tai mũi họng'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Tai Mũi Họng'],
  },

  // Nhóm 10: Da liễu
  {
    id: 'TC-19',
    category: 'Da liễu',
    profile: {
      fullName: 'Dương Văn Khoa',
      age: 22,
      gender: 'MALE',
      bmi: 21.5,
      medicalHistory: 'Mụn trứng cá bọc vùng mặt và lưng, viêm da dầu, ngứa rát khi ra mồ hôi',
      allergies: 'Không',
    },
    expectedKeywords: ['da liễu', 'da'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Da liễu'],
  },
  {
    id: 'TC-20',
    category: 'Da liễu',
    profile: {
      fullName: 'Nguyễn Thị Hồng',
      age: 41,
      gender: 'FEMALE',
      bmi: 22.3,
      medicalHistory: 'Mề đay mạn tính vô căn, dị ứng thời tiết nổi sẩn phù ngứa toàn thân',
      allergies: 'Thời tiết lạnh',
    },
    expectedKeywords: ['da liễu'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Da liễu'],
  },

  // Nhóm 11: Khám sức khỏe tổng quát định kỳ (Người khỏe mạnh)
  {
    id: 'TC-21',
    category: 'Tổng quát định kỳ',
    profile: {
      fullName: 'Lâm Tuấn Kiệt',
      age: 25,
      gender: 'MALE',
      bmi: 21.7,
      medicalHistory: 'Khỏe mạnh bình thường, muốn kiểm tra sức khỏe tổng quát định kỳ hàng năm',
      allergies: 'Không',
    },
    expectedKeywords: ['tổng quát', 'cơ bản'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Nội tổng quát'],
  },
  {
    id: 'TC-22',
    category: 'Tổng quát định kỳ',
    profile: {
      fullName: 'Đoàn Thanh Trúc',
      age: 27,
      gender: 'FEMALE',
      bmi: 20.2,
      medicalHistory: 'Khỏe mạnh, chuẩn bị đi làm công ty mới cần kiểm tra sức khỏe tổng quát toàn diện',
      allergies: 'Không',
    },
    expectedKeywords: ['tổng quát', 'nữ', 'cơ bản'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Nội tổng quát', 'Sản – Phụ khoa'],
  },

  // Nhóm 12: Đa bệnh lý đồng mắc (Comorbidities) - Phức tạp cao
  {
    id: 'TC-23',
    category: 'Đa bệnh lý đồng mắc',
    profile: {
      fullName: 'Trần Đình Trọng',
      age: 63,
      gender: 'MALE',
      bmi: 28.1,
      medicalHistory: 'Tăng huyết áp vô căn + Đái tháo đường tuýp 2 đang dùng thuốc + Thoái hóa khớp gối',
      allergies: 'Không',
    },
    expectedKeywords: ['tim mạch', 'tiểu đường', 'nội tiết', 'chấn thương', 'khớp', 'tổng quát'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Tim mạch', 'Nội tiết – Đái tháo đường', 'Nội tổng quát'],
  },
  {
    id: 'TC-24',
    category: 'Đa bệnh lý đồng mắc',
    profile: {
      fullName: 'Bùi Thị Cúc',
      age: 68,
      gender: 'FEMALE',
      bmi: 25.8,
      medicalHistory: 'Tăng huyết áp 10 năm + Mỡ máu cao + Mắt nhìn mờ do biến chứng tiểu đường',
      allergies: 'Không',
    },
    expectedKeywords: ['tim mạch', 'tiểu đường', 'mắt', 'nội tiết', 'tổng quát'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Tim mạch', 'Nội tiết – Đái tháo đường', 'Mắt'],
  },
  {
    id: 'TC-25',
    category: 'Đa bệnh lý đồng mắc',
    profile: {
      fullName: 'Nguyễn Văn Sang',
      age: 52,
      gender: 'MALE',
      bmi: 27.0,
      medicalHistory: 'Viêm gan B mạn + Đau dạ dày trào ngược + Mỡ máu cao, thường xuyên uống bia rượu',
      allergies: 'Không',
    },
    expectedKeywords: ['tiêu hóa', 'gan mật', 'tim mạch', 'tổng quát'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Tiêu hóa – Gan mật', 'Nội tổng quát'],
  },

  // Nhóm 13: Ràng buộc an toàn lâm sàng (Negative Safety Tests)
  {
    id: 'TC-26',
    category: 'An toàn giới tính (Nam)',
    profile: {
      fullName: 'Lê Văn Hùng',
      age: 35,
      gender: 'MALE',
      bmi: 22.0,
      medicalHistory: 'Đau tức vùng hạ vị âm ỉ, tiểu buốt, đau thắt lưng',
      allergies: 'Không',
    },
    expectedKeywords: ['ngoại', 'tiêu hóa', 'tổng quát'],
    forbiddenKeywords: ['phụ khoa', 'thai sản', 'cổ tử cung', 'buồng trứng', 'mang thai', 'nữ'],
    expectedSpecialties: ['Ngoại tổng quát', 'Nội tổng quát'],
  },
  {
    id: 'TC-27',
    category: 'An toàn giới tính (Nữ)',
    profile: {
      fullName: 'Nguyễn Bích Ngọc',
      age: 45,
      gender: 'FEMALE',
      bmi: 23.2,
      medicalHistory: 'Tiểu rắt, đau hông lưng hai bên, tiểu đêm',
      allergies: 'Không',
    },
    expectedKeywords: ['nội tổng quát', 'phụ khoa'],
    forbiddenKeywords: ['nam khoa', 'tuyến tiền liệt', 'nam giới'],
    expectedSpecialties: ['Nội tổng quát', 'Sản – Phụ khoa'],
  },

  // Nhóm 14: Tái khám chuyên khoa (Follow-up Deterministic Match)
  {
    id: 'TC-28',
    category: 'Luật tái khám (Tim mạch)',
    profile: {
      fullName: 'Đặng Quốc Huy',
      age: 50,
      gender: 'MALE',
      bmi: 24.0,
      medicalHistory: 'Tái khám định kỳ theo hẹn chuyên khoa Tim mạch sau điều trị tăng huyết áp ổn định',
      allergies: 'Không',
    },
    // Giả lập đã có lịch hẹn hoàn tất chuyên khoa Tim mạch
    simulatedPastSpecialty: 'Tim mạch',
    expectedKeywords: ['tái khám', 'tim mạch'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Tim mạch'],
    isFollowUpTest: true,
  },
  {
    id: 'TC-29',
    category: 'Luật tái khám (Mắt)',
    profile: {
      fullName: 'Trần Thị Thu Trang',
      age: 28,
      gender: 'FEMALE',
      bmi: 21.0,
      medicalHistory: 'Tái khám mắt sau điều trị viêm kết mạc và kiểm tra lại thị lực kính',
      allergies: 'Không',
    },
    simulatedPastSpecialty: 'Mắt',
    expectedKeywords: ['tái khám', 'mắt'],
    forbiddenKeywords: ['nam khoa'],
    expectedSpecialties: ['Mắt'],
    isFollowUpTest: true,
  },
  {
    id: 'TC-30',
    category: 'Luật tái khám (Tai Mũi Họng)',
    profile: {
      fullName: 'Hoàng Minh Quân',
      age: 36,
      gender: 'MALE',
      bmi: 22.8,
      medicalHistory: 'Tái khám nội soi tai mũi họng sau đợt kháng sinh điều trị viêm xoang cấp',
      allergies: 'Không',
    },
    simulatedPastSpecialty: 'Tai Mũi Họng',
    expectedKeywords: ['tái khám', 'tai mũi họng'],
    forbiddenKeywords: ['phụ khoa'],
    expectedSpecialties: ['Tai Mũi Họng'],
    isFollowUpTest: true,
  },
];
export { TEST_CASES };

// Technical taxonomy annotations from actual package names/descriptions/symptoms.
// They extend specialty-only proxy labels; they are not clinician-reviewed judgments.
const PACKAGE_RELEVANCE_ANNOTATIONS = [
  { codePrefix: 'PKG-EYE-COMPREHENSIVE-', specialty: 'Mắt', evidence: 'thị lực' },
  { codePrefix: 'PKG-EYE-CATARACT-', specialty: 'Mắt', evidence: 'đáy mắt' },
  { codePrefix: 'PKG-ENT-ENDOSCOPY-', specialty: 'Tai Mũi Họng', evidence: 'tai mũi họng' },
  { codePrefix: 'PKG-CARDIO-SCREENING-', specialty: 'Tim mạch', evidence: 'tim mạch' },
  { codePrefix: 'PKG-GENERAL-BASIC-', specialty: 'Nội tổng quát', evidence: 'tổng quát' },
  { codePrefix: 'PKG-WOMEN-WELLNESS-', specialty: 'Sản – Phụ khoa', evidence: 'phụ khoa' },
];

export function buildEvaluationLabels(catalog) {
  const specialties = new Set(catalog.map(pkg => pkg.specialty?.name).filter(Boolean));
  return catalog.map(pkg => {
    if (pkg.specialty?.name) return { packageId: pkg.id, code: pkg.code,
      specialtyNames: [pkg.specialty.name], source: 'DB_SPECIALTY', reviewStatus: 'TECHNICAL_UNREVIEWED' };
    const annotation = PACKAGE_RELEVANCE_ANNOTATIONS.find(item => pkg.code.startsWith(item.codePrefix));
    const content = [pkg.name, pkg.description, ...(pkg.symptoms || [])].join(' ').toLowerCase();
    if (!annotation || !specialties.has(annotation.specialty) || !content.includes(annotation.evidence)) {
      throw new Error(`Package requires explicit evaluation-label review: ${pkg.code}`);
    }
    return { packageId: pkg.id, code: pkg.code, specialtyNames: [annotation.specialty],
      source: 'PACKAGE_CONTENT_ANNOTATION', evidence: annotation.evidence, reviewStatus: 'TECHNICAL_UNREVIEWED' };
  });
}

// Keep the existing command, but evaluate the real recommendation service.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const benchmark = path.join(path.dirname(fileURLToPath(import.meta.url)), 'benchmark-recommendations.cjs');
  const result = spawnSync(process.execPath, [benchmark, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
