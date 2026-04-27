const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes");
const backordersRoutes = require("./routes/backorders.routes");
const emailRoutes = require("./routes/email.routes");
const importRoutes = require("./routes/import.routes");
const notesRoutes = require("./routes/notes.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const productsRoutes = require("./routes/products.routes");
const shopifyRoutes = require("./routes/shopify.routes");
const usersRoutes = require("./routes/users.routes");
const vendorsRoutes = require("./routes/vendors.routes");
const { requireAuth } = require("./middleware/auth");

const app = express();

app.set("trust proxy", 1);
app.use(express.json());
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowedOrigins = new Set([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://dpp.skunexus.com",
        "https://stockbridgedpp.vercel.app"
      ]);

      callback(
        null,
        allowedOrigins.has(origin) || origin.startsWith("chrome-extension://")
      );
    }
  })
);

app.use(authRoutes);
app.use(requireAuth);
app.use(backordersRoutes);
app.use(emailRoutes);
app.use(importRoutes);
app.use(notesRoutes);
app.use(notificationsRoutes);
app.use(productsRoutes);
app.use(shopifyRoutes);
app.use(usersRoutes);
app.use(vendorsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).send({
    message: err.statusCode ? err.message : "Something went wrong."
  });
});

module.exports = app;
