import("./scripts/schedule-job-backup.mjs").catch(error => console.error("Backup scheduler unavailable:", error.message));
process.env.JOB_MONITORING_DB_PATH = "/home/u394546085/domains/api.secondtales.com/hbuilds/config/job-monitoring.sqlite";
process.env.TZ = "Asia/Kolkata";
import("./dist/src/server.js").catch(error => {
  import("fs").then(fs => {
    fs.writeFileSync("stderr.log", `Import Error: ${error}\n${error?.stack || ""}\n`, { flag: "a" });
  }).catch(err => {
    console.error("Failed to write to stderr.log:", err);
  });
});
