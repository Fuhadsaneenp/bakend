import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  console.log("Cleaning up existing database records...");

  // Delete dependent tables in order
  await prisma.salary.deleteMany({});
  await prisma.employeeDocument.deleteMany({});
  await prisma.employeeLetter.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.wFHRequest.deleteMany({});
  await prisma.expenseClaim.deleteMany({});
  await prisma.reworkLog.deleteMany({});
  await prisma.rating.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.pointsLedger.deleteMany({});
  await prisma.statusHistory.deleteMany({});
  await prisma.workCard.deleteMany({});
  await prisma.client.deleteMany({});
  await prisma.specialDay.deleteMany({});
  await prisma.payslip.deleteMany({});
  await prisma.payrollRun.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.workTrackSetting.deleteMany({});
  
  // Delete core tables
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.designation.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.company.deleteMany({});

  console.log("Clean up completed successfully.");

  // 1. Create seed company
  const company = await prisma.company.create({
    data: {
      id: "seed-company",
      name: "Second Tales EMS",
      legalName: "Second Tales EMS LLC"
    }
  });
  console.log(`Created Company: ${company.name}`);

  // Helper arrays of employee details
  const employeeDetails = [
    {
      code: "ST001",
      firstName: "Fuhad Saneen",
      lastName: "P K",
      email: "hr@example.com", // Default login email
      role: Role.HR_ADMIN,
      deptCode: "MGMT",
      deptName: "Management",
      title: "HR Manager",
      gender: "Male",
      phone: "15551234567"
    },
    {
      code: "ST002",
      firstName: "Hashim",
      lastName: "VP",
      email: "hashim@secondtales.com",
      role: Role.MANAGER,
      deptCode: "PROD",
      deptName: "Team Product",
      title: "UI UX Designer",
      gender: "Male",
      phone: "15551234568"
    },
    {
      code: "ST003",
      firstName: "Nithin",
      lastName: "Bhaskar",
      email: "nithin@secondtales.com",
      role: Role.MANAGER,
      deptCode: "PROD",
      deptName: "Team Product",
      title: "Frontend Developer",
      gender: "Male",
      phone: "15551234569"
    },
    {
      code: "ST004",
      firstName: "Muhammed Rashid",
      lastName: "AK",
      email: "rashid@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "PROD",
      deptName: "Team Product",
      title: "Backend Developer",
      gender: "Male",
      phone: "15551234570"
    },
    {
      code: "ST005",
      firstName: "Fathima",
      lastName: "Sherin",
      email: "fathima@secondtales.com",
      role: Role.HR_ADMIN,
      deptCode: "CREATIVE",
      deptName: "Creative",
      title: "Graphic Designer",
      gender: "Female",
      phone: "15551234571"
    },
    {
      code: "ST006",
      firstName: "Muhammed",
      lastName: "Swadique",
      email: "swadique@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "CREATIVE",
      deptName: "Creative",
      title: "3D Designer",
      gender: "Male",
      phone: "15551234572"
    },
    {
      code: "ST007",
      firstName: "Salahudeen Ayoobi",
      lastName: "C M",
      email: "salahudeen@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "OPS",
      deptName: "Operations",
      title: "Operations Lead",
      gender: "Male",
      phone: "15551234573"
    },
    {
      code: "ST008",
      firstName: "Shoukath Shabeeth",
      lastName: "K",
      email: "shoukath@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "SUPPORT",
      deptName: "Support",
      title: "IT Support",
      gender: "Male",
      phone: "15551234574"
    },
    {
      code: "ST009",
      firstName: "Abdul",
      lastName: "Basith",
      email: "basith@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "FINANCE",
      deptName: "Finance",
      title: "Accountant",
      gender: "Male",
      phone: "15551234575"
    },
    {
      code: "ST010",
      firstName: "Naseeha",
      lastName: "-",
      email: "naseeha@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "SUPPORT",
      deptName: "Support",
      title: "Customer Support",
      gender: "Female",
      phone: "15551234576"
    },
    {
      code: "ST013",
      firstName: "Asif",
      lastName: "Ameen",
      email: "asif@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "PROD",
      deptName: "Team Product",
      title: "QA Engineer",
      gender: "Male",
      phone: "15551234577"
    },
    {
      code: "ST014",
      firstName: "Shamil",
      lastName: "-",
      email: "shamil@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "CREATIVE",
      deptName: "Creative",
      title: "Video Editor",
      gender: "Male",
      phone: "15551234578"
    }
  ];

  const passwordHash = await bcrypt.hash("Password123!", 12);
  const createdEmployees: any[] = [];

  // Seed employees in sequence
  for (const item of employeeDetails) {
    // 2. Create or find department
    const department = await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code: item.deptCode } },
      update: {},
      create: { companyId: company.id, code: item.deptCode, name: item.deptName }
    });

    // 3. Create or find designation
    let designation = await prisma.designation.findFirst({
      where: { departmentId: department.id, title: item.title }
    });
    if (!designation) {
      designation = await prisma.designation.create({
        data: { departmentId: department.id, title: item.title }
      });
    }

    // 4. Create user account
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        email: item.email,
        passwordHash,
        role: item.role
      }
    });

    // 5. Create employee profile
    const employee = await prisma.employee.create({
      data: {
        companyId: company.id,
        userId: user.id,
        employeeCode: item.code,
        firstName: item.firstName,
        lastName: item.lastName,
        phone: item.phone,
        personalEmail: item.email,
        gender: item.gender,
        dateOfJoining: new Date("2026-06-08"),
        departmentId: department.id,
        designationId: designation.id,
        salary: {
          create: {
            basic: 8000,
            allowances: 1500,
            deductions: 500,
            effectiveFrom: new Date("2026-06-08")
          }
        }
      }
    });

    createdEmployees.push(employee);
    console.log(`Seeded employee: ${item.firstName} ${item.lastName} [${item.code}]`);
  }

  // 6. Set Manager Relations (ST001 as manager for all others)
  const managerEmployee = createdEmployees.find(e => e.employeeCode === "ST001");
  if (managerEmployee) {
    for (const employee of createdEmployees) {
      if (employee.employeeCode !== "ST001") {
        await prisma.employee.update({
          where: { id: employee.id },
          data: { managerId: managerEmployee.id }
        });
      }
    }
    console.log("Set ST001 (Fuhad Saneen P K) as manager for all other employees.");
  }

  console.log("\nDatabase seeding completed successfully!");
  console.log("Default admin login: hr@example.com / Password123!");
}

main().finally(() => prisma.$disconnect());
