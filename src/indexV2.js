// ================================================================
// indexV6.js – Volley Legends Matchmaking Bot (Optimized Clean Edition)
// Without Emojis, With Unicode Labels, DM Request System & Auto-Delete
// ================================================================

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
  TextInputStyle
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

// ================================================================
// EXPRESS SERVER
// ================================================================
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot running"));
app.listen(3000, () => console.log("Express OK"));

// ================================================================
// MONGO CONNECTION
// ================================================================
mongoose
  .connect(process.env.MONGO_URI, { dbName: "VolleyBot" })
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("MongoDB Error:", err));

// ================================================================
// SCHEMAS
// ================================================================
const hostStatsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String
});
const HostStats = mongoose.model("HostStats", hostStatsSchema);

const cooldownSchema = new mongoose.Schema({
  userId: String,
  hostId: String,
  timestamp: Number
});
const Cooldowns = mongoose.model("Cooldowns", cooldownSchema);

const hostCooldownSchema = new mongoose.Schema({
  userId: String,
  timestamp: Number
});
const HostCooldown = mongoose.model("HostCooldown", hostCooldownSchema);

const requestCountSchema = new mongoose.Schema({
  hostId: String,
  count: Number
});
const RequestCounter = mongoose.model("RequestCounter", requestCountSchema);

// ================================================================
// CLIENT
// ================================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// ================================================================
// AUTO DELETE DMs AFTER 1 MINUTE
// ================================================================
client.on("messageCreate", async msg => {
  if (!msg.guild) {
    setTimeout(() => msg.delete().catch(() => {}), 60000);
  }
});

// ================================================================
// CHANNELS
// ================================================================
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

let parentMessage = null;

// ================================================================
// PARSERS (Simplified)
// ================================================================
function parseGameplay(text) {
  const parts = text.split("|").map(t => t.trim());
  return {
    level: parts[0] || "Unknown",
    rank: parts[1] || "Unknown",
    playstyle: parts[2] || "Unknown"
  };
}

function parseCommunication(text) {
  const parts = text.split("|").map(t => t.trim());
  return {
    vc: parts[0] || "Unknown",
    language: parts[1] || "Unknown"
  };
}

// ================================================================
// RESET MATCHMAKING CHANNEL
// ================================================================
async function resetMatchmakingChannel() {
  const ch = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!ch) return;
  const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => {});
  if (msgs) await ch.bulkDelete(msgs).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Click **Create Match** to start.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Success)
  );

  parentMessage = await ch.send({ embeds: [embed], components: [row] });
}

// ================================================================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  resetMatchmakingChannel();
});

// ================================================================
// HOST COOLDOWN
// ================================================================
async function checkHostCooldown(id) {
  const entry = await HostCooldown.findOne({ userId: id });
  if (!entry) return 0;
  const diff = Date.now() - entry.timestamp;
  if (diff >= 300000) return 0;
  return Math.ceil((300000 - diff) / 60000);
}

// ================================================================
// CREATE MATCH
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (i.customId !== "create_match") return;

  const cd = await checkHostCooldown(i.user.id);
  if (cd > 0) {
    return i.reply({
      content: `You must wait **${cd} min** before creating again.`,
      ephemeral: true
    });
  }

  const stats = await HostStats.findOne({ userId: i.user.id });

  const ask = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Reuse previous settings?")
    .setDescription("Do you want to autofill using your last match data?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  if (!stats) return openModal(i, false, null);

  return i.reply({ embeds: [ask], components: [row], ephemeral: true });
});

// ================================================================
// OPEN MODAL
// ================================================================
function openModal(interaction, autofill, data) {
  const modal = new ModalBuilder()
    .setCustomId("match_form")
    .setTitle("Create Match");

  const g = new TextInputBuilder()
    .setCustomId("gameplay")
    .setLabel("Level | Rank | Playstyle")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const a = new TextInputBuilder()
    .setCustomId("ability")
    .setLabel("Ability")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const r = new TextInputBuilder()
    .setCustomId("region")
    .setLabel("Region")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const c = new TextInputBuilder()
    .setCustomId("comm")
    .setLabel("VC | Language")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const n = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Notes")
    .setRequired(false)
    .setStyle(TextInputStyle.Paragraph);

  if (autofill && data) {
    g.setValue(data.gameplay);
    a.setValue(data.ability);
    r.setValue(data.region);
    c.setValue(data.communication);
    n.setValue(data.notes || "");
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(g),
    new ActionRowBuilder().addComponents(a),
    new ActionRowBuilder().addComponents(r),
    new ActionRowBuilder().addComponents(c),
    new ActionRowBuilder().addComponents(n)
  );

  interaction.showModal(modal);
}

// ================================================================
// REUSE BUTTONS
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  if (i.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: i.user.id });
    return openModal(i, true, stats);
  }

  if (i.customId === "reuse_no") {
    return openModal(i, false, null);
  }
});

// ================================================================
// SUBMIT MATCH FORM
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (i.customId !== "match_form") return;

  const user = i.user;

  const gameplay = i.fields.getTextInputValue("gameplay");
  const ability = i.fields.getTextInputValue("ability");
  const region = i.fields.getTextInputValue("region");
  const comm = i.fields.getTextInputValue("comm");
  const notes = i.fields.getTextInputValue("notes");

  const gp = parseGameplay(gameplay);
  const cm = parseCommunication(comm);

  await HostStats.findOneAndUpdate(
    { userId: user.id },
    { gameplay, ability, region, communication: comm, notes },
    { upsert: true }
  );

  await RequestCounter.findOneAndUpdate({ hostId: user.id }, { count: 0 }, { upsert: true });

  await HostCooldown.findOneAndUpdate(
    { userId: user.id },
    { timestamp: Date.now() },
    { upsert: true }
  );

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Match Created")
    .setDescription(
`ʜᴏsᴛ: ${user}

ʟᴇᴠᴇʟ: ${gp.level}
ʀᴀɴᴋ: ${gp.rank}
ᴘʟᴀʏsᴛʏʟᴇ: ${gp.playstyle}

ᴀʙɪʟɪᴛʏ: ${ability}
ʀᴇɢɪᴏɴ: ${region}
ᴠᴄ: ${cm.vc}
ʟᴀɴɢᴜᴀɢᴇ: ${cm.language}

ɴᴏᴛᴇs:
${notes || "None"}
`
    );

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`req_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const ch = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await ch.send({ content: `${user}`, embeds: [embed], components: [btn] });

  return i.reply({ content: "Match created!", ephemeral: true });
});

// ================================================================
// PLAYER REQUEST
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("req_")) return;

  const hostId = i.customId.replace("req_", "");
  const requester = i.user;

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

  const matchEmbed = i.message.embeds[0];

  const host = await client.users.fetch(hostId).catch(() => {});

  if (host) {
    const embed = new EmbedBuilder()
      .setColor("#22C55E")
      .setTitle("New Play Request")
      .setDescription(
`ᴘʟᴀʏᴇʀ: ${requester}
ʀᴇǫᴜᴇsᴛs: ${requestCount}

Please send the Discord private server. It's ineeded!

${matchEmbed.description}
`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`accept_${requester.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`decline_${requester.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`link_${requester.id}`).setLabel("Send Private Server Link").setStyle(ButtonStyle.Primary)
    );

    await host.send({ embeds: [embed], components: [row] }).catch(() => {});
  }

  return i.reply({ content: "Request sent!", ephemeral: true });
});

// ================================================================
// ACCEPT / DECLINE
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  if (i.customId.startsWith("accept_")) {
    const id = i.customId.replace("accept_", "");
    const user = await client.users.fetch(id).catch(() => {});
    if (user) user.send("Your request was accepted.").catch(() => {});
    return i.reply({ content: "Accepted.", ephemeral: true });
  }

  if (i.customId.startsWith("decline_")) {
    const id = i.customId.replace("decline_", "");
    const user = await client.users.fetch(id).catch(() => {});
    if (user) user.send("Your request was declined.").catch(() => {});
    return i.reply({ content: "Declined.", ephemeral: true });
  }
});

// ================================================================
// SEND LINK MODAL
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("link_")) return;

  const id = i.customId.replace("link_", "");

  const modal = new ModalBuilder()
    .setCustomId(`sendlink_${id}`)
    .setTitle("Private Server Link");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("link")
        .setLabel("Roblox Private Server Link")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  return i.showModal(modal);
});

// ================================================================
// SEND LINK SUBMIT
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (!i.customId.startsWith("sendlink_")) return;

  const id = i.customId.replace("sendlink_", "");
  const link = i.fields.getTextInputValue("link");

  if (!link.startsWith("https://www.roblox.com/")) {
    return i.reply({
      content: "Link must start with https://www.roblox.com/",
      ephemeral: true
    });
  }

  const user = await client.users.fetch(id).catch(() => {});
  if (user) user.send(`Here is your server link:\n${link}`).catch(() => {});

  return i.reply({ content: "Link sent!", ephemeral: true });
});

// ================================================================
client.login(process.env.BOT_TOKEN);
