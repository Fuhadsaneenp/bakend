import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { employeeService } from '../modules/employees/employee.service.js';
import { accessResolverService } from '../modules/authority/access-resolver.service.js';
import { scopeResolverService } from '../modules/authority/scope-resolver.service.js';
import { workTrackService } from '../modules/work-track/work-track.service.js';

export const mcpEvidenceRouter = Router();
mcpEvidenceRouter.use(requireAuth);
mcpEvidenceRouter.get('/work-evidence', async (req, res, next) => {
  try {
    const input=z.object({employeeId:z.string().optional(),dateFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),dateTo:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(req.query);
    const start=new Date(`${input.dateFrom}T00:00:00+05:30`);const end=new Date(`${input.dateTo}T23:59:59.999+05:30`);
    if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<start||+end-+start>367*86400000)return res.status(400).json({message:'Invalid date range'});
    const visible=await employeeService.listForUser(req.user!);
    const selected=visible.filter(e=>!input.employeeId||e.id===input.employeeId);
    if(input.employeeId&&!selected.length)return res.status(403).json({message:'Employee not visible'});
    const context=await accessResolverService.getUserAccessContext(req.user!.id);
    const permitted=[];const unavailable=[];
    for(const employee of selected){
      const scope={companyId:employee.companyId,employeeId:employee.id,assignedToEmployeeId:employee.id,departmentId:employee.departmentId};
      const allowed=await scopeResolverService.canAccess(context,'worktrack.task.view',scope);
      if(allowed)permitted.push(employee.id);else unavailable.push(employee.id);
    }
    const cards=permitted.length?await prisma.workCard.findMany({where:{assignedToId:{in:permitted},OR:[{createdAt:{gte:start,lte:end}},{statusHistory:{some:{createdAt:{gte:start,lte:end}}}},{comments:{some:{createdAt:{gte:start,lte:end}}}},{status:{in:['PENDING','IN_PROGRESS','REWORK']}}]},select:{id:true,companyId:true,workId:true,title:true,category:true,status:true,createdAt:true,deadline:true,assignedToId:true,clientId:true,client:{select:{id:true,name:true}},reworkCount:true,pointsEarned:true,statusHistory:{select:{status:true,createdAt:true,user:{select:{employee:{select:{id:true}}}}}},comments:{select:{id:true,createdAt:true,user:{select:{employee:{select:{id:true}}}}}},reworkLogs:{select:{roundNumber:true,reason:true,createdAt:true}},ratings:{select:{rating:true,feedback:true}},pointsLedgers:{where:{createdAt:{gte:start,lte:end}},select:{employeeId:true,points:true,createdAt:true}}},orderBy:{createdAt:'desc'}}):[];
    const tracks=['designer','video-editor','seo','performance-marketing','development','data-entry'];
    const visibleIds=new Set(visible.map(e=>e.id));
    const memberships=req.user!.companyId?await Promise.all(tracks.map(async track=>({track,employees:(await workTrackService.getDesigners(req.user!.companyId!,track)).filter(e=>visibleIds.has(e.id)).map(e=>e.id)}))):[];
    res.json({cards,permittedEmployeeIds:permitted,unavailableEmployeeIds:unavailable,tracks:memberships,range:{dateFrom:input.dateFrom,dateTo:input.dateTo},coverage:'permission_scoped_assigned_tasks_and_current_backlog'});
  }catch(error){next(error);}
});
