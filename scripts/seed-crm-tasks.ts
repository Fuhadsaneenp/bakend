import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function seedCrmAndTasks() {
  console.log("🌱 Updating all CRM Clients with accurate multi-service scope...");

  const company = await prisma.company.findFirst();
  if (!company) {
    console.error("❌ No company found in DB!");
    return;
  }

  const employees = await prisma.employee.findMany({
    where: { companyId: company.id }
  });

  const akhil = employees.find(e => 
    (e.firstName?.toLowerCase().includes("akhil") || e.lastName?.toLowerCase().includes("akhil") || e.email?.toLowerCase().includes("akhil"))
  ) || employees[0];

  const rahul = employees.find(e => e.id !== akhil?.id) || akhil;

  // CRM is the source of truth for Work Track clients.
  // Keep live data limited to the real active CRM clients below.
  const clientData = [
    {
      name: "SLF",
      details: "3 Creative Posters · 1 Moment Marketing · 1 Ad Poster",
      contacts: "+971 50 123 4567 (contact@slf.ae)",
      packageName: "Creative & Ads Retainer (5 Deliverables)",
      postersCommitted: 5,
      videoSeo: "0 Videos",
      digitalMarketingActivities: "Creative Posters (3), Moment Marketing (1), Ad Posters (1)",
      accountManagerId: akhil?.id
    },
    {
      name: "Doner Club",
      details: "2 Moment Marketing · 2 Ad Posters · 9 Video Works",
      contacts: "+971 52 987 6543 (marketing@donerclub.ae)",
      packageName: "Omnichannel Growth Retainer (13 Deliverables)",
      postersCommitted: 4,
      videoSeo: "9 Video Works / Reels",
      digitalMarketingActivities: "Video Works (9), Moment Marketing (2), Ad Posters (2)",
      accountManagerId: akhil?.id
    },
    {
      name: "Nizar Hospital",
      details: "2 Ad Posters · 8 Video Works",
      contacts: "+91 98460 33221 (info@nizarhospital.com)",
      packageName: "Healthcare Awareness Retainer (10 Deliverables)",
      postersCommitted: 2,
      videoSeo: "8 Video Works / Reels",
      digitalMarketingActivities: "Video Works (8), Ad Posters (2)",
      accountManagerId: akhil?.id
    },
    {
      name: "Salty Fresh",
      details: "2 Moment Marketing · 5 Video Works",
      contacts: "+971 55 443 3221 (hello@saltyfresh.com)",
      packageName: "Brand Video & Social Retainer (7 Deliverables)",
      postersCommitted: 2,
      videoSeo: "5 Video Works / Reels",
      digitalMarketingActivities: "Video Works (5), Moment Marketing (2)",
      accountManagerId: rahul?.id
    },
    {
      name: "Turbit",
      details: "4 Video Works / Motion Graphics",
      contacts: "+971 58 776 5544 (team@turbit.io)",
      packageName: "Video Production Retainer (4 Deliverables)",
      postersCommitted: 0,
      videoSeo: "4 Video Works / Reels",
      digitalMarketingActivities: "Video Works (4)",
      accountManagerId: rahul?.id
    }
  ];

  const knownDummyClientNames = [
    "Clearpath Logistics",
    "Solstice Studios",
    "Apex Ventures",
    "NovaBrands Co.",
    "Meridian Health",
    "Pinnacle Group",
    "Apex Dental & Implant Centre",
    "Zenith Cloud Technologies",
    "KiteWave Digital FinTech",
    "Bloomfield International School",
    "SpiceRoute Heritage Resorts",
    "GreenRoots Organic Foods",
    "Stellar Fashion",
    "Urban Kraft Interiors",
    "Nova Fitness & Crossfit Hub"
  ];

  const staleClients = await prisma.client.findMany({
    where: {
      companyId: company.id,
      name: { in: knownDummyClientNames }
    },
    select: { id: true, name: true }
  });

  const staleClientIds = staleClients.map(client => client.id);
  if (staleClientIds.length > 0) {
    const staleCards = await prisma.workCard.findMany({
      where: { companyId: company.id, clientId: { in: staleClientIds } },
      select: { id: true }
    });
    const staleCardIds = staleCards.map(card => card.id);

    if (staleCardIds.length > 0) {
      await prisma.statusHistory.deleteMany({ where: { workCardId: { in: staleCardIds } } });
      await prisma.reworkLog.deleteMany({ where: { workCardId: { in: staleCardIds } } });
      await prisma.comment.deleteMany({ where: { workCardId: { in: staleCardIds } } });
      await prisma.rating.deleteMany({ where: { workCardId: { in: staleCardIds } } });
      await prisma.pointsLedger.updateMany({
        where: { workCardId: { in: staleCardIds } },
        data: { workCardId: null }
      });
      await prisma.workCard.deleteMany({ where: { id: { in: staleCardIds } } });
    }

    await prisma.specialDay.deleteMany({ where: { clientId: { in: staleClientIds } } });
    await prisma.metaDailyInsight.deleteMany({ where: { clientId: { in: staleClientIds } } });
    await prisma.metaLead.deleteMany({ where: { clientId: { in: staleClientIds } } });
    await prisma.metaCampaign.deleteMany({ where: { clientId: { in: staleClientIds } } });
    await prisma.metaAdAccount.deleteMany({ where: { clientId: { in: staleClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: staleClientIds } } });
    console.log(`🧹 Removed stale dummy clients: ${staleClients.map(client => client.name).join(", ")}`);
  }

  for (const cData of clientData) {
    const existing = await prisma.client.findFirst({
      where: { name: cData.name, companyId: company.id }
    });

    if (existing) {
      await prisma.client.update({
        where: { id: existing.id },
        data: {
          details: cData.details,
          contacts: cData.contacts,
          packageName: cData.packageName,
          postersCommitted: cData.postersCommitted,
          videoSeo: cData.videoSeo,
          digitalMarketingActivities: cData.digitalMarketingActivities,
          accountManagerId: cData.accountManagerId
        }
      });
      console.log(`🔄 Updated Client: ${cData.name}`);
    } else {
      await prisma.client.create({
        data: {
          ...cData,
          companyId: company.id
        }
      });
      console.log(`✅ Created Client: ${cData.name}`);
    }
  }

  console.log("🎉 Successfully updated all CRM clients!");
}

seedCrmAndTasks()
  .catch(err => {
    console.error("❌ Error updating clients:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
