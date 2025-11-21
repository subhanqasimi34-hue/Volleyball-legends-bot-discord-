// ======================================================
// VOLLEY LEGENDS MATCHMAKING BOT — ULTRA FIXED VERSION
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
  PermissionsBitField,
  ChannelType
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

// ---------------- KEEPALIVE ---------------------------
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
app.listen(3000);

// ---------------- DATABASE ----------------------------
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

// ---------------- DISCORD CLIENT -----------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

const SERVER_ID = "1439709824773263503";
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";
const CATEGORY_NAME = "Matchmaking";

// ---------------- HELPERS -----------------------------
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

  const l = p.find(x => /(eng|german|de|turkish|spanish|arabic|english)/i.test(x));
  if (l) language = l;

  return { vc, language };
}

// ---------------- CHANNEL RESET ------------------------
client.once("ready", async () => {
  console.log("Bot online.");
  const ch = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!ch) return;

  await ch.bulkDelete(100).catch(()=>{});

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
});

// ---------------- HOST FLOW ---------------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  // CREATE MATCH
  if (i.customId === "create_match") {
    return i.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setColor("#22C55E")
          .setTitle("♻️ Reuse last stats?")
          .setDescription("Reuse your previous match info?")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  if (i.customId === "reuse_yes" || i.customId === "reuse_no") {
    const data = i.customId === "reuse_yes" ? await HostStats.findOne({ userId: i.user.id }) : null;
    return showHostModal(i, data);
  }
});

function showHostModal(i, data) {
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
          .setValue(val || "")
          .setRequired(id !== "notes")
          .setStyle(id === "notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      )
    )
  );

  i.showModal(modal);
}

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

  const fp = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  await fp.send({ content: `<@${user.id}>`, embeds: [embed], components: [row] });

  return i.reply({ ephemeral: true, content: "Match created!" });
});

// ---------------- PLAYER REQUEST -----------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("request_")) return;

  const hostId = i.customId.split("_")[1];
  const old = await PlayerStats.findOne({ userId: i.user.id });

  return playerModal(i, old, hostId);
});

function playerModal(i, data, hostId) {
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
          .setValue(val || "")
          .setRequired(id !== "p_notes")
          .setStyle(id === "p_notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      )
    )
  );

  i.showModal(modal);
}

// ---------------- PLAYER SUBMIT -----------------------
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

  const counter = await RequestCounter.findOneAndUpdate(
    { hostId },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );

  const host = await client.users.fetch(hostId);

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🔔 New Play Request")
    .setDescription(
      `👤 **Player:** <@${requester.id}>\n` +
      `📨 Total Requests: ${counter.count}\n\n` +
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
    new ButtonBuilder().setCustomId(`decline_${requester.id}_${hostId}`).setLabel("Decline").setStyle(ButtonStyle.Danger)
  );

  try {
    await host.send({ embeds: [embed], components: [row] });
  } catch {}

  return i.reply({ ephemeral: true, content: "Request sent!" });
});

// ---------------- ACCEPT / DECLINE ---------------------
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("accept") && !i.customId.startsWith("decline")) return;

  const [type, playerId, hostId] = i.customId.split("_");
  const guild = client.guilds.cache.get(SERVER_ID);

  const host = i.user;
  const player = await client.users.fetch(playerId);

  // DECLINE
  if (type === "decline") {
    try { await player.send("❌ Your request was declined."); } catch {}
    return i.reply({ ephemeral: true, content: "Declined." });
  }

  // ACCEPT — ALWAYS create channel IN SERVER
  let active = await ActiveMatch.findOne({ hostId });
  let channel;

  if (active) channel = guild.channels.cache.get(active.channelId);

  if (!active || !channel) {
    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory);
    if (!category) {
      category = await guild.channels.create({
        name: CATEGORY_NAME,
        type: ChannelType.GuildCategory
      });
    }

    channel = await guild.channels.create({
      name: `matchmaking-${host.username}`,
      type: ChannelType.GuildText,
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
    if (active.players.length >= 3) {
      return i.reply({ ephemeral: true, content: "❌ Max players reached (3)." });
    }

    await channel.permissionOverwrites.edit(playerId, {
      ViewChannel: true,
      SendMessages: true
    });

    active.players.push(playerId);
    await active.save();
  }

  try {
    await player.send("✅ You were accepted! Check the group channel.");
  } catch {}

  await i.reply({ ephemeral: true, content: "Player added." });

  await channel.send(`🎉 <@${playerId}> joined <@${hostId}>'s match!`);

  setTimeout(async () => {
    const c = guild.channels.cache.get(channel.id);
    if (!c) return;

    await ActiveMatch.deleteOne({ hostId }).catch(() => {});
    c.delete().catch(() => {});
  }, 3 * 60 * 1000);
});

// ---------------- LOGIN -------------------------------
client.login(process.env.BOT_TOKEN);
