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

  // Comprehensive client service definitions
  const clientData = [
    {
      name: "HealthFirst Clinics",
      details: "Premier multi-specialty healthcare & wellness clinic (Dr. Amit Gupta)",
      contacts: "+91 98765 00100 (amit@healthfirst.in)",
      packageName: "SEO + Google Ads Retainer",
      postersCommitted: 0,
      videoSeo: "10 Keyword Tracking, 150 Backlinks",
      digitalMarketingActivities: "SEO, Keyword Ranking, Backlinks, Google Search Ads, PPC",
      accountManagerId: akhil?.id
    },
    {
      name: "Apex Dental & Implant Centre",
      details: "Premier cosmetic dentistry & orthodontic clinic in Kochi (Dr. Anand)",
      contacts: "+91 98470 11223 (dr.anand@apexdental.in)",
      packageName: "Growth Package (SEO + 30 Posters + 8 Reels)",
      postersCommitted: 30,
      videoSeo: "Local SEO, 12 Keywords, Google Business Profile",
      digitalMarketingActivities: "SEO, Keyword Ranking, Google Ads, Social Media Management, Performance Ads, Local SEO",
      accountManagerId: akhil?.id
    },
    {
      name: "Zenith Cloud Technologies",
      details: "High-performance multi-cloud SaaS & DevOps platform (Siddharth Menon)",
      contacts: "+91 98950 44332 (siddharth@zenithcloud.io)",
      packageName: "Enterprise Tech SEO & Performance Retainer",
      postersCommitted: 20,
      videoSeo: "Technical SEO, 25 Keywords Ranking, Backlink Outreach",
      digitalMarketingActivities: "SEO, Technical SEO, Backlink Sheet, Google Search Ads, PPC Campaigns, B2B Whitepapers",
      accountManagerId: akhil?.id
    },
    {
      name: "KiteWave Digital FinTech",
      details: "Next-gen zero-fee neobank & cross-border payments app (Varun Nambiar)",
      contacts: "+91 99955 66778 (varun@kitewave.finance)",
      packageName: "FinTech Scale Suite (SEO + Paid Ads + Creatives)",
      postersCommitted: 35,
      videoSeo: "Fintech SEO, 20 Keywords Ranking, App Store Search",
      digitalMarketingActivities: "SEO, Keyword Ranking, Google Ads, Meta Ads, App Store SEO, Motion Graphics",
      accountManagerId: akhil?.id
    },
    {
      name: "Bloomfield International School",
      details: "CBSE & Cambridge affiliated residential campus & STEM academy (Fr. Mathew)",
      contacts: "+91 94470 12345 (principal@bloomfieldschool.org)",
      packageName: "Education Admissions SEO & Ads Suite",
      postersCommitted: 20,
      videoSeo: "Admissions Local SEO, 15 Keywords, Google Maps",
      digitalMarketingActivities: "SEO, Local SEO, Keyword Ranking, Google Search Ads, Admissions Campaigns",
      accountManagerId: akhil?.id
    },
    {
      name: "SpiceRoute Heritage Resorts",
      details: "Eco-luxury forest resort & Ayurvedic wellness retreat in Munnar (Nandini Warrier)",
      contacts: "+91 94471 99887 (nandini@spicerouteresorts.com)",
      packageName: "Hospitality Elite Suite (SEO + Social + Video)",
      postersCommitted: 25,
      videoSeo: "Travel & Resort SEO, Google Maps Ranking",
      digitalMarketingActivities: "SEO, Tourism SEO, Local Search, Reels Production, Travel Influencer PR, Meta Ads",
      accountManagerId: akhil?.id
    },
    {
      name: "Stellar Fashion",
      details: "Priyanka Malhotra",
      contacts: "+91 87654 00200",
      packageName: "Social Media + Design & Video",
      postersCommitted: 12,
      videoSeo: "4 Product Reels",
      digitalMarketingActivities: "Social Media, Design & Video, Product Reels",
      accountManagerId: rahul?.id
    },
    {
      name: "Luxe Aura Cosmetics",
      details: "Luxury vegan skincare & personal care brand (Maya Nair)",
      contacts: "+91 97455 33445 (maya@luxeaura.com)",
      packageName: "Brand Starter Kit (Social + Packaging)",
      postersCommitted: 20,
      videoSeo: "4 Videos",
      digitalMarketingActivities: "Meta Ads, Influencer PR Creatives, Brand Identity, Packaging Design",
      accountManagerId: rahul?.id
    },
    {
      name: "Urban Kraft Interiors",
      details: "Modern bespoke architectural & interior design studio (Arjun K)",
      contacts: "+91 99951 88776 (arjun@urbankraft.design)",
      packageName: "Enterprise Visual Suite",
      postersCommitted: 25,
      videoSeo: "6 Videos",
      digitalMarketingActivities: "Lead Generation Ads, Project Showcase Carousels",
      accountManagerId: akhil?.id
    },
    {
      name: "GreenRoots Organic Foods",
      details: "Farm-to-table organic produce & cold-pressed oils (Sujith V)",
      contacts: "+91 94460 55667 (sujith@greenrootsorganic.com)",
      packageName: "Standard Social Suite",
      postersCommitted: 15,
      videoSeo: "2 Videos",
      digitalMarketingActivities: "Product Photography Packaging, Weekly Social Packs",
      accountManagerId: akhil?.id
    },
    {
      name: "Nova Fitness & Crossfit Hub",
      details: "High-intensity fitness, strength & MMA training academy (Karan Varma)",
      contacts: "+91 97460 77665 (karan@novafitness.fit)",
      packageName: "Fitness Growth Pack",
      postersCommitted: 18,
      videoSeo: "6 Videos",
      digitalMarketingActivities: "Challenge Banners, Story Templates, Lead Gen",
      accountManagerId: akhil?.id
    }
  ];

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
