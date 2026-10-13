import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='mysql://test:test@127.0.0.1:1/test';
process.env.NODE_ENV='test';
const { aiRouter }=await import('../src/modules/ai/ai.routes.js');
const { requireAuth }=await import('../src/middleware/auth.js');
const { prisma }=await import('../src/lib/prisma.js');
const jwt=(await import('jsonwebtoken')).default;
const { env }=await import('../src/config/env.js');
test('all AI routes have authentication before handlers',()=>{assert.equal((aiRouter as any).stack[0].handle,requireAuth);});
test('missing or invalid token never falls back to admin',async()=>{
  for(const headers of [{},{authorization:'Bearer invalid'}]){
    let error:any;await requireAuth({headers} as any,{} as any,(value:any)=>{error=value;});assert.equal(error.statusCode,401);
  }
});
test('inactive and exited tokens cannot access the assistant',async()=>{
  const token=jwt.sign({id:'u'},env.JWT_ACCESS_SECRET);
  (prisma.user as any).findUnique=async()=>({id:'u',isActive:false});
  let error:any;await requireAuth({headers:{authorization:`Bearer ${token}`}} as any,{} as any,(value:any)=>{error=value;});assert.equal(error.statusCode,401);
  (prisma.user as any).findUnique=async()=>({id:'u',isActive:true,employee:{status:'ACTIVE',dateOfExit:new Date('2000-01-01')}});
  await requireAuth({headers:{authorization:`Bearer ${token}`}} as any,{} as any,(value:any)=>{error=value;});assert.equal(error.statusCode,403);
});
