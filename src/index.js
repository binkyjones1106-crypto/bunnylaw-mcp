import express from "express";
import {
  Client,
  GatewayIntentBits,
} from "discord.js";

import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

const PORT = Number(process.env.PORT || 10000);

// ============================================================
// DISCORD BOT
// ============================================================

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

// ============================================================
// DISCORD HELPERS
// ============================================================

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

async function findMember(guild, username) {
  await guild.members.fetch();

  const search = username.toLowerCase();

  return guild.members.cache.find(
    (member) =>
      member.user.username.toLowerCase() === search ||
      member.displayName.toLowerCase() === search
  );
}

function findRole(guild, roleName) {
  const search = roleName.toLowerCase();

  return guild.roles.cache.find(
    (role) => role.name.toLowerCase() === search
  );
}

function getManageableRole(guild, role) {
  const me = guild.members.me;

  if (!me) {
    throw new Error("I couldn't determine the bot's member information.");
  }

  if (role.id === guild.id) {
    throw new Error("The @everyone role cannot be managed.");
  }

  if (role.managed) {
    throw new Error("That role is managed by a Discord integration.");
  }

  if (role.position >= me.roles.highest.position) {
    throw new Error(
      "That role is at or above Bunnylaw bot's highest role."
    );
  }

  return role;
}

// ============================================================
// DISCORD COMMANDS
// ============================================================

discord.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const command = message.content.toLowerCase();

  if (command === "test") {
    await message.reply("Bunny law bot is working! 🐰");
    return;
  }

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
      console.error(error);
      await message.reply("❌ I couldn't create that role.");
    }

    return;
  }

  if (command.startsWith("!addrole ")) {
    const member = message.mentions.members.first();

    const roleName = message.content
      .replace(/^!addrole\s+<@!?\d+>\s*/i, "")
      .trim();

    if (!member || !roleName) {
      await message.reply(
        "Usage: `!addrole @member Role Name`"
      );
      return;
    }

    const role = findRole(message.guild, roleName);

    if (!role) {
      await message.reply(`❌ I couldn't find **${roleName}**.`);
      return;
    }

    try {
      getManageableRole(message.guild, role);
      await member.roles.add(role);

      await message.reply(
        `✅ Added **${role.name}** to **${member.user.username}**.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  if (command.startsWith("!removerole ")) {
    const member = message.mentions.members.first();

    const roleName = message.content
      .replace(/^!removerole\s+<@!?\d+>\s*/i, "")
      .trim();

    if (!member || !roleName) {
      await message.reply(
        "Usage: `!removerole @member Role Name`"
      );
      return;
    }

    const role = findRole(message.guild, roleName);

    if (!role) {
      await message.reply(`❌ I couldn't find **${roleName}**.`);
      return;
    }

    try {
      getManageableRole(message.guild, role);
      await member.roles.remove(role);

      await message.reply(
        `✅ Removed **${role.name}** from **${member.user.username}**.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }
});

// ============================================================
// MCP SERVER FACTORY
// ============================================================

function buildMcpServer() {
  const server = new McpServer({
    name: "Bunnylaw",
    version: "1.0.0",
  });

  // ----------------------------------------------------------
  // LIST ROLES
  // ----------------------------------------------------------

  server.registerTool(
    "list_roles",
    {
      description:
        "List all roles in the Bunnylaw Discord server.",
      inputSchema: z.object({}),
    },
    async () => {
      const guild = getGuild();

      const roles = guild.roles.cache
        .filter((role) => role.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map((role) => `${role.name} — position ${role.position}`);

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

  // ----------------------------------------------------------
  // CREATE ROLE
  // ----------------------------------------------------------

  server.registerTool(
    "create_role",
    {
      description: "Create a new Discord role.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
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
              text: `❌ I couldn't create that role: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  // ----------------------------------------------------------
  // DELETE ROLE
  // ----------------------------------------------------------

  server.registerTool(
    "delete_role",
    {
      description: "Delete a Discord role.",
      inputSchema: z.object({
        role: z.string().min(1),
      }),
    },
    async ({ role }) => {
      const guild = getGuild();
      const discordRole = findRole(guild, role);

      if (!discordRole) {
        return {
          content: [
            {
              type: "text",
              text: `❌ I couldn't find "${role}".`,
            },
          ],
        };
      }

      try {
        getManageableRole(guild, discordRole);

        await discordRole.delete(
          "Deleted through Bunnylaw MCP"
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Deleted "${role}".`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `❌ ${error.message}`,
            },
          ],
        };
      }
    }
  );

  // ----------------------------------------------------------
  // RENAME ROLE
  // ----------------------------------------------------------

  server.registerTool(
    "rename_role",
    {
      description: "Rename an existing Discord role.",
      inputSchema: z.object({
        role: z.string().min(1),
        new_name: z.string().min(1),
      }),
    },
    async ({ role, new_name }) => {
      const guild = getGuild();
      const discordRole = findRole(guild, role);

      if (!discordRole) {
        return {
          content: [
            {
              type: "text",
              text: `❌ I couldn't find "${role}".`,
            },
          ],
        };
      }

      try {
        getManageableRole(guild, discordRole);

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
        return {
          content: [
            {
              type: "text",
              text: `❌ ${error.message}`,
            },
          ],
        };
      }
    }
  );

  // ----------------------------------------------------------
  // ADD ROLE
  // ----------------------------------------------------------

  server.registerTool(
    "add_role",
    {
      description:
        "Give an existing Discord role to a server member.",
      inputSchema: z.object({
        username: z.string().min(1),
        role: z.string().min(1),
      }),
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
              text: `❌ I couldn't find "${role}".`,
            },
          ],
        };
      }

      try {
        getManageableRole(guild, discordRole);

        await member.roles.add(
          discordRole,
          "Added through Bunnylaw MCP"
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Added "${discordRole.name}" to ${member.user.username}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `❌ ${error.message}`,
            },
          ],
        };
      }
    }
  );

  // ----------------------------------------------------------
  // REMOVE ROLE
  // ----------------------------------------------------------

  server.registerTool(
    "remove_role",
    {
      description:
        "Remove an existing Discord role from a server member.",
      inputSchema: z.object({
        username: z.string().min(1),
        role: z.string().min(1),
      }),
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
              text: `❌ I couldn't find "${role}".`,
            },
          ],
        };
      }

      try {
        getManageableRole(guild, discordRole);

        await member.roles.remove(
          discordRole,
          "Removed through Bunnylaw MCP"
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Removed "${discordRole.name}" from ${member.user.username}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `❌ ${error.message}`,
            },
          ],
        };
      }
    }
  );

  // ----------------------------------------------------------
  // MEMBER ROLES
  // ----------------------------------------------------------

  server.registerTool(
    "list_member_roles",
    {
      description:
        "List the roles currently assigned to a Discord member.",
      inputSchema: z.object({
        username: z.string().min(1),
      }),
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
        .sort((a, b) => b.position - a.position)
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

  // ----------------------------------------------------------
  // FIND MEMBER
  // ----------------------------------------------------------

  server.registerTool(
    "find_member",
    {
      description:
        "Find a Discord server member by username or display name.",
      inputSchema: z.object({
        username: z.string().min(1),
      }),
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
            text:
              `Username: ${member.user.username}\n` +
              `Display name: ${member.displayName}\n` +
              `User ID: ${member.id}`,
          },
        ],
      };
    }
  );

  // ----------------------------------------------------------
  // ROLE COLOR
  // ----------------------------------------------------------

  server.registerTool(
    "set_role_color",
    {
      description:
        "Change the color of an existing Discord role.",
      inputSchema: z.object({
        role: z.string().min(1),
        color: z.string().min(1),
      }),
    },
    async ({ role, color }) => {
      const guild = getGuild();
      const discordRole = findRole(guild, role);

      if (!discordRole) {
        return {
          content: [
            {
              type: "text",
              text: `❌ I couldn't find "${role}".`,
            },
          ],
        };
      }

      try {
        getManageableRole(guild, discordRole);

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
        return {
          content: [
            {
              type: "text",
              text: `❌ ${error.message}`,
            },
          ],
        };
      }
    }
  );

  // ----------------------------------------------------------
  // MOVE ROLE
  // ----------------------------------------------------------

  server.registerTool(
    "move_role",
    {
      description:
        "Move a manageable Discord role to a different hierarchy position.",
      inputSchema: z.object({
        role: z.string().min(1),
        position: z.number().int().min(1),
      }),
    },
    async ({ role, position }) => {
      const guild = getGuild();
      const discordRole = findRole(guild, role);

      if (!discordRole) {
        return {
          content: [
            {
              type: "text",
              text: `❌ I couldn't find "${role}".`,
            },
          ],
        };
      }

      try {
        getManageableRole(guild, discordRole);

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
        return {
          content: [
            {
              type: "text",
              text: `❌ ${error.message}`,
            },
          ],
        };
      }
    }
  );

  // ----------------------------------------------------------
  // SERVER INFO
  // ----------------------------------------------------------

  server.registerTool(
    "server_info",
    {
      description:
        "Get basic information about the Bunnylaw Discord server.",
      inputSchema: z.object({}),
    },
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

  return server;
}

// ============================================================
// MCP HTTP SERVER
// ============================================================

const mcpHandler = createMcpHandler(buildMcpServer);

const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: ["bunnylaw-mcp.onrender.com"],
});

const nodeMcpHandler = toNodeHandler(mcpHandler);

app.all("/mcp", (req, res) => {
  void nodeMcpHandler(req, res, req.body);
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res.send("Bunnylaw MCP server is online!");
});

app.get("/health", (req, res) => {
  res.json({
    online: true,
    discordReady: discord.isReady(),
  });
});

// ============================================================
// START
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`MCP endpoint: https://bunnylaw-mcp.onrender.com/mcp`);
});
