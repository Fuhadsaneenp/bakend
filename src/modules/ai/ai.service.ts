import { previousPeriod } from "./verified-query.js";
import { identifyReadOnlyQuery } from "./query-intent.service.js";
import { formatMalayalamReport } from "./malayalam-report.js";
import { dataEntryAnswer, shouldUseDataEntryTrack } from "./data-entry-answer.service.js";
import type { UserContext, AIResponsePayload } from './ai.types.js';
import { verifiedAnalyticsService } from './verified-analytics.service.js';
export const aiService = {
  async processQuestion(user: UserContext, question: string, language = 'en', history: {role:'user'|'assistant';text:string}[] = [], voiceMode = false): Promise<AIResponsePayload> {
    const q = question.trim();
    if (/^(hi|hello|hey|hai|good morning|good evening|namaskaram|നമസ്കാരം)[!. ]*$/i.test(q)) return { intent:'GENERAL_WORKPLACE_QUERY',markdown:language==='ml'?'നമസ്കാരം! ഞാൻ STEMS AI — Tale Buddy. എന്താണ് അറിയേണ്ടത്?':"Hello! I'm STEMS AI — Tale Buddy. What would you like to know?" };
    if (/who are you|your name|created you|ആരാണ് നീ/i.test(q)) return { intent:'GENERAL_WORKPLACE_QUERY',markdown:language==='ml'?'ഞാൻ STEMS AI — Tale Buddy. അനുമതിയുള്ള STEMS രേഖകളിൽ നിന്ന് ജോലിയും ഹാജറും സംബന്ധിച്ച ചോദ്യങ്ങൾക്ക് മറുപടി നൽകുന്നു.':"I'm STEMS AI — Tale Buddy, Second Tales' assistant for authorized attendance, work and employee reporting." };
    if (/\b(delete|terminate|fire|resign|change salary|update employee|approve leave)\b/i.test(q) && !/who|show|history|report|employees who/.test(q.toLowerCase())) return {intent:'GENERAL_WORKPLACE_QUERY',markdown:'This assistant supports read-only reporting. Use the authorized STEMS workflow for employee or record changes.'};
    if (/keyword ranking|seo ranking|google position|page 1/i.test(q)) return { intent:'SEO_KEYWORD_RANKINGS', markdown:'A verified SEO keyword ranking source is not connected to this assistant. Ranking values cannot be confirmed.' };
    const plan = await identifyReadOnlyQuery(q, history);
    if(await shouldUseDataEntryTrack(user,q,plan))plan.kind='data-entry';
    const dataEntryReply = plan.kind === "data-entry" ? await dataEntryAnswer(user, plan.subjectText, language, plan) : null;
    if (dataEntryReply) {
      if(plan.compare && dataEntryReply.metrics?.source === 'live_data_entry_sheets') {
        const previous = previousPeriod(plan);
        const old = await dataEntryAnswer(user, plan.subjectText, language, {...plan,...previous,compare:false});
        if(old?.metrics?.source === 'live_data_entry_sheets') {
          const labels = language === 'ml' ? ['പുതിയ ജോബുകൾ','അപ്ഡേറ്റ് ചെയ്ത ജോബുകൾ'] : ['Jobs published','Jobs updated'];
          const current=dataEntryReply.metrics, before=old.metrics;
          dataEntryReply.markdown += `\n\n**${language==='ml'?'മുൻ കാലയളവുമായി താരതമ്യം':'Previous-period comparison'} (${previous.start}–${previous.end})**\n` + ['created','edited'].filter(key=>current[key]>0||before[key]>0).map((key,index)=>`- ${labels[key==='created'?0:1]}: ${before[key]} → ${current[key]}`).join('\n');
          current.comparison=before;
        }
      }
      return dataEntryReply;
    }
    const {report,markdown} = await verifiedAnalyticsService.answer(user,q,history,plan);
    let answer = markdown;
    const localized = language === 'ml' ? formatMalayalamReport(report, markdown) : undefined;
    if (localized) answer = localized.markdown;
    let overviewDataEntry: Record<string,any> | undefined;
    if(plan.kind==='overview') {
      try {
        const entries=await dataEntryAnswer(user, 'data entry', language, {...plan,kind:'data-entry',metric:'summary',compare:false,employee:undefined,department:undefined});
        if(entries?.metrics?.source==='live_data_entry_sheets') {
          overviewDataEntry=entries.metrics;
          const created=Number(entries.metrics.created||0), edited=Number(entries.metrics.edited||0);
          if(created+edited>0) {
            const lines=[created?(language==='ml'?`${created} പുതിയ ജോബുകൾ പ്രസിദ്ധീകരിച്ചിട്ടുണ്ട്`:`${created} new jobs were published`):'',edited?(language==='ml'?`${edited} ജോബുകൾ അപ്ഡേറ്റ് ചെയ്തിട്ടുണ്ട്`:`${edited} jobs were updated`):''].filter(Boolean);
            answer+=`\n\n${language==='ml'?'ഡാറ്റാ എൻട്രിയുടെ കാര്യത്തിൽ, ':'For Data Entry, '}${lines.join('. ')}.`;
            if(localized) localized.spokenReply+=` ഡാറ്റാ എൻട്രിയിൽ ${created+edited} ജോബ് പ്രവർത്തനങ്ങളും രേഖപ്പെടുത്തിയിട്ടുണ്ട്.`;
          }
        }
      } catch {
        answer+='\n\n'+(language==='ml'?'ഡാറ്റാ എൻട്രി സ്രോതസ്സ് ഇപ്പോൾ ലഭ്യമല്ല; അതിന്റെ കണക്ക് ഈ സംഗ്രഹത്തിൽ സ്ഥിരീകരിച്ചിട്ടില്ല.':'The Data Entry source is unavailable; its counts are not confirmed in this overview.');
      }
    }
    return {intent:'GENERAL_WORKPLACE_QUERY',markdown:answer,spokenReply:localized?.spokenReply,metrics:{source:"live_database",retrievedAt:report.sourceTimestamp,period:{start:report.plan.start,end:report.plan.end},timezone:report.timezone,sourceTimestamp:report.sourceTimestamp,sources:report.sources,dataGaps:report.gaps,dataEntry:overviewDataEntry,totals:report.totals},reportTable:report.plan.detailed?{title:`${report.plan.start}–${report.plan.end}`,headers:['Employee','Value','Unit','Recorded details'],rows:report.rows.slice(0,50).map(row=>[row.name,String(row.value),row.unit,row.details||''])}:undefined,suggestedFollowUps:['Show a detailed report','Compare with the previous month']};
  },
  getSuggestedPrompts(role:string):string[] {
    if (['SUPER_ADMIN','HR_ADMIN'].includes(role)) return ["Show today's attendance report",'Who published the most jobs today?','Show last month’s employee exit history','Show the monthly approved performance report'];
    if (['MANAGER','TEAM_LEAD'].includes(role)) return ["Show my team's pending tasks",'Which employees have missing checkout records?','Compare this month with last month'];
    return ['Show my pending tasks','How many hours did I work yesterday?','What is my KPI?','Show my leave balance'];
  }
};
