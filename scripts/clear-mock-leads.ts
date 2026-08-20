import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function clearMockLeads() {
  const deleted = await prisma.metaLead.deleteMany();
  console.log(`✅ Cleared ${deleted.count} mock leads from database.`);
}

clearMockLeads().catch(console.error).finally(() => prisma.$disconnect());
