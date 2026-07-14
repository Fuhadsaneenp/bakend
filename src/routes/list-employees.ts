import { prisma } from "../lib/prisma.js";

async function main() {
  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      employeeCode: true,
      biometricId: true,
      firstName: true,
      lastName: true
    }
  });

  console.log("--- Current Database Employees ---");
  for (const emp of employees) {
    console.log(`Code: ${emp.employeeCode} | BiometricID: ${emp.biometricId} | Name: ${emp.firstName} ${emp.lastName}`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
