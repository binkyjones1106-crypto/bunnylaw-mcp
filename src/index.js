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
    throw new Error("Bunnylaw Bot is not in a Discord server.");
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
    throw new Error("That role is managed by Discord.");
  }

  if (role.position >= me.roles.highest.position) {
    throw new Error(
      "That role is at or above Bunnylaw Bot's highest role."
    );
  }

  return role;
}

// ============================================================
// SAFE PERMISSIONS
// ============================================================
//
// These are the ONLY permissions Bunnylaw can give to roles.
//
// Administrator
// Manage Roles
// Ban Members
// Kick Members
// Moderate Members
// Manage Server
// Manage Webhooks
// Manage Channels
// etc.
//
// are intentionally blocked from being granted.
//

const SAFE_PERMISSIONS = {
  viewchannel: "ViewChannel",
  sendmessages: "SendMessages",
  sendmessagesinthreads: "SendMessagesInThreads",
  readmessagehistory: "ReadMessageHistory",
  addreactions: "AddReactions",
  embedlinks: "EmbedLinks",
  attachfiles: "AttachFiles",
  mentioneveryone: "MentionEveryone",

  createpublicthreads: "CreatePublicThreads",
  createprivatethreads: "CreatePrivateThreads",

  connect: "Connect",
  speak: "Speak",
  stream: "Stream",

  movemembers: "MoveMembers",
  managemessages: "ManageMessages",
  managethreads: "ManageThreads",
  manageevents: "ManageEvents",
};

function getSafePermissionFlag(permissionName) {
  const normalized = permissionName
    .replace(/[\s_-]/g, "")
    .toLowerCase();

  const key = SAFE_PERMISSIONS[normalized];

  if (!key) {
    return undefined;
  }

  return PermissionFlagsBits[key];
}

function textResult(text) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
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
        `✅ Created **${role.name}** with no permissions.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }

    return;
  }

  // ==========================================================
  // SET ROLE PERMISSIONS
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
        "❌ That permission is blocked or unsupported."
      );
      return;
    }

    try {
      requireOwnerOrAdmin(message);
      getManageableRole(message.guild, role);

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

      // Channel no longer exists, so don't try to reply there.

    } catch (error) {
      console.error(error);

      try {
        await message.reply(`❌ ${error.message}`);
      } catch {}
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

      await channel.setParent(category.id, {
        lockPermissions: false,
      });

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
  // BLOCKED MEMBER COMMANDS
  // ==========================================================

  if (
    command.startsWith("!addrole ") ||
    command.startsWith("!removerole ") ||
    command.startsWith("!grantadmin ") ||
    command.startsWith("!removeadmin ")
  ) {
    await message.reply(
      "❌ That command is disabled for Bunnylaw Bot."
    );

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
});

// ============================================================
// MCP SERVER
// ============================================================

function buildMcpServer() {
  const server = new McpServer({
    name: "Bunnylaw",
    version: "1.0.0",
  });

  // ==========================================================
  // LIST ROLES
  // ==========================================================

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

      return textResult(
        roles.length
          ? `Server roles:\n${roles.join("\n")}`
          : "There are no other roles."
      );
    }
  );

  // ==========================================================
  // CREATE ROLE
  // ==========================================================

  server.registerTool(
    "create_role",
    {
      description:
        "Create a Discord role with no permissions.",
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

        return textResult(
          `✅ Created role "${role.name}".`
        );
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ==========================================================
  // RENAME ROLE
  // ==========================================================

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
      const r = findRole(guild, role);

      if (!r) {
        return textResult(
          `❌ I couldn't find "${role}".`
        );
      }

      try {
        getManageableRole(guild, r);

        await r.setName(
          new_name,
          "Renamed through Bunnylaw MCP"
        );

        return textResult(
          `✅ Renamed "${role}" to "${new_name}".`
        );
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ==========================================================
  // SET ROLE PERMISSIONS
  // ==========================================================

  server.registerTool(
    "set_role_permissions",
    {
      description:
        "Add safe permissions to an existing Discord role. Dangerous permissions are blocked.",
      inputSchema: z.object({
        role: z.string().min(1),
        permissions: z.array(
          z.string().min(1)
        ).min(1),
      }),
    },
    async ({ role, permissions }) => {
      const guild = getGuild();
      const r = findRole(guild, role);

      if (!r) {
        return textResult(
          `❌ I couldn't find "${role}".`
        );
      }

      try {
        getManageableRole(guild, r);

        let bitfield = r.permissions.bitfield;

        const added = [];
        const blocked = [];

        for (const name of permissions) {
          const flag = getSafePermissionFlag(name);

          if (flag) {
            bitfield |= flag;
            added.push(name);
          } else {
            blocked.push(name);
          }
        }

        if (added.length) {
          await r.setPermissions(
            bitfield,
            "Permissions changed through Bunnylaw MCP"
          );
        }

        let result =
          `✅ "${role}": added [${
            added.join(", ") || "none"
          }]`;

        if (blocked.length) {
          result +=
            `\n⚠️ Blocked: ${blocked.join(", ")}`;
        }

        return textResult(result);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ==========================================================
  // SET ROLE COLOR
  // ==========================================================

  server.registerTool(
    "set_role_color",
    {
      description:
        "Change a Discord role's color.",
      inputSchema: z.object({
        role: z.string().min(1),
        color: z.string().regex(
          /^#?[0-9a-fA-F]{6}$/
        ),
      }),
    },
    async ({ role, color }) => {
      const guild = getGuild();
      const r = findRole(guild, role);

      if (!r) {
        return textResult(
          `❌ I couldn't find "${role}".`
        );
      }

      try {
        getManageableRole(guild, r);

        const hex = color.startsWith("#")
          ? color
          : `#${color}`;

        await r.setColor(
          hex,
          "Color changed through Bunnylaw MCP"
        );

        return textResult(
          `✅ Changed "${role}" to ${hex}.`
        );
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ==========================================================
  // MOVE ROLE
  // ==========================================================

  server.registerTool(
    "move_role",
    {
      description:
        "Move a manageable role in the role hierarchy.",
      inputSchema: z.object({
        role: z.string().min(1),
        position: z.number().int().min(1),
      }),
    },
    async ({ role, position }) => {
      const guild = getGuild();
      const r = findRole(guild, role);

      if (!r) {
        return textResult(
          `❌ I couldn't find "${role}".`
        );
      }

      try {
        getManageableRole(guild, r);

        const me = guild.members.me;
        const max =
          me.roles.highest.position - 1;

        if (position > max) {
          return textResult(
            `❌ The highest position I can use is ${max}.`
          );
        }

        await r.setPosition(position, {
          reason: "Moved through Bunnylaw MCP",
        });

        return textResult(
          `✅ Moved "${role}" to position ${position}.`
        );
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ==========================================================
  // CREATE CHANNEL
  // ==========================================================

  server.registerTool(
    "create_channel",
    {
      description:
        "Create a text or voice channel, optionally inside a category.",
      inputSchema: z.object({
        name: z.string().min(1),
        type: z
          .enum(["text", "voice"])
          .optional(),
        category: z.string().optional(),
      }),
    },
    async ({ name, type, category }) => {
      const guild = getGuild();

      try {
        let parent;

        if (category) {
          parent = findChannel(
            guild,
            category
          );

          if (
            !parent ||
            parent.type !== ChannelType.GuildCategory
          ) {
            return textResult(
              `❌ I couldn't find category "${category}".`
            );
          }
        }

        const channel =
          await guild.channels.create({
            name,
            type:
              type === "voice"
                ? ChannelType.GuildVoice
                : ChannelType.GuildText,
            parent: parent?.id,
            reason:
              "Created through Bunnylaw MCP",
          });

        return textResult(
          `✅ Created ${
            type === "voice"
              ? "voice"
              : "text"
          } channel "${channel.name}"${
            parent
              ? ` in "${parent.name}".`
              : "."
          }`
        );
      } catch (error) {
        return textResult(
          `❌ ${error.message}`
        );
      }
    }
  );

  // ==========================================================
  // CREATE CATEGORY
  // ==========================================================

  server.registerTool(
    "create_category",
    {
      description:
        "Create a Discord category.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    async ({ name }) => {
      const guild = getGuild();

      try {
        const category =
          await guild.channels.create({
            name,
            type: ChannelType.GuildCategory,
            reason:
              "Created through Bunnylaw MCP",
          });

        return textResult(
          `✅ Created category "${category.name}".`
        );
      } catch (error) {
        return textResult(
          `❌ ${error.message}`
        );
      }
    }
  );

  // ==========================================================
  // MOVE CHANNEL
  // ==========================================================

  server.registerTool(
    "move_channel",
    {
      description:
        "Move a channel into a category.",
      inputSchema: z.object({
        channel: z.string().min(1),
        category: z.string().min(1),
      }),
    },
    async ({ channel, category }) => {
      const guild = getGuild();

      const ch = findChannel(
        guild,
        channel
      );

      const cat = findChannel(
        guild,
        category
      );

      if (!ch) {
        return textResult(
          `❌ I couldn't find "${channel}".`
        );
      }

      if (
        !cat ||
        cat.type !== ChannelType.GuildCategory
      ) {
        return textResult(
          `❌ I couldn't find category "${category}".`
        );
      }

      try {
        await ch.setParent(cat.id, {
          lockPermissions: false,
        });

        return textResult(
          `✅ Moved "${ch.name}" into "${cat.name}".`
        );
      } catch (error) {
        return textResult(
          `❌ ${error.message}`
        );
      }
    }
  );

  // ==========================================================
  // RENAME CHANNEL
  // ==========================================================

  server.registerTool(
    "rename_channel",
    {
      description:
        "Rename a Discord channel.",
      inputSchema: z.object({
        channel: z.string().min(1),
        new_name: z.string().min(1),
      }),
    },
    async ({ channel, new_name }) => {
      const guild = getGuild();

      const ch = findChannel(
        guild,
        channel
      );

      if (!ch) {
        return textResult(
          `❌ I couldn't find "${channel}".`
        );
      }

      try {
        await ch.setName(
          new_name,
          "Renamed through Bunnylaw MCP"
        );

        return textResult(
          `✅ Renamed "${channel}" to "${new_name}".`
        );
      } catch (error) {
        return textResult(
          `❌ ${error.message}`
        );
      }
    }
  );

  // ==========================================================
  // DELETE CHANNEL
  // ==========================================================

  server.registerTool(
    "delete_channel",
    {
      description:
        "Delete a Discord channel.",
      inputSchema: z.object({
        channel: z.string().min(1),
      }),
    },
    async ({ channel }) => {
      const guild = getGuild();

      const ch = findChannel(
        guild,
        channel
      );

      if (!ch) {
        return textResult(
          `❌ I couldn't find "${channel}".`
        );
      }

      try {
        await ch.delete(
          "Deleted through Bunnylaw MCP"
        );

        return textResult(
          `✅ Deleted "${channel}".`
        );
      } catch (error) {
        return textResult(
          `❌ ${error.message}`
        );
      }
    }
  );

  // ==========================================================
  // CHANNEL PERMISSIONS
  // ==========================================================

  server.registerTool(
    "set_channel_permissions",
    {
      description:
        "Allow or deny safe permissions for a role on a channel or category.",
      inputSchema: z.object({
        channel: z.string().min(1),
        role: z.string().min(1),
        allow: z
          .array(z.string())
          .default([]),
        deny: z
          .array(z.string())
          .default([]),
      }),
    },
    async ({
      channel,
      role,
      allow,
      deny,
    }) => {
      const guild = getGuild();

      const ch = findChannel(
        guild,
        channel
      );

      if (!ch) {
        return textResult(
          `❌ I couldn't find "${channel}".`
        );
      }

      const target =
        role.toLowerCase() === "everyone" ||
        role === "@everyone"
          ? guild.roles.everyone
          : findRole(guild, role);

      if (!target) {
        return textResult(
          `❌ I couldn't find role "${role}".`
        );
      }

      const overwrites = {};
      const skipped = [];

      for (const name of allow) {
        const key =
          SAFE_PERMISSIONS[
            name
              .replace(/[\s_-]/g, "")
              .toLowerCase()
          ];

        if (key) {
          overwrites[key] = true;
        } else {
          skipped.push(name);
        }
      }

      for (const name of deny) {
        const key =
          SAFE_PERMISSIONS[
            name
              .replace(/[\s_-]/g, "")
              .toLowerCase()
          ];

        if (key) {
          overwrites[key] = false;
        } else {
          skipped.push(name);
        }
      }

      if (!Object.keys(overwrites).length) {
        return textResult(
          "❌ No valid permissions were supplied."
        );
      }

      try {
        await ch.permissionOverwrites.edit(
          target,
          overwrites,
          {
            reason:
              "Changed through Bunnylaw MCP",
          }
        );

        return textResult(
          `✅ Updated "${role}" on "${ch.name}".${
            skipped.length
              ? `\n⚠️ Skipped: ${skipped.join(", ")}`
              : ""
          }`
        );
      } catch (error) {
        return textResult(
          `❌ ${error.message}`
        );
      }
    }
  );

  // ==========================================================
  // SERVER INFO
  // ==========================================================

  server.registerTool(
    "server_info",
    {
      description:
        "Get basic information about the Bunnylaw server.",
      inputSchema: z.object({}),
    },
    async () => {
      const guild = getGuild();

      return textResult(
        `Server: ${guild.name}\n` +
        `Members: ${guild.memberCount}\n` +
        `Roles: ${guild.roles.cache.size - 1}\n` +
        `Channels: ${guild.channels.cache.size}`
      );
    }
  );

  return server;
}

// ============================================================
// MCP HTTP SERVER
// ============================================================

const mcpHandler =
  createMcpHandler(buildMcpServer);

const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: [
    "bunnylaw-mcp.onrender.com",
  ],
});

const nodeMcpHandler =
  toNodeHandler(mcpHandler);

app.all("/mcp", (req, res) => {
  void nodeMcpHandler(
    req,
    res,
    req.body
  );
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res.send(
    "Bunnylaw MCP server is online!"
  );
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

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Server running on port ${PORT}`
    );

    console.log(
      "MCP endpoint: https://bunnylaw-mcp.onrender.com/mcp"
    );
  }
);
