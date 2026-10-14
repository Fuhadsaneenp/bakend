import { normalizeMalayalamProse } from "./malayalam-language.js";
import type { AIResponsePayload } from './ai.types.js';
/** Preserve verified wording and values while presenting legacy sources as prose. */
export function conversationalAnswer(reply: AIResponsePayload, language: string): AIResponsePayload {
 if(language==='ml')reply={...reply,markdown:normalizeMalayalamProse(reply.markdown),spokenReply:reply.spokenReply?normalizeMalayalamProse(reply.spokenReply):undefined};
 const text=reply.markdown;
 const t=reply.metrics?.totals;
 if(language!=='ml' && t && /recorded attendance hours|employees checked in|Company overview/.test(text) && !/\b(most|least|longest|late|early|missing|absent)\b/i.test(text)) {
  const facts=[t.checkedIn>0?`${t.checkedIn} of the ${t.employees} employees in scope have recorded check-ins`:'',t.approvedWfh>0?`${t.approvedWfh} have approved work-from-home arrangements`:'',t.approvedLeave>0?`${t.approvedLeave} have approved leave`:''].filter(Boolean);
  const work=[t.completedTasks>0?`${t.completedTasks} tasks were completed`:'',t.pendingTasks>0?`${t.pendingTasks} tasks remain pending`:'',t.overdueTasks>0?`${t.overdueTasks} tasks are overdue`:''].filter(Boolean);
  const paragraphs=[facts.length?facts.join('. ')+'.':'',work.length?'For work progress, '+work.join('. ')+'.':'',t.noAttendanceRecord>0?`Attendance records were not found for ${t.noAttendanceRecord} employees. That alone does not confirm absence.`:''].filter(Boolean);
  // Keep specific employee/hour questions and data-entry sections intact.
  if(paragraphs.length && !/\d+(?:\.\d+)? recorded attendance hours/.test(text) && !reply.metrics?.dataEntry) return {...reply,markdown:paragraphs.join('\n\n'),spokenReply:paragraphs.slice(0,2).join(' ')};
 }

 if(!/^\s*(?:#{1,6}\s|[-•*]\s)/m.test(text))return reply;
 const paragraphs=text.split(/\n\s*\n/).flatMap(block=>{
  const lines=block.split('\n').map(line=>line.trim()).filter(Boolean);
  const content=lines.filter(line=>!/^#{1,6}\s/.test(line)).map(line=>line.replace(/^[-•*]\s+/, '').replace(/\*\*/g,'').replace(/\s*·\s*/g, '. '));
  if(!content.length)return [];
  return [content.map(line=>/[.!?。]$/.test(line)?line:line+'.').join(' ')];
 });
 const markdown=paragraphs.join('\n\n');
 return {...reply,markdown,spokenReply:reply.spokenReply||paragraphs.slice(0,2).join(' ').slice(0,1100)};
}
