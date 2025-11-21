// ======================================================
//  VOLLEY LEGENDS MATCHMAKING BOT — FIXED VERSION
// ======================================================

import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

// ------------------------------------------------------
// KEEPALIVE
// ------------------------------------------------------
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
app.listen(3000);

// ------------------------------------------------------
// DATABASE
// ------------------------------------------------------
mongoose.connect(process.env.MONGO_URI, { dbName: "VolleyBot" });

const statsSchema = {
  userId: String,
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String
};

const HostStats = mongoose.model("HostStats", new mongoose.Schema(statsSchema));
const PlayerStats = mongoose.model("PlayerStats", new mongoose.Schema(statsSchema));

const Cooldowns = mongoose.model("Cooldowns", new mongoose.Schema({
  userId: String,
  hostId: String,
  timestamp: Number
}));

const HostCooldown = mongoose.model("HostCooldown", new mongoose.Schema({
  userId: String,
  timestamp: Number
}));

const RequestCounter = mongoose.model("RequestCounter", new mongoose.Schema({
  hostId: String,
  count: Number
}));

const ActiveMatch = mongoose.model("ActiveMatch", new mongoose.Schema({
  hostId: String,
  channelId: String,
  players: [String]
}));

// ------------------------------------------------------
// DISCORD CLIENT
// ------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// ------------------------------------------------------
// CONFIG
// ------------------------------------------------------
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";
const CATEGORY_NAME = "Matchmaking";

// ------------------------------------------------------
// HELPERS
// ------------------------------------------------------
function parseLevelRankPlaystyle(text) {
  const p = text.split("|").map(x => x.trim());
  let level = "Unknown", rank = "Unknown", playstyle = "Unknown";

  const lvl = p.find(x => /^\d{1,4}$/.test(x));
  if (lvl) level = lvl;

  const rk = p.find(x => /(bronze|silver|gold|diamond|elite|pro)/i.test(x));
  if (rk) rank = rk;

  const ps = p.find(x => x !== lvl && x !== rk);
  if (ps) playstyle = ps;

  return { level, rank, playstyle };
}

function parseCommunication(text) {
  const p = text.split("|").map(x => x.trim());
  let vc = "Unknown", language = "Unknown";

  const v = p.find(x => /(vc|yes|no|voice)/i.test(x));
  if (v) vc = v;

  const l = p.find(x => /(eng|english|german|de|turkish|spanish|arabic)/i.test(x));
  if (l) language = l;

  return { vc, language };
}

function autoDelete(msg) {
  setTimeout(() => msg.delete().catch(() => {}), 5 * 60 * 1000);
}

// ------------------------------------------------------
// CHANNEL RESET
// ------------------------------------------------------
async function resetMatchmakingChannel() {
  const ch = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!ch) return;

  const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => {});
  if (msgs) ch.bulkDelete(msgs).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Volley Legends Matchmaking")
    .setDescription("Find teammates.\nPress **Create Match** to begin.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Success)
  );

  await ch.send({ embeds: [embed], components: [row] });
}

client.once("ready", async () => {
  console.log("Bot ready.");
  await resetMatchmakingChannel();
});

// ------------------------------------------------------
// HOST COOLDOWN
// ------------------------------------------------------
async function checkHostCooldown(id) {
  const e = await HostCooldown.findOne({ userId: id });
  if (!e) return 0;

  const diff = Date.now() - e.timestamp;
  if (diff >= 5 * 60 * 1000) return 0;

  return Math.ceil((5 * 60 * 1000 - diff) / 60000);
}

// ------------------------------------------------------
// CREATE MATCH BUTTON
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (i.customId !== "create_match") return;

  const cd = await checkHostCooldown(i.user.id);
  if (cd > 0) {
    return i.reply({ ephemeral: true, content: `❌ Wait **${cd} min**.` });
  }

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("♻️ Reuse last stats?")
    .setDescription("Reuse your last matchmaking stats?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  return i.reply({ ephemeral: true, embeds: [embed], components: [row] });
});

// ------------------------------------------------------
// REUSE BUTTONS
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  if (i.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: i.user.id });
    return openHostModal(i, true, stats);
  }

  if (i.customId === "reuse_no") {
    return openHostModal(i, false, null);
  }
});

// ------------------------------------------------------
// HOST MODAL
// ------------------------------------------------------
function openHostModal(i, autofill, data) {
  const modal = new ModalBuilder()
    .setCustomId("host_form")
    .setTitle("Create Match");

  const fields = [
    ["gameplay", "Level | Rank | Playstyle", data?.gameplay],
    ["ability", "Ability", data?.ability],
    ["region", "Region", data?.region],
    ["communication", "VC | Language", data?.communication],
    ["notes", "Notes", data?.notes]
  ];

  modal.addComponents(
    ...fields.map(([id, label, val]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setValue(autofill && val ? val : "")
          .setRequired(id !== "notes")
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      )
    )
  );

  i.showModal(modal);
}

// ------------------------------------------------------
// HOST SUBMIT
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (i.customId !== "host_form") return;

  const user = i.user;

  const gameplay = i.fields.getTextInputValue("gameplay");
  const ability = i.fields.getTextInputValue("ability");
  const region = i.fields.getTextInputValue("region");
  const comm = i.fields.getTextInputValue("communication");
  const notes = i.fields.getTextInputValue("notes");

  await HostStats.findOneAndUpdate(
    { userId: user.id },
    { gameplay, ability, region, communication: comm, notes },
    { upsert: true }
  );

  await HostCooldown.findOneAndUpdate(
    { userId: user.id },
    { timestamp: Date.now() },
    { upsert: true }
  );

  await RequestCounter.findOneAndUpdate(
    { hostId: user.id },
    { count: 0 },
    { upsert: true }
  );

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Volley Legends Match Found")
    .setDescription(
      `👤 **Host:** <@${user.id}>\n\n` +
      `• Level: ${level}\n` +
      `• Rank: ${rank}\n` +
      `• Playstyle: ${playstyle}\n` +
      `• Ability: ${ability}\n` +
      `• Region: ${region}\n` +
      `• VC: ${vc}\n` +
      `• Language: ${language}\n` +
      `• Notes: ${notes || "None"}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const fp = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await fp.send({ content: `<@${user.id}>`, embeds: [embed], components: [row] });

  return i.reply({ ephemeral: true, content: "Match created!" });
});

// ------------------------------------------------------
// PLAYER REQUEST BUTTON
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("request_")) return;

  const hostId = i.customId.split("_")[1];
  const requester = i.user;

  const cd = await Cooldowns.findOne({ userId: requester.id, hostId });
  if (cd && Date.now() - cd.timestamp < 5 * 60 * 1000) {
    const min = Math.ceil((5 * 60 * 1000 - (Date.now() - cd.timestamp)) / 60000);
    return i.reply({ ephemeral: true, content: `❌ Wait **${min} min**.` });
  }

  const old = await PlayerStats.findOne({ userId: requester.id });
  return openPlayerModal(i, !!old, old, hostId);
});

// ------------------------------------------------------
// PLAYER MODAL
// ------------------------------------------------------
function openPlayerModal(i, autofill, data, hostId) {
  const modal = new ModalBuilder()
    .setCustomId(`player_form_${hostId}`)
    .setTitle("Your Stats");

  const fields = [
    ["p_gameplay", "Level | Rank | Playstyle", data?.gameplay],
    ["p_ability", "Ability", data?.ability],
    ["p_region", "Region", data?.region],
    ["p_communication", "VC | Language", data?.communication],
    ["p_notes", "Notes", data?.notes]
  ];

  modal.addComponents(
    ...fields.map(([id, label, val]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setValue(autofill && val ? val : "")
          .setRequired(id !== "p_notes")
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      )
    )
  );

  i.showModal(modal);
}

// ------------------------------------------------------
// PLAYER SUBMIT
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (!i.customId.startsWith("player_form_")) return;

  const hostId = i.customId.split("_")[2];
  const requester = i.user;

  const gameplay = i.fields.getTextInputValue("p_gameplay");
  const ability = i.fields.getTextInputValue("p_ability");
  const region = i.fields.getTextInputValue("p_region");
  const comm = i.fields.getTextInputValue("p_communication");
  const notes = i.fields.getTextInputValue("p_notes");

  await PlayerStats.findOneAndUpdate(
    { userId: requester.id },
    { gameplay, ability, region, communication: comm, notes },
    { upsert: true }
  );

  await Cooldowns.findOneAndUpdate(
    { userId: requester.id, hostId },
    { timestamp: Date.now() },
    { upsert: true }
  );

  const counter = await RequestCounter.findOneAndUpdate(
    { hostId },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );

  const requestCount = counter.count;
  const host = await client.users.fetch(hostId);

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🔔 New Play Request")
    .setDescription(
      `👤 **Player:** <@${requester.id}>\n` +
      `📨 Total Requests: ${requestCount}\n\n` +
      `• Level: ${level}\n` +
      `• Rank: ${rank}\n` +
      `• Playstyle: ${playstyle}\n` +
      `• Ability: ${ability}\n` +
      `• Region: ${region}\n` +
      `• VC: ${vc}\n` +
      `• Language: ${language}\n` +
      `• Notes: ${notes || "None"}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${requester.id}_${hostId}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}_${hostId}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sendlink_${requester.id}_${hostId}`).setLabel("Send Private Link").setStyle(ButtonStyle.Primary)
  );

  try {
    await host.send({ embeds: [embed], components: [row] });
  } catch {
    // Falls DMs disabled sind
  }

  return i.reply({ ephemeral: true, content: "Your request was sent!" });
});

// ------------------------------------------------------
// ACCEPT / DECLINE SYSTEM
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  const [type, playerId, hostId] = i.customId.split("_");
  if (type !== "accept" && type !== "decline") return;

  // FIX: DM click prevention
  if (!i.guild) {
    return i.reply({
      ephemeral: true,
      content: "Please click this button inside the server, not in private messages."
    });
  }

  const guild = i.guild;
  const host = i.user;
  const player = await client.users.fetch(playerId);

  // DECLINE
  if (type === "decline") {
    try {
      await player.send("❌ Your request was declined.");
    } catch {}
    return i.reply({ ephemeral: true, content: "Declined." });
  }

  // ACCEPT
  let active = await ActiveMatch.findOne({ hostId });
  let channel;

  if (active) {
    channel = guild.channels.cache.get(active.channelId);
  }

  // If missing: recreate
  if (!active || !channel) {
    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === 4);
    if (!category) {
      category = await guild.channels.create({
        name: CATEGORY_NAME,
        type: 4
      });
    }

    channel = await guild.channels.create({
      name: `matchmaking-${host.username}`,
      type: 0,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: hostId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: playerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });

    await ActiveMatch.findOneAndReplace(
      { hostId },
      { hostId, channelId: channel.id, players: [playerId] },
      { upsert: true }
    );
  } else {
    // Channel exists
    if (active.players.length >= 3) {
      return i.reply({
        ephemeral: true,
        content: "❌ You already have 3 players. Max reached."
      });
    }

    await channel.permissionOverwrites.edit(playerId, {
      ViewChannel: true,
      SendMessages: true
    });

    active.players.push(playerId);
    await active.save();
  }

  try {
    await player.send("✅ Your request was accepted! You were added to the match channel.");
  } catch {}

  await i.reply({
    ephemeral: true,
    content: `Player added: <@${playerId}>`
  });

  await channel.send(`🎉 <@${playerId}> joined the match with Host <@${hostId}>!`);

  // Auto delete channel in 3 minutes
  setTimeout(async () => {
    const c = guild.channels.cache.get(channel.id);
    if (!c) return;

    await ActiveMatch.deleteOne({ hostId }).catch(() => {});

    c.delete().catch(() => {});
  }, 3 * 60 * 1000);
});

// ------------------------------------------------------
// SEND LINK
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("sendlink_")) return;

  const playerId = i.customId.split("_")[1];

  const modal = new ModalBuilder()
    .setCustomId(`privatelink_${playerId}`)
    .setTitle("Send Private Server Link");

  const input = new TextInputBuilder()
    .setCustomId("link")
    .setLabel("Roblox Private Link")
    .setPlaceholder("https://www.roblox.com/…")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  i.showModal(modal);
});

// ------------------------------------------------------
// PRIVATE LINK SUBMIT
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (!i.customId.startsWith("privatelink_")) return;

  const playerId = i.customId.split("_")[1];
  const player = await client.users.fetch(playerId);
  const link = i.fields.getTextInputValue("link");

  if (!link.startsWith("https://www.roblox.com/")) {
    return i.reply({
      ephemeral: true,
      content: "❌ Link must start with: https://www.roblox.com/"
    });
  }

  try {
    await player.send(`🔗 **Private Server Link:**\n${link}`);
  } catch {}

  await i.reply({ ephemeral: true, content: "Link sent!" });

  const active = await ActiveMatch.findOne({ hostId: i.user.id });
  if (active) {
    const channel = await client.channels.fetch(active.channelId).catch(() => null);
    if (channel) {
      await channel.send(`🔗 **The Host sent you a privat link: ** from <@${i.user.id}>:\n${link}`);
    }
  }
});

// ------------------------------------------------------
// FINISH MATCH
// ------------------------------------------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("finishmatch_")) return;

  const hostId = i.customId.split("_")[1];
  if (i.user.id !== hostId) {
    return i.reply({ ephemeral: true, content: "❌ Only the host can finish the match." });
  }

  const active = await ActiveMatch.findOne({ hostId });
  const channel = i.channel;

  for (const [, member] of channel.members) {
    if (!member.user.bot) {
      try {
        await member.send("🏁 The match has ended. The channel will be deleted.");
      } catch {}
    }
  }

  await i.reply({ ephemeral: true, content: "Match closed. Channel will be deleted." });

  if (active) await ActiveMatch.deleteOne({ hostId });

  setTimeout(() => channel.delete().catch(() => {}), 2000);
});

// ------------------------------------------------------
// LOGIN
// ------------------------------------------------------
client.login(process.env.BOT_TOKEN);
