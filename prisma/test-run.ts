import { authService } from "../src/modules/auth/auth.service.js";
import { prisma } from "../src/lib/prisma.js";

async function runTest() {
  console.log("=== RUNNING AUTH LOGIN TEST ===");
  try {
    const result = await authService.login("hr@example.com", "Password123!");
    console.log("Login test succeeded!", JSON.stringify({ email: result.user.email, role: result.user.role }));
  } catch (error: any) {
    console.error("Login test failed! Error details:");
    console.error(error);
    if (error.stack) {
      console.error(error.stack);
    }
  }
  console.log("=== END OF AUTH LOGIN TEST ===");
}

runTest().finally(() => prisma.$disconnect());
