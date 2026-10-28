#!/usr/bin/env bash
set -euo pipefail
release="$1"
[[ "$release" =~ ^github-[0-9a-f]{40}$ ]] || exit 2
site=/home/u743262110/domains/api.secondtales.com
base="$site/hbuilds"
app="$base/versions/$release/nodejs"
previous=$(readlink "$base/current")
previous_app=$(readlink -f "$base/current/nodejs")
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH
cd "$app"
ln -s /home/u743262110/stems-migration-20261024/private/production.env .env
ln -s /home/u743262110/stems-migration-20261024/backend/storage storage
npm ci --ignore-scripts --no-audit --no-fund > "$app/../install.log" 2>&1
npm rebuild >> "$app/../install.log" 2>&1
npx prisma generate > ../prisma.log 2>&1
mkdir -p tmp
node --input-type=commonjs <<'JS'
const fs=require('fs');
const base='/home/u743262110/domains/api.secondtales.com/hbuilds/config/';
fs.writeFileSync('server.js',`import dotenv from 'dotenv';
dotenv.config({path:'/home/u743262110/stems-migration-20261024/private/production.env',override:true});
dotenv.config({path:${JSON.stringify(base+'.env.seo')},override:true});
process.env.NODE_ENV='production';
process.env.TZ='Asia/Kolkata';
process.env.APP_ORIGIN='https://stems.secondtales.com';
process.env.JOB_MONITORING_DB_PATH=${JSON.stringify(base+'job-monitoring.sqlite')};
import('./scripts/schedule-job-backup.mjs').catch(e=>console.error(e.message));
import('./dist/src/server.js').catch(e=>{console.error(e);process.exit(1)});
`);
JS
# Check staged database connectivity before changing routing.
NODE_ENV=production node --input-type=module <<'JS'
import dotenv from 'dotenv';
const base='/home/u743262110/domains/api.secondtales.com/hbuilds/config/';
dotenv.config({path:'/home/u743262110/stems-migration-20261024/private/production.env',override:true});dotenv.config({path:base+'.env.seo',override:true});
const {prisma}=await import('./dist/src/lib/prisma.js');
try{await prisma.user.count();await prisma.seoMetric.count();console.log('Staged database checks passed');}finally{await prisma.$disconnect();}
JS
cp "$site/public_html/.htaccess" ../htaccess.previous
restart_app() {
  local root="$1"
  for pid in $(pgrep -u "$(id -u)" -f 'lsnode:|next-server' || true); do
    if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null || true)" = "$root" ]; then kill -TERM "$pid" || true; fi
  done
}
rollback() {
  cp ../htaccess.previous "$site/public_html/.htaccess"
  ln -s "$previous" "$base/current.rollback-$release"
  mv -Tf "$base/current.rollback-$release" "$base/current"
  touch "$base/current/nodejs/tmp/restart.txt"
  restart_app "$app"
  echo 'Verification failed; restored previous API release.' >&2
}
trap rollback ERR
SITE_ROOT="$site" node --input-type=commonjs <<'JS'
const fs=require('fs');const site=process.env.SITE_ROOT;const file=site+'/public_html/.htaccess';
const content=fs.readFileSync(file,'utf8').replace(/^PassengerAppRoot .*$/m,'PassengerAppRoot '+site+'/hbuilds/current/nodejs').replace(/^PassengerRestartDir .*$/m,'PassengerRestartDir '+site+'/hbuilds/current/nodejs/tmp');
fs.writeFileSync(file+'.next',content);fs.renameSync(file+'.next',file);
JS
ln -s "versions/$release" "$base/current.next-$release"
mv -Tf "$base/current.next-$release" "$base/current"
touch "$app/tmp/restart.txt" "$previous_app/tmp/restart.txt"
restart_app "$previous_app"
# Start via the configured Hostinger virtual host, then perform authenticated reads.
curl --max-time 30 -s -o /dev/null https://api.secondtales.com/api/seo/google/callback
NODE_ENV=production node scripts/verify-seo-release.mjs
trap - ERR
echo "API deployment verified: $release"
