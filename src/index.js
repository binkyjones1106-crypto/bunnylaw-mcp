import express from "express";
import { Client, GatewayIntentBits } from "discord.js";

const app = express();
const PORT = process.env.PORT || 10000;

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

discord.once("ready", () => {
  console.log(`Discord bot logged in as ${discord.user.tag}`);
});

discord.login(process.env.DISCORD_BOT_TOKEN);

app.get("/", (req, res) => {
  res.send("Bunnylaw MCP server is online!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
