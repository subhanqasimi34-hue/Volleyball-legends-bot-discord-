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

// ----------------------------------------------------
// Express Keep-Alive
// ----------------------------------------------------
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
app.listen(3000);

// ----------------------------------------------------
// MongoDB
// ----------------------------------------------------
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

// ----------------------------------------------------
// Discord Client
// ----------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.User]
});

const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------
function autoDelete(message) {
  setTimeout(() => {
    message.delete().catch(() => {});
  }, 5 * 60 * 1000);
}

function parseLevelRankPlaystyle(text) {
  if (!text) return { level: "Unknown", rank: "Unknown", playstyle: "Unknown" };

  const parts = text.split("|").map(p => p.trim());
  const lvl = parts.find(p => /^\d{1,4}$/.test(p));
  const rk = parts.find(p => /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(p));
  const ps = parts.find(p => p !== lvl && p !== rk);

  return {
    level: lvl || "Unknown",
    rank: rk || "Unknown",
    playstyle: ps || "Unknown"
  };
}

function parseCommunication(text) {
  if (!text) return { vc: "Unknown", language: "Unknown" };

  const parts = text.split("|").map(p => p.trim());
  const vc = parts.find(p => /(yes|no|vc|voice)/i.test(p));
  const lang = parts.find(p => /(eng|german|de|fr|tr|es|arabic)/i.test(p));

  return {
    vc: vc || "Unknown",
    language: lang || "Unknown"
  };
}

// ----------------------------------------------------
// Reset Matchmaking Channel (public)
// ----------------------------------------------------
async function resetMatchmakingChannel() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return;

  const old = await channel.messages.fetch({ limit: 100 }).catch(() => {});
  if (old) channel.bulkDelete(old).catch(() => {});

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

  await channel.send({ embeds: [embed], components: [row] });
}

client.once("ready", async () => {
  await resetMatchmakingChannel();
});

// ----------------------------------------------------
// Create Match (host clicks in server)
// ----------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "create_match") return;

  const stats = await HostStats.findOne({ userId: interaction.user.id });

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("♻️ Reuse last stats?")
    .setDescription("Do you want to reuse your last stats?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  const msg = await interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
  autoDelete(msg);
});

// ----------------------------------------------------
// Reuse or New Stats
// ----------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "reuse_yes") {
    const old = await HostStats.findOne({ userId: interaction.user.id });
    openHostModal(interaction, true, old);
  }

  if (interaction.customId === "reuse_no") {
    openHostModal(interaction, false, null);
  }
});

// ----------------------------------------------------
// Host Modal
// ----------------------------------------------------
function openHostModal(interaction, autofill, data) {
  const modal = new ModalBuilder().setCustomId("host_form").setTitle("Create Match");

  const fields = [
    ["gameplay", "Level | Rank | Playstyle", data?.gameplay],
    ["ability", "Ability", data?.ability],
    ["region", "Region", data?.region],
    ["communication", "VC | Language", data?.communication],
    ["notes", "Notes", data?.notes]
  ];

  modal.addComponents(
    ...fields.map(([id, label, value]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(id !== "notes")
          .setValue(autofill && value ? value : "")
      )
    )
  );

  interaction.showModal(modal);
}

// ----------------------------------------------------
// Host Form Submit
// ----------------------------------------------------
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

  // Build public embed for find-players
  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Volley Legends Match Found")
    .setDescription(
      `👤 **Host:** <@${user.id}>\n\n` +
      `📌 **Stats:**\n` +
      `• Level: ${level}\n` +
      `• Rank: ${rank}\n` +
      `• Playstyle: ${playstyle}\n\n` +
      `📌 **Profile:**\n` +
      `• Ability: ${ability}\n` +
      `• Region: ${region}\n` +
      `• VC: ${vc}\n` +
      `• Language: ${language}\n\n` +
      `📝 Notes:\n${notes || "None"}`
    );

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const channel = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await channel.send({ content: `<@${user.id}>`, embeds: [embed], components: [btn] });

  const ep = await interaction.reply({ ephemeral: true, content: "Match created!" });
  autoDelete(ep);
});

// ----------------------------------------------------
// Player clicks Play Together
// ----------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.split("_")[1];
  const requester = interaction.user;

  const oldStats = await PlayerStats.findOne({ userId: requester.id });

  openPlayerModal(interaction, !!oldStats, oldStats, hostId);
});

// ----------------------------------------------------
// Player Modal
// ----------------------------------------------------
function openPlayerModal(interaction, autofill, data, hostId) {
  const modal = new ModalBuilder().setCustomId(`player_form_${hostId}`).setTitle("Your Stats");

  const fields = [
    ["p_gameplay", "Level | Rank | Playstyle", data?.gameplay],
    ["p_ability", "Ability", data?.ability],
    ["p_region", "Region", data?.region],
    ["p_communication", "VC | Language", data?.communication],
    ["p_notes", "Notes", data?.notes]
  ];

  modal.addComponents(
    ...fields.map(([id, label, value]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(id !== "p_notes")
          .setValue(autofill && value ? value : "")
      )
    )
  );

  interaction.showModal(modal);
}

// ----------------------------------------------------
// Player Form Submit → Send to Host DM
// ----------------------------------------------------
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

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  const host = await client.users.fetch(hostId);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🔔 New Play Request")
    .setDescription(
      `👤 Player: <@${requester.id}>\n\n` +
      `📌 Stats:\n` +
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
      .setCustomId(`accept_${requester.id}_${hostId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`decline_${requester.id}_${hostId}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
  );

  const dm = await host.send({ embeds: [embed], components: [row] });
  autoDelete(dm);

  const ep = await interaction.reply({ ephemeral: true, content: "Your request was sent!" });
  autoDelete(ep);
});

// ----------------------------------------------------
// Accept / Decline
// ----------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  const [action, playerId, hostId] = interaction.customId.split("_");

  if (action === "accept") {
    const guild = client.guilds.cache.first();

    let category = guild.channels.cache.find(c => c.name === "matchmaking-private" && c.type === 4);
    if (!category) {
      category = await guild.channels.create({
        name: "matchmaking-private",
        type: 4,
        position: 9999
      });
    }

    const host = await guild.members.fetch(hostId);
    const player = await guild.members.fetch(playerId);

    const matchChannel = await guild.channels.create({
      name: `your-match-${host.user.username}`,
      type: 0,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.id, deny: ["ViewChannel"] },
        { id: host.id, allow: ["ViewChannel", "SendMessages"] },
        { id: player.id, allow: ["ViewChannel", "SendMessages"] }
      ]
    });

    const msg = await matchChannel.send(`🎉 Match started!\n<@${hostId}> and <@${playerId}> can chat here.`);
    autoDelete(msg);

    setTimeout(() => {
      matchChannel.delete().catch(() => {});
    }, 5 * 60 * 1000);

    const dm = await (await client.users.fetch(playerId)).send("✅ Your request was accepted!");
    autoDelete(dm);

    const ep = await interaction.reply({ ephemeral: true, content: "Accepted!" });
    autoDelete(ep);
  }

  if (action === "decline") {
    const player = await client.users.fetch(playerId);

    const dm = await player.send("❌ Your request was declined.");
    autoDelete(dm);

    const ep = await interaction.reply({ ephemeral: true, content: "Declined." });
    autoDelete(ep);
  }
});

// ----------------------------------------------------
client.login(process.env.BOT_TOKEN);