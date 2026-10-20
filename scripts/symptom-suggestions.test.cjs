require('ts-node/register/transpile-only');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('.') && request.endsWith('.js') && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
  }
  return resolve.call(this, request, parent, ...rest);
};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AiRankingService } = require('../src/modules/recommendations/services/ai-ranking.service.ts');

function fixture(generate) {
  const service = new AiRankingService({ get: (key) => key === 'gemini.apiKey' ? 'test-key' : 'gemini-2.5-flash' });
  const logs = [];
  service.logger = { warn: (entry) => logs.push(entry), log: (entry) => logs.push(entry) };
  service.aiClient = { models: { generateContent: generate } };
  return { service, logs };
}

test('returns normalized unique suggestions from a structured response', async () => {
  const { service } = fixture(async (request) => {
    assert.equal(request.config.responseMimeType, 'application/json');
    assert.equal(request.config.httpOptions.timeout, 12000);
    return { text: '[" Đau  bụng ", "đau bụng", "buồn nôn", ""]' };
  });
  assert.deepEqual(await service.suggestSymptomsForPackage('Khám tiêu hóa', 'Tiêu hóa'), { symptoms: ['đau bụng', 'buồn nôn'] });
});

test('a valid empty array is distinguished from an unavailable provider', async () => {
  const { service } = fixture(async () => ({ text: '[]' }));
  assert.deepEqual(await service.suggestSymptomsForPackage('Gói chưa xác định'), { symptoms: [] });
  service.aiClient = null;
  await assert.rejects(service.suggestSymptomsForPackage('Gói khám'), (error) => error.getStatus() === 503);
});

test('invalid names are rejected before calling AI', async () => {
  const { service } = fixture(async () => { throw new Error('must not be called'); });
  await assert.rejects(service.suggestSymptomsForPackage(' '), (error) => error.getStatus() === 400);
});

test('empty or malformed AI output is an explicit error, not an empty success', async () => {
  for (const text of ['', 'not JSON', '{"symptoms":[]}', '[{"name":"đau đầu"}]']) {
    const { service } = fixture(async () => ({ text }));
    await assert.rejects(service.suggestSymptomsForPackage('Gói khám'), (error) => error.getStatus() === 502);
  }
});

test('quota and timeout errors are actionable and provider secrets are not logged', async () => {
  for (const [failure, expected] of [
    [{ status: 429, message: 'secret-key quota exceeded' }, 503],
    [{ name: 'AbortError', message: 'secret-key aborted' }, 504],
    [{ status: 401, message: 'secret-key rejected' }, 502],
  ]) {
    const { service, logs } = fixture(async () => { throw failure; });
    await assert.rejects(service.suggestSymptomsForPackage('Gói khám'), (error) => error.getStatus() === expected && !error.message.includes('secret-key'));
    assert.ok(logs.some((entry) => entry.includes('symptom_suggestions_failed')));
    assert.ok(logs.every((entry) => !entry.includes('secret-key')));
  }
});
