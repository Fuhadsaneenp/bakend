import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
const script='/home/u394546085/domains/api.secondtales.com/hbuilds/config/backup-job-monitoring.sh';
let running=false;
async function backup(){
 if(running)return;
 try{await access(script);}catch{return;}
 running=true;
 execFile('/bin/sh',[script],{timeout:120000},error=>{
  running=false;
  if(error)console.error('Job backup failed:',error.message);
  else console.info('Job data backup verified');
 });
}
void backup();
setInterval(()=>void backup(),60*60*1000).unref();
