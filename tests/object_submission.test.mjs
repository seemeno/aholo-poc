import test from 'node:test';
import assert from 'node:assert/strict';
import {continueObjectJobs} from '../object_submission.mjs';

test('continuing a saved batch starts only drafts and rechecks an ambiguous previous start without resubmission',async()=>{
 const jobs=[{id:'a',state:'DRAFT'},{id:'b',state:'READY'},{id:'c',state:'SUBMIT_UNKNOWN'}];let starts=0;
 const json=async(url,options)=>{if(!options)return {jobs};starts++;assert.deepEqual(options.body.ids,['a']);jobs[0].state='QUEUED';throw Error('response lost after admission');};
 await assert.rejects(continueObjectJobs('project',['a','b','c'],json),/response lost/);
 await continueObjectJobs('project',['a','b','c'],json);assert.equal(starts,1);
 await assert.rejects(continueObjectJobs('project',['missing'],json),e=>e.kind==='missing');
});
