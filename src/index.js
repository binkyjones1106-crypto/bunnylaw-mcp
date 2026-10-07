import express from "express";

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("Bunnylaw MCP server is online!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
