const gmailInventoryService = require("../../server/services/gmailInventory.service");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed." });
    return;
  }

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!secret) {
    res.status(500).json({ message: "Missing CRON_SECRET configuration." });
    return;
  }

  if (authHeader !== `Bearer ${secret}`) {
    res.status(401).json({ message: "Unauthorized." });
    return;
  }

  try {
    res.status(200).json(await gmailInventoryService.renewWatch());
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Something went wrong."
    });
  }
};
