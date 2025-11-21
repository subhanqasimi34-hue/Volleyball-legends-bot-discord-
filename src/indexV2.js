// ================================================================
// indexV6.js – Volley Legends Matchmaking Bot (Premium Edition)
// With: MongoDB, Cooldowns, Auto-Delete, Request Counter, 2 Channels
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
// MONGO SCHEMAS
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
// DISCORD CLIENT
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
// CHANNELS
// ================================================================
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

let parentMessage = null;

// ================================================================
// PARSER HELPERS
// ================================================================
function parseLevelRankPlaystyle(text) {
  const parts = text.split("|").map(p => p.trim());
  let level = "Unknown", rank = "Unknown", playstyle = "Unknown";

  const lvl = parts.find(p => /^\d{1,4}$/i.test(p));
  if (lvl) level = lvl;

  const rk = parts.find(p =>
    /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(p)
  );
  if (rk) rank = rk;

  const ps = parts.find(p => p !== lvl && p !== rk);
  if (ps) playstyle = ps;

  return { level, rank, playstyle };
}

function parseCommunication(text) {
  const parts = text.split("|").map(p => p.trim());
  let vc = "Unknown", language = "Unknown";

  const vcPart = parts.find(p => /(yes|no|vc|voice)/i.test(p));
  if (vcPart) vc = vcPart;

  const lang = parts.find(p =>
    /(eng|english|german|de|fr|turkish|spanish|arabic)/i.test(p)
  );
  if (lang) language = lang;

  return { vc, language };
}

// ================================================================
// RESET MATCHMAKING CHANNEL (DELETES ALL REQUESTS)
// ================================================================
async function resetMatchmakingChannel() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => {});
  if (messages) await channel.bulkDelete(messages).catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle("🏐 Volley Legends Matchmaking")
    .setDescription("Click **Create Match** to find teammates.")
    .setColor("#22C55E");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  parentMessage = msg;
}

// ================================================================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await resetMatchmakingChannel();
});

// ================================================================
// 5 MIN HOST COOLDOWN CHECK
// ================================================================
async function checkHostCooldown(userId) {
  const entry = await HostCooldown.findOne({ userId });
  if (!entry) return 0;

  const now = Date.now();
  const diff = now - entry.timestamp;

  if (diff >= 5 * 60 * 1000) return 0; // expired

  return Math.ceil((5 * 60 * 1000 - diff) / 60000);
}

// ================================================================
// HOST CLICK: CREATE MATCH → Ask Reuse
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "create_match") return;

  // Check Host Cooldown
  const minutesLeft = await checkHostCooldown(interaction.user.id);
  if (minutesLeft > 0) {
    return interaction.reply({
      content: `❌ You must wait **${minutesLeft} minute(s)** before creating a new match again.`,
      ephemeral: true
    });
  }

  await resetMatchmakingChannel();

  const stats = await HostStats.findOne({ userId: interaction.user.id });

  if (!stats) return openModal(interaction, false, null);

  const embed = new EmbedBuilder()
    .setTitle("♻️ Reuse previous match settings?")
    .setColor("#22C55E")
    .setDescription("Would you like to autofill your last match settings?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
});

// ================================================================
// OPEN MODAL
// ================================================================
function openModal(interaction, autofill, data) {
  const modal = new ModalBuilder()
    .setCustomId("match_form")
    .setTitle("Create Volley Match");

  const gameplay = new TextInputBuilder()
    .setCustomId("gameplay")
    .setLabel("Level | Rank | Playstyle")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const ability = new TextInputBuilder()
    .setCustomId("ability")
    .setLabel("Ability")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const region = new TextInputBuilder()
    .setCustomId("region")
    .setLabel("Region")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const comm = new TextInputBuilder()
    .setCustomId("communication")
    .setLabel("VC | Language")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const notes = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Notes")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  if (autofill && data) {
    gameplay.setValue(data.gameplay);
    ability.setValue(data.ability);
    region.setValue(data.region);
    comm.setValue(data.communication);
    notes.setValue(data.notes || "");
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(gameplay),
    new ActionRowBuilder().addComponents(ability),
    new ActionRowBuilder().addComponents(region),
    new ActionRowBuilder().addComponents(comm),
    new ActionRowBuilder().addComponents(notes)
  );

  return interaction.showModal(modal);
}

// ================================================================
// YES / NO REUSE
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: interaction.user.id });
    return openModal(interaction, true, stats);
  }

  if (interaction.customId === "reuse_no") {
    return openModal(interaction, false, null);
  }
});

// ================================================================
// SUBMIT MATCH FORM → SEND TO #find-players
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "match_form") return;

  const user = interaction.user;

  const gameplay = interaction.fields.getTextInputValue("gameplay");
  const ability = interaction.fields.getTextInputValue("ability");
  const region = interaction.fields.getTextInputValue("region");
  const comm = interaction.fields.getTextInputValue("communication");
  const notes = interaction.fields.getTextInputValue("notes");

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  // SAVE PROFILE
  await HostStats.findOneAndUpdate(
    { userId: user.id },
    { gameplay, ability, region, communication: comm, notes },
    { upsert: true }
  );

  // RESET REQUEST COUNTER
  await RequestCounter.findOneAndUpdate(
    { hostId: user.id },
    { count: 0 },
    { upsert: true }
  );

  // SET HOST COOLDOWN
  await HostCooldown.findOneAndUpdate(
    { userId: user.id },
    { timestamp: Date.now() },
    { upsert: true }
  );

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Volley Legends Match Found")
    .setDescription(
      `👤 **Host:** ${user}\n\n` +
      `📌 **Stats:**\n` +
      `• 📊 **Level:** ${level}\n` +
      `• 🏅 **Rank:** ${rank}\n` +
      `• 🎮 **Playstyle:** ${playstyle}\n\n` +
      `📌 **Profile:**\n` +
      `• ⚡ **Ability:** ${ability}\n` +
      `• 🌍 **Region:** ${region}\n` +
      `• 🎤 **VC:** ${vc}\n` +
      `• 🗣️ **Language:** ${language}\n\n` +
      `📝 **Notes:**\n${notes || "None"}`
    );

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const channel = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await channel.send({ content: `${user}`, embeds: [embed], components: [btn] });

  return interaction.reply({ content: "Match created!", ephemeral: true });
});

// ================================================================
// PLAYER REQUEST → 5 MIN COOLDOWN + COUNTER + REQUEST EMBED
// ================================================================
async function checkPlayerCooldown(playerId, hostId) {
  const entry = await Cooldowns.findOne({ userId: playerId, hostId });
  if (!entry) return 0;

  const now = Date.now();
  const diff = now - entry.timestamp;

  if (diff >= 5 * 60 * 1000) return 0;

  return Math.ceil((5 * 60 * 1000 - diff) / 60000);
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.replace("request_", "");
  const requester = interaction.user;

  const cooldown = await checkPlayerCooldown(requester.id, hostId);
  if (cooldown > 0) {
    return interaction.reply({
      content: `❌ You must wait **${cooldown} minute(s)** before sending another request to this host.`,
      ephemeral: true
    });
  }

  // SAVE PLAYER COOLDOWN
  await Cooldowns.findOneAndUpdate(
    { userId: requester.id, hostId },
    { timestamp: Date.now() },
    { upsert: true }
  );

  // INCREASE HOST REQUEST COUNTER
  const counter = await RequestCounter.findOneAndUpdate(
    { hostId },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );

  const requestCount = counter.count;

  const matchEmbed = interaction.message.embeds[0];

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🔔 New Play Request")
    .setDescription(
      `👤 **Player:** ${requester}\n\n` +
      `📨 **Total Requests: ${requestCount}**\n\n` +
      `Wants to join this match:\n\n` +
      matchEmbed.description
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${requester.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sendlink_${requester.id}`).setLabel("Send Private Server Link").setStyle(ButtonStyle.Primary)
  );

  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  await channel.send({ content: `<@${hostId}>`, embeds: [embed], components: [row] });

  return interaction.reply({ content: "Request sent!", ephemeral: true });
});

// ================================================================
// ACCEPT / DECLINE
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("accept_")) {
    const uid = interaction.customId.replace("accept_", "");
    const user = await client.users.fetch(uid).catch(() => {});
    await user.send("Your play request was **accepted**!").catch(() => {});
    return interaction.reply({ content: "Accepted.", ephemeral: true });
  }

  if (interaction.customId.startsWith("decline_")) {
    const uid = interaction.customId.replace("decline_", "");
    const user = await client.users.fetch(uid).catch(() => {});
    await user.send("Your play request was **declined**.").catch(() => {});
    return interaction.reply({ content: "Declined.", ephemeral: true });
  }
});

// ================================================================
// PRIVATE LINK MODAL
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sendlink_")) return;

  const uid = interaction.customId.replace("sendlink_", "");

  const modal = new ModalBuilder()
    .setCustomId(`privatelink_${uid}`)
    .setTitle("Send Private Server Link");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("link")
        .setLabel("Roblox Private Server Link")
        .setPlaceholder("https://www.roblox.com/…")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );

  return interaction.showModal(modal);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("privatelink_")) return;

  const uid = interaction.customId.replace("privatelink_", "");
  const user = await client.users.fetch(uid).catch(() => {});
  const link = interaction.fields.getTextInputValue("link");

  if (!link.startsWith("https://www.roblox.com/")) {
    return interaction.reply({
      content: "❌ Link must start with https://www.roblox.com/",
      ephemeral: true
    });
  }

  await user.send(`Here is your private server link:\n${link}`).catch(() => {});

  return interaction.reply({
    content: "Private server link sent!",
    ephemeral: true
  });
});

// ================================================================
client.login(process.env.BOT_TOKEN);
