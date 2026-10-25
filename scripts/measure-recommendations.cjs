// Export observed recommendation metrics without creating engagement or bookings.
require('ts-node/register/transpile-only');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('src/')) request = path.resolve(__dirname, '..', request);
  if (request.endsWith('.js') && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
  }
  return resolve.call(this, request, parent, ...rest);
};
const root = path.resolve(__dirname, '..');
process.chdir(root);
const envFile = process.env.ENV_FILE || '.env.development';
require('dotenv').config({ path: '.env', quiet: true });
require('dotenv').config({ path: envFile, override: true, quiet: true });
const { PrismaService } = require('../src/infrastructure/database/prisma/prisma.service.ts');
const { SearchAnalyticsService } = require('../src/modules/search-analytics/search-analytics.service.ts');

function parseArgs() {
  const args = process.argv.slice(2), query = {};
  let verify = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--verify') verify = true;
    else if (['--start', '--end'].includes(args[index]) && args[index + 1]) {
      const option = args[index].slice(2);
      query[option] = args[++index];
    }
    else throw new Error('Dùng: node scripts/measure-recommendations.cjs [--start ISO_DATE] [--end ISO_DATE] [--verify]');
  }
  return { query, verify };
}

function verifyTracking(directory) {
  const suites = [
    { name: 'backend', cwd: root, files: ['scripts/recommendation-measurement.test.cjs'], env: { RUN_RECOMMENDATION_DB_TESTS: '1' } },
    { name: 'frontend', cwd: path.resolve(root, '../fe_clinic_web'), files: ['scripts/recommendation-measurement.test.cjs', 'scripts/booking-checkout-flow.test.cjs'] },
  ];
  return suites.map(suite => {
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...suite.files], {
      cwd: suite.cwd, env: { ...process.env, ...suite.env }, encoding: 'utf8', timeout: 60000,
    });
    const output = (result.stdout || '') + (result.stderr || '') + (result.error ? '\n' + result.error.message : '');
    fs.writeFileSync(path.join(directory, `${suite.name}-verification.tap`), output);
    const count = key => Number(output.match(new RegExp(`^# ${key} (\\d+)`, 'm'))?.[1] || 0);
    return { suite: suite.name, exitCode: result.status, passed: count('pass'), failed: count('fail'), skipped: count('skipped'),
      cases: [...output.matchAll(/^# Subtest: (.+)$/gm)].map(match => match[1]) };
  });
}

const cell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const percentage = value => value === null ? 'Chưa có dữ liệu' : `${value}%`;
function table(rows, key) {
  return ['| Nhóm | Hiển thị | Bấm | Tạo giữ chỗ | Đặt thành công | Đã thanh toán | CTR | Chuyển đổi/hiển thị | Chuyển đổi/bấm |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(row => `| ${cell(row[key])} | ${row.impressions} | ${row.clicks} | ${row.checkouts} | ${row.bookings} | ${row.paid} | ${percentage(row.ctr)} | ${percentage(row.bookingRate)} | ${percentage(row.clickToBookingRate)} |`),
  ].join('\n');
}

async function main() {
  const { query, verify } = parseArgs();
  const prisma = new PrismaService();
  let observed;
  try {
    observed = await prisma.$transaction(async tx => {
      const service = new SearchAnalyticsService(tx, { getOrThrow() { throw new Error('Exporter không phát hành tracking token.'); } });
      const metrics = await service.recommendationMetrics(query);
      const where = { eventType: 'RECOMMEND_IMPRESSION', occurredAt: { gte: new Date(metrics.start), lt: new Date(metrics.end) } };
      const [first, last, identities] = await Promise.all([
        tx.analyticsInteraction.findFirst({ where, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
        tx.analyticsInteraction.findFirst({ where, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
        tx.$queryRaw`SELECT COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT account_id) AS accounts,
          COUNT(DISTINCT recommendation_id) AS responses FROM analytics_interactions
          WHERE event_type = 'RECOMMEND_IMPRESSION' AND occurred_at >= ${new Date(metrics.start)} AND occurred_at < ${new Date(metrics.end)}`,
      ]);
      return { ...metrics, coverage: { sessions: Number(identities[0].sessions), accounts: Number(identities[0].accounts),
        responses: Number(identities[0].responses), firstImpressionAt: first?.occurredAt.toISOString() || null,
        lastImpressionAt: last?.occurredAt.toISOString() || null } };
    }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
  } finally { await prisma.onModuleDestroy(); }

  const capturedAt = new Date().toISOString();
  const directory = path.join(root, 'reports', 'recommendations', capturedAt.replaceAll(':', '-'));
  fs.mkdirSync(directory, { recursive: true });
  const verification = verify ? verifyTracking(directory) : [];
  const report = { capturedAt, environmentFile: envFile,
    provenance: 'Existing database events; human-versus-test origin is not independently verified. No synthetic engagement is added by this exporter.',
    observed, verification };
  fs.writeFileSync(path.join(directory, 'metrics.json'), JSON.stringify(report, null, 2) + '\n');
  const columns = ['group', 'id', 'name', 'impressions', 'clicks', 'checkouts', 'bookings', 'paid', 'ctr', 'bookingRate', 'clickToBookingRate'];
  const rows = [{ group: 'TOTAL', ...observed.totals },
    ...observed.bySource.map(row => ({ group: 'SOURCE', id: row.source, ...row })),
    ...observed.byPackage.map(row => ({ group: 'PACKAGE', id: row.packageId, name: row.packageName, ...row })),
  ];
  const csvCell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  fs.writeFileSync(path.join(directory, 'metrics.csv'), '\uFEFF' + [columns.join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n'));
  const hasObservations = observed.totals.impressions > 0;
  const markdown = [
    '# Báo cáo đo lường hệ thống gợi ý gói khám', '',
    `Thời điểm chốt số liệu: ${capturedAt}. Nguồn cấu hình: \`${envFile}\`.`,
    `Khoảng hiển thị được xét: từ ${observed.start} (bao gồm) đến ${observed.end} (không bao gồm).`, '',
    '## Phạm vi và nguồn dữ liệu', '',
    'Số liệu dưới đây được đọc từ các sự kiện đã tồn tại trong PostgreSQL. Công cụ không sinh lượt xem, lượt bấm hoặc lịch đặt để tăng chỉ số. Nguồn sự kiện chưa được xác minh là người dùng thực hay thao tác thử trên môi trường phát triển.',
    `Ghi nhận ${observed.coverage.sessions} phiên truy cập, ${observed.coverage.accounts} tài khoản có sự kiện hiển thị và ${observed.coverage.responses} lần trả danh sách có ít nhất một gói được nhìn thấy. Phiên và tài khoản không tương đương số người tham gia thử nghiệm.`, '',
    '## Kết quả quan sát', '', table([{ name: 'Tổng cộng', ...observed.totals }], 'name'), '',
    ...(observed.bySource.length ? ['### Theo nguồn gợi ý', '', table(observed.bySource, 'source'), ''] : []),
    ...(observed.byPackage.length ? ['### Theo gói khám', '', table(observed.byPackage.map(row => ({ ...row, label: `${row.packageName || row.packageId} (${row.packageId})` })), 'label'), ''] : []),
    hasObservations
      ? 'Các giá trị trên mô tả hành vi đã ghi nhận. Chưa đủ cơ sở suy ra tác động nhân quả của LLM hoặc kết luận hiệu quả y khoa; chưa có phân nhóm A/B trong báo cáo này.'
      : '**Chưa có lượt hiển thị gợi ý trong khoảng được đo. CTR và tỷ lệ chuyển đổi chưa xác định; không được diễn giải thành hiệu quả bằng 0 hoặc sử dụng số liệu minh họa thay kết quả thực nghiệm.**', '',
    '## Quy tắc tính', '',
    '- Hiển thị: ít nhất 50% diện tích thẻ trong vùng nhìn thấy khi tab đang hiển thị; không yêu cầu thời gian lưu lại tối thiểu.',
    '- Mỗi gói được tính tối đa một hiển thị và một bấm trong cùng một lần trả danh sách. Bấm nhanh cũng xác nhận gói đã được nhìn thấy.',
    '- CTR = số bấm / số hiển thị × 100%; chuyển đổi/hiển thị = số bấm dẫn đến đặt thành công / số hiển thị × 100%; chuyển đổi/bấm = số bấm dẫn đến đặt thành công / số bấm × 100%.',
    '- Mẫu số bằng 0 được biểu diễn bằng null. Số chuyển đổi là số lượt bấm có ít nhất một lịch thành công, không phải tổng số lịch gia đình.',
    '- Lịch đặt phải khớp gói, phiên/tài khoản và được tạo trong vòng 24 giờ sau tương tác hợp lệ. Chỉ thấy gói nhưng không bấm chưa được tính chuyển đổi gợi ý.',
    '- Thành công tính theo BOOKED, CONFIRMED, CHECKED_IN, IN_EXAMINATION, COMPLETED, NO_SHOW; HOLD và CANCELLED không tính. NO_SHOW phản ánh đã đặt, không phản ánh đã đến khám.',
    '- Trạng thái lịch và hóa đơn được đọc tại thời điểm chốt số liệu. Lịch bị hủy sau đó có thể làm báo cáo xuất lại thay đổi.',
    '- PROFILE_AI là nhãn nguồn hồ sơ, không bảo đảm mọi kết quả nhóm này đã được LLM xử lý; hệ thống có cơ chế fallback theo quy tắc.', '',
    '## Kiểm chứng cơ chế đo', '',
    ...(verification.length ? verification.flatMap(result => [
      `### ${result.suite}`, '', `Kết quả: ${result.passed} đạt, ${result.failed} lỗi, ${result.skipped} bỏ qua; mã thoát ${result.exitCode}.`, '',
      ...result.cases.map(title => '- ' + title), '',
    ]) : ['Chưa chạy kiểm chứng tự động trong lần xuất này. Dùng --verify để chạy và lưu log.', '']),
    'Các kiểm thử tự động xác minh cơ chế ghi nhận và tính toán. Chúng không phải lượt tương tác tự nhiên của người bệnh và không được dùng làm mẫu để kết luận chất lượng gợi ý. Kiểm thử PostgreSQL tạo fixture trong transaction và rollback sau khi chạy; không gửi thanh toán hoặc thông báo ra ngoài.', '',
    '## Đoạn có thể đưa vào khóa luận', '',
    hasObservations
      ? `Tại thời điểm ${capturedAt}, hệ thống ghi nhận ${observed.totals.impressions} lượt hiển thị, ${observed.totals.clicks} lượt nhấn và ${observed.totals.bookings} lượt nhấn dẫn đến đặt lịch thành công trong khoảng khảo sát. CTR đạt ${percentage(observed.totals.ctr)}, tỷ lệ chuyển đổi từ hiển thị đạt ${percentage(observed.totals.bookingRate)}. Các kết quả mang tính mô tả trên dữ liệu môi trường được khảo sát; chưa chứng minh mức cải thiện so với hệ thống đối chứng.`
      : 'Hệ thống đã triển khai cơ chế thu thập sự kiện hiển thị, nhấn chọn và liên kết lịch đặt để tính CTR và tỷ lệ chuyển đổi. Tại thời điểm khảo sát, môi trường phát triển chưa có dữ liệu tương tác gợi ý trong khoảng đo, do đó chưa đủ cơ sở đánh giá hiệu quả sử dụng thực tế. Các kết quả kiểm thử chỉ xác nhận tính đúng đắn của cơ chế đo lường.', '',
    '## Tái lập', '',
    'Chạy tại be_clinic:', '', '```powershell', 'node scripts/measure-recommendations.cjs --verify', '```', '',
    'Có thể thêm --start và --end bằng thời gian ISO để chốt khoảng đo. Khoảng tối đa 90 ngày, mặc định 30 ngày. Các file metrics.json, metrics.csv và log TAP đi kèm là bằng chứng tái lập; không xuất tên hoặc hồ sơ sức khỏe người dùng.', '',
  ].join('\n');
  fs.writeFileSync(path.join(directory, 'bao-cao.md'), markdown);
  console.log(JSON.stringify({ reportDirectory: directory, totals: observed.totals, coverage: observed.coverage, verification: verification.map(({ cases, ...result }) => result) }, null, 2));
  if (verification.some(result => result.exitCode !== 0)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
