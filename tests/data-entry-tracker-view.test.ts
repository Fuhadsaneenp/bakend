import test from 'node:test';import assert from 'node:assert/strict';import {dataEntryTrackerView} from '../src/lib/dataEntryTrackerView.js';
test('tracker projection excludes employers, edits, old and draft rows and deduplicates operator aliases',()=>{
 const row={status:'Uploaded',uploadedAt:'2026-10-31T06:00:00Z',sourceUrl:'https://post.example/job',companyName:'Hospital',jobCount:1};
 const key='Medbiomate-Jobs-2026-10-31-a';const projected=dataEntryTrackerView({[key]:[row,{...row,sourceUrl:'old',uploadedAt:'2026-09-01T00:00:00Z'},{...row,sourceUrl:'draft',status:'Not Uploaded'},{...row,sourceUrl:'edited',activityType:'edited'}],'Medbiomate-Jobs-2026-10-31-b':[{...row,updatedAt:'2026-10-31T07:00:00Z',jobTitle:'Latest'}],'Medbiomate-Employer-2026-10-31-a':[row]});
 const rows=Object.values(projected).flat();assert.equal(rows.length,1);assert.equal(rows[0].jobTitle,'Latest');
});
test('invalid later aliases do not hide valid tracker jobs; cached snapshots are reused',()=>{
 const row={status:'Uploaded',uploadedAt:'2026-10-31T06:00:00Z',sourceUrl:'https://example.test/job',companyName:'Hospital',categoryCounts:{Nurse:2}};
 const sheets={'Medbiomate-Jobs-2026-10-31-a':[row,{...row,updatedAt:'2026-11-01T06:00:00Z',jobCount:0}]};
 const result=dataEntryTrackerView(sheets);assert.equal(Object.values(result).flat().length,1);assert.equal(Object.values(result).flat()[0],row);assert.equal(dataEntryTrackerView(sheets),result);
});
