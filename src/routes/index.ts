import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { employeeRouter } from "../modules/employees/employee.routes.js";
import { payrollRouter } from "../modules/payroll/payroll.routes.js";
import { attendanceRouter } from "../modules/attendance/attendance.routes.js";
import { wfhRouter } from "../modules/wfh/wfh.routes.js";
import { expenseRouter } from "../modules/expenses/expense.routes.js";
import { notificationRouter } from "../modules/notifications/notification.routes.js";
import { dashboardRouter } from "../modules/dashboard/dashboard.routes.js";
import { orgRouter } from "../modules/org/org.routes.js";
import { workTrackRouter } from "../modules/work-track/work-track.routes.js";
import { exec } from "child_process";

export const apiRouter = Router();

// Temporary endpoints for production database migrations/seeding
apiRouter.get("/db-push", (req, res) => {
  if (req.query.secret !== "fuhad-deploy-secret-2026") {
    return res.status(403).json({ error: "Unauthorized" });
  }
  exec("npx prisma db push --accept-data-loss", (error, stdout, stderr) => {
    res.json({
      error: error ? error.message : null,
      stdout,
      stderr
    });
  });
});

apiRouter.get("/seed-csv-employees", async (req, res) => {
  if (req.query.secret !== "fuhad-deploy-secret-2026") {
    return res.status(403).json({ error: "Unauthorized" });
  }
  try {
    const bcrypt = (await import("bcryptjs")).default;
    const { prisma } = await import("../lib/prisma.js");

    const rawRecords = [
      { empCode: "ST005", biometricId: "ST005", firstName: "Fathima", middleName: "Sherin", lastName: "PT", email: "fathimasherinparankithodi@gmail.com", personalEmail: "fathimasherinparankithodi@gmail.com", phone: "9645204233", company: "Second Tales LLP", department: "Growth", designation: "Senior Digital Marketer", doj: "2025-08-04", dob: "2000-07-13", gender: "Female", basicSalary: 15000, emergencyName: "Sidheeque .PT ", emergencyPhone: "9747255054", address: "Parankithodi House, Areekulam, Vengara (PO), Malappuram , Kerala - 676304" },
      { empCode: "ST006", biometricId: "ST006", firstName: "Muhammed", middleName: "Swadique", lastName: "Kozhikkoden", email: "mswadique89@gmail.com", personalEmail: "mswadique89@gmail.com", phone: "9061406195", company: "Second Tales LLP", department: "Design", designation: "Designer", doj: "2025-10-31", dob: "2007-04-07", gender: "Male", basicSalary: 15000, emergencyName: "Musthafa ", emergencyPhone: "747996945", address: "kozhikodan (H), cherukunnu melekulamb, othukkungal PO" },
      { empCode: "ST007", biometricId: "ST007", firstName: "Salahudeen", middleName: "Ayoobi", lastName: "CM", email: "ssaalahudheen@gmail.com", personalEmail: "ayoobicm@gmail.com", phone: "8078044236", company: "Second Tales LLP", department: "Design", designation: "Designer", doj: "2026-01-13", dob: "2006-08-31", gender: "Male", basicSalary: 10000, emergencyName: "Ayshabi", emergencyPhone: "9747996045", address: "Chelamalayil House, Kurikkal Bazar, Parappur, Malappuram, Kerala, 676503" },
      { empCode: "ST008", biometricId: "ST008", firstName: "Shoukath", middleName: "Shabeeth", lastName: "K", email: "hebywork01@gmail.com", personalEmail: "muhammadshabee66@gmail.com", phone: "8129804357", company: "Second Tales LLP", department: "SEO", designation: "SEO Executive", doj: "2026-02-24", dob: "1999-02-18", gender: "Male", basicSalary: 10000, emergencyName: "Muhammad", emergencyPhone: "9048678185", address: "Kandamchira house , kachirakkol , thekkankuttur po , thalakkad, 676551" },
      { empCode: "ST009", biometricId: "ST009", firstName: "Abdul", middleName: "Basith", lastName: "VP", email: "itsmebasithseo@gmail.com", personalEmail: "basithbasith501@gmail.com", phone: "9539993204", company: "Second Tales LLP", department: "SEO", designation: "SEO Executive", doj: "2026-02-24", dob: "1999-11-18", gender: "Male", basicSalary: 10000, emergencyName: "Hameed", emergencyPhone: "6282913819", address: "vellarampara(h) ,Poovathikkal(po) ,Pavanna,Areekode" },
      { empCode: "ST010", biometricId: "ST010", firstName: "Fathima", middleName: "Naseeha", lastName: "Chemban", email: "naseehadm@gmail.com", personalEmail: "naseehasulfikar2004@gmail.com", phone: "8137061847", company: "Second Tales LLP", department: "Growth", designation: "Digital Marketer", doj: "2026-05-18", dob: "2004-11-13", gender: "Female", basicSalary: 6000, emergencyName: "sulfeekar Ali", emergencyPhone: "8129538288", address: "Chemban house , west villoor , indinoor(po)kottakkal ,Malappuram" },
      { empCode: "ST013", biometricId: "ST013", firstName: "Asif", middleName: "Ameen", lastName: "MP", email: "asifameenmp@gmail.com", personalEmail: "asifameenmp@gmail.com", phone: "8590563411", company: "Second Tales LLP", department: "Design", designation: "Designer", doj: "2026-03-05", dob: "2001-11-29", gender: "Male", basicSalary: 25000, emergencyName: "Nasar", emergencyPhone: "9846899846", address: "elepeediyekkal ( H ) Vadakkumpuram (PO) Ck Para" },
      { empCode: "ST014", biometricId: "ST014", firstName: "Muhammed", middleName: "Shamil", lastName: "PT", email: "shamilpuzhakka@gmail.com", personalEmail: "muhammedshamil5665@gmail.com", phone: "6238940702", company: "Second Tales LLP", department: "Production", designation: "Video Editor", doj: "2026-05-25", dob: "2003-01-13", gender: "Male", basicSalary: 5000, emergencyName: "Muhammedkutty", emergencyPhone: "9946819927", address: "PUZHAKKAL, ,SULAIMAN PADI, THALAKKADA THUR,MALAPPURAM ,KERALA" },
      { empCode: "HF001", biometricId: "HF001", firstName: "Nihala", middleName: null, lastName: "", email: "nihala808678@gmail.com", personalEmail: "nihala808678@gmail.com", phone: "7306191793", company: "Medbiomate", department: "Data Entry", designation: "Senior Data Entry Specialist", doj: "2025-09-08", dob: "2003-09-16", gender: "Female", basicSalary: 8000, emergencyName: "Basheer", emergencyPhone: "8086787772", address: "Peringoden House, Klari Moochikkal , Malappuram, Kerala" },
      { empCode: "HF002", biometricId: "HF002", firstName: "Fathima", middleName: "Rishana", lastName: "K", email: "risharinzzz@gmail.com", personalEmail: "risharinzzz@gmail.com", phone: "9567068271", company: "Medbiomate", department: "Data Entry", designation: "Senior Data Entry Specialist", doj: "2025-12-17", dob: "2004-03-10", gender: "Female", basicSalary: 8000, emergencyName: "Abdul razak", emergencyPhone: "70344 50853", address: "karadan house kacherippadi" },
      { empCode: "HF003", biometricId: "HF003", firstName: "Safna", middleName: null, lastName: "C", email: "safnanizam@gmail.com", personalEmail: "safnanizam@gmail.com", phone: "8086084610", company: "Medbiomate", department: "Data Entry", designation: "Junior Data Entry Specialist", doj: "2026-05-20", dob: "2001-02-12", gender: "Female", basicSalary: 6000, emergencyName: "Shafi", emergencyPhone: "9895094929", address: "Sharath House, Kolappuram, Malappuram, Kerala" },
      { empCode: "HF004", biometricId: "HF004", firstName: "Hasna", middleName: null, lastName: "P", email: "hasnafayis09@gmail.com", personalEmail: "hasnafayis09@gmail.com", phone: "974700034", company: "Medbiomate", department: "Data Entry", designation: "Junior Data Entry Specialist", doj: "2026-06-22", dob: "2007-03-11", gender: "Female", basicSalary: 6000, emergencyName: "Abdul Azeez", emergencyPhone: "9847227905", address: "Palakkal, Iringavur, Tirur, Malappuram, Kerala" }
    ];

    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: { name: "Second Tales LLP", legalName: "Second Tales LLP" }
      });
    }

    const defaultPasswordHash = await bcrypt.hash("Password123!", 12);
    const results: string[] = [];

    for (const rec of rawRecords) {
      const compQuery = rec.company.toLowerCase().includes("medbio") ? "medbio" : rec.company;
      let empCompany = await prisma.company.findFirst({
        where: { name: { contains: compQuery } }
      });
      if (!empCompany) {
        empCompany = await prisma.company.create({
          data: { name: rec.company, legalName: rec.company }
        });
      }

      let dept = await prisma.department.findFirst({ where: { companyId: empCompany.id, name: rec.department } });
      if (!dept) {
        dept = await prisma.department.create({
          data: { companyId: empCompany.id, name: rec.department, code: `${rec.department.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-4)}` }
        });
      }
      let desg = await prisma.designation.findFirst({ where: { departmentId: dept.id, title: rec.designation } });
      if (!desg) {
        desg = await prisma.designation.create({ data: { departmentId: dept.id, title: rec.designation } });
      }

      let user = await prisma.user.findUnique({ where: { email: rec.email } });
      if (!user) {
        user = await prisma.user.create({
          data: { companyId: empCompany.id, email: rec.email, passwordHash: defaultPasswordHash, role: "EMPLOYEE" }
        });
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: { companyId: empCompany.id, passwordHash: defaultPasswordHash }
        });
      }

      let existingEmp = await prisma.employee.findFirst({
        where: { OR: [{ biometricId: rec.biometricId }, { employeeCode: rec.empCode }, { userId: user.id }] }
      });

      const empData: any = {
        companyId: empCompany.id,
        userId: user.id,
        employeeCode: rec.empCode,
        biometricId: rec.biometricId,
        firstName: rec.firstName,
        middleName: rec.middleName,
        lastName: rec.lastName,
        phone: rec.phone,
        personalEmail: rec.personalEmail,
        dateOfJoining: new Date(rec.doj),
        dateOfBirth: rec.dob ? new Date(rec.dob) : null,
        gender: rec.gender,
        departmentId: dept.id,
        designationId: desg.id,
        addressLine1: rec.address,
        emergencyContactName: rec.emergencyName,
        emergencyContactPhone: rec.emergencyPhone,
        status: "ACTIVE"
      };

      let savedEmp;
      if (existingEmp) {
        savedEmp = await prisma.employee.update({ where: { id: existingEmp.id }, data: empData });
        results.push(`Updated: ${rec.empCode} - ${rec.firstName} ${rec.middleName || ""} ${rec.lastName}`);
      } else {
        savedEmp = await prisma.employee.create({ data: empData });
        results.push(`Created: ${rec.empCode} - ${rec.firstName} ${rec.middleName || ""} ${rec.lastName}`);
      }

      if (rec.basicSalary > 0) {
        const salary = await prisma.salary.findFirst({ where: { employeeId: savedEmp.id } });
        if (salary) {
          await prisma.salary.update({ where: { id: salary.id }, data: { basic: rec.basicSalary } });
        } else {
          await prisma.salary.create({
            data: { employeeId: savedEmp.id, basic: rec.basicSalary, allowances: 0, deductions: 0, effectiveFrom: new Date(rec.doj) }
          });
        }
      }
    }

    res.json({ success: true, count: results.length, details: results });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || String(error) });
  }
});
apiRouter.get("/seed-attendance-real-temp", async (req, res) => {
  if (req.query.secret !== "fuhad-deploy-secret-2026") {
    return res.status(403).json({ error: "Unauthorized" });
  }
  try {
    const { prisma } = await import("../lib/prisma.js");

    // 1. Delete all existing July 2026 attendance records
    await prisma.attendance.deleteMany({
      where: {
        workDate: {
          gte: new Date("2026-07-01T00:00:00+05:30"),
          lte: new Date("2026-07-31T23:59:59+05:30")
        }
      }
    });

    const employees = await prisma.employee.findMany({
      include: {
        company: true,
        wfhRequests: true
      }
    });

    const today = new Date();
    const currentDay = today.getDate();

    let count = 0;
    // Loop through all days of July 2026 up to today (July 24th)
    for (let day = 1; day <= currentDay; day++) {
      const dayStr = day < 10 ? `0${day}` : `${day}`;
      const dateKey = `2026-07-${dayStr}`;
      
      const workDate = new Date(`${dateKey}T00:00:00+05:30`);
      
      // Get Kolkata weekday name
      const weekdayStr = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        weekday: "long"
      }).format(workDate);

      const isSunday = weekdayStr === "Sunday";
      const isSaturday = weekdayStr === "Saturday";

      for (const emp of employees) {
        // Check if weekend
        const worksSevenDays = emp.company?.worksSevenDays || false;
        const isWeekend = isSunday || (isSaturday && !worksSevenDays);

        if (isWeekend) {
          // Do not seed attendance on weekends
          continue;
        }

        // Check if there is an approved WFH or Leave request for this day
        const approvedRequest = emp.wfhRequests.find(r => {
          if (r.status !== "APPROVED") return false;
          const startStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(r.startDate));
          const endStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(r.endDate));
          return dateKey >= startStr && dateKey <= endStr;
        });

        if (approvedRequest) {
          const reason = approvedRequest.reason.toUpperCase();
          
          if (reason.includes("UNPAID") || reason.includes("PAID LEAVE") || reason.includes("WFH") || reason.includes("WORK FROM HOME") || reason.includes("SHOOTING")) {
            // These are full day leaves/WFH, do not seed physical check-in/out records
            continue;
          }

          if (reason.includes("HALF")) {
            // Seed a half day punch (check-in only)
            const checkInTime = new Date(`${dateKey}T09:00:00+05:30`);
            await prisma.attendance.create({
              data: {
                employeeId: emp.id,
                workDate: workDate,
                checkInAt: checkInTime,
                workMinutes: 240, // 4 hours
                isLate: false,
                isEarlyLeave: false
              }
            });
            count++;
            continue;
          }
        }

        // Randomly skip (5% chance of unapproved absence)
        if (Math.random() < 0.05 && day !== currentDay) {
          continue;
        }

        // Normal working day - check-in and check-out
        // Check-in around 08:45 to 09:15 AM
        const checkInHour = "08";
        const checkInMin = Math.floor(Math.random() * 30) + 45; // 45 to 74
        let checkInTimeStr = "";
        let isLate = false;

        if (checkInMin >= 60) {
          const minPart = checkInMin - 60;
          const minPartStr = minPart < 10 ? `0${minPart}` : `${minPart}`;
          checkInTimeStr = `09:${minPartStr}:00`;
          isLate = minPart > 0; // Late if after 09:00 AM
        } else {
          checkInTimeStr = `08:${checkInMin}:00`;
        }

        const checkInTime = new Date(`${dateKey}T${checkInTimeStr}+05:30`);

        // Check-out around 06:00 PM to 06:30 PM
        const checkOutMin = Math.floor(Math.random() * 30); // 0 to 29
        const checkOutMinStr = checkOutMin < 10 ? `0${checkOutMin}` : `${checkOutMin}`;
        const checkOutTime = new Date(`${dateKey}T18:${checkOutMinStr}:00+05:30`);

        const workMinutes = Math.floor((checkOutTime.getTime() - checkInTime.getTime()) / 60000);

        await prisma.attendance.create({
          data: {
            employeeId: emp.id,
            workDate: workDate,
            checkInAt: checkInTime,
            checkOutAt: checkOutTime,
            workMinutes: workMinutes,
            isLate: isLate,
            isEarlyLeave: false
          }
        });
        count++;
      }
    }
    res.json({ success: true, reseededCount: count });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || String(error) });
  }
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/employees", employeeRouter);
apiRouter.use("/payroll", payrollRouter);
apiRouter.use("/attendance", attendanceRouter);
apiRouter.use("/wfh", wfhRouter);
apiRouter.use("/expenses", expenseRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/work-track", workTrackRouter);
apiRouter.use("/", orgRouter);

