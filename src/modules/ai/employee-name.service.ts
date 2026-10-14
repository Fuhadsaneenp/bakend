/** Match names locally, only against the caller's already-authorized roster. */
export type NameRecord={id:string;employeeCode?:string|null;firstName:string;middleName?:string|null;lastName?:string|null};
const letters:Record<string,string>={
 'അ':'a','ആ':'aa','ഇ':'i','ഈ':'ii','ഉ':'u','ഊ':'uu','ഋ':'ri','എ':'e','ഏ':'ee','ഐ':'ai','ഒ':'o','ഓ':'oo','ഔ':'au',
 'ക':'k','ഖ':'kh','ഗ':'g','ഘ':'gh','ങ':'ng','ച':'ch','ഛ':'ch','ജ':'j','ഝ':'jh','ഞ':'nj','ട':'t','ഠ':'th','ഡ':'d','ഢ':'dh','ണ':'n','ത':'th','ഥ':'th','ദ':'d','ധ':'dh','ന':'n','പ':'p','ഫ':'f','ബ':'b','ഭ':'bh','മ':'m','യ':'y','ര':'r','റ':'r','ല':'l','ള':'l','ഴ':'zh','വ':'v','ശ':'sh','ഷ':'sh','സ':'s','ഹ':'h',
 'ാ':'aa','ി':'i','ീ':'ii','ു':'u','ൂ':'uu','ൃ':'ri','െ':'e','േ':'ee','ൈ':'ai','ൊ':'o','ോ':'oo','ൌ':'au','ൗ':'au','ം':'m','ഃ':'h','്':'','ൺ':'n','ൻ':'n','ർ':'r','ൽ':'l','ൾ':'l','ൿ':'k'
};
const ignored=new Set(['ഇന്ന്','ഇന്നലെ','ഇന്നത്തെ','ഇന്നലത്തെ','ഒന്ന്','ആരാണ്','ആരൊക്കെ','എത്ര','എന്ത്','എപ്പോൾ','ആണ്','ആയിരുന്നു','അത്','അവരുടെ','അയാളുടെ','വർക്ക്','ജോലി','ജോലിയുടെ','ഹാജർ','റിപ്പോർട്ട്','പറയൂ','പറയാമോ','കമ്പനിയുടെ','കമ്പനി','ടീമിന്റെ','വിഭാഗത്തിന്റെ','നേരത്തെ','വൈകി','എല്ലാവരും','today','yesterday','work','report','team','company','show','give','tell','hours','attendance','compare','with','and','the','of','my','me']);
const words=(value:string)=>value.normalize('NFC').toLowerCase().replace(/[\u200c\u200d]/g,'').match(/[\p{L}\p{M}\p{N}]+/gu)||[];
const roman=(value:string)=>Array.from(value).map(char=>letters[char]??char).join('').toLowerCase().replace(/[^a-z0-9]/g,'');
const sound=(value:string)=>roman(value).replace(/^sw(?=[aeiou])/,'s').replace(/ph/g,'f').replace(/qu|q/g,'k').replace(/dh/g,'d').replace(/th/g,'t').replace(/zh/g,'l').replace(/c(?!h)/g,'k').replace(/w/g,'v').replace(/[aeiou]/g,'').replace(/(.)\1+/g,'$1');
function variants(word:string):{key:string;weight:number}[]{
 const stem=word.replace(/(?:ിന്റെ|ിന്റെ|ന്റേ|ന്റെ|യുടെ|യുടേത്|യ്ക്കു|യ്ക്ക്|ക്കു|ക്ക്|നോട്|നെ|യെ|റെ)$/u,'').replace(/(?:'s|s')$/,'');
 const result=[{key:word,weight:0}];
 if(stem!==word&&stem.length>1){result.push({key:stem,weight:0});if(/ന്റെ|ിന്റെ|ിന്റെ/u.test(word))result.push({key:stem+'ൻ',weight:-8});}
 return result;
}
const fullName=(person:NameRecord)=>[person.firstName,person.middleName,person.lastName].filter(Boolean).join(' ');
function literal(text:string,value:string):boolean {
 if(!value)return false;
 const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,'iu').test(text);
}
export function matchEmployeeMention<T extends NameRecord>(text:string,roster:T[]):{matches:T[];ambiguous:boolean}{
 const tokens=[...new Set(words(text))].filter(word=>!ignored.has(word));
 const ranked=roster.map(person=>{
  if(literal(text,person.id)||person.employeeCode&&literal(text,person.employeeCode))return {person,score:10000,hits:['code']};
  if(literal(text,fullName(person)))return {person,score:5000,hits:['full-name']};
  const parts=words(fullName(person)).filter(part=>part.length>1);
  let score=0;const hits:string[]=[];
  for(const token of tokens){
   let best=0;
   for(const variant of variants(token))for(const part of parts){
    if(variant.key===part){best=Math.max(best,100+variant.weight);continue;}
    const raw=roman(variant.key),candidate=roman(part);
    if(raw.length>=3&&raw===candidate){best=Math.max(best,95+variant.weight);continue;}
    const key=sound(variant.key),other=sound(part);
    if(key.length>=3&&key===other)best=Math.max(best,80+variant.weight);
   }
   if(best>0){score+=best;hits.push(token);}
  }
  return {person,score,hits};
 });
 const best=Math.max(0,...ranked.map(row=>row.score));
 const winners=ranked.filter(row=>best>0&&row.score===best);
 const signatures=new Set(winners.map(row=>row.hits.slice().sort().join('|')));
 return {matches:winners.map(row=>row.person),ambiguous:winners.length>1&&signatures.size===1};
}
export async function resolveMalayalamEmployee(question:string,names:string[]):Promise<string|null>{
 const result=matchEmployeeMention(question,names.map(name=>({id:'name:'+name,firstName:name})));
 return result.matches.length===1?result.matches[0].firstName:null;
}
