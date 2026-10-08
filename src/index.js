import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 10000;

// -------------------------
// Discord bot
// -------------------------

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

discord.once("ready", () => {
  console.log(`Discord bot logged in as ${discord.user.tag}`);
});

discord.login(process.env.DISCORD_BOT_TOKEN);

// -------------------------
// Discord helper
// -------------------------

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

// -------------------------
// MCP server
// -------------------------

const mcp = new McpServer({
  name: "Bunnylaw",
  version: "1.0.0",
});

// List roles
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

// Create role
mcp.tool(
  "create_role",
  "Create a new role in the Bunnylaw Discord server.",
  {
    name: z.string().min(1).describe("The name of the role to create."),
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
            text: `Created the role "${role.name}".`,
          },
        ],
      };
    } catch (error) {
      console.error("MCP role creation error:", error);

      return {
        content: [
          {
            type: "text",
            text: "I couldn't create that role. Make sure Bunny law bot has Manage Roles permission.",
          },
        ],
      };
    }
  }
);

// Give role to member
mcp.tool(
  "add_role",
  "Give an existing Discord role to a member.",
  {
    username: z
      .string()
      .min(1)
      .describe("The Discord username or display name of the member."),
    role: z.string().min(1).describe("The exact role name to give."),
  },
  async ({ username, role }) => {
    const guild = getGuild();

    const member =
      guild.members.cache.find(
        (m) =>
          m.user.username.toLowerCase() === username.toLowerCase() ||
          m.displayName.toLowerCase() === username.toLowerCase()
      );

    if (!member) {
      return {
        content: [
          {
            type: "text",
            text: `I couldn't find the member "${username}".`,
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
            text: `I couldn't find a role named "${role}".`,
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
            text: `Added "${discordRole.name}" to ${member.user.username}.`,
          },
        ],
      };
    } catch (error) {
      console.error("MCP role assignment error:", error);

      return {
        content: [
          {
            type: "text",
            text: "I couldn't assign that role. Make sure Bunny law bot's role is above the role it is trying to assign.",
          },
        ],
      };
    }
  }
);

// Remove role
mcp.tool(
  "remove_role",
  "Remove an existing Discord role from a member.",
  {
    username: z
      .string()
      .min(1)
      .describe("The Discord username or display name of the member."),
    role: z.string().min(1).describe("The exact role name to remove."),
  },
  async ({ username, role }) => {
    const guild = getGuild();

    const member =
      guild.members.cache.find(
        (m) =>
          m.user.username.toLowerCase() === username.toLowerCase() ||
          m.displayName.toLowerCase() === username.toLowerCase()
      );

    if (!member) {
      return {
        content: [
          {
            type: "text",
            text: `I couldn't find the member "${username}".`,
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
            text: `I couldn't find a role named "${role}".`,
          },
        ],
      };
    }

    try {
      await member.roles.remove(discordRole);

      return {
        content: [
          {
            type: "text",
            text: `Removed "${discordRole.name}" from ${member.user.username}.`,
          },
        ],
      };
    } catch (error) {
      console.error("MCP role removal error:", error);

      return {
        content: [
          {
            type: "text",
            text: "I couldn't remove that role.",
          },
        ],
      };
    }
  }
);

// -------------------------
// Express
// -------------------------

app.use(express.json());

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
