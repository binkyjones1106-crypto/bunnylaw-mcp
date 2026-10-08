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

discord.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Test command
  if (message.content.toLowerCase() === "test") {
    await message.reply("Bunny law bot is working! 🐰");
    return;
  }

  // List server roles
  if (message.content.toLowerCase() === "!roles") {
    const roles = message.guild.roles.cache
      .filter((role) => role.name !== "@everyone")
      .map((role) => role.name);

    await message.reply(
      roles.length
        ? `**Server roles:**\n${roles.join("\n")}`
        : "There are no other roles."
    );
  }
});

discord.login(process.env.DISCORD_BOT_TOKEN);

app.get("/", (req, res) => {
  res.send("Bunnylaw MCP server is online!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
