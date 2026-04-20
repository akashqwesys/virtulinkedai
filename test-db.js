const { getDatabase, upsertLeadProfile } = require('./out/main/storage/database.js');
const db = getDatabase();
try {
  upsertLeadProfile({
    id: "1",
    linkedinUrl: "test",
    firstName: "test",
    lastName: "test",
    headline: "test",
    company: "test",
    role: "test",
    location: "test",
    about: "test",
    experience: [],
    education: [],
    skills: [],
    recentPosts: [],
    mutualConnections: [],
    profileImageUrl: "test",
    connectionDegree: "test",
    isSalesNavigator: false,
    scrapedAt: "test",
    rawData: {}
  });
  console.log("Success");
} catch(e) {
  console.log("Error:", e.message);
}
