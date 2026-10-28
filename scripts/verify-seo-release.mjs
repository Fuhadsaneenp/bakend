// Run on the deployment host. Credentials remain on the server; all checks are read-only.
import dotenv from 'dotenv';
const config='/home/u743262110/domains/api.secondtales.com/hbuilds/config/';
dotenv.config({path:'/home/u743262110/stems-migration-20261024/private/production.env',override:true});
dotenv.config({path:config+'.env.seo',override:true});
const {prisma}=await import('../dist/src/lib/prisma.js');
const {env}=await import('../dist/src/config/env.js');
const {default:jwt}=await import('jsonwebtoken');
try {
  const user=await prisma.user.findFirst({where:{role:{in:['SUPER_ADMIN','HR_ADMIN']},isActive:true},select:{id:true}});
  if(!user)throw Error('No administrator available for read-only verification');
  await prisma.seoMetric.count();
  await prisma.seoConnection.count();
  const token=jwt.sign({id:user.id},env.JWT_ACCESS_SECRET,{expiresIn:'1m'});
  const response=await fetch('https://api.secondtales.com/api/seo/workspaces',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(response.status!==200)throw Error('Authenticated SEO API check failed: '+response.status);
  const body=await response.json();
  if(!Array.isArray(body.availableClients))throw Error('Invalid SEO response');
  console.log('Live authenticated SEO API and database checks passed; eligible clients: '+body.availableClients.length);
} finally {await prisma.$disconnect();}
