import { prisma } from "../lib/prisma.js";

async function seedAttendance() {
  console.log("Seeding attendance records for July 2026...");
  
  const employees = await prisma.employee.findMany();
  console.log(`Found ${employees.length} employees`);

  // July 1, 2026 to July 21, 2026
  const dates = [];
  for (let day = 1; day <= 21; day++) {
    const dayStr = day < 10 ? `0${day}` : `${day}`;
    dates.push(`2026-07-${dayStr}`);
  }

  for (const emp of employees) {
    for (const dateStr of dates) {
      const workDate = new Date(`${dateStr}T00:00:00+05:30`);
      const dayOfWeek = workDate.getDay(); // 0 is Sunday

      if (dayOfWeek === 0) {
        // Skip Sunday weekend
        continue;
      }

      // Check-in around 08:50 to 09:15 AM
      const checkInHour = dayOfWeek === 1 ? "09" : "08";
      const checkInMin = Math.floor(Math.random() * 20) + 45; // 45 to 64
      const checkInMinStr = checkInMin < 60 ? (checkInMin < 10 ? `0${checkInMin}` : `${checkInMin}`) : "05";
      const checkInTime = new Date(`${dateStr}T09:00:00+05:30`);

      // Check-out around 18:00 PM
      const checkOutTime = new Date(`${dateStr}T18:00:00+05:30`);
      const workMinutes = 540; // 9 hours
      const isLate = dayOfWeek === 1; // Mon late demo

      await prisma.attendance.upsert({
        where: {
          employeeId_workDate: {
            employeeId: emp.id,
            workDate: workDate
          }
        },
        update: {
          checkInAt: checkInTime,
          checkOutAt: checkOutTime,
          workMinutes: workMinutes,
          isLate: isLate,
          isEarlyLeave: false
        },
        create: {
          employeeId: emp.id,
          workDate: workDate,
          checkInAt: checkInTime,
          checkOutAt: checkOutTime,
          workMinutes: workMinutes,
          isLate: isLate,
          isEarlyLeave: false
        }
      });
    }
  }

  console.log("Successfully seeded attendance logs!");
}

seedAttendance()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
