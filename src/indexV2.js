// ================================================================
// indexV5.js – Volley Legends Matchmaking Bot (Premium Edition)
// With: MongoDB, Clean UI, 2-Channel System
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
// MONGO SCHEMA
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
// PARSER FUNCTIONS
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
// RESET MATCHMAKING CHANNEL
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

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await resetMatchmakingChannel();
});

// ================================================================
// CREATE MATCH (ASK REUSE?)
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "create_match") return;

  await resetMatchmakingChannel();

  const stats = await HostStats.findOne({ userId: interaction.user.id });

  if (!stats) return openModal(interaction, false, null);

  const embed = new EmbedBuilder()
    .setTitle("♻️ Reuse your previous match settings?")
    .setColor("#22C55E")
    .setDescription("Would you like to autofill your previous match data?");

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

  const fields = {
    gameplay: new TextInputBuilder()
      .setCustomId("gameplay")
      .setLabel("Level | Rank | Playstyle")
      .setRequired(true)
      .setStyle(TextInputStyle.Short),

    ability: new TextInputBuilder()
      .setCustomId("ability")
      .setLabel("Ability")
      .setRequired(true)
      .setStyle(TextInputStyle.Short),

    region: new TextInputBuilder()
      .setCustomId("region")
      .setLabel("Region")
      .setRequired(true)
      .setStyle(TextInputStyle.Short),

    communication: new TextInputBuilder()
      .setCustomId("communication")
      .setLabel("VC | Language")
      .setRequired(true)
      .setStyle(TextInputStyle.Short),

    notes: new TextInputBuilder()
      .setCustomId("notes")
      .setLabel("Notes")
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph)
  };

  if (autofill && data) {
    fields.gameplay.setValue(data.gameplay);
    fields.ability.setValue(data.ability);
    fields.region.setValue(data.region);
    fields.communication.setValue(data.communication);
    fields.notes.setValue(data.notes || "");
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(fields.gameplay),
    new ActionRowBuilder().addComponents(fields.ability),
    new ActionRowBuilder().addComponents(fields.region),
    new ActionRowBuilder().addComponents(fields.communication),
    new ActionRowBuilder().addComponents(fields.notes)
  );

  return interaction.showModal(modal);
}

// ================================================================
// REUSE HANDLING
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
// SUBMIT MATCH FORM → SEND TO FIND-PLAYERS
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

  await HostStats.findOneAndUpdate(
    { userId: user.id },
    { gameplay, ability, region, communication: comm, notes },
    { upsert: true }
  );

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  // EMBED FOR FIND-PLAYERS
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

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  // SEND TO FIND-PLAYERS CHANNEL
  const findChannel = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await findChannel.send({ content: `${user}`, embeds: [embed], components: [row] });

  return interaction.reply({ content: "Match created!", ephemeral: true });
});

// ================================================================
// PLAY TOGETHER → SEND REQUEST IN MATCHMAKING
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.replace("request_", "");
  const requester = interaction.user;

  const matchEmbed = interaction.message.embeds[0];

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🔔 New Play Request")
    .setDescription(
      `👤 **Player:** ${requester}\n\n` +
      `Wants to join this match:\n\n` +
      matchEmbed.description
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${requester.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sendlink_${requester.id}`).setLabel("Send Private Server Link").setStyle(ButtonStyle.Primary)
  );

  const matchChannel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);

  await matchChannel.send({
    content: `<@${hostId}>`,
    embeds: [embed],
    components: [row]
  });

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
// PRIVATE LINK
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
    return interaction.reply({ content: "❌ Link must start with https://www.roblox.com/", ephemeral: true });
  }

  await user.send(`Here is your private server link:\n${link}`).catch(() => {});

  return interaction.reply({ content: "Private server link sent!", ephemeral: true });
});

// ================================================================
client.login(process.env.BOT_TOKEN);
