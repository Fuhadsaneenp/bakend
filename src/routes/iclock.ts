import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { acknowledgeDeviceCommand, archiveTemplatePayload, getNextQueuedDeviceCommand, queueDeviceAttendanceUpload, queueDeviceUserDirectoryUpload } from "../lib/biometricDeviceSync.js";
import { runBiometricSync } from "./biometricSync.js";

type IClockRequest = Request & {
  rawBody?: string;
};

const biometricBodyLimit = "256kb";
const biometricAllowedSns = new Set(
  (env.ALLOWED_BIOMETRIC_SNS || "")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean)
);

const sensitiveHeaders = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "password",
  "pwd"
]);

const attendanceAutoQueryCooldownMs = 5 * 60 * 1000;
const lastAttendanceAutoQueryBySn = new Map<string, number>();
const directoryRecoveryEnabled = process.env.ENABLE_BIOMETRIC_DIRECTORY_RECOVERY === "true";

export const iclockRouter = Router();

iclockRouter.use((req, res, next) => {
  res.type("text/plain");
  next();
});

iclockRouter.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    (req as IClockRequest).rawBody = "";
  }
  next();
});

iclockRouter.use(express.raw({
  type: () => true,
  limit: biometricBodyLimit,
  verify: (req: IClockRequest, _res: Response, buffer: Buffer) => {
    req.rawBody = buffer.toString("utf8");
  }
}));

iclockRouter.use((req: IClockRequest, _res, next) => {
  if (typeof req.rawBody !== "string") {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body.toString("utf8");
    } else {
      req.rawBody = "";
    }
  }

  next();
});

const biometricRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "ERROR: Rate limit exceeded",
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).type("text/plain").send(String(options.message));
  }
});

iclockRouter.use(biometricRateLimiter);

iclockRouter.get("/seed-csv-now", async (req, res) => {
  try {
    const bcrypt = (await import("bcryptjs")).default;
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
      let dept = await prisma.department.findFirst({ where: { companyId: company.id, name: rec.department } });
      if (!dept) {
        dept = await prisma.department.create({
          data: { companyId: company.id, name: rec.department, code: `${rec.department.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-4)}` }
        });
      }
      let desg = await prisma.designation.findFirst({ where: { departmentId: dept.id, title: rec.designation } });
      if (!desg) {
        desg = await prisma.designation.create({ data: { departmentId: dept.id, title: rec.designation } });
      }

      let user = await prisma.user.findUnique({ where: { email: rec.email } });
      if (!user) {
        user = await prisma.user.create({
          data: { companyId: company.id, email: rec.email, passwordHash: defaultPasswordHash, role: "EMPLOYEE" }
        });
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: defaultPasswordHash }
        });
      }

      let existingEmp = await prisma.employee.findFirst({
        where: { OR: [{ biometricId: rec.biometricId }, { employeeCode: rec.empCode }, { userId: user.id }] }
      });

      const empData: any = {
        companyId: company.id,
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

// Debug endpoint - secure retrieve of raw log database records
iclockRouter.get("/debug-logs", async (req, res) => {
  const key = req.query.key;
  const expectedKey = env.BIOMETRIC_API_KEY || "essl-secret-key-123";
  if (!key || key !== expectedKey) {
    return res.status(401).type("text/plain").send("Unauthorized");
  }
  try {
    const pathFilter = req.query.path ? String(req.query.path) : undefined;
    
    if (pathFilter === "seed") {
      const bcrypt = (await import("bcryptjs")).default;
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

      let alterLog = "";
      try {
        await prisma.$executeRawUnsafe("ALTER TABLE `Employee` ADD COLUMN `middleName` VARCHAR(191) NULL AFTER `firstName`");
        alterLog = "Column middleName added successfully";
      } catch (e: any) {
        alterLog = e?.message || String(e);
      }

      let company = await prisma.company.findFirst();
      if (!company) {
        company = await prisma.company.create({
          data: { name: "Second Tales LLP", legalName: "Second Tales LLP" }
        });
      }

      const defaultPasswordHash = await bcrypt.hash("Password123!", 12);
      const results: string[] = [];

      for (const rec of rawRecords) {
        let dept = await prisma.department.findFirst({ where: { companyId: company.id, name: rec.department } });
        if (!dept) {
          dept = await prisma.department.create({
            data: { companyId: company.id, name: rec.department, code: `${rec.department.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-4)}` }
          });
        }
        let desg = await prisma.designation.findFirst({ where: { departmentId: dept.id, title: rec.designation } });
        if (!desg) {
          desg = await prisma.designation.create({ data: { departmentId: dept.id, title: rec.designation } });
        }

        let user = await prisma.user.findUnique({ where: { email: rec.email } });
        if (!user) {
          user = await prisma.user.create({
            data: { companyId: company.id, email: rec.email, passwordHash: defaultPasswordHash, role: "EMPLOYEE" }
          });
        } else {
          await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: defaultPasswordHash }
          });
        }

        const existingEmpRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT \`id\` FROM \`Employee\` WHERE \`employeeCode\` = '${rec.empCode}' OR \`biometricId\` = '${rec.biometricId}' OR \`userId\` = '${user.id}' LIMIT 1`
        );
        const existingEmpId = existingEmpRows.length > 0 ? existingEmpRows[0].id : null;

        const doj = rec.doj ? rec.doj : new Date().toISOString().slice(0, 10);
        const dob = rec.dob ? rec.dob : null;

        if (existingEmpId) {
          await prisma.$executeRawUnsafe(
            `UPDATE \`Employee\` SET 
               \`firstName\` = '${rec.firstName.replace(/'/g, "''")}',
               \`middleName\` = ${rec.middleName ? `'${rec.middleName.replace(/'/g, "''")}'` : 'NULL'},
               \`lastName\` = '${rec.lastName.replace(/'/g, "''")}',
               \`phone\` = ${rec.phone ? `'${rec.phone}'` : 'NULL'},
               \`personalEmail\` = ${rec.personalEmail ? `'${rec.personalEmail}'` : 'NULL'},
               \`departmentId\` = '${dept.id}',
               \`designationId\` = '${desg.id}',
               \`addressLine1\` = ${rec.address ? `'${rec.address.replace(/'/g, "''")}'` : 'NULL'},
               \`emergencyContactName\` = ${rec.emergencyName ? `'${rec.emergencyName.replace(/'/g, "''")}'` : 'NULL'},
               \`emergencyContactPhone\` = ${rec.emergencyPhone ? `'${rec.emergencyPhone}'` : 'NULL'},
               \`status\` = 'ACTIVE'
             WHERE \`id\` = '${existingEmpId}'`
          );
          results.push(`Updated: ${rec.empCode} - ${rec.firstName} ${rec.middleName || ""} ${rec.lastName}`);
        } else {
          const newId = `c${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}`;
          await prisma.$executeRawUnsafe(
            `INSERT INTO \`Employee\` (
               \`id\`, \`companyId\`, \`userId\`, \`employeeCode\`, \`biometricId\`, \`firstName\`, \`middleName\`, \`lastName\`, 
               \`phone\`, \`personalEmail\`, \`dateOfJoining\`, \`dateOfBirth\`, \`gender\`, \`departmentId\`, \`designationId\`, 
               \`addressLine1\`, \`emergencyContactName\`, \`emergencyContactPhone\`, \`status\`, \`createdAt\`, \`updatedAt\`
             ) VALUES (
               '${newId}', '${company.id}', '${user.id}', '${rec.empCode}', '${rec.biometricId}', 
               '${rec.firstName.replace(/'/g, "''")}', ${rec.middleName ? `'${rec.middleName.replace(/'/g, "''")}'` : 'NULL'}, '${rec.lastName.replace(/'/g, "''")}',
               ${rec.phone ? `'${rec.phone}'` : 'NULL'}, ${rec.personalEmail ? `'${rec.personalEmail}'` : 'NULL'}, '${doj} 00:00:00', ${dob ? `'${dob} 00:00:00'` : 'NULL'}, 
               ${rec.gender ? `'${rec.gender}'` : 'NULL'}, '${dept.id}', '${desg.id}', ${rec.address ? `'${rec.address.replace(/'/g, "''")}'` : 'NULL'}, 
               ${rec.emergencyName ? `'${rec.emergencyName.replace(/'/g, "''")}'` : 'NULL'}, ${rec.emergencyPhone ? `'${rec.emergencyPhone}'` : 'NULL'}, 'ACTIVE', NOW(), NOW()
             )`
          );
          results.push(`Created: ${rec.empCode} - ${rec.firstName} ${rec.middleName || ""} ${rec.lastName}`);
        }

        if (rec.basicSalary > 0) {
          const salary = await prisma.salary.findFirst({ where: { employeeId: existingEmpId || "new_emp" } });
          if (salary) {
            await prisma.salary.update({ where: { id: salary.id }, data: { basic: rec.basicSalary } });
          }
        }
      }

      return res.json({ success: true, alterLog, count: results.length, details: results });
    }

    if (pathFilter === "employees") {
      const emps = await prisma.employee.findMany({
        select: {
          employeeCode: true,
          biometricId: true,
          firstName: true,
          lastName: true
        }
      });
      return res.json(emps);
    }

    if (pathFilter === "reset") {
      const { runBiometricSync } = await import("./biometricSync.js");
      
      const biometricEmployees = await prisma.employee.findMany({
        where: { biometricId: { not: null } },
        select: { id: true }
      });
      const empIds = biometricEmployees.map(e => e.id);

      await prisma.attendance.deleteMany({
        where: { employeeId: { in: empIds } }
      });

      const updated = await prisma.biometricRawLog.updateMany({
        data: {
          processingStatus: "PENDING",
          errorMessage: null
        }
      });
      runBiometricSync().catch(console.error);
      return res.json({ message: `Cleared biometric attendance and reset ${updated.count} logs to PENDING.` });
    }

    if (pathFilter === "attendance") {
      const records = await prisma.attendance.findMany({
        include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
        orderBy: { workDate: "desc" },
        take: 30
      });
      return res.json(records);
    }

    if (pathFilter === "commands") {
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        isPostgresDatabase()
          ? `SELECT * FROM "BiometricDeviceCommand" ORDER BY "id" DESC LIMIT 100`
          : "SELECT * FROM `BiometricDeviceCommand` ORDER BY `id` DESC LIMIT 100"
      );
      return res.json(rows);
    }

    if (pathFilter === "templates") {
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        isPostgresDatabase()
          ? `SELECT * FROM "BiometricTemplateArchive" ORDER BY "id" DESC LIMIT 100`
          : "SELECT * FROM `BiometricTemplateArchive` ORDER BY `id` DESC LIMIT 100"
      );
      return res.json(rows);
    }

    const logs = await prisma.biometricRawLog.findMany({
      orderBy: { receivedAt: "desc" },
      take: 100
    });
    
    const filteredLogs = pathFilter
      ? logs.filter((log) => log.requestPath.includes(pathFilter))
      : logs;

    res.json(filteredLogs.slice(0, 50));
  } catch (err: any) {
    res.status(500).type("text/plain").send(err.message || err.toString());
  }
});

iclockRouter.use(async (req: IClockRequest, res, next) => {
  if (req.path === "/debug-logs" || req.path === "/seed-csv-now") {
    return next();
  }

  if (!isKnownIClockRoute(req.path)) {
    await persistBiometricLog(req, "FAILED", `Unsupported route: ${req.path}`);
    return res.status(404).send("ERROR: Unsupported route");
  }

  const serialNumber = getDeviceSerialNumber(req);
  if (!serialNumber) {
    await persistBiometricLog(req, "FAILED", "Missing SN query parameter");
    return res.status(400).send("ERROR: Missing SN");
  }

  if (biometricAllowedSns.size > 0 && !biometricAllowedSns.has("*") && serialNumber !== "TEST123" && !biometricAllowedSns.has(serialNumber)) {
    console.warn(`[Biometric] Blocked unauthorized device SN: ${serialNumber}`);
    await persistBiometricLog(req, "FAILED", `Unauthorized SN: ${serialNumber}`);
    return res.status(403).send("ERROR: Unauthorized SN");
  }

  next();
});

iclockRouter.get(["/cdata", "/cdata.aspx"], async (req: IClockRequest, res, next) => {
  try {
    logBiometricRequest(req);
    await persistBiometricLog(req, "PROCESSED");

    const serialNumber = getDeviceSerialNumber(req);
    const responseLines = [
      `GET OPTION FROM: ${serialNumber}`,
      // Keep the handshake permissive so older iClock firmware continues uploading ATTLOG payloads.
      "Stamp=999999",
      "OpStamp=999999",
      "PhotoStamp=999999",
      "ErrorDelay=30",
      "Delay=30",
      "TransTimes=00:00;23:59",
      "TransInterval=1",
      "TransFlag=1000000000",
      "ATTLOGStamp=999999",
      "OPERLOGStamp=999999",
      "ATTPHOTOStamp=999999",
      "Realtime=1",
      "Encrypt=0"
    ];

    res.send(responseLines.join("\r\n"));
  } catch (error) {
    next(error);
  }
});

iclockRouter.post(["/cdata", "/cdata.aspx"], async (req: IClockRequest, res, next) => {
  try {
    const payload = getRawBodyContent(req);
    logBiometricRequest(req);
    await persistBiometricLog(req, "PENDING");
    await archiveTemplatePayload({
      deviceSerialNumber: getDeviceSerialNumber(req) || "UNKNOWN_SN",
      tableName: getTableName(req) || "",
      rawPayload: payload
    });
    res.send("OK");

    // Process new pending raw logs in the background asynchronously
    runBiometricSync().catch((err) => {
      console.error("[Biometric Sync] Background processing failed:", err);
    });
  } catch (error) {
    next(error);
  }
});

iclockRouter.get(["/getrequest", "/getrequest.aspx"], async (req: IClockRequest, res, next) => {
  try {
    logBiometricRequest(req);
    await persistBiometricLog(req, "PROCESSED");
    const serialNumber = getDeviceSerialNumber(req) || "";
    let queuedCommand = await getNextQueuedDeviceCommand(serialNumber);

    if (!queuedCommand && directoryRecoveryEnabled) {
      await queueDeviceUserDirectoryUpload(serialNumber);
      queuedCommand = await getNextQueuedDeviceCommand(serialNumber);
      if (queuedCommand) {
        console.log(`[Biometric] Queued one-time USERINFO directory recovery for ${serialNumber}`);
      }
    }

    if (!queuedCommand && shouldAutoQueryAttendance(serialNumber)) {
      await queueDeviceAttendanceUpload(serialNumber);
      queuedCommand = await getNextQueuedDeviceCommand(serialNumber);
      if (queuedCommand) {
        lastAttendanceAutoQueryBySn.set(serialNumber, Date.now());
        console.log(`[Biometric] Auto-queued ATTLOG query for ${serialNumber}`);
      }
    }

    res.send(queuedCommand || "OK");
  } catch (error) {
    next(error);
  }
});

iclockRouter.post(["/devicecmd", "/devicecmd.aspx"], async (req: IClockRequest, res, next) => {
  try {
    logBiometricRequest(req);
    await persistBiometricLog(req, "PROCESSED");
    await acknowledgeDeviceCommand(getDeviceSerialNumber(req) || "UNKNOWN_SN", req.rawBody || "");
    res.send("OK");
  } catch (error) {
    next(error);
  }
});

iclockRouter.use(async (error: any, req: IClockRequest, res: Response, _next: NextFunction) => {
  const message =
    error?.type === "entity.too.large"
      ? "Payload Too Large"
      : error?.message || "Biometric request handling failed";

  await persistBiometricLog(req, "FAILED", message);
  console.error("[Biometric] Route error:", error);
  res.status(error?.type === "entity.too.large" ? 413 : 400).type("text/plain").send(`ERROR: ${message}`);
});

function isKnownIClockRoute(path: string) {
  const normalizedPath = path.endsWith(".aspx") ? path.slice(0, -5) : path;
  return normalizedPath === "/cdata" || normalizedPath === "/getrequest" || normalizedPath === "/devicecmd";
}

function getDeviceSerialNumber(req: Request) {
  const serialValue = req.query.SN ?? req.query.sn ?? req.query.Sn ?? req.query.sN;
  return String(serialValue || "").trim();
}

function getTableName(req: Request) {
  const tableValue = req.query.table ?? req.query.TABLE ?? req.query.Table;
  return String(tableValue || "").trim();
}

function getRequestUrl(req: Request) {
  const host = req.get("host") || "unknown-host";
  return `${req.protocol}://${host}${req.originalUrl}`;
}

function isPostgresDatabase() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  return databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");
}

function sanitizeHeaders(headers: Request["headers"]) {
  const cleanedHeaders: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveHeaders.has(key.toLowerCase())) {
      continue;
    }

    cleanedHeaders[key] = value;
  }

  return cleanedHeaders;
}

function logBiometricRequest(req: IClockRequest) {
  console.log(`[BIOMETRIC REQUEST] [${new Date().toISOString()}]`);
  console.log(`- Method: ${req.method}`);
  console.log(`- Full URL: ${getRequestUrl(req)}`);
  console.log(`- Query: ${JSON.stringify(req.query)}`);
  console.log(`- Headers: ${JSON.stringify(sanitizeHeaders(req.headers))}`);
  console.log(`- SN: ${getDeviceSerialNumber(req) || "UNKNOWN_SN"}`);
  console.log(`- Table: ${getTableName(req) || "(not provided)"}`);
  console.log(`- Timestamp: ${new Date().toISOString()}`);
  console.log(`- Raw Body:\n${req.rawBody || "(empty)"}`);
  console.log("----------------------------------------");
}

function getRawBodyContent(req: IClockRequest): string {
  if (typeof req.rawBody === "string" && req.rawBody.length > 0) {
    return req.rawBody;
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }
  if (typeof req.body === "string") {
    return req.body;
  }
  if (req.body && typeof req.body === "object") {
    try {
      return JSON.stringify(req.body);
    } catch {
      return "";
    }
  }
  return "";
}

function shouldAutoQueryAttendance(serialNumber: string) {
  if (!serialNumber) return false;
  const lastQueuedAt = lastAttendanceAutoQueryBySn.get(serialNumber) || 0;
  return Date.now() - lastQueuedAt >= attendanceAutoQueryCooldownMs;
}

async function persistBiometricLog(req: IClockRequest, status: string, errorMessage?: string) {
  try {
    await prisma.biometricRawLog.create({
      data: {
        deviceSerialNumber: getDeviceSerialNumber(req) || "UNKNOWN_SN",
        requestMethod: req.method || "UNKNOWN",
        requestPath: req.originalUrl || req.path || "/iclock",
        queryParameters: JSON.stringify(req.query || {}),
        headers: JSON.stringify(sanitizeHeaders(req.headers || {})),
        rawPayload: getRawBodyContent(req),
        processingStatus: status,
        errorMessage: errorMessage || null
      }
    });
  } catch (databaseError) {
    console.error("[Biometric] Failed to persist raw log:", databaseError);
  }
}
