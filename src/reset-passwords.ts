import dotenv from "dotenv";
dotenv.config({ path: "backend/.env" });
import bcrypt from "bcryptjs";

async function main() {
  const { prisma } = await import("./lib/prisma.js");

  const passwordHash = await bcrypt.hash("Password123!", 12);
  const updated = await prisma.user.updateMany({
    data: {
      passwordHash
    }
  });

  console.log(`Successfully reset password to 'Password123!' for all ${updated.count} users in the database!`);
}

main().finally(() => import("./lib/prisma.js").then(({ prisma }) => prisma.$disconnect()));
