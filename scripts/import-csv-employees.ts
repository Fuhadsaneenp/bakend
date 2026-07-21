import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

const csvFilePath = "/Users/saneen/Downloads/Emplyee Detailes - Sheet1.csv";

function parseCsv(content: string) {
  const lines: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      insideQuotes = !insideQuotes;
      current += char;
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (current.trim().length > 0) {
        lines.push(current.trim());
      }
      current = "";
      if (char === '\r' && content[i + 1] === '\n') i++;
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) lines.push(current.trim());

  const parseLine = (line: string) => {
    const fields: string[] = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
      } else if (c === ',' && !inQ) {
        fields.push(field.trim());
        field = "";
      } else {
        field += c;
      }
    }
    fields.push(field.trim());
    return fields;
  };

  const rows = lines.map(parseLine);
  const headers = rows[0].map(h => h.trim());
  const records = rows.slice(1).map(row => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      let val = row[idx] || "";
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).trim();
      }
      record[h] = val;
    });
    return record;
  });

  return records;
}

async function main() {
  console.log("Reading CSV file:", csvFilePath);
  const csvContent = fs.readFileSync(csvFilePath, "utf8");
  const records = parseCsv(csvContent);
  console.log(`Parsed ${records.length} employee records from CSV.`);

  // Ensure default company
  let company = await prisma.company.findFirst();
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: "Second Tales LLP",
        legalName: "Second Tales LLP"
      }
    });
  }

  const defaultPasswordHash = await bcrypt.hash("Password123!", 12);

  for (const row of records) {
    const empCode = row["Employee Code"];
    const biometricId = row["Biometric ID"] || empCode;
    const firstName = row["First Name"];
    const middleName = row["Middle Name"] || null;
    const lastName = row["Last Name"] || "";
    const email = (row["Work Email"] || "").toLowerCase().trim();
    const personalEmail = row["Personal Email"] || null;
    const phone = row["Phone Number"] || null;
    const deptName = row["Department"] || "General";
    const desgTitle = row["Designation"] || "Employee";
    const dojStr = row["Date of Joining (YYYY-MM-DD)"];
    const dobStr = row["Date of Birth (YYYY-MM-DD)"];
    const genderRaw = (row["Gender"] || "").trim();
    const gender = genderRaw.startsWith("F") ? "Female" : genderRaw.startsWith("M") ? "Male" : genderRaw || null;
    const basicSalaryStr = row["Monthly Basic Salary (INR)"] || "0";
    const emergencyContactName = row["Emergency Contact Name"] || null;
    const emergencyContactPhone = row["Emergency Contact Phone"] || null;
    const address = row["Address"] || null;

    if (!email || !firstName) {
      console.warn(`Skipping row with missing email/name: Code ${empCode}`);
      continue;
    }

    // 1. Ensure Department
    let department = await prisma.department.findFirst({
      where: { companyId: company.id, name: deptName }
    });
    if (!department) {
      const code = deptName.substring(0, 4).toUpperCase();
      department = await prisma.department.create({
        data: {
          companyId: company.id,
          name: deptName,
          code: `${code}-${Date.now().toString().slice(-4)}`
        }
      });
    }

    // 2. Ensure Designation
    let designation = await prisma.designation.findFirst({
      where: { departmentId: department.id, title: desgTitle }
    });
    if (!designation) {
      designation = await prisma.designation.create({
        data: {
          departmentId: department.id,
          title: desgTitle
        }
      });
    }

    // 3. Upsert User
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          companyId: company.id,
          email,
          passwordHash: defaultPasswordHash,
          role: "EMPLOYEE"
        }
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: defaultPasswordHash
        }
      });
    }

    // 4. Upsert Employee
    const dateOfJoining = dojStr ? new Date(dojStr) : new Date();
    const dateOfBirth = dobStr ? new Date(dobStr) : null;

    let existingEmp = await prisma.employee.findFirst({
      where: {
        OR: [
          { biometricId },
          { employeeCode: empCode },
          { userId: user.id }
        ]
      }
    });

    const empData: any = {
      companyId: company.id,
      userId: user.id,
      employeeCode: empCode,
      biometricId,
      firstName,
      middleName,
      lastName,
      phone,
      personalEmail,
      dateOfJoining,
      dateOfBirth,
      gender,
      departmentId: department.id,
      designationId: designation.id,
      addressLine1: address,
      emergencyContactName,
      emergencyContactPhone,
      status: "ACTIVE"
    };

    let savedEmployee;
    if (existingEmp) {
      savedEmployee = await prisma.employee.update({
        where: { id: existingEmp.id },
        data: empData
      });
      console.log(`Updated Employee: ${savedEmployee.employeeCode} (${firstName} ${middleName || ""} ${lastName})`);
    } else {
      savedEmployee = await prisma.employee.create({
        data: empData
      });
      console.log(`Created Employee: ${savedEmployee.employeeCode} (${firstName} ${middleName || ""} ${lastName})`);
    }

    // 5. Upsert Salary
    const basicAmount = parseFloat(basicSalaryStr) || 0;
    if (basicAmount > 0) {
      const existingSalary = await prisma.salary.findFirst({ where: { employeeId: savedEmployee.id } });
      if (existingSalary) {
        await prisma.salary.update({
          where: { id: existingSalary.id },
          data: { basic: basicAmount }
        });
      } else {
        await prisma.salary.create({
          data: {
            employeeId: savedEmployee.id,
            basic: basicAmount,
            allowances: 0,
            deductions: 0,
            effectiveFrom: dateOfJoining
          }
        });
      }
    }
  }

  console.log("Employee CSV import successfully completed.");
}

main()
  .catch((e) => {
    console.error("Import error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
