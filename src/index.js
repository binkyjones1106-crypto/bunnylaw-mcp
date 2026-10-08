import express from "express";
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
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
// HELPERS
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

function findRole(guild, roleName) {
  const search = roleName.toLowerCase();

  return guild.roles.cache.find(
    (role) => role.name.toLowerCase() === search
  );
}

function findChannel(guild, channelName) {
  const search = channelName.toLowerCase();

  return guild.channels.cache.find(
    (channel) =>
      channel.name.toLowerCase() === search ||
      channel.id === channelName
  );
}

function requireOwnerOrAdmin(message) {
  if (
    message.author.id !== message.guild.ownerId &&
    !message.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    throw new Error(
      "Only the server owner or an Administrator can use this command."
    );
  }
}

function requireOwner(message) {
  if (message.author.id !== message.guild.ownerId) {
    throw new Error("Only the server owner can use this command.");
  }
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
      "That role is at or above Bunnylaw Bot's highest role."
    );
  }

  return role;
}

// ============================================================
// SAFE ROLE PERMISSIONS
// ============================================================
//
// Administrator is intentionally NOT included.
// Ban/Kick/Moderate members are also blocked.
//
// This prevents the bot from creating a role and then using
// that role to gain full server control.
//

function getSafePermissionFlag(permissionName) {
  const normalized = permissionName
    .replace(/[\s_-]/g, "")
    .toLowerCase();

  const permissions = {
    viewchannel: PermissionFlagsBits.ViewChannel,
    sendmessages: PermissionFlagsBits.SendMessages,
    sendmessagesindthreads:
      PermissionFlagsBits.SendMessagesInThreads,
    readmessagehistory:
      PermissionFlagsBits.ReadMessageHistory,
    addreactions: PermissionFlagsBits.AddReactions,
    embedlinks: PermissionFlagsBits.EmbedLinks,
    attachfiles: PermissionFlagsBits.AttachFiles,
    mentioneveryone: PermissionFlagsBits.MentionEveryone,

    connect: PermissionFlagsBits.Connect,
    speak: PermissionFlagsBits.Speak,
    stream: PermissionFlagsBits.Stream,
    movemembers: PermissionFlagsBits.MoveMembers,

    managechannels: PermissionFlagsBits.ManageChannels,
    managewebhooks: PermissionFlagsBits.ManageWebhooks,
  };

  return permissions[normalized];
}

// ============================================================
// DISCORD COMMANDS
// ============================================================

discord.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const command = message.content.toLowerCase();

  // TEST
  if (command === "test") {
    await message.reply("Bunnylaw Bot is working! 🐰");
    return;
  }

  // ==========================================================
  // LIST ROLES
  // ==========================================================

  if (command === "!roles") {
    const roles = message.guild.roles.cache
      .filter((role) => role.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .map((role) => role.name);

    await message.reply(
      roles.length
        ? `**Server roles:**\n${roles.join("\n")}`
        : "There are no other roles."
    );

    return;
  }

  // ==========================================================
  // CREATE ROLE
  // ==========================================================

  if (command.startsWith("!createrole ")) {
    const roleName = message.content.slice(12).trim();

    if (!roleName) {
      await message.reply("Please provide a role name.");
      return;
    }

    try {
      requireOwnerOrAdmin(message);

      const role = await message.guild.roles.create({
        name: roleName,
        permissions: [],
        reason: `Created by ${message.author.tag}`,
      });

      await message.reply(
        `✅ Created **${role.name}** with no dangerous permissions.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // SET ROLE PERMISSION
  // ==========================================================

  if (command.startsWith("!setrolepermission ")) {
    const parts = message.content.split(" ");
    parts.shift();

    const roleName = parts.shift();
    const permissionName = parts.join(" ").trim();

    if (!roleName || !permissionName) {
      await message.reply(
        "Usage: `!setrolepermission RoleName Permission`"
      );
      return;
    }

    const role = findRole(message.guild, roleName);

    if (!role) {
      await message.reply(`❌ I couldn't find **${roleName}**.`);
      return;
    }

    const permission = getSafePermissionFlag(permissionName);

    if (!permission) {
      await message.reply(
        "❌ That permission is not allowed by Bunnylaw Bot."
      );
      return;
    }

    try {
      requireOwnerOrAdmin(message);
      getManageableRole(message.guild, role);

      // ADD the permission without removing existing permissions.
      const current = role.permissions.bitfield;
      const updated = current | permission;

      await role.setPermissions(
        updated,
        `Permission changed by ${message.author.tag}`
      );

      await message.reply(
        `✅ Added **${permissionName}** to **${role.name}**.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // CREATE CHANNEL
  // ==========================================================

  if (command.startsWith("!createchannel ")) {
    const channelName = message.content.slice(15).trim();

    if (!channelName) {
      await message.reply("Please provide a channel name.");
      return;
    }

    try {
      requireOwnerOrAdmin(message);

      const channel = await message.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        reason: `Created by ${message.author.tag}`,
      });

      await message.reply(
        `✅ Created channel <#${channel.id}>.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // CREATE CATEGORY
  // ==========================================================

  if (command.startsWith("!createcategory ")) {
    const categoryName = message.content.slice(16).trim();

    if (!categoryName) {
      await message.reply("Please provide a category name.");
      return;
    }

    try {
      requireOwnerOrAdmin(message);

      const category = await message.guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
        reason: `Created by ${message.author.tag}`,
      });

      await message.reply(
        `✅ Created category **${category.name}**.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // RENAME CHANNEL
  // ==========================================================

  if (command.startsWith("!renamechannel ")) {
    const parts = message.content.split(" ");
    parts.shift();

    const oldName = parts.shift();
    const newName = parts.join(" ").trim();

    if (!oldName || !newName) {
      await message.reply(
        "Usage: `!renamechannel old-name new-name`"
      );
      return;
    }

    const channel = findChannel(message.guild, oldName);

    if (!channel) {
      await message.reply(`❌ I couldn't find **${oldName}**.`);
      return;
    }

    try {
      requireOwnerOrAdmin(message);

      await channel.setName(
        newName,
        `Renamed by ${message.author.tag}`
      );

      await message.reply(
        `✅ Renamed the channel to **${newName}**.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // DELETE CHANNEL
  // ==========================================================

  if (command.startsWith("!deletechannel ")) {
    const channelName = message.content.slice(15).trim();

    if (!channelName) {
      await message.reply("Please provide a channel name.");
      return;
    }

    const channel = findChannel(message.guild, channelName);

    if (!channel) {
      await message.reply(`❌ I couldn't find **${channelName}**.`);
      return;
    }

    try {
      requireOwnerOrAdmin(message);

      await channel.delete(
        `Deleted by ${message.author.tag}`
      );

      await message.reply(
        `✅ Deleted **${channelName}**.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // MOVE CHANNEL TO CATEGORY
  // ==========================================================

  if (command.startsWith("!movetochannel ")) {
    const parts = message.content.split(" ");
    parts.shift();

    const channelName = parts.shift();
    const categoryName = parts.join(" ").trim();

    if (!channelName || !categoryName) {
      await message.reply(
        "Usage: `!movetochannel Channel Category`"
      );
      return;
    }

    const channel = findChannel(message.guild, channelName);
    const category = findChannel(message.guild, categoryName);

    if (!channel) {
      await message.reply(
        `❌ I couldn't find **${channelName}**.`
      );
      return;
    }

    if (
      !category ||
      category.type !== ChannelType.GuildCategory
    ) {
      await message.reply(
        `❌ I couldn't find category **${categoryName}**.`
      );
      return;
    }

    try {
      requireOwnerOrAdmin(message);

      await channel.setParent(category.id, true);

      await message.reply(
        `✅ Moved **${channel.name}** into **${category.name}**.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // SERVER INFO
  // ==========================================================

  if (command === "!serverinfo") {
    try {
      requireOwnerOrAdmin(message);

      await message.reply(
        `**${message.guild.name}**\n` +
        `Members: ${message.guild.memberCount}\n` +
        `Roles: ${message.guild.roles.cache.size - 1}\n` +
        `Channels: ${message.guild.channels.cache.size}`
      );
    } catch (error) {
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // BLOCKED COMMANDS
  // ==========================================================

  if (
    command.startsWith("!addrole ") ||
    command.startsWith("!removerole ") ||
    command.startsWith("!grantadmin ") ||
    command.startsWith("!removeadmin ")
  ) {
    await message.reply(
      "❌ That command has been disabled for Bunnylaw Bot."
    );

    return;
  }
});

// ============================================================
// MCP SERVER
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
      description: "List roles in the Bunnylaw Discord server.",
      inputSchema: z.object({}),
    },
    async () => {
      const guild = getGuild();

      const roles = guild.roles.cache
        .filter((role) => role.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map(
          (role) =>
            `${role.name} — position ${role.position}`
        );

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
      description: "Create a Discord role with no permissions.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    async ({ name }) => {
      const guild = getGuild();

      try {
        const role = await guild.roles.create({
          name,
          permissions: [],
          reason: "Created through Bunnylaw MCP",
        });

        return {
          content: [
            {
              type: "text",
              text: `✅ Created role "${role.name}".`,
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
  // CREATE CHANNEL
  // ----------------------------------------------------------

  server.registerTool(
    "create_channel",
    {
      description: "Create a Discord text channel.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    async ({ name }) => {
      const guild = getGuild();

      try {
        const channel = await guild.channels.create({
          name,
          type: ChannelType.GuildText,
          reason: "Created through Bunnylaw MCP",
        });

        return {
          content: [
            {
              type: "text",
              text: `✅ Created channel "${channel.name}".`,
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
  // CREATE CATEGORY
  // ----------------------------------------------------------

  server.registerTool(
    "create_category",
    {
      description: "Create a Discord category.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    async ({ name }) => {
      const guild = getGuild();

      try {
        const category = await guild.channels.create({
          name,
          type: ChannelType.GuildCategory,
          reason: "Created through Bunnylaw MCP",
        });

        return {
          content: [
            {
              type: "text",
              text: `✅ Created category "${category.name}".`,
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
  // RENAME CHANNEL
  // ----------------------------------------------------------

  server.registerTool(
    "rename_channel",
    {
      description: "Rename a Discord channel.",
      inputSchema: z.object({
        channel: z.string().min(1),
        new_name: z.string().min(1),
      }),
    },
    async ({ channel, new_name }) => {
      const guild = getGuild();
      const discordChannel = findChannel(guild, channel);

      if (!discordChannel) {
        return {
          content: [
            {
              type: "text",
              text: `❌ I couldn't find "${channel}".`,
            },
          ],
        };
      }

      try {
        await discordChannel.setName(
          new_name,
          "Renamed through Bunnylaw MCP"
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Renamed channel to "${new_name}".`,
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
  // DELETE CHANNEL
  // ----------------------------------------------------------

  server.registerTool(
    "delete_channel",
    {
      description: "Delete a Discord channel.",
      inputSchema: z.object({
        channel: z.string().min(1),
      }),
    },
    async ({ channel }) => {
      const guild = getGuild();
      const discordChannel = findChannel(guild, channel);

      if (!discordChannel) {
        return {
          content: [
            {
              type: "text",
              text: `❌ I couldn't find "${channel}".`,
            },
          ],
        };
      }

      try {
        await discordChannel.delete(
          "Deleted through Bunnylaw MCP"
        );

        return {
          content: [
            {
              type: "text",
              text: `✅ Deleted "${channel}".`,
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
  // SET ROLE PERMISSION
  // ----------------------------------------------------------

  server.registerTool(
    "set_role_permission",
    {
      description:
        "Add an allowed permission to a Discord role. Administrator and dangerous member-management permissions are blocked.",
      inputSchema: z.object({
        role: z.string().min(1),
        permission: z.string().min(1),
      }),
    },
    async ({ role, permission }) => {
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

      const permissionFlag =
        getSafePermissionFlag(permission);

      if (!permissionFlag) {
        return {
          content: [
            {
              type: "text",
              text:
                "❌ That permission is blocked or not supported.",
            },
          ],
        };
      }

      try {
        getManageableRole(guild, discordRole);

        const current =
          discordRole.permissions.bitfield;

        const updated =
          current | permissionFlag;

        await discordRole.setPermissions(
          updated,
          "Permission changed through Bunnylaw MCP"
        );

        return {
          content: [
            {
              type: "text",
              text:
                `✅ Added "${permission}" to "${role}".`,
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
        "Get basic information about the Bunnylaw server.",
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
              `Members: ${guild.memberCount}\n` +
              `Roles: ${guild.roles.cache.size - 1}\n` +
              `Channels: ${guild.channels.cache.size}`,
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
// START SERVER
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(
    "MCP endpoint: https://bunnylaw-mcp.onrender.com/mcp"
  );
});
