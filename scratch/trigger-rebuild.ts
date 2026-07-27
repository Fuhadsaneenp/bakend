async function main() {
  const secret = "fuhad-deploy-secret-2026";
  const companyId = "seed-company";

  // Rebuild June 2026
  console.log("Triggering rebuild for June 2026...");
  const juneRes = await fetch(`https://api.secondtales.com/api/attendance/admin/rebuild-month-from-machine?month=6&year=2026&dryRun=false&secret=${secret}&companyId=${companyId}`, {
    method: "GET"
  });

  console.log("June Rebuild Status:", juneRes.status);
  console.log("June Rebuild Response:", await juneRes.json());

  // Rebuild May 2026
  console.log("Triggering rebuild for May 2026...");
  const mayRes = await fetch(`https://api.secondtales.com/api/attendance/admin/rebuild-month-from-machine?month=5&year=2026&dryRun=false&secret=${secret}&companyId=${companyId}`, {
    method: "GET"
  });

  console.log("May Rebuild Status:", mayRes.status);
  console.log("May Rebuild Response:", await mayRes.json());
}

main().catch(console.error);
