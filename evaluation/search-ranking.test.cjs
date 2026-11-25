// Run after compiling the backend: node node_modules/typescript/bin/tsc
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SearchRankingService } = require('../dist/modules/search/services/search-ranking.service.js');

const pkg = (id, name, extra = {}) => ({ id, name, code: `PKG-${id}`, description: '',
  specialtyName: '', symptoms: [], price: 100000, durationMin: 20, specialtyId: null, ...extra });
function ranker(hits = []) {
  return new SearchRankingService({
    embedSearchQuery: async () => [1],
    retrieveVectorCandidates: async () => hits,
  });
}

test('RRF combines ranks, promotes agreement and counts duplicate vector hits only once', async () => {
  const exact = pkg(1, 'Tim mạch');
  const keyword = pkg(2, 'Gói khám Tim mạch');
  const semantic = pkg(3, 'Đánh giá sức khỏe hệ tuần hoàn');
  const other = pkg(4, 'Tư vấn sức khỏe');
  const service = ranker([{ package: semantic, score: 0.99 }, { package: keyword, score: 0.98 },
    { package: exact, score: 0.85 }, { package: semantic, score: 0.97 }, { package: other, score: 0.90 }]);
  const packages = [keyword, semantic, exact, other];
  const result = await service.rank('tim mạch', packages);
  assert.deepEqual(result.map(row => row.package.id), [2, 1, 3, 4]);
  assert.equal(result[0].score, 2 / 62);
  assert.equal(result[1].score, 1 / 61 + 1 / 64);
  assert.equal(result[2].score, 1 / 61);
  assert.equal(result[3].score, 1 / 63);
  assert.deepEqual((await service.rank('tim mạch', packages, 2)).map(row => row.package.id), [2, 1]);
});

test('keywords match only package and specialty names, without field weights or double counting', async () => {
  const items = [
    pkg(1, 'Gói dịch vụ', { code: 'tim mạch' }),
    pkg(2, 'Dịch vụ chuyên sâu', { description: 'tim mạch' }),
    pkg(3, 'Dịch vụ khác', { symptoms: ['tim mạch'] }),
    pkg(4, 'Gói khám Tim mạch'),
    pkg(5, 'Tư vấn sức khỏe', { specialtyName: 'Tim mạch' }),
    pkg(6, 'Gói khám Tim mạch', { specialtyName: 'Gói Tim mạch' }),
  ];
  const results = await ranker().rank('tim mạch', items, 10, { semantic: false });
  assert.deepEqual(results.map(row => row.package.id), [5, 4, 6]);
  assert.deepEqual(results.map(row => row.score), [5, 4, 4]);
});

test('semantic matches have no cutoff but still respect constraints, exclusions and score order', async () => {
  const allowed = pkg(1, 'Đánh giá sức khỏe hệ tuần hoàn');
  const next = pkg(2, 'Kiểm tra chức năng tim');
  const expensive = pkg(3, 'Gói chăm sóc chuyên sâu', { price: 500000 });
  const low = pkg(4, 'Dịch vụ sức khỏe');
  const service = ranker([{ package: next, score: 0.86 }, { package: expensive, score: 0.99 },
    { package: low, score: 0.81 }, { package: allowed, score: 0.95 }]);
  const result = await service.rank('tim mạch dưới 500 nghìn', [next, expensive, low, allowed]);
  assert.deepEqual(result.map(row => row.package.id), [1, 2, 4]);
  assert.deepEqual(result.map(row => row.score), [1 / 61, 1 / 62, 1 / 63]);
  const excluded = await service.rank('tim mạch, không kiểm tra chức năng tim', [allowed, next]);
  assert.deepEqual(excluded.map(row => row.package.id), [1]);
});

test('keyword-only comparison and constraint-only queries do not call embedding', async () => {
  const service = new SearchRankingService({ embedSearchQuery: async () => { throw new Error('Unexpected embedding call'); } });
  const items = [pkg(1, 'Tim mạch'), pkg(2, 'Mắt')];
  assert.deepEqual((await service.rank('tim mạch', items, 10, { semantic: false })).map(row => row.package.id), [1]);
  assert.equal((await service.rank('dưới 500 nghìn', items)).length, 2);
});

test('vector outage preserves keyword results and reports unavailable for unmatched queries', async () => {
  const service = new SearchRankingService({ embedSearchQuery: async () => null });
  const items = [pkg(1, 'Tim mạch')];
  const result = await service.rank('tim mạch', items);
  assert.deepEqual(result.map(row => row.package.id), [1]);
  assert.equal(result[0].score, 1 / 61);
  await assert.rejects(service.rank('thị lực', items), error => error.getStatus() === 503);
});

test('RRF uses positions rather than raw score magnitudes and breaks ties deterministically', async () => {
  const keyword = pkg(1, 'Tim mạch');
  const semantic = pkg(2, 'Đánh giá sức khỏe hệ tuần hoàn');
  const packages = [semantic, keyword];
  const high = await ranker([{ package: semantic, score: 0.99 }]).rank('tim mạch', packages);
  const low = await ranker([{ package: semantic, score: 0.01 }]).rank('tim mạch', [...packages].reverse());
  assert.deepEqual(high, low);
  assert.deepEqual(high.map(row => row.package.id), [1, 2]);
  assert.deepEqual(high.map(row => row.score), [1 / 61, 1 / 61]);
});

test('both retrieval windows are bounded and fusion happens before the final limit', async () => {
  const packages = Array.from({ length: 51 }, (_, i) => pkg(i + 1, `Gói khám Tim mạch ${i + 1}`));
  const service = ranker([{ package: packages[50], score: 0.9 }]);
  const result = await service.rank('tim mạch', packages, 100);
  assert.equal(result.length, 51);
  assert.equal(result.find(row => row.package.id === 51).score, 1 / 61);
  assert.equal(result.find(row => row.package.id === 50).score, 1 / 110);
  assert.deepEqual((await service.rank('tim mạch', packages, 2)).map(row => row.package.id), [1, 51]);
});

test('healthy empty vector results remain empty or produce single-retriever RRF', async () => {
  const service = ranker();
  const packages = [pkg(1, 'Tim mạch')];
  assert.deepEqual(await service.rank('thị lực', packages), []);
  assert.equal((await service.rank('tim mạch', packages))[0].score, 1 / 61);
});

test('vector exceptions fall back to keyword ranking without bypassing filters', async () => {
  const service = new SearchRankingService({ embedSearchQuery: async () => { throw new Error('Provider offline'); } });
  const packages = [pkg(1, 'Tim mạch', { price: 600000 }), pkg(2, 'Gói khám Tim mạch')];
  const result = await service.rank('tim mạch dưới 500 nghìn', packages);
  assert.deepEqual(result.map(row => row.package.id), [2]);
  assert.equal(result[0].score, 1 / 61);
});
