import { prisma } from "../lib/prisma.js";
import { attendanceService } from "../modules/attendance/attendance.service.js";

export async function runBiometricSync() {
  const pendingLogs = await prisma.biometricRawLog.findMany({
    where: { processingStatus: "PENDING" },
    orderBy: { receivedAt: "asc" }
  });

  if (pendingLogs.length === 0) {
    return;
  }

  console.log(`[Biometric Sync] Starting background sync for ${pendingLogs.length} pending logs...`);

  for (const log of pendingLogs) {
    try {
      let query: Record<string, any> = {};
      try {
        query = JSON.parse(log.queryParameters || "{}");
      } catch (e) {
        // Fallback if not JSON
        console.warn(`[Biometric Sync] Failed to parse queryParameters for log ${log.id}:`, e);
      }

      const tableValue = query.table ?? query.TABLE ?? query.Table ?? "";
      const table = String(tableValue).toUpperCase().trim();

      const rawLines = log.rawPayload ? log.rawPayload.split("\n") : [];
      let successCount = 0;
      let failCount = 0;

      if (table === "OPERLOG") {
        // Parse User Directory logs
        // Line format: USER PIN=ST001\tName=Fuhad Saneen P K\t...
        for (const line of rawLines) {
          if (!line.trim()) continue;

          const matchPin = line.match(/USER PIN=([^\t\r\n]+)/);
          if (matchPin) {
            const pin = matchPin[1].trim();
            // Link to Employee where employeeCode matches PIN
            const employee = await prisma.employee.findFirst({
              where: { employeeCode: pin }
            });

            if (employee) {
              await prisma.employee.update({
                where: { id: employee.id },
                data: { biometricId: pin }
              });
              successCount++;
            } else {
              failCount++;
            }
          }
        }

        await prisma.biometricRawLog.update({
          where: { id: log.id },
          data: {
            processingStatus: "PROCESSED",
            errorMessage: `Sync complete. Linked ${successCount} employees (failed/unmatched: ${failCount}).`
          }
        });

      } else if (table === "ATTLOG") {
        // Parse Attendance Punch logs
        // Line format: PIN\tTimestamp\tState\tVerifyMode\t...
        // Example: ST013\t2026-06-22 10:06:12\t0\t1\t0\t\t\t0\t0\t
        for (const line of rawLines) {
          if (!line.trim()) continue;

          const parts = line.split("\t");
          if (parts.length >= 2) {
            const biometricId = parts[0].trim();
            const punchTimeStr = parts[1].trim();

            if (biometricId && punchTimeStr) {
              try {
                await attendanceService.biometricPunch(biometricId, punchTimeStr);
                successCount++;
              } catch (punchErr: any) {
                console.error(`[Biometric Sync] Punch failed for ${biometricId} at ${punchTimeStr}:`, punchErr.message);
                failCount++;
              }
            }
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
        // Unknown or empty table type (e.g. handshake, command queries)
        // Mark as PROCESSED since there is no payload data to extract
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
