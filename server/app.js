const express = require("express");
const cors = require("cors");
const backordersRoutes = require("./routes/backorders.routes");
const importRoutes = require("./routes/import.routes");
const notesRoutes = require("./routes/notes.routes");
const productsRoutes = require("./routes/products.routes");
const vendorsRoutes = require("./routes/vendors.routes");

const app = express();

app.use(express.json());
app.use(cors());

app.use(backordersRoutes);
app.use(importRoutes);
app.use(notesRoutes);
app.use(productsRoutes);
app.use(vendorsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).send({
    message: err.statusCode ? err.message : "Something went wrong."
  });
});

module.exports = app;
