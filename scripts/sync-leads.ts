import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function seedMetaLeads() {
  console.log("🚀 Starting Meta Lead Ads sync & seed...");

  const company = await prisma.company.findFirst();
  if (!company) {
    console.error("❌ No company found");
    return;
  }

  const clients = await prisma.client.findMany({
    where: { companyId: company.id },
    include: {
      metaCampaigns: true
    }
  });

  console.log(`Found ${clients.length} clients in database`);

  const mockLeadsData = [
    { name: "Muhammed Rashid", phone: "+91 98471 23450", email: "rashid.m@gmail.com", location: "Kochi, Ernakulam", ageGroup: "25-34", gender: "Male", leadSource: "Instagram Feed", formName: "Onam Instant Lead Form", adSetName: "Kerala 21-45 Broad", adName: "Reel 15s Malayalam", leadStatus: "CONVERTED", qualificationStatus: "QUALIFIED", conversionValue: 24999, notes: "Confirmed enrollment. Sent welcome kit." },
    { name: "Anjali Menon", phone: "+91 97455 88123", email: "anjali.menon88@yahoo.com", location: "Calicut, Kozhikode", ageGroup: "25-34", gender: "Female", leadSource: "Instagram Story", formName: "Instant Registration Form", adSetName: "Malabar Professionals", adName: "4-Card Carousel Highlights", leadStatus: "INTERESTED", qualificationStatus: "QUALIFIED", conversionValue: 0, notes: "Requested fee structure via WhatsApp." },
    { name: "Vishnu Prasad", phone: "+91 94470 65432", email: "vishnu.p.k@outlook.com", location: "Trivandrum", ageGroup: "35-44", gender: "Male", leadSource: "Facebook Feed", formName: "Consultation Booking Form", adSetName: "South Kerala Lookalike 2%", adName: "Student Success Video Testimonial", leadStatus: "FOLLOW_UP", qualificationStatus: "QUALIFIED", conversionValue: 0, notes: "Follow up scheduled for Thursday 4:00 PM." },
    { name: "Fathima Nihala", phone: "+91 99951 11244", email: "nihala.fathima@gmail.com", location: "Thrissur", ageGroup: "18-24", gender: "Female", leadSource: "Instagram Reel", formName: "Onam Instant Lead Form", adSetName: "Kerala 21-45 Broad", adName: "Reel 15s Malayalam", leadStatus: "CONTACTED", qualificationStatus: "QUALIFIED", conversionValue: 0, notes: "First call completed. Shared syllabus brochure." },
    { name: "Deepak Soman", phone: "+91 98950 33411", email: "deepaksoman@gmail.com", location: "Kollam", ageGroup: "25-34", gender: "Male", leadSource: "Instagram Feed", formName: "Weekend Batch Form", adSetName: "Job Seekers PSC/SSC", adName: "Poster 1080x1080 Banner", leadStatus: "NEW_LEAD", qualificationStatus: "QUALIFIED", conversionValue: 0, notes: "Fresh lead received 15 mins ago." },
    { name: "Gopika R Nair", phone: "+91 97462 77890", email: "gopika.rnair@gmail.com", location: "Palakkad", ageGroup: "18-24", gender: "Female", leadSource: "Facebook Feed", formName: "Instant Registration Form", adSetName: "Central Kerala Segment", adName: "Course Highlights Carousel", leadStatus: "NEW_LEAD", qualificationStatus: "QUALIFIED", conversionValue: 0, notes: "New lead from Sunday campaign boost." },
    { name: "Arun Kumar B", phone: "+91 98460 99881", email: "arunkumar.b@gmail.com", location: "Kannur", ageGroup: "35-44", gender: "Male", leadSource: "Instagram Story", formName: "Consultation Booking Form", adSetName: "North Kerala Doctors & Execs", adName: "Doctor Interview Clip", leadStatus: "NOT_INTERESTED", qualificationStatus: "UNQUALIFIED", conversionValue: 0, notes: "Looking for offline center in Kasaragod." },
    { name: "Haris K P", phone: "+91 94951 44556", email: "haris.kp@gmail.com", location: "Malappuram", ageGroup: "25-34", gender: "Male", leadSource: "Instagram Feed", formName: "Onam Instant Lead Form", adSetName: "Malabar Professionals", adName: "Reel 15s Malayalam", leadStatus: "WRONG_NUMBER", qualificationStatus: "INVALID", conversionValue: 0, notes: "Number out of service / wrong entry." },
    { name: "Sneha Varghese", phone: "+91 96561 22334", email: "sneha.varghese@gmail.com", location: "Kottayam", ageGroup: "25-34", gender: "Female", leadSource: "Facebook Feed", formName: "Onam Instant Lead Form", adSetName: "Kerala 21-45 Broad", adName: "Poster 1080x1080 Banner", leadStatus: "CONVERTED", qualificationStatus: "QUALIFIED", conversionValue: 18500, notes: "Paid online admission fee via Razorpay." },
    { name: "Rahul C S", phone: "+91 98471 23450", email: "rahul.cs@gmail.com", location: "Kochi, Ernakulam", ageGroup: "25-34", gender: "Male", leadSource: "Instagram Feed", formName: "Onam Instant Lead Form", adSetName: "Kerala 21-45 Broad", adName: "Reel 15s Malayalam", leadStatus: "CLOSED", qualificationStatus: "DUPLICATE", conversionValue: 0, notes: "Duplicate entry of Rashid's inquiry." }
  ];

  for (const client of clients) {
    const leadCamps = client.metaCampaigns.filter(c => c.objective === "LEADS" || c.leads > 0);
    const targetCamp = leadCamps[0] || client.metaCampaigns[0] || null;

    const existingCount = await prisma.metaLead.count({
      where: { clientId: client.id }
    });

    if (existingCount === 0) {
      console.log(`Seeding 10 lead records for ${client.name}...`);
      for (let i = 0; i < mockLeadsData.length; i++) {
        const item = mockLeadsData[i];
        const subDate = new Date();
        subDate.setHours(subDate.getHours() - (i * 5));

        const lead = await prisma.metaLead.create({
          data: {
            companyId: company.id,
            clientId: client.id,
            campaignId: targetCamp?.id || null,
            metaLeadId: `leadgen_${Date.now()}_${i}`,
            name: item.name,
            phone: item.phone,
            email: item.email,
            location: item.location,
            ageGroup: item.ageGroup,
            gender: item.gender,
            leadSource: item.leadSource,
            formName: item.formName,
            adSetName: item.adSetName,
            adName: item.adName,
            leadStatus: item.leadStatus,
            qualificationStatus: item.qualificationStatus,
            conversionValue: item.conversionValue,
            conversionDate: item.leadStatus === "CONVERTED" ? new Date() : null,
            lastContactDate: new Date(),
            nextFollowUpDate: item.leadStatus === "FOLLOW_UP" ? new Date(Date.now() + 86400000 * 2) : null,
            notes: item.notes,
            leadSubmittedAt: subDate
          }
        });

        // Add initial note
        await prisma.metaLeadNote.create({
          data: {
            leadId: lead.id,
            authorName: "Marketing Bot",
            content: `Lead captured via ${item.leadSource} • Form: ${item.formName}`
          }
        });

        if (item.notes) {
          await prisma.metaLeadNote.create({
            data: {
              leadId: lead.id,
              authorName: "Sales Exec",
              content: item.notes
            }
          });
        }
      }
    } else {
      console.log(`Client ${client.name} already has ${existingCount} leads.`);
    }
  }

  console.log("✅ Meta Lead Ads seeding completed successfully!");
}

seedMetaLeads().catch(console.error).finally(() => prisma.$disconnect());
