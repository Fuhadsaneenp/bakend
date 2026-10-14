/** Local grammar and speech preparation; no model call or data transfer. */
export function normalizeMalayalamProse(text:string):string {
 return text
  .replace(/(?<![\d.])1\s+പേർക്കും/g,'ഒരാൾക്കും')
  .replace(/(?<![\d.])1\s+പേർക്ക്/g,'ഒരാൾക്ക്')
  .replace(/(?<![\d.])1\s+പേരുടെ/g,'ഒരാളുടെ')
  .replace(/(?<![\d.])1\s+പേർ/g,'ഒരാൾ')
  .replace(/(?<![\d.])1\s+ടാസ്കുകൾ/g,'ഒരു ടാസ്ക്')
  .replace(/(?<![\d.])1\s+പുതിയ ജോബുകൾ/g,'ഒരു പുതിയ ജോബ്')
  .replace(/(?<![\d.])1\s+ജോബുകൾ/g,'ഒരു ജോബ്')
  .replace(/(?<![\d.])1\s+ജീവനക്കാരുടെ/g,'ഒരാളുടെ')
  .replace(/(?<![\d.])1\s+ദിവസത്തെ/g,'ഒരു ദിവസത്തെ')
  .replace(/(?<![\d.])1\s+ദിവസം/g,'ഒരു ദിവസം')
  .replace(/(?<![\d.])1\s+മണിക്കൂർ/g,'ഒരു മണിക്കൂർ')
  .replace(/(?<![\d.])1\s+മിനിറ്റ്/g,'ഒരു മിനിറ്റ്');
}
export function prepareMalayalamSpeech(text:string):string {
 const small=['പൂജ്യം','ഒരു','രണ്ട്','മൂന്ന്','നാല്','അഞ്ച്','ആറ്','ഏഴ്','എട്ട്','ഒൻപത്','പത്ത്','പതിനൊന്ന്','പന്ത്രണ്ട്','പതിമൂന്ന്','പതിനാല്','പതിനഞ്ച്','പതിനാറ്','പതിനേഴ്','പതിനെട്ട്','പത്തൊമ്പത്'];
 const number=(n:number):string=>n<20?small[n]:n%10===0?({20:'ഇരുപത്',30:'മുപ്പത്',40:'നാല്പത്',50:'അമ്പത്'} as Record<number,string>)[n]:({2:'ഇരുപത്തി',3:'മുപ്പത്തി',4:'നാല്പത്തി',5:'അമ്പത്തി'} as Record<number,string>)[Math.floor(n/10)]+(n%10===1?'യൊന്ന്':small[n%10]);
 const clock=(hour:string,minute:string,meridiem:string,suffix?:string)=>{
  const h=Number(hour),m=Number(minute);if(h<1||h>12||m<0||m>59)return `${hour}:${minute} ${meridiem}`;
  const pm=meridiem.toLowerCase()==='pm';
  const part=pm?(h===12||h<4?'ഉച്ചയ്ക്ക്':h<7?'വൈകുന്നേരം':'രാത്രി'):(h===12||h<5?'പുലർച്ചെ':'രാവിലെ');
  const ending=suffix==='നാണ്'?(m?'മിനിറ്റിനാണ്':'മണിക്കാണ്'):suffix==='നുമാണ്'?(m?'മിനിറ്റിനുമാണ്':'മണിക്കുമാണ്'):suffix==='നും'?(m?'മിനിറ്റിനും':'മണിക്കും'):suffix==='ന്'?(m?'മിനിറ്റിന്':'മണിക്ക്'):(m?'മിനിറ്റ്':'മണി');
  return `${part} ${number(h)} ${m?'മണി '+number(m)+' ':''}${ending}`;
 };
 return normalizeMalayalamProse(text).replace(/[*#`]/g,'')
  .replace(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b(?:-(നുമാണ്|നാണ്|നും|ന്))?/gi,(_,h,m,ap,suffix)=>clock(h,m,ap,suffix))
  .replace(/\bWFH\b/gi,'വീട്ടിൽനിന്നുള്ള ജോലി')
  .replace(/\bKPI\b/g,'കെ പി ഐ').replace(/\bSTEMS\b/gi,'സ്റ്റെംസ്')
  .replace(/\bcheck[ -]?in\b/gi,'ചെക്ക് ഇൻ').replace(/\bcheck[ -]?out\b/gi,'ചെക്ക് ഔട്ട്');
}
