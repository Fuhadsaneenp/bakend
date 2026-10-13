import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Source, Job, Actor } from "./types.js";
// Dedicated durable store: no changes to the existing application's live database.
let database: any;
export function db(): any {
  if (database) return database;
  const path = resolve(process.env.JOB_MONITORING_DB_PATH || "./data/job-monitoring.sqlite");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  database = new DatabaseSync(path);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, company TEXT NOT NULL, url TEXT NOT NULL, active INTEGER NOT NULL, due TEXT NOT NULL, priority INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(company,url));
    CREATE INDEX IF NOT EXISTS source_due ON sources(active,due,priority);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,company TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,assignee TEXT,department TEXT,detected TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS job_company ON jobs(company,status,detected);
    CREATE INDEX IF NOT EXISTS job_employee ON jobs(company,assignee,department);
    CREATE TABLE IF NOT EXISTS identities(company TEXT NOT NULL,identity TEXT NOT NULL,job TEXT NOT NULL,PRIMARY KEY(company,identity));
    CREATE TABLE IF NOT EXISTS occurrences(source TEXT NOT NULL,identity TEXT NOT NULL,job TEXT NOT NULL,firstSeen TEXT NOT NULL,lastSeen TEXT NOT NULL,PRIMARY KEY(source,identity));
    CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,company TEXT NOT NULL,source TEXT NOT NULL,started TEXT NOT NULL,finished TEXT,newJobs INTEGER,duplicates INTEGER,duration INTEGER,error TEXT,warning TEXT);
    CREATE INDEX IF NOT EXISTS scan_company ON scans(company,started);
    CREATE TABLE IF NOT EXISTS queue(source TEXT PRIMARY KEY,company TEXT NOT NULL,state TEXT NOT NULL,available TEXT NOT NULL,lease TEXT,token TEXT,attempts INTEGER NOT NULL DEFAULT 0,error TEXT);
    CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,company TEXT NOT NULL,source TEXT,job TEXT,employee TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_company ON activities(company,source,at);
  `);
  const schema=database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sources'").get()?.sql||"";
  if (/UNIQUE\s*\(company\s*,\s*url\)/i.test(schema)) database.exec(`BEGIN IMMEDIATE;
    ALTER TABLE sources RENAME TO sources_legacy;
    CREATE TABLE sources(id TEXT PRIMARY KEY, company TEXT NOT NULL, url TEXT NOT NULL, active INTEGER NOT NULL, due TEXT NOT NULL, priority INTEGER NOT NULL, payload TEXT NOT NULL);
    INSERT INTO sources SELECT * FROM sources_legacy;
    DROP TABLE sources_legacy;
    CREATE INDEX source_due ON sources(active,due,priority);
    COMMIT;`);
  return database;
}
export function transaction<T>(fn: () => T): T { const d = db(); d.exec("BEGIN IMMEDIATE"); try { const result = fn(); d.exec("COMMIT"); return result; } catch (e) { d.exec("ROLLBACK"); throw e; } }
export function sources(company?: string): Source[] { return db().prepare(`SELECT payload FROM sources ${company ? "WHERE company=?" : ""}`).all(...(company ? [company] : [])).map((r: any) => JSON.parse(r.payload)); }
export function source(company: string, id: string): Source | undefined { const r = db().prepare("SELECT payload FROM sources WHERE company=? AND id=?").get(company,id); return r ? JSON.parse(r.payload) : undefined; }
export function saveSource(s: Source) { db().prepare(`INSERT INTO sources VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,active=excluded.active,due=excluded.due,priority=excluded.priority,payload=excluded.payload`).run(s.id,s.companyId,s.url,+s.active,s.nextCheckAt,{High:0,Normal:1,Low:2}[s.priority],JSON.stringify(s)); }
export function jobs(company: string): Job[] { return db().prepare("SELECT json_remove(payload,'$.raw','$.description','$.requirements') payload FROM jobs WHERE company=? ORDER BY detected DESC").all(company).map((r:any) => JSON.parse(r.payload)); }
export function job(company: string,id: string): Job | undefined { const r = db().prepare("SELECT payload FROM jobs WHERE company=? AND id=?").get(company,id); return r ? JSON.parse(r.payload) : undefined; }
export function saveJob(j: Job) { db().prepare(`INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,assignee=excluded.assignee,department=excluded.department,payload=excluded.payload`).run(j.id,j.companyId,j.sourceId,j.status,j.assignedToId || null,j.departmentId || null,j.detectedAt,JSON.stringify(j)); }
export function audit(company: string,actor: Actor,kind: string,payload: any = {},sourceId?: string,jobId?: string) { db().prepare("INSERT INTO activities VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(),company,sourceId || null,jobId || null,actor.id,actor.name,kind,new Date().toISOString(),JSON.stringify(payload)); }
export function enqueue(s: Source,now = new Date().toISOString()) { db().prepare("INSERT INTO queue(source,company,state,available) VALUES(?,?,'queued',?) ON CONFLICT(source) DO NOTHING").run(s.id,s.companyId,now); }
export function lease(): any { return transaction(() => {
  const now = new Date().toISOString();
  db().prepare("UPDATE queue SET state='queued',token=NULL WHERE state='running' AND lease<?").run(now);
  const r = db().prepare("SELECT q.* FROM queue q JOIN sources s ON s.id=q.source WHERE q.state='queued' AND q.available<=? AND s.active=1 ORDER BY s.priority,q.available LIMIT 1").get(now);
  if (!r) return null;
  r.token = randomUUID(); db().prepare("UPDATE queue SET state='running',token=?,lease=?,attempts=attempts+1 WHERE source=?").run(r.token,new Date(Date.now()+600000).toISOString(),r.source); return r;
}); }

export function purgeUnqualified(now=new Date().toISOString()){return db().prepare("DELETE FROM jobs WHERE json_extract(payload,'$.unqualifiedExpiresAt') IS NOT NULL AND json_extract(payload,'$.unqualifiedExpiresAt')<=?").run(now);}
