import express from "express";
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
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

// Lowercase and strip emoji / punctuation / spaces so
// "Chief Justice" matches "⚖️ Chief Justice".
const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function findRole(guild, roleName) {
  const search = normalize(roleName);
  if (!search) return undefined;
  return guild.roles.cache.find((role) => normalize(role.name) === search);
}

// exact: true -> only an exact (normalized) name or ID match.
// Otherwise a single unambiguous partial match is also accepted.
function findChannel(guild, channelName, { exact = false } = {}) {
  const byId = guild.channels.cache.get(channelName);
  if (byId) return byId;

  const search = normalize(channelName);
  if (!search) return undefined;

  const match = guild.channels.cache.find(
    (c) => normalize(c.name) === search
  );
  if (match || exact) return match;

  const partial = guild.channels.cache.filter((c) =>
    normalize(c.name).includes(search)
  );
  return partial.size === 1 ? partial.first() : undefined;
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
    throw new Error("That role is at or above Bunnylaw Bot's highest role.");
  }
  return role;
}

// ============================================================
// SAFE PERMISSIONS
// ============================================================
//
// These are the ONLY permissions Bunnylaw can GIVE to roles.
// Administrator, Manage Roles/Channels/Server/Webhooks,
// Kick, Ban, Timeout, View Audit Log, etc. stay blocked
// from being granted (they must be set by hand in Discord).
//
// Removing permissions is allowed for any permission.

const SAFE_PERMISSIONS = {
  viewchannel: "ViewChannel",
  sendmessages: "SendMessages",
  sendmessagesinthreads: "SendMessagesInThreads",
  readmessagehistory: "ReadMessageHistory",
  addreactions: "AddReactions",
  embedlinks: "EmbedLinks",
  attachfiles: "AttachFiles",
  mentioneveryone: "MentionEveryone",
  useexternalemojis: "UseExternalEmojis",
  useexternalstickers: "UseExternalStickers",
  createinstantinvite: "CreateInstantInvite",
  sendpolls: "SendPolls",
  pinmessages: "PinMessages", // ignored if your discord.js is too old

  createpublicthreads: "CreatePublicThreads",
  createprivatethreads: "CreatePrivateThreads",

  connect: "Connect",
  speak: "Speak",
  stream: "Stream",
  usevad: "UseVAD",

  movemembers: "MoveMembers",
  mutemembers: "MuteMembers",
  deafenmembers: "DeafenMembers",
  managemessages: "ManageMessages",
  managethreads: "ManageThreads",
  manageevents: "ManageEvents",
};

// Returns the PermissionFlagsBits key for a safe permission, or undefined.
function getSafeKey(permissionName) {
  const normalized = permissionName.replace(/[\s_-]/g, "").toLowerCase();
  const key = SAFE_PERMISSIONS[normalized];
  if (!key || PermissionFlagsBits[key] === undefined) return undefined;
  return key;
}

function getSafePermissionFlag(permissionName) {
  const key = getSafeKey(permissionName);
  return key ? PermissionFlagsBits[key] : undefined;
}

// Bitmask of every safe permission that exists in this discord.js version.
const SAFE_MASK = Object.values(SAFE_PERMISSIONS).reduce(
  (mask, key) =>
    PermissionFlagsBits[key] !== undefined
      ? mask | PermissionFlagsBits[key]
      : mask,
  0n
);

// Any real Discord permission name (used only for REMOVING permissions).
function getAnyKey(permissionName) {
  const wanted = permissionName.replace(/[\s_-]/g, "").toLowerCase();
  return Object.keys(PermissionFlagsBits).find(
    (k) => k.toLowerCase() === wanted
  );
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

// ============================================================
// DISCORD COMMANDS
// ============================================================

discord.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const command = message.content.toLowerCase();

  if (command === "test") {
    await message.reply("Bunnylaw Bot is working! 🐰");
    return;
  }

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
      await message.reply(`✅ Created **${role.name}** with no permissions.`);
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }
    return;
  }

  if (command.startsWith("!setrolepermission ")) {
    const parts = message.content.split(" ");
    parts.shift();
    const roleName = parts.shift();
    const permissionName = parts.join(" ").trim();

    if (!roleName || !permissionName) {
      await message.reply("Usage: `!setrolepermission RoleName Permission`");
      return;
    }

    const role = findRole(message.guild, roleName);
    if (!role) {
      await message.reply(`❌ I couldn't find **${roleName}**.`);
      return;
    }

    const permission = getSafePermissionFlag(permissionName);
    if (!permission) {
      await message.reply("❌ That permission is blocked or unsupported.");
      return;
    }

    try {
      requireOwnerOrAdmin(message);
      getManageableRole(message.guild, role);
      await role.setPermissions(
        role.permissions.bitfield | permission,
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
      await message.reply(`✅ Created channel <#${channel.id}>.`);
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }
    return;
  }

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
      await message.reply(`✅ Created category **${category.name}**.`);
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }
    return;
  }

  if (command.startsWith("!renamechannel ")) {
    const parts = message.content.split(" ");
    parts.shift();
    const oldName = parts.shift();
    const newName = parts.join(" ").trim();

    if (!oldName || !newName) {
      await message.reply("Usage: `!renamechannel old-name new-name`");
      return;
    }

    const channel = findChannel(message.guild, oldName);
    if (!channel) {
      await message.reply(`❌ I couldn't find **${oldName}**.`);
      return;
    }

    try {
      requireOwnerOrAdmin(message);
      await channel.setName(newName, `Renamed by ${message.author.tag}`);
      await message.reply(`✅ Renamed the channel to **${newName}**.`);
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }
    return;
  }

  if (command.startsWith("!deletechannel ")) {
    const channelName = message.content.slice(15).trim();
    if (!channelName) {
      await message.reply("Please provide a channel name.");
      return;
    }

    const channel = findChannel(message.guild, channelName, { exact: true });
    if (!channel) {
      await message.reply(`❌ I couldn't find **${channelName}**.`);
      return;
    }

    try {
      requireOwnerOrAdmin(message);
      await channel.delete(`Deleted by ${message.author.tag}`);
    } catch (error) {
      console.error(error);
      try {
        await message.reply(`❌ ${error.message}`);
      } catch {}
    }
    return;
  }

  if (command.startsWith("!movetochannel ")) {
    const parts = message.content.split(" ");
    parts.shift();
    const channelName = parts.shift();
    const categoryName = parts.join(" ").trim();

    if (!channelName || !categoryName) {
      await message.reply("Usage: `!movetochannel Channel Category`");
      return;
    }

    const channel = findChannel(message.guild, channelName);
    const category = findChannel(message.guild, categoryName);

    if (!channel) {
      await message.reply(`❌ I couldn't find **${channelName}**.`);
      return;
    }
    if (!category || category.type !== ChannelType.GuildCategory) {
      await message.reply(`❌ I couldn't find category **${categoryName}**.`);
      return;
    }

    try {
      requireOwnerOrAdmin(message);
      await channel.setParent(category.id, { lockPermissions: false });
      await message.reply(
        `✅ Moved **${channel.name}** into **${category.name}**.`
      );
    } catch (error) {
      console.error(error);
      await message.reply(`❌ ${error.message}`);
    }
    return;
  }

  if (
    command.startsWith("!addrole ") ||
    command.startsWith("!removerole ") ||
    command.startsWith("!grantadmin ") ||
    command.startsWith("!removeadmin ")
  ) {
    await message.reply("❌ That command is disabled for Bunnylaw Bot.");
    return;
  }

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
    version: "1.1.0",
  });

  // ---------- LIST ROLES ----------

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
        .map((role) => `${role.name} — position ${role.position}`);

      return textResult(
        roles.length
          ? `Server roles:\n${roles.join("\n")}`
          : "There are no other roles."
      );
    }
  );

  // ---------- GET ROLE PERMISSIONS ----------

  server.registerTool(
    "get_role_permissions",
    {
      description:
        "Show a role's current permissions. Leave 'role' empty to list every role's permissions.",
      inputSchema: z.object({
        role: z.string().optional(),
      }),
    },
    async ({ role }) => {
      const guild = getGuild();

      if (role) {
        const r = findRole(guild, role);
        if (!r) return textResult(`❌ I couldn't find "${role}".`);
        return textResult(
          `${r.name}: ${r.permissions.toArray().join(", ") || "none"}`
        );
      }

      const lines = guild.roles.cache
        .sort((a, b) => b.position - a.position)
        .map(
          (r) =>
            `${r.name} (pos ${r.position}): ${
              r.permissions.toArray().join(", ") || "none"
            }`
        );
      return textResult(lines.join("\n"));
    }
  );

  // ---------- CREATE ROLE ----------

  server.registerTool(
    "create_role",
    {
      description: "Create a Discord role with no permissions.",
      inputSchema: z.object({ name: z.string().min(1) }),
    },
    async ({ name }) => {
      const guild = getGuild();
      try {
        const role = await guild.roles.create({
          name,
          permissions: [],
          reason: "Created through Bunnylaw MCP",
        });
        return textResult(`✅ Created role "${role.name}".`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- RENAME ROLE ----------

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
      if (!r) return textResult(`❌ I couldn't find "${role}".`);

      try {
        getManageableRole(guild, r);
        await r.setName(new_name, "Renamed through Bunnylaw MCP");
        return textResult(`✅ Renamed "${role}" to "${new_name}".`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- SET ROLE PERMISSIONS ----------

  server.registerTool(
    "set_role_permissions",
    {
      description:
        "Give safe permissions to a role. mode 'add' (default) keeps existing permissions and adds these. mode 'replace' makes the role's safe permissions exactly this list; permissions outside the safe list (Kick, Ban, Timeout, etc.) are left untouched. Dangerous permissions can never be granted.",
      inputSchema: z.object({
        role: z.string().min(1),
        permissions: z.array(z.string().min(1)),
        mode: z.enum(["add", "replace"]).default("add"),
      }),
    },
    async ({ role, permissions, mode }) => {
      const guild = getGuild();
      const r = findRole(guild, role);
      if (!r) return textResult(`❌ I couldn't find "${role}".`);

      try {
        getManageableRole(guild, r);

        let requested = 0n;
        const applied = [];
        const blocked = [];

        for (const name of permissions) {
          const key = getSafeKey(name);
          if (key) {
            requested |= PermissionFlagsBits[key];
            applied.push(key);
          } else {
            blocked.push(name);
          }
        }

        const current = r.permissions.bitfield;
        const updated =
          mode === "replace"
            ? (current & ~SAFE_MASK) | requested
            : current | requested;

        if (updated !== current) {
          await r.setPermissions(
            updated,
            "Permissions changed through Bunnylaw MCP"
          );
        }

        let result = `✅ "${r.name}" (${mode}): ${
          applied.join(", ") || "none"
        }`;
        if (updated === current) result += "\n(no change needed)";
        if (blocked.length) {
          result += `\n⚠️ Blocked/unsupported: ${blocked.join(", ")}`;
        }
        return textResult(result);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- REMOVE ROLE PERMISSIONS ----------

  server.registerTool(
    "remove_role_permissions",
    {
      description:
        "Remove permissions from a role. Any Discord permission name can be removed (removing is always safe).",
      inputSchema: z.object({
        role: z.string().min(1),
        permissions: z.array(z.string().min(1)).min(1),
      }),
    },
    async ({ role, permissions }) => {
      const guild = getGuild();
      const r = findRole(guild, role);
      if (!r) return textResult(`❌ I couldn't find "${role}".`);

      try {
        getManageableRole(guild, r);

        let bitfield = r.permissions.bitfield;
        const removed = [];
        const unknown = [];

        for (const name of permissions) {
          const key = getAnyKey(name);
          if (key) {
            bitfield &= ~PermissionFlagsBits[key];
            removed.push(key);
          } else {
            unknown.push(name);
          }
        }

        if (bitfield !== r.permissions.bitfield) {
          await r.setPermissions(
            bitfield,
            "Permissions removed through Bunnylaw MCP"
          );
        }

        let result = `✅ "${r.name}": removed [${removed.join(", ") || "none"}]`;
        if (unknown.length) result += `\n⚠️ Unknown: ${unknown.join(", ")}`;
        return textResult(result);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- SET ROLE COLOR ----------

  server.registerTool(
    "set_role_color",
    {
      description: "Change a Discord role's color.",
      inputSchema: z.object({
        role: z.string().min(1),
        color: z.string().regex(/^#?[0-9a-fA-F]{6}$/),
      }),
    },
    async ({ role, color }) => {
      const guild = getGuild();
      const r = findRole(guild, role);
      if (!r) return textResult(`❌ I couldn't find "${role}".`);

      try {
        getManageableRole(guild, r);
        const hex = color.startsWith("#") ? color : `#${color}`;
        await r.setColor(hex, "Color changed through Bunnylaw MCP");
        return textResult(`✅ Changed "${role}" to ${hex}.`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- MOVE ROLE ----------

  server.registerTool(
    "move_role",
    {
      description: "Move a manageable role in the role hierarchy.",
      inputSchema: z.object({
        role: z.string().min(1),
        position: z.number().int().min(1),
      }),
    },
    async ({ role, position }) => {
      const guild = getGuild();
      const r = findRole(guild, role);
      if (!r) return textResult(`❌ I couldn't find "${role}".`);

      try {
        getManageableRole(guild, r);

        const max = guild.members.me.roles.highest.position - 1;
        if (position > max) {
          return textResult(`❌ The highest position I can use is ${max}.`);
        }

        await r.setPosition(position, {
          reason: "Moved through Bunnylaw MCP",
        });
        return textResult(`✅ Moved "${role}" to position ${position}.`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- REORDER ROLES (BULK) ----------

  server.registerTool(
    "reorder_roles",
    {
      description:
        "Put a list of roles in order, highest first, directly under Bunnylaw Bot's role. Roles the bot can't manage are skipped. dry_run (default true) only previews the result.",
      inputSchema: z.object({
        roles: z.array(z.string().min(1)).min(1),
        dry_run: z.boolean().default(true),
      }),
    },
    async ({ roles, dry_run }) => {
      const guild = getGuild();
      const top = guild.members.me.roles.highest.position - 1;

      const resolved = [];
      const skipped = [];

      for (const name of roles) {
        const r = findRole(guild, name);
        if (!r) {
          skipped.push(`${name}: not found`);
          continue;
        }
        try {
          getManageableRole(guild, r);
          if (!resolved.includes(r)) resolved.push(r);
        } catch (error) {
          skipped.push(`${r.name}: ${error.message}`);
        }
      }

      if (!resolved.length) {
        return textResult(
          `❌ Nothing to move.\n${skipped.join("\n")}`
        );
      }
      if (resolved.length > top) {
        return textResult(
          `❌ Too many roles (${resolved.length}) for the available positions (${top}).`
        );
      }

      const plan = resolved.map((role, i) => ({
        role,
        position: top - i,
      }));

      const preview = plan
        .map((p) => `${p.position}. ${p.role.name}`)
        .join("\n");
      const skippedText = skipped.length
        ? `\n\n⚠️ Skipped:\n${skipped.join("\n")}`
        : "";

      if (dry_run) {
        return textResult(
          `Preview (nothing changed). Run again with dry_run false to apply:\n${preview}${skippedText}`
        );
      }

      try {
        await guild.roles.setPositions(
          plan.map((p) => ({ role: p.role.id, position: p.position }))
        );
        return textResult(`✅ Reordered roles:\n${preview}${skippedText}`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- LIST CHANNELS ----------

  server.registerTool(
    "list_channels",
    {
      description: "List all channels and categories.",
      inputSchema: z.object({}),
    },
    async () => {
      const guild = getGuild();
      const lines = guild.channels.cache
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(
          (c) =>
            `${c.parent ? c.parent.name + " / " : ""}${c.name} (${
              ChannelType[c.type]
            })`
        );
      return textResult(lines.join("\n") || "No channels.");
    }
  );

  // ---------- CREATE CHANNEL ----------

  server.registerTool(
    "create_channel",
    {
      description:
        "Create a text or voice channel, optionally inside a category.",
      inputSchema: z.object({
        name: z.string().min(1),
        type: z.enum(["text", "voice"]).optional(),
        category: z.string().optional(),
      }),
    },
    async ({ name, type, category }) => {
      const guild = getGuild();

      try {
        let parent;
        if (category) {
          parent = findChannel(guild, category);
          if (!parent || parent.type !== ChannelType.GuildCategory) {
            return textResult(`❌ I couldn't find category "${category}".`);
          }
        }

        const channel = await guild.channels.create({
          name,
          type:
            type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText,
          parent: parent?.id,
          reason: "Created through Bunnylaw MCP",
        });

        return textResult(
          `✅ Created ${type === "voice" ? "voice" : "text"} channel "${
            channel.name
          }"${parent ? ` in "${parent.name}".` : "."}`
        );
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- CREATE CATEGORY ----------

  server.registerTool(
    "create_category",
    {
      description: "Create a Discord category.",
      inputSchema: z.object({ name: z.string().min(1) }),
    },
    async ({ name }) => {
      const guild = getGuild();
      try {
        const category = await guild.channels.create({
          name,
          type: ChannelType.GuildCategory,
          reason: "Created through Bunnylaw MCP",
        });
        return textResult(`✅ Created category "${category.name}".`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- MOVE CHANNEL ----------

  server.registerTool(
    "move_channel",
    {
      description: "Move a channel into a category.",
      inputSchema: z.object({
        channel: z.string().min(1),
        category: z.string().min(1),
      }),
    },
    async ({ channel, category }) => {
      const guild = getGuild();
      const ch = findChannel(guild, channel);
      const cat = findChannel(guild, category);

      if (!ch) return textResult(`❌ I couldn't find "${channel}".`);
      if (!cat || cat.type !== ChannelType.GuildCategory) {
        return textResult(`❌ I couldn't find category "${category}".`);
      }

      try {
        await ch.setParent(cat.id, { lockPermissions: false });
        return textResult(`✅ Moved "${ch.name}" into "${cat.name}".`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- RENAME CHANNEL ----------

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
      const ch = findChannel(guild, channel);
      if (!ch) return textResult(`❌ I couldn't find "${channel}".`);

      try {
        await ch.setName(new_name, "Renamed through Bunnylaw MCP");
        return textResult(`✅ Renamed "${channel}" to "${new_name}".`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- DELETE CHANNEL ----------

  server.registerTool(
    "delete_channel",
    {
      description:
        "Delete a Discord channel. Requires an exact name and confirm set to true.",
      inputSchema: z.object({
        channel: z.string().min(1),
        confirm: z.boolean().default(false),
      }),
    },
    async ({ channel, confirm }) => {
      const guild = getGuild();
      const ch = findChannel(guild, channel, { exact: true });
      if (!ch) return textResult(`❌ I couldn't find "${channel}".`);

      if (!confirm) {
        return textResult(
          `⚠️ This would permanently delete "${ch.name}". Call again with confirm set to true to proceed.`
        );
      }

      try {
        await ch.delete("Deleted through Bunnylaw MCP");
        return textResult(`✅ Deleted "${channel}".`);
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- CHANNEL PERMISSIONS ----------

  server.registerTool(
    "set_channel_permissions",
    {
      description:
        "Allow or deny safe permissions for a role on a channel or category. Use 'everyone' for @everyone.",
      inputSchema: z.object({
        channel: z.string().min(1),
        role: z.string().min(1),
        allow: z.array(z.string()).default([]),
        deny: z.array(z.string()).default([]),
      }),
    },
    async ({ channel, role, allow, deny }) => {
      const guild = getGuild();

      const ch = findChannel(guild, channel);
      if (!ch) return textResult(`❌ I couldn't find "${channel}".`);

      const target =
        normalize(role) === "everyone"
          ? guild.roles.everyone
          : findRole(guild, role);
      if (!target) return textResult(`❌ I couldn't find role "${role}".`);

      const overwrites = {};
      const skipped = [];

      for (const name of allow) {
        const key = getSafeKey(name);
        if (key) overwrites[key] = true;
        else skipped.push(name);
      }
      for (const name of deny) {
        const key = getSafeKey(name);
        if (key) overwrites[key] = false;
        else skipped.push(name);
      }

      if (!Object.keys(overwrites).length) {
        return textResult("❌ No valid permissions were supplied.");
      }

      try {
        await ch.permissionOverwrites.edit(target, overwrites, {
          reason: "Changed through Bunnylaw MCP",
        });
        return textResult(
          `✅ Updated "${target.name}" on "${ch.name}".${
            skipped.length ? `\n⚠️ Skipped: ${skipped.join(", ")}` : ""
          }`
        );
      } catch (error) {
        return textResult(`❌ ${error.message}`);
      }
    }
  );

  // ---------- SERVER INFO ----------

  server.registerTool(
    "server_info",
    {
      description: "Get basic information about the Bunnylaw server.",
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

const mcpHandler = createMcpHandler(buildMcpServer);

const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: ["bunnylaw-mcp.onrender.com"],
});

const nodeMcpHandler = toNodeHandler(mcpHandler);

// If MCP_SECRET is set on Render, the endpoint becomes /mcp/<secret>
// and plain /mcp stops working. Use that full URL in the connector.
const MCP_PATH = process.env.MCP_SECRET
  ? `/mcp/${process.env.MCP_SECRET}`
  : "/mcp";

if (!process.env.MCP_SECRET) {
  console.warn(
    "WARNING: MCP_SECRET is not set. Anyone with the URL can use the MCP tools."
  );
}

app.all(MCP_PATH, (req, res) => {
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
  console.log(
    process.env.MCP_SECRET
      ? "MCP endpoint: https://bunnylaw-mcp.onrender.com/mcp/<MCP_SECRET>"
      : "MCP endpoint: https://bunnylaw-mcp.onrender.com/mcp"
  );
});
