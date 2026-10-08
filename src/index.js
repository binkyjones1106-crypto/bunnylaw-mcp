import express from "express";
import {
  Client,
  GatewayIntentBits,
} from "discord.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// =========================
// DISCORD BOT
// =========================

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
    throw new Error("Bunnylaw bot is not in a Discord server.");
  }

  return guild;
}

// Find a member
async function findMember(guild, username) {
  await guild.members.fetch();

  return guild.members.cache.find(
    (member) =>
      member.user.username.toLowerCase() === username.toLowerCase() ||
      member.displayName.toLowerCase() === username.toLowerCase()
  );
}

// Find a role
function findRole(guild, roleName) {
  return guild.roles.cache.find(
    (role) => role.name.toLowerCase() === roleName.toLowerCase()
  );
}

// =========================
// DISCORD COMMANDS
// =========================

discord.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

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

    const role = findRole(message.guild, roleName);

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
        "❌ I couldn't assign that role. Make sure Bunnylaw bot's role is above the role."
      );
    }

    return;
  }

  // Remove role
  if (command.startsWith("!removerole ")) {
    const member = message.mentions.members.first();

    const roleName = message.content
      .replace(/^!removerole\s+<@!?\d+>\s*/i, "")
      .trim();

    if (!member) {
      await message.reply("Please mention the member.");
      return;
    }

    const role = findRole(message.guild, roleName);

    if (!role) {
      await message.reply(`❌ I couldn't find **${roleName}**.`);
      return;
    }

    try {
      await member.roles.remove(role);

      await message.reply(
        `✅ Removed **${role.name}** from **${member.user.username}**.`
      );
    } catch (error) {
      console.error("Role removal error:", error);

      await message.reply(
        "❌ I couldn't remove that role."
      );
    }

    return;
  }
});

// =========================
// MCP SERVER
// =========================

function createMcpServer() {
  const mcp = new McpServer({
    name: "Bunnylaw",
    version: "1.0.0",
  });

  // LIST ROLES
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

  // CREATE ROLE
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

  // DELETE ROLE
  mcp.tool(
    "delete_role",
    "Delete a Discord role.",
    {
      role: z.string().min(1),
    },
    async ({ role }) => {
      const guild = getGuild();
      const discordRole = findRole(guild, role);

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
        await discordRole.delete("Deleted through Bunnylaw MCP");

        return {
          content: [
            {
              type: "text",
              text: `✅ Deleted the role "${role}".`,
            },
          ],
        };
      } catch (error) {
        console.error(error);

        return {
          content: [
            {
              type: "text",
              text: "❌ I couldn't delete that role.",
            },
          ],
        };
      }
    }
  );

  // RENAME ROLE
  mcp.tool(
    "rename_role",
    "Rename a Discord role.",
    {
      role: z.string().min(1),
      new_name: z.string().min(1),
    },
    async ({ role, new_name }) => {
      const guild = getGuild();
      const discordRole = findRole(guild, role);

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
        await discordRole.setName(
          new_name,
          "Renamed through Bunnylaw MCP"
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Renamed "${role}" to "${new_name}".`,
            },
          ],
        };
      } catch (error) {
        console.error(error);

        return {
          content: [
            {
              type: "text",
              text: "❌ I couldn't rename that role.",
            },
          ],
        };
      }
    }
  );

  // ADD ROLE
  mcp.tool(
    "add_role",
    "Give a Discord role to a member.",
    {
      username: z.string().min(1),
      role: z.string().min(1),
    },
    async ({ username, role }) => {
      const guild = getGuild();

      const member = await findMember(guild, username);

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

      const discordRole = findRole(guild, role);

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

  // REMOVE ROLE
  mcp.tool(
    "remove_role",
    "Remove a Discord role from a member.",
    {
      username: z.string().min(1),
      role: z.string().min(1),
    },
    async ({ username, role }) => {
      const guild = getGuild();

      const member = await findMember(guild, username);

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

      const discordRole = findRole(guild, role);

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
        await member.roles.remove(discordRole);

        return {
          content: [
            {
              type: "text",
              text: `✅ Removed "${discordRole.name}" from ${member.user.username}.`,
            },
          ],
        };
      } catch (error) {
        console.error(error);

        return {
          content: [
            {
              type: "text",
              text: "❌ I couldn't remove that role.",
            },
          ],
        };
      }
    }
  );

  // LIST MEMBER ROLES
  mcp.tool(
    "list_member_roles",
    "List all roles assigned to a Discord member.",
    {
      username: z.string().min(1),
    },
    async ({ username }) => {
      const guild = getGuild();
      const member = await findMember(guild, username);

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

      const roles = member.roles.cache
        .filter((role) => role.name !== "@everyone")
        .map((role) => role.name);

      return {
        content: [
          {
            type: "text",
            text: roles.length
              ? `${member.user.username}'s roles:\n${roles.join("\n")}`
              : `${member.user.username} has no assigned roles.`,
          },
        ],
      };
    }
  );

  // FIND MEMBER
  mcp.tool(
    "find_member",
    "Find a Discord member by username or display name.",
    {
      username: z.string().min(1),
    },
    async ({ username }) => {
      const guild = getGuild();
      const member = await findMember(guild, username);

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

      return {
        content: [
          {
            type: "text",
            text: `Found member: ${member.user.username}\nDisplay name: ${member.displayName}\nUser ID: ${member.id}`,
          },
        ],
      };
    }
  );

  // CHANGE ROLE COLOR
  mcp.tool(
    "set_role_color",
    "Change the color of a Discord role.",
    {
      role: z.string().min(1),
      color: z.string().min(1),
    },
    async ({ role, color }) => {
      const guild = getGuild();
      const discordRole = findRole(guild, role);

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
        await discordRole.setColor(
          color,
          "Color changed through Bunnylaw MCP"
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Changed "${role}" to ${color}.`,
            },
          ],
        };
      } catch (error) {
        console.error(error);

        return {
          content: [
            {
              type: "text",
              text: "❌ I couldn't change that role's color.",
            },
          ],
        };
      }
    }
  );

  // MOVE ROLE
  mcp.tool(
    "move_role",
    "Move a Discord role to a specified position.",
    {
      role: z.string().min(1),
      position: z.number().int().min(1),
    },
    async ({ role, position }) => {
      const guild = getGuild();
      const discordRole = findRole(guild, role);

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
        await discordRole.setPosition(position);

        return {
          content: [
            {
              type: "text",
              text: `✅ Moved "${role}" to position ${position}.`,
            },
          ],
        };
      } catch (error) {
        console.error(error);

        return {
          content: [
            {
              type: "text",
              text: "❌ I couldn't move that role.",
            },
          ],
        };
      }
    }
  );

  // SERVER INFO
  mcp.tool(
    "server_info",
    "Get information about the Bunnylaw Discord server.",
    {},
    async () => {
      const guild = getGuild();

      return {
        content: [
          {
            type: "text",
            text:
              `Server: ${guild.name}\n` +
              `Server ID: ${guild.id}\n` +
              `Members: ${guild.memberCount}\n` +
              `Roles: ${guild.roles.cache.size - 1}`,
          },
        ],
      };
    }
  );

  return mcp;
}

// =========================
// MCP HTTP ENDPOINT
// =========================

app.post("/mcp", async (req, res) => {
  try {
    const mcp = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
    });

    await mcp.connect(transport);

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "MCP request failed.",
      });
    }
  }
});

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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`MCP endpoint: /mcp`);
});
