const app = require("./src/app");
const { initializeSchema } = require("./src/db/schema");

const PORT = process.env.PORT || 3000;

async function startServer() {
  await initializeSchema();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
