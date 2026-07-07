import { authService } from "../src/modules/auth/auth.service.js";

async function runTest() {
  console.log("=== RUNNING AUTH LOGIN TEST ===");
  try {
    const result = await authService.login("hr@example.com", "Password123!");
    console.log("Login test succeeded! Result:", JSON.stringify(result));
  } catch (error: any) {
    console.error("Login test failed! Error details:");
    console.error(error);
    if (error.stack) {
      console.error(error.stack);
    }
  }
  console.log("=== END OF AUTH LOGIN TEST ===");
}

runTest();
