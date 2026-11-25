const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scorePool,digest}=require('./score-pool.cjs');
function fixture() {
  const queryJudgments=[{caseId:'a',query:'a',group:'keyword',intentStatus:'clear'},
    {caseId:'b',query:'b',group:'keyword',intentStatus:'clear'},
    {caseId:'n',query:'n',group:'keyword',intentStatus:'no_advertised_service'},
    {caseId:'u',query:'u',group:'keyword',intentStatus:'ambiguous'}];
  const run={complete:true,metadata:{catalogHash:'frozen'},rows:queryJudgments.flatMap(q=>['KEYWORD_ONLY','HYBRID_GEMINI'].map(method=>({
    id:q.caseId,query:q.query,method,status:'success',latencyMs:1,
    packageIds:q.caseId==='a'?(method==='KEYWORD_ONLY'?[1]:[2]):q.caseId==='b'?[3]:q.caseId==='n'?(method==='KEYWORD_ONLY'?[]:[4]):[5],
  })))};
  const rows=[['a',1,0],['a',2,1],['b',3,'unclear'],['n',4,0],['u',5,'unclear']].map(([caseId,packageId,textRelevant])=>({
    caseId,query:caseId,packageId,textRelevant,conditionVerdict:'not_applicable',reason:'fixture only',assessor:'fixture',
  }));
  return {run,judgments:{metadata:{runHash:digest(run),catalogHash:'frozen'},queryJudgments,rows}};
}
test('both methods use the same paired cases; unclear is not silently scored as zero',()=>{
  const f=fixture(),r=scorePool(f.judgments,f.run);
  assert.equal(r.coverage.pairedTop1Queries,1);
  assert.equal(r.summaries.all.methods.KEYWORD_ONLY.top1,0);
  assert.equal(r.summaries.all.methods.HYBRID_GEMINI.top1,1);
  assert.deepEqual(r.coverage.unresolvedPairedCaseIds,['b']);
  assert.equal(r.summaries.all.methods.KEYWORD_ONLY.top1UpperBound,0.5);
});
test('absence and ambiguity are evaluated separately from relevance',()=>{
  const f=fixture(),r=scorePool(f.judgments,f.run);
  assert.equal(r.summaries.all.methods.KEYWORD_ONLY.correctEmptyRate,1);
  assert.equal(r.summaries.all.methods.HYBRID_GEMINI.correctEmptyRate,0);
  assert.deepEqual(r.coverage.ambiguousQueryIds,['u']);
});
test('every returned Top-5 item requires a real judgment and matching query provenance',()=>{
  const f=fixture();f.judgments.rows=f.judgments.rows.filter(row=>row.packageId!==2);
  assert.throws(()=>scorePool(f.judgments,f.run),/Missing pool label/);
  const other=fixture();other.run.rows[0].query='changed';
  assert.throws(()=>scorePool(other.judgments,other.run),/another run/);
});
test('a text-relevant result with a failed condition is not reported as full compliance',()=>{
  const f=fixture();f.judgments.rows.find(row=>row.packageId===2).conditionVerdict='fail';
  const r=scorePool(f.judgments,f.run);
  assert.equal(r.summaries.all.methods.HYBRID_GEMINI.top1,1);
  assert.equal(r.summaries.all.methods.HYBRID_GEMINI.relatedTop1Conditions.fail,1);
});
