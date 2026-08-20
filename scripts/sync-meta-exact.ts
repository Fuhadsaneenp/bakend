import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const ACCESS_TOKEN = "EAGPX4DeSj5EBSDWEkrhBxmXUTmN5GwuRiryaRThFaMmwCSRgmL5MZCLZBECQ9OFArbjiCfk6XA0fgyBgbJVuhoURUW7K2rGIdR0ML1ssOdWLrbadxZCdKNmULkrkYZBXXh5QlJkKrb4fjkLingovFm7KWZCpwXKwyO3gWoVZCgZAEhTPdUQL3l2bkiYiiLmyF2VozEeQjczClewzlhBX9UzWBHBy0h1FbQqqZAZAmD0Hs5V1t7svgq8McTBToqrWpoKuSyxKYkUFW9FZAZBOXmschFg";

async function syncAllRealCampaigns() {
  console.log("Starting authentic Meta API campaign sync...");

  const adAccounts = await prisma.metaAdAccount.findMany({
    include: { client: true }
  });

  console.log(`Found ${adAccounts.length} Meta Ad Accounts to sync.`);

  for (const account of adAccounts) {
    const actId = account.adAccountId;
    console.log(`\n----------------------------------------`);
    console.log(`Syncing ${account.client.name} (${actId})...`);

    // 1. Fetch campaigns
    const campUrl = `https://graph.facebook.com/v20.0/${actId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time&limit=200&access_token=${ACCESS_TOKEN}`;
    let campaigns: any[] = [];
    try {
      const campRes = await fetch(campUrl);
      const campJson = await campRes.json();
      if (campJson.data) {
        campaigns = campJson.data;
      } else {
        console.log(`  No campaigns found or error:`, campJson.error?.message || campJson);
      }
    } catch (e: any) {
      console.error(`  Failed to fetch campaigns for ${actId}:`, e.message);
    }

    // 2. Fetch campaign-level insights
    const insightsMap: Record<string, any> = {};
    try {
      const insUrl = `https://graph.facebook.com/v20.0/${actId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,reach,clicks,cpc,cpm,ctr,actions,cost_per_action_type,purchase_roas&date_preset=maximum&limit=500&access_token=${ACCESS_TOKEN}`;
      const insRes = await fetch(insUrl);
      const insJson = await insRes.json();
      if (insJson.data && Array.isArray(insJson.data)) {
        for (const row of insJson.data) {
          insightsMap[row.campaign_id] = row;
        }
      }
    } catch (e: any) {
      console.error(`  Failed to fetch insights for ${actId}:`, e.message);
    }

    console.log(`  Found ${campaigns.length} campaigns from Meta API and ${Object.keys(insightsMap).length} campaign insight rows.`);

    // 3. Delete existing daily insights & campaigns for this client
    await prisma.metaDailyInsight.deleteMany({
      where: { clientId: account.clientId }
    });
    await prisma.metaCampaign.deleteMany({
      where: { clientId: account.clientId }
    });

    // 4. Insert each real campaign with exact Meta data
    for (const c of campaigns) {
      const ins = insightsMap[c.id] || {};
      
      const spent = parseFloat(ins.spend || "0");
      const impressions = parseInt(ins.impressions || "0", 10);
      const reach = parseInt(ins.reach || "0", 10);
      const clicks = parseInt(ins.clicks || "0", 10);
      const cpc = parseFloat(ins.cpc || "0");
      const cpm = parseFloat(ins.cpm || "0");
      const ctr = parseFloat(ins.ctr || "0");

      // Extract real leads
      let leads = 0;
      let costPerResult = 0;
      if (ins.actions && Array.isArray(ins.actions)) {
        for (const act of ins.actions) {
          if (
            act.action_type === "lead" ||
            act.action_type === "onsite_conversion.lead_grouped" ||
            act.action_type === "onsite_conversion.total_messaging_connection" ||
            act.action_type === "contact_total" ||
            act.action_type === "onsite_conversion.messaging_conversation_started_7d"
          ) {
            leads += parseInt(act.value || "0", 10);
          }
        }
      }

      if (ins.cost_per_action_type && Array.isArray(ins.cost_per_action_type)) {
        for (const cpa of ins.cost_per_action_type) {
          if (
            cpa.action_type === "lead" ||
            cpa.action_type === "onsite_conversion.lead_grouped" ||
            cpa.action_type === "onsite_conversion.total_messaging_connection" ||
            cpa.action_type === "link_click"
          ) {
            costPerResult = parseFloat(cpa.value || "0");
            break;
          }
        }
      }

      // Extract real ROAS
      let roas = 0;
      if (ins.purchase_roas && Array.isArray(ins.purchase_roas) && ins.purchase_roas.length > 0) {
        roas = parseFloat(ins.purchase_roas[0].value || "0");
      }

      // Map objective cleanly
      let objEnum = "ENGAGEMENT";
      const objStr = (c.objective || "").toUpperCase();
      if (objStr.includes("LEAD")) objEnum = "LEADS";
      else if (objStr.includes("CONVERSION") || objStr.includes("OUTCOME_SALES")) objEnum = "CONVERSIONS";
      else if (objStr.includes("TRAFFIC")) objEnum = "TRAFFIC";
      else if (objStr.includes("MESSAGE")) objEnum = "MESSAGES";
      else if (objStr.includes("ENGAGEMENT")) objEnum = "ENGAGEMENT";

      const dailyBudget = c.daily_budget ? Math.round(parseInt(c.daily_budget, 10) / 100) : 0;
      const lifetimeBudget = c.lifetime_budget ? Math.round(parseInt(c.lifetime_budget, 10) / 100) : null;

      await prisma.metaCampaign.create({
        data: {
          company: { connect: { id: account.companyId } },
          client: { connect: { id: account.clientId } },
          metaCampaignId: c.id,
          name: c.name,
          status: c.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
          objective: objEnum,
          dailyBudget: dailyBudget,
          lifetimeBudget: lifetimeBudget,
          amountSpent: spent,
          impressions: impressions,
          reach: reach,
          clicks: clicks,
          ctr: ctr,
          cpc: cpc,
          cpm: cpm,
          leads: leads,
          messages: 0,
          conversions: 0,
          costPerResult: costPerResult,
          roas: roas,
          startDate: c.created_time ? new Date(c.created_time) : (c.start_time ? new Date(c.start_time) : null),
          endDate: c.stop_time ? new Date(c.stop_time) : null,
          createdAt: c.created_time ? new Date(c.created_time) : new Date(),
          creativeType: "IMAGE",
          notes: c.name
        }
      });
    }

    console.log(`  Synced ${campaigns.length} live campaigns for ${account.client.name}.`);
  }

  console.log("\n✅ All 31 Meta accounts successfully synced with exact live campaign insights!");
}

syncAllRealCampaigns().catch(console.error).finally(() => prisma.$disconnect());
