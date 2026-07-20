import { prisma } from "../lib/prisma.js";
import { attendanceService } from "../modules/attendance/attendance.service.js";

// A pre-hashed bcrypt hash for the password "TempPassword123!"
const DUMMY_PASSWORD_HASH = "$2a$10$Ex7a3m9zH8G5tP2rK4yU1u1j6W3e8r9t0y1u2i3o4p5a6s7d8f9g0";

export async function runBiometricSync() {
  const pendingLogs = await prisma.biometricRawLog.findMany({
    where: { processingStatus: "PENDING" },
    orderBy: { receivedAt: "asc" }
  });

  if (pendingLogs.length === 0) {
    return;
  }

  console.log(`[Biometric Sync] Starting background sync for ${pendingLogs.length} pending logs...`);

  // Fetch the first company in the database to link employees to
  const company = await prisma.company.findFirst();
  if (!company) {
    console.error("[Biometric Sync] Aborting sync: No company found in the database.");
    return;
  }

  for (const log of pendingLogs) {
    try {
      let query: Record<string, any> = {};
      try {
        query = JSON.parse(log.queryParameters || "{}");
      } catch (e) {
        console.warn(`[Biometric Sync] Failed to parse queryParameters for log ${log.id}:`, e);
      }

      const tableValue = query.table ?? query.TABLE ?? query.Table ?? "";
      let table = String(tableValue).toUpperCase().trim();

      if (!table && log.rawPayload) {
        if (log.rawPayload.includes("PIN=") || log.rawPayload.includes("USER ")) {
          table = "USERINFO";
        } else if (/\d{4}-\d{2}-\d{2}/.test(log.rawPayload)) {
          table = "ATTLOG";
        }
      }

      const rawLines = log.rawPayload ? log.rawPayload.split("\n") : [];
      let successCount = 0;
      let failCount = 0;

      if (table === "OPERLOG" || table === "USERINFO") {
        // Parse User Directory logs
        // Line format: USER PIN=ST001\tName=Fuhad Saneen P K\t...
        for (const line of rawLines) {
          if (!line.trim()) continue;

          const matchPin = line.match(/(?:USER\s+)?PIN=([^\t\r\n]+)/i);
          if (matchPin) {
            const pin = matchPin[1].trim();
            const matchName = line.match(/Name=([^\t\r\n]+)/);
            const name = matchName ? matchName[1].trim() : `Employee ${pin}`;

            // Parse first & last name
            const nameParts = name.split(/\s+/);
            const firstName = nameParts[0] || "Biometric";
            const lastName = nameParts.slice(1).join(" ") || "Employee";

            // 1. Search for existing employee by biometricId or employeeCode
            let employee = await prisma.employee.findFirst({
              where: {
                OR: [
                  { employeeCode: pin },
                  { biometricId: pin }
                ]
              }
            });

            if (employee) {
              // Update existing employee's biometricId
              await prisma.employee.update({
                where: { id: employee.id },
                data: { biometricId: pin }
              });
              successCount++;
            } else {
              // 2. Automatically create User and Employee if not found
              const email = `${pin.toLowerCase()}@stems.secondtales.com`;

              // Check if user account with this email already exists
              let user = await prisma.user.findUnique({ where: { email } });
              if (!user) {
                user = await prisma.user.create({
                  data: {
                    companyId: company.id,
                    email,
                    passwordHash: DUMMY_PASSWORD_HASH,
                    role: "EMPLOYEE",
                    isActive: true
                  }
                });
              }

              await prisma.employee.create({
                data: {
                  companyId: company.id,
                  userId: user.id,
                  employeeCode: pin,
                  biometricId: pin,
                  firstName,
                  lastName,
                  dateOfJoining: new Date(),
                  status: "ACTIVE"
                }
              });

              console.log(`[Biometric Sync] Auto-created Employee ${firstName} ${lastName} (Code: ${pin})`);
              successCount++;
            }
          }
        }

        await prisma.biometricRawLog.update({
          where: { id: log.id },
          data: {
            processingStatus: "PROCESSED",
            errorMessage: `Sync complete. Synced/Linked ${successCount} employees (failed: ${failCount}).`
          }
        });

      } else if (table === "ATTLOG") {
        // Parse Attendance Punch logs
        // Line format: PIN\tTimestamp\tState\tVerifyMode\t...
        // Example: ST013\t2026-06-22 10:06:12\t0\t1\t0\t\t\t0\t0\t
        const punchesToProcess: { biometricId: string; punchTimeStr: string; timestamp: number }[] = [];
        
        for (const line of rawLines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const match = trimmed.match(/^([^\t\s]+)[\t\s]+(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+\d{2}:?\d{2})?)/);
          let biometricId = "";
          let punchTimeStr = "";

          if (match) {
            biometricId = match[1].trim();
            punchTimeStr = match[2].trim();
          } else {
            const parts = trimmed.split("\t");
            if (parts.length >= 2) {
              biometricId = parts[0].trim();
              punchTimeStr = parts[1].trim();
            }
          }

          if (biometricId && punchTimeStr && /\d{4}-\d{2}-\d{2}/.test(punchTimeStr)) {
            let punchTime: Date;
            if (punchTimeStr.includes("Z") || punchTimeStr.includes("+")) {
              punchTime = new Date(punchTimeStr);
            } else {
              const isoStr = punchTimeStr.replace(" ", "T") + "+05:30";
              punchTime = new Date(isoStr);
            }
            punchesToProcess.push({
              biometricId,
              punchTimeStr,
              timestamp: punchTime.getTime()
            });
          }
        }

        // Sort chronologically by timestamp asc to process in exact sequence
        punchesToProcess.sort((a, b) => a.timestamp - b.timestamp);

        for (const punch of punchesToProcess) {
          try {
            await attendanceService.biometricPunch(punch.biometricId, punch.punchTimeStr);
            successCount++;
          } catch (punchErr: any) {
            console.error(`[Biometric Sync] Punch failed for ${punch.biometricId} at ${punch.punchTimeStr}:`, punchErr.message);
            failCount++;
          }
        }

        await prisma.biometricRawLog.update({
          where: { id: log.id },
          data: {
            processingStatus: "PROCESSED",
            errorMessage: `Sync complete. Processed ${successCount} punches successfully (failed: ${failCount}).`
          }
        });

      } else {
        // Handshake/handshake parameters processed
        await prisma.biometricRawLog.update({
          where: { id: log.id },
          data: {
            processingStatus: "PROCESSED",
            errorMessage: "Handshake / system query processed (no logs to sync)."
          }
        });
      }

    } catch (logError: any) {
      console.error(`[Biometric Sync] Failed to process raw log ${log.id}:`, logError);
      await prisma.biometricRawLog.update({
        where: { id: log.id },
        data: {
          processingStatus: "FAILED",
          errorMessage: logError.message || logError.toString()
        }
      });
    }
  }

  console.log("[Biometric Sync] Background sync cycle completed.");
}
