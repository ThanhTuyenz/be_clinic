const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const METHODS=['KEYWORD_ONLY','HYBRID_GEMINI'];
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;

function scorePool(judgments,run) {
  assert.equal(run.complete,true,'Search collection is incomplete');
  assert.equal(judgments.metadata.runHash,digest(run),'Judgments refer to another run');
  assert.equal(judgments.metadata.catalogHash,run.metadata.catalogHash,'Catalog mismatch');
  const cases=new Map(judgments.queryJudgments.map(row=>[row.caseId,row]));
  assert.equal(cases.size,judgments.queryJudgments.length,'Duplicate query judgments');
  const labels=new Map();
  for(const row of judgments.rows) {
    const key=`${row.caseId}:${row.packageId}`;
    assert.ok(!labels.has(key),`Duplicate judgment ${key}`);
    assert.ok([0,1,'unclear'].includes(row.textRelevant),`Unjudged pair ${key}`);
    assert.ok(['pass','fail','unknown','not_applicable'].includes(row.conditionVerdict),`Unjudged condition ${key}`);
    assert.ok(row.reason?.trim()&&row.assessor?.trim(),`Missing rationale/assessor ${key}`);
    assert.equal(cases.get(row.caseId)?.query,row.query,`Judgment query mismatch ${key}`);
    labels.set(key,row);
  }
  const rows=[],seen=new Set();
  for(const result of run.rows) {
    const query=cases.get(result.id);
    assert.ok(query,`Missing query judgment ${result.id}`);
    assert.equal(query.query,result.query,`Run query changed ${result.id}`);
    assert.equal(result.status,'success',`Run failure/fallback ${result.id}`);
    assert.ok(METHODS.includes(result.method),'Unknown method');
    const key=`${result.id}:${result.method}`;
    assert.ok(!seen.has(key),`Duplicate run ${key}`);seen.add(key);
    assert.ok(['clear','ambiguous','no_advertised_service'].includes(query.intentStatus),`Unjudged query ${result.id}`);
    for(const id of result.packageIds.slice(0,5)) assert.ok(labels.has(`${result.id}:${id}`),`Missing pool label ${result.id}:${id}`);
    const first=result.packageIds[0];
    const label=first===undefined?null:labels.get(`${result.id}:${first}`);
    rows.push({caseId:result.id,group:query.group,query:query.query,method:result.method,
      intentStatus:query.intentStatus,firstPackageId:first??null,firstPackageName:label?.name||null,
      textTop1:query.intentStatus==='ambiguous'?null:label?label.textRelevant:0,
      conditionVerdict:label?.conditionVerdict||'not_returned',conditionReason:label?.conditionReason||'',
      judgmentReason:label?.reason||'Không có kết quả trả về.',packageIds:result.packageIds,
      correctEmpty:query.intentStatus==='no_advertised_service'?Number(result.packageIds.length===0):null,
      latencyMs:result.latencyMs});
  }
  for(const query of cases.values())for(const method of METHODS) assert.ok(seen.has(`${query.caseId}:${method}`),`Missing run ${query.caseId}:${method}`);
  const allCases=[...cases.values()];
  const clear=allCases.filter(query=>query.intentStatus==='clear');
  const pairable=query=>METHODS.every(method=>[0,1].includes(rows.find(row=>row.caseId===query.caseId&&row.method===method).textTop1));
  const paired=clear.filter(pairable);
  const groups=[...new Set(allCases.map(query=>query.group))];
  const summaries={};
  for(const group of [...groups,'all']) {
    const eligible=clear.filter(query=>group==='all'||query.group===group);
    const pairedCases=paired.filter(query=>group==='all'||query.group===group);
    const pairedIds=new Set(pairedCases.map(query=>query.caseId));
    const methods={};
    for(const method of METHODS) {
      const all=rows.filter(row=>row.method===method&&(group==='all'||row.group===group));
      const scored=all.filter(row=>pairedIds.has(row.caseId));
      const clearRows=all.filter(row=>row.intentStatus==='clear');
      const positives=scored.filter(row=>row.textTop1===1);
      const correct=positives.length;
      const unclear=clearRows.filter(row=>row.textTop1==='unclear').length;
      const knownCorrect=clearRows.filter(row=>row.textTop1===1).length;
      const negatives=all.filter(row=>row.intentStatus==='no_advertised_service');
      methods[method]={pairedN:scored.length,correctTop1:correct,top1:mean(scored.map(row=>row.textTop1)),
        clearQueryN:clearRows.length,unresolvedTop1:unclear,
        top1LowerBound:clearRows.length?knownCorrect/clearRows.length:null,
        top1UpperBound:clearRows.length?(knownCorrect+unclear)/clearRows.length:null,
        noServiceN:negatives.length,correctEmpty:negatives.filter(row=>row.correctEmpty===1).length,
        correctEmptyRate:mean(negatives.map(row=>row.correctEmpty)),
        relatedTop1Conditions:Object.fromEntries(['pass','fail','unknown','not_applicable'].map(verdict=>
          [verdict,positives.filter(row=>row.conditionVerdict===verdict).length]))};
    }
    summaries[group]={clearQueryN:eligible.length,pairedN:pairedCases.length,
      excludedUnclearCaseIds:eligible.filter(query=>!pairedIds.has(query.caseId)).map(query=>query.caseId),methods};
  }
  return {assessmentType:'AI_ASSISTED_POOLED_RELEVANCE_EXPLORATORY',
    metadata:{scoredAt:new Date().toISOString(),runHash:digest(run),judgmentsHash:digest(judgments),
      catalogHash:run.metadata.catalogHash,queryCount:allCases.length,judgedPairCount:judgments.rows.length,
      independentlyReviewed:false,clinicallyReviewed:false,newSearchRequests:0,
      metric:'Top-1 direct advertised text relevance; condition verdict is separate, not full clinical/service compliance',
      pairedPolicy:'Identical clear cases with binary Top-1 judgments for both methods; unclear excluded from both, coverage and bounds retained',
      limitation:'Same assistant knows prior results. AI proxy judgments, not blinded human gold standard. Do not infer global recall from pool.'},
    coverage:{totalQueries:allCases.length,clearQueries:clear.length,pairedTop1Queries:paired.length,
      ambiguousQueryIds:allCases.filter(query=>query.intentStatus==='ambiguous').map(query=>query.caseId),
      noServiceQueries:allCases.filter(query=>query.intentStatus==='no_advertised_service').length,
      unresolvedPairedCaseIds:clear.filter(query=>!pairable(query)).map(query=>query.caseId),
      unclearPairs:judgments.rows.filter(row=>row.textRelevant==='unclear').length},summaries,rows};
}

if(require.main===module) {
  const base=__dirname;
  const judgments=JSON.parse(fs.readFileSync(path.join(base,'pool.judgments.ai.json')));
  const run=JSON.parse(fs.readFileSync(path.join(base,'results.gemini.v3.json')));
  const report=scorePool(judgments,run);
  fs.writeFileSync(path.join(base,'pool.report.ai.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  const headers=['caseId','group','query','method','intentStatus','firstPackageId','firstPackageName','textTop1','conditionVerdict','conditionReason','correctEmpty','judgmentReason'];
  fs.writeFileSync(path.join(base,'pool.report.ai.csv'),'\uFEFF'+[headers,...report.rows.map(row=>headers.map(key=>row[key]))]
    .map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n',{flag:'wx'});
  console.log(JSON.stringify({coverage:report.coverage,summaries:report.summaries},null,2));
}
module.exports={scorePool,digest};
