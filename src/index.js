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
    return;
  }

  // Create a new role
  if (message.content.toLowerCase().startsWith("!createrole ")) {
    const roleName = message.content.slice(12).trim();

    if (!roleName) {
      await message.reply("Please provide a role name.");
      return;
    }

    try {
      const role = await message.guild.roles.create({
        name: roleName,
        reason: `Created by ${message.author.tag}`,
      });

      await message.reply(`✅ Created the role **${role.name}**.`);
    } catch (error) {
      console.error("Role creation error:", error);
      await message.reply(
        "❌ I couldn't create that role. Make sure I have Manage Roles permission."
      );
    }
  }
});

discord.login(process.env.DISCORD_BOT_TOKEN);

app.get("/", (req, res) => {
  res.send("Bunnylaw MCP server is online!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
