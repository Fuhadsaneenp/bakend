import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const company = await prisma.company.upsert({
    where: { id: "seed-company" },
    update: {},
    create: { id: "seed-company", name: "Acme People Ops", legalName: "Acme People Ops LLC" }
  });

  const department = await prisma.department.upsert({
    where: { companyId_code: { companyId: company.id, code: "OPS" } },
    update: {},
    create: { companyId: company.id, code: "OPS", name: "Operations" }
  });

  const designation =
    (await prisma.designation.findFirst({ where: { departmentId: department.id, title: "HR Manager" } })) ??
    (await prisma.designation.create({ data: { departmentId: department.id, title: "HR Manager" } }));

  const passwordHash = await bcrypt.hash("Password123!", 12);
  const hrUser = await prisma.user.upsert({
    where: { email: "hr@example.com" },
    update: {},
    create: { companyId: company.id, email: "hr@example.com", passwordHash, role: Role.HR_ADMIN }
  });

  await prisma.employee.upsert({
    where: { userId: hrUser.id },
    update: {},
    create: {
      companyId: company.id,
      userId: hrUser.id,
      employeeCode: "EMP-00001",
      firstName: "Asha",
      lastName: "Kapoor",
      phone: "15551234567",
      dateOfJoining: new Date(),
      departmentId: department.id,
      designationId: designation.id,
      salary: { create: { basic: 6000, allowances: 1200, deductions: 500, effectiveFrom: new Date() } }
    }
  });

  console.log("Seeded HR admin: hr@example.com / Password123!");
}

main().finally(() => prisma.$disconnect());
