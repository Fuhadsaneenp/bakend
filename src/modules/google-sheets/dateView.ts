import { google } from './sheets.service.js';
/** Formula is relative to the first data row below header row 2. */
export const DATE_VIEW_FORMULA = '=OR($B3="",LOWER(TRIM($B$1))="all dates",IFERROR(INT($A3),IFERROR(DATEVALUE($A3),0))=IF(LOWER(TRIM($B$1))="today",TODAY(),IF(LOWER(TRIM($B$1))="yesterday",TODAY()-1,IFERROR(DATEVALUE($B$1),-1))))';
const metadataCache=new Map<string,{expires:number;data:any}>();
export async function applyDateView(companyId:string,spreadsheetId:string,title:string){
 const key=companyId+':'+spreadsheetId;let cached=metadataCache.get(key);
 if(!cached||cached.expires<Date.now()){cached={expires:Date.now()+25000,data:await google(companyId,spreadsheetId+'?fields=sheets(properties,basicFilter)')};metadataCache.set(key,cached);}
 const sheet=cached.data.sheets?.find((s:any)=>s.properties.title===title);if(!sheet)throw new Error('Date filter worksheet missing: '+title);
 const filter={...sheet.basicFilter,range:{sheetId:sheet.properties.sheetId,startRowIndex:1,endRowIndex:sheet.properties.gridProperties.rowCount,startColumnIndex:0,endColumnIndex:8},criteria:{...sheet.basicFilter?.criteria,'0':{condition:{type:'CUSTOM_FORMULA',values:[{userEnteredValue:DATE_VIEW_FORMULA}]}}}};
 // API cell writes do not run the bound onEdit trigger. Rebuild the filter after sync
 // so all old/new rows are evaluated, retaining platform/status criteria and sorting.
 await google(companyId,spreadsheetId+':batchUpdate',{method:'POST',body:JSON.stringify({requests:[{clearBasicFilter:{sheetId:sheet.properties.sheetId}},{setBasicFilter:{filter}}]})});
}
