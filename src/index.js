import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 10000;

// Discord bot
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

discord.once("ready", () => {
  console.log(`Discord bot logged in as ${discord.user.tag}`);
});

discord.login(process.env.DISCORD_BOT_TOKEN);

// Get the Discord server
function getGuild() {
  if (!discord.isReady()) {
    throw new Error("Discord bot is not ready yet.");
  }

  const guild = discord.guilds.cache.first();

  if (!guild) {
    throw new Error("Bunny law bot is not in a Discord server.");
  }

  return guild;
}

// Discord commands
discord.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const command = message.content.toLowerCase();

  // Test
  if (command === "test") {
    await message.reply("Bunny law bot is working! 🐰");
    return;
  }

  // List roles
  if (command === "!roles") {
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

  // Create role
  if (command.startsWith("!createrole ")) {
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

    return;
  }

  // Add role
  if (command.startsWith("!addrole ")) {
    const member = message.mentions.members.first();

    const roleName = message.content
      .replace(/^!addrole\s+<@!?\d+>\s*/i, "")
      .trim();

    if (!member) {
      await message.reply("Please mention the member.");
      return;
    }

    if (!roleName) {
      await message.reply("Please provide the role name.");
      return;
    }

    const role = message.guild.roles.cache.find(
      (r) => r.name.toLowerCase() === roleName.toLowerCase()
    );

    if (!role) {
      await message.reply(`❌ I couldn't find **${roleName}**.`);
      return;
    }

    try {
      await member.roles.add(role);

      await message.reply(
        `✅ Added **${role.name}** to **${member.user.username}**.`
      );
    } catch (error) {
      console.error("Role assignment error:", error);

      await message.reply(
        "❌ I couldn't assign that role. Make sure Bunny law bot's role is above the role."
      );
    }

    return;
  }
});

// -------------------------
// MCP
// -------------------------

const mcp = new McpServer({
  name: "Bunnylaw",
  version: "1.0.0",
});

// MCP: list roles
mcp.tool(
  "list_roles",
  "List all roles in the Bunnylaw Discord server.",
  {},
  async () => {
    const guild = getGuild();

    const roles = guild.roles.cache
      .filter((role) => role.name !== "@everyone")
      .map((role) => role.name);

    return {
      content: [
        {
          type: "text",
          text: roles.length
            ? `Server roles:\n${roles.join("\n")}`
            : "There are no other roles.",
        },
      ],
    };
  }
);

// MCP: create role
mcp.tool(
  "create_role",
  "Create a Discord role.",
  {
    name: z.string().min(1),
  },
  async ({ name }) => {
    const guild = getGuild();

    try {
      const role = await guild.roles.create({
        name,
        reason: "Created through Bunnylaw MCP",
      });

      return {
        content: [
          {
            type: "text",
            text: `✅ Created the role "${role.name}".`,
          },
        ],
      };
    } catch (error) {
      console.error(error);

      return {
        content: [
          {
            type: "text",
            text: "❌ I couldn't create that role.",
          },
        ],
      };
    }
  }
);

// MCP: add role
mcp.tool(
  "add_role",
  "Give a Discord role to a member.",
  {
    username: z.string().min(1),
    role: z.string().min(1),
  },
  async ({ username, role }) => {
    const guild = getGuild();

    const member = guild.members.cache.find(
      (member) =>
        member.user.username.toLowerCase() === username.toLowerCase() ||
        member.displayName.toLowerCase() === username.toLowerCase()
    );

    if (!member) {
      return {
        content: [
          {
            type: "text",
            text: `❌ I couldn't find "${username}".`,
          },
        ],
      };
    }

    const discordRole = guild.roles.cache.find(
      (r) => r.name.toLowerCase() === role.toLowerCase()
    );

    if (!discordRole) {
      return {
        content: [
          {
            type: "text",
            text: `❌ I couldn't find the role "${role}".`,
          },
        ],
      };
    }

    try {
      await member.roles.add(discordRole);

      return {
        content: [
          {
            type: "text",
            text: `✅ Added "${discordRole.name}" to ${member.user.username}.`,
          },
        ],
      };
    } catch (error) {
      console.error(error);

      return {
        content: [
          {
            type: "text",
            text: "❌ I couldn't assign that role. Check the bot's role hierarchy.",
          },
        ],
      };
    }
  }
);

// Health check
app.get("/", (req, res) => {
  res.send("Bunnylaw MCP server is online!");
});

app.get("/health", (req, res) => {
  res.json({
    online: true,
    discordReady: discord.isReady(),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
