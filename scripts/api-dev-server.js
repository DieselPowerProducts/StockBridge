const http = require("http");
const handler = require("../api");

const port = Number.parseInt(process.env.API_PORT || "3000", 10);

const server = http.createServer(handler);

server.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
