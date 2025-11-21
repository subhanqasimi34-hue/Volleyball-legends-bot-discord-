// ================================================================
// indexV9.js – Volley Legends Matchmaking Bot (DM-Only Edition)
// Host starts in server → Everything else happens in private DMs
// Auto-Delete (5 min), Reuse Stats, Player Stats, Accept/Decline
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
// EXPRESS KEEPALIVE
// ================================================================
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
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

// ================================================================
// DISCORD CLIENT
// ================================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// ================================================================
// CHANNELS
// ================================================================
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";

// ================================================================
// HELPERS
// ================================================================
const DELETE_AFTER = 5 * 60 * 1000; // 5 Minuten

function parseGameplay(text) {
  const p = text.split("|").map(v => v.trim());
  return {
    level: p[0] || "Unknown",
    rank: p[1] || "Unknown",
    playstyle: p[2] || "Unknown"
  };
}

function parseComm(text) {
  const p = text.split("|").map(v => v.trim());
  return {
    vc: p[0] || "Unknown",
    language: p[1] || "Unknown"
  };
}

async function autoDelete(msg) {
  setTimeout(() => msg.delete().catch(() => {}), DELETE_AFTER);
}

async function autoDeleteDM(user, contentOrObject) {
  const m = await user.send(contentOrObject).catch(() => null);
  if (m) setTimeout(() => m.delete().catch(() => {}), DELETE_AFTER);
}

// ================================================================
// RESET MATCHMAKING CHANNEL
// ================================================================
async function resetChannel() {
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

  const msg = await ch.send({ embeds: [embed], components: [row] });
  return msg;
}

// ================================================================
// READY
// ================================================================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await resetChannel();
});

// ================================================================
// CREATE MATCH BUTTON
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "create_match") return;

  const host = interaction.user;

  // 👉 Check cooldown
  const entry = await HostCooldown.findOne({ userId: host.id });
  if (entry && Date.now() - entry.timestamp < 5 * 60 * 1000) {
    const left = Math.ceil((5 * 60 * 1000 - (Date.now() - entry.timestamp)) / 60000);
    return interaction.reply({ content: `⏳ Please wait **${left}m**.`, ephemeral: true });
  }

  await HostCooldown.findOneAndUpdate(
    { userId: host.id },
    { timestamp: Date.now() },
    { upsert: true }
  );

  const previous = await HostStats.findOne({ userId: host.id });

  // 👉 Ask "Reuse last stats?"
  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("♻️ Reuse last stats?")
    .setDescription("Do you want to reuse your last stats?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  const msg = await interaction.reply({ embeds: [embed], components: [row], ephemeral: false, fetchReply: true });
  autoDelete(msg);
});

// ================================================================
// REUSE STATS BUTTONS
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  // host pressed "reuse_yes"
  if (interaction.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: interaction.user.id });
    openHostModal(interaction, stats);
  }

  if (interaction.customId === "reuse_no") {
    openHostModal(interaction, null);
  }
});

// ================================================================
// HOST MODAL
// ================================================================
function openHostModal(interaction, data) {
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
          .setRequired(id !== "notes")
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setValue(val || "")
      )
    )
  );

  interaction.showModal(modal);
}

// ================================================================
// HOST FORM SUBMIT → SEND MATCH TO DM
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "host_form") return;

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

  const g = parseGameplay(gameplay);
  const c = parseComm(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Your Match is Live")
    .setDescription(
      `You are now hosting a match.\n\n` +
      `📌 **Your Stats:**\n` +
      `• Level: ${g.level}\n` +
      `• Rank: ${g.rank}\n` +
      `• Playstyle: ${g.playstyle}\n\n` +
      `📌 **Profile:**\n` +
      `• Ability: ${ability}\n` +
      `• Region: ${region}\n` +
      `• VC: ${c.vc}\n` +
      `• Language: ${c.language}\n\n` +
      `📝 Notes: ${notes || "None"}\n\n` +
      `Players who click on **Play Together** will message you here.`
    );

  // remove reply
  await interaction.reply({ content: "✔ Match created in your DM!", ephemeral: true });

  // DM to host
  const msg = await user.send({ embeds: [embed] }).catch(() => null);
  if (msg) autoDelete(msg);
});

// ================================================================
// PLAYER REQUEST BUTTON → PLAYER MODAL
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.split("_")[1];
  const requester = interaction.user;

  const entry = await Cooldowns.findOne({ userId: requester.id, hostId });
  if (entry && Date.now() - entry.timestamp < 5 * 60 * 1000) {
    const left = Math.ceil((5 * 60 * 1000 - (Date.now() - entry.timestamp)) / 60000);
    return interaction.reply({ content: `⏳ Please wait **${left}m**.`, ephemeral: true });
  }

  const previous = await PlayerStats.findOne({ userId: requester.id });

  openPlayerModal(interaction, previous, hostId);
});

// ================================================================
// PLAYER MODAL
// ================================================================
function openPlayerModal(interaction, data, hostId) {
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
          .setRequired(id !== "p_notes")
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setValue(val || "")
      )
    )
  );

  interaction.showModal(modal);
}

// ================================================================
// PLAYER FORM SUBMIT → SEND DM ONLY TO HOST
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("player_form_")) return;

  const hostId = interaction.customId.split("_")[2];
  const requester = interaction.user;

  const gameplay = interaction.fields.getTextInputValue("p_gameplay");
  const ability = interaction.fields.getTextInputValue("p_ability");
  const region = interaction.fields.getTextInputValue("p_region");
  const comm = interaction.fields.getTextInputValue("p_communication");
  const notes = interaction.fields.getTextInputValue("p_notes");

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

  const host = await client.users.fetch(hostId).catch(() => null);
  if (!host) return interaction.reply({ content: "Host not found.", ephemeral: true });

  const g = parseGameplay(gameplay);
  const c = parseComm(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🔔 New Play Request")
    .setDescription(
      `👤 **Player:** <@${requester.id}>\n\n` +
      `📌 **Stats:**\n` +
      `• Level: ${g.level}\n` +
      `• Rank: ${g.rank}\n` +
      `• Playstyle: ${g.playstyle}\n\n` +
      `• Ability: ${ability}\n` +
      `• Region: ${region}\n` +
      `• VC: ${c.vc}\n` +
      `• Language: ${c.language}\n\n` +
      `📝 Notes: ${notes || "None"}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${requester.id}_${hostId}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}_${hostId}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`link_${requester.id}_${hostId}`).setLabel("Private Server Link").setStyle(ButtonStyle.Primary)
  );

  await autoDeleteDM(host, { embeds: [embed], components: [row] });

  interaction.reply({ content: "Request sent!", ephemeral: true });
});

// ================================================================
// ACCEPT / DECLINE
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("accept_")) {
    const [_, playerId] = interaction.customId.split("_");
    const player = await client.users.fetch(playerId).catch(() => null);

    autoDeleteDM(player, "✔ Your request was **accepted**!");
    autoDeleteDM(interaction.user, "Player accepted.");

    return;
  }

  if (interaction.customId.startsWith("decline_")) {
    const [_, playerId] = interaction.customId.split("_");
    const player = await client.users.fetch(playerId).catch(() => null);

    autoDeleteDM(player, "❌ Your request was **declined**.");
    autoDeleteDM(interaction.user, "Player declined.");

    return;
  }
});

// ================================================================
// PRIVATE SERVER LINK
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("link_")) {
    const [_, playerId, hostId] = interaction.customId.split("_");

    const modal = new ModalBuilder()
      .setCustomId(`privatelink_${playerId}_${hostId}`)
      .setTitle("Private Server Link");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Roblox Private Server Link")
          .setPlaceholder("https://www.roblox.com/...")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

    return interaction.showModal(modal);
  }
});

// ================================================================
// PRIVATE LINK SUBMIT
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("privatelink_")) return;

  const [_, playerId] = interaction.customId.split("_");

  const link = interaction.fields.getTextInputValue("link");

  if (!/^https:\/\/www\.roblox\.com\//.test(link)) {
    return interaction.reply({
      content: "❌ Invalid link. Must start with https://www.roblox.com/",
      ephemeral: true
    });
  }

  const player = await client.users.fetch(playerId).catch(() => null);

  autoDeleteDM(player, `🔗 **Private Server Link:**\n${link}`);
  autoDeleteDM(interaction.user, "✔ Link sent!");

  interaction.reply({ content: "Done!", ephemeral: true });
});

// ================================================================
client.login(process.env.BOT_TOKEN);
