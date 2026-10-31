import test from 'node:test';import assert from 'node:assert/strict';import {dataEntryDayView} from '../src/lib/dataEntryDayView.js';
test('daily payload keeps selected editable sheets and activity across local midnight without master duplication',()=>{
 const sheets={ 'Medbiomate-Jobs-2026-10-31-user':[{status:'Not Uploaded'}], 'Trikonet-Jobs-2026-10-30-user':[{uploadedAt:'2026-10-30T20:00:00Z'},{uploadedAt:'2026-10-30T10:00:00Z'},{activityType:'edited',uploadedAt:'2026-10-29T10:00:00Z',editedAt:'2026-10-31T05:00:00Z'}],__COMPANY_MASTER_SHEET_ENTRIES__:[{}]};
 const day=dataEntryDayView(sheets,'2026-10-31');assert.equal(day['Medbiomate-Jobs-2026-10-31-user'].length,1);assert.equal(day['Trikonet-Jobs-2026-10-30-user'].length,2);assert.equal(day.__COMPANY_MASTER_SHEET_ENTRIES__,undefined);assert.throws(()=>dataEntryDayView(sheets,'bad'));
});
test('edited activity uses its publication edit time even when metadata changes later',()=>{
 const row={activityType:'edited',editedAt:'2026-10-31T06:00:00Z',updatedAt:'2026-11-01T06:00:00Z'};
 assert.equal(Object.values(dataEntryDayView({'Medbiomate-Jobs-2026-10-01-a':[row]},'2026-10-31')).flat().length,1);
});
