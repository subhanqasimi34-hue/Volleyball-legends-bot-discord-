// ================================================================
// indexV9.js – Volley Legends Matchmaking Bot (Premium Edition)
// DM Play Requests, Autofill, Stats Modal, Clean UI
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
// EXPRESS
// ================================================================
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
app.listen(3000, () => console.log("Express OK"));

// ================================================================
// MONGO
// ================================================================
mongoose
  .connect(process.env.MONGO_URI, { dbName: "VolleyBot" })
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("Mongo Error:", err));

const StatsSchema = {
  userId: { type: String, required: true, unique: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String
};

const HostStats = mongoose.model("HostStats", new mongoose.Schema(StatsSchema));
const PlayerStats = mongoose.model("PlayerStats", new mongoose.Schema(StatsSchema));

const Cooldowns = mongoose.model(
  "Cooldowns",
  new mongoose.Schema({ userId: String, hostId: String, timestamp: Number })
);

const HostCooldown = mongoose.model(
  "HostCooldown",
  new mongoose.Schema({ userId: String, timestamp: Number })
);

const PendingRequests = mongoose.model(
  "PendingRequests",
  new mongoose.Schema({
    hostId: String,
    requests: Array
  })
);

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
// CHANNEL CONFIG
// ================================================================
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

// ================================================================
// HELPERS
// ================================================================
function parseStats(text) {
  const parts = text.split("|").map(p => p.trim());
  return {
    level: parts.find(p => /^\d{1,4}$/i.test(p)) || "Unknown",
    rank: parts.find(p => /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(p)) || "Unknown",
    playstyle: parts.reverse().find(p => !/(bronze|silver|gold|diamond|elite|pro|i|ii|iii|\d+)/i.test(p)) || "Unknown"
  };
}

function parseComm(text) {
  const parts = text.split("|").map(p => p.trim());
  return {
    vc: parts.find(p => /(yes|no|vc)/i.test(p)) || "Unknown",
    language: parts.find(p =>
      /(eng|german|turkish|spanish|arabic|fr|de)/i.test(p)
    ) || "Unknown"
  };
}

// ================================================================
// MATCHMAKING CHANNEL RESET
// ================================================================
async function resetMM() {
  const ch = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!ch) return;

  const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => {});
  if (msgs) await ch.bulkDelete(msgs).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 𝙑𝙤𝙡𝙡𝙚𝙮 𝙇𝙚𝙜𝙚𝙣𝙙𝙨 𝗠𝗮𝘁𝗰𝗵𝗺𝗮𝗸𝗶𝗻𝗴")
    .setDescription("Find teammates instantly.\nPress **Create Match** to begin.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Success)
  );

  await ch.send({ embeds: [embed], components: [row] });
}

// ================================================================
// READY
// ================================================================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await resetMM();
});

// ================================================================
// HOST COOLDOWN
// ================================================================
async function hostCD(id) {
  const entry = await HostCooldown.findOne({ userId: id });
  if (!entry) return 0;
  const diff = Date.now() - entry.timestamp;
  return diff >= 300000 ? 0 : Math.ceil((300000 - diff) / 60000);
}

// ================================================================
// CREATE MATCH BUTTON
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (i.customId !== "create_match") return;

  const cd = await hostCD(i.user.id);
  if (cd > 0)
    return i.reply({ content: `❌ Wait **${cd} min** before creating a new match.`, ephemeral: true });

  await resetMM();

  const old = await HostStats.findOne({ userId: i.user.id });
  openHostModal(i, !!old, old);
});

// ================================================================
// HOST MODAL
// ================================================================
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
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(id !== "notes")
          .setValue(autofill && val ? val : "")
      )
    )
  );

  i.showModal(modal);
}

// ================================================================
// HOST FORM SUBMIT
// ================================================================
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

  const { level, rank, playstyle } = parseStats(gameplay);
  const { vc, language } = parseComm(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Volley Legends Match Found")
    .setDescription(
      `👤 **Host:** <@${user.id}>\n\n` +
      `📌 **Stats:**\n` +
      `• 📊 Level: ${level}\n` +
      `• 🏆 Rank: ${rank}\n` +
      `• 🎮 Playstyle: ${playstyle}\n\n` +
      `📌 **Profile:**\n` +
      `• ⚡ Ability: ${ability}\n` +
      `• 🌍 Region: ${region}\n` +
      `• 🎤 VC: ${vc}\n` +
      `• 🌐 Language: ${language}\n\n` +
      `📝 Notes: ${notes || "None"}`
    );

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const ch = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await ch.send({ content: `<@${user.id}>`, embeds: [embed], components: [btn] });

  i.reply({ content: "Match created!", ephemeral: true });
});

// ================================================================
// PLAYER REQUEST → OPEN PLAYER MODAL
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("request_")) return;

  const hostId = i.customId.split("_")[1];
  const requester = i.user;

  const old = await PlayerStats.findOne({ userId: requester.id });
  openPlayerModal(i, !!old, old, hostId);
});

// ================================================================
// PLAYER MODAL
// ================================================================
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
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(id !== "p_notes")
          .setValue(autofill && val ? val : "")
      )
    )
  );

  i.showModal(modal);
}

// ================================================================
// PLAYER FORM SUBMIT (DM-ONLY REQUESTS)
// ================================================================
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

  const { level, rank, playstyle } = parseStats(gameplay);
  const { vc, language } = parseComm(comm);

  // DM MESSAGE
  const dmText =
    `🔔 **New Play Request**\n\n` +
    `👤 **Player:** <@${requester.id}>\n\n` +
    `📌 **Stats:**\n` +
    `• 📊 Level: ${level}\n` +
    `• 🏆 Rank: ${rank}\n` +
    `• 🎮 Playstyle: ${playstyle}\n` +
    `• ⚡ Ability: ${ability}\n` +
    `• 🌍 Region: ${region}\n` +
    `• 🎤 VC: ${vc}\n` +
    `• 🌐 Language: ${language}\n` +
    `• 📝 Notes: ${notes || "None"}\n`;

  const host = await client.users.fetch(hostId).catch(() => null);

  // TRY DM
  try {
    await host.send(dmText);
  } catch (e) {
    // SAVE REQUEST FOR LATER
    await PendingRequests.findOneAndUpdate(
      { hostId },
      { $push: { requests: dmText } },
      { upsert: true }
    );

    // Notify host in match channel
    const mm = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
    await mm.send(`<@${hostId}> ⚠️ You have DMs disabled. Incoming requests saved until you enable them.`);

    return i.reply({ content: "Request saved & pending (Host DMs off).", ephemeral: true });
  }

  i.reply({ content: "Request sent!", ephemeral: true });
});

// ================================================================
// LOGIN
// ================================================================
client.login(process.env.BOT_TOKEN);
