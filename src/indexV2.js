// ================================================================
// indexV6.js – Volley Legends Matchmaking Bot (Optimierte Version)
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

// SERVER (Ping-Schutz für Hosting)
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot running"));
app.listen(3000, () => console.log("Express OK"));

// MONGODB
mongoose.connect(process.env.MONGO_URI, { dbName: "VolleyBot" })
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("MongoDB Error:", err));


// =====================
// DATABASE MODELS
// =====================

const HostStats = mongoose.model("HostStats", new mongoose.Schema({
  userId: { type: String, unique: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String,
  mode: String
}));

const RequestCounter = mongoose.model("RequestCounter", new mongoose.Schema({
  hostId: String,
  count: Number
}));

const HostCooldown = mongoose.model("HostCooldown", new mongoose.Schema({
  userId: String,
  timestamp: Number
}));

const Cooldowns = mongoose.model("Cooldowns", new mongoose.Schema({
  userId: String,
  hostId: String,
  timestamp: Number
}));


// =====================
// CLIENT INIT
// =====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// AUTO DELETE DMs
client.on("messageCreate", msg => {
  if (!msg.guild) {
    setTimeout(() => msg.delete().catch(() => {}), 60000);
  }
});

const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";


// =====================
// HELPERS
// =====================

const parseGameplay = text => {
  const p = text.split("|").map(s => s.trim());
  return { level: p[0] || "Unknown", rank: p[1] || "Unknown", playstyle: p[2] || "Unknown" };
};

const parseCommunication = text => {
  const p = text.split("|").map(s => s.trim());
  return { vc: p[0] || "Unknown", language: p[1] || "Unknown" };
};

const modeStyles = {
  "2v2": { color: "#22C55E", emoji: "🟢", button: ButtonStyle.Success },
  "3v3": { color: "#3B82F6", emoji: "🔵", button: ButtonStyle.Primary },
  "4v4": { color: "#8B5CF6", emoji: "🟣", button: ButtonStyle.Secondary }
};


// =====================
// RESET MATCHMAKING CHANNEL
// =====================

async function resetMatchmakingChannel() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return;

  const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => {});
  if (msgs) await channel.bulkDelete(msgs).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Volley Legends Matchmaking")
    .setDescription(
      "Click **Create Match** to get started.\n" +
      "We built this bot to keep you safe. Scam links are everywhere — our Security Link Checker protects you."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("create_match").setLabel("Create Match").setStyle(ButtonStyle.Success)
  );

  channel.send({ embeds: [embed], components: [row] });
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  resetMatchmakingChannel();
});


// =====================
// COOLDOWN CHECK
// =====================

async function checkHostCooldown(id) {
  const entry = await HostCooldown.findOne({ userId: id });
  if (!entry) return 0;

  const diff = Date.now() - entry.timestamp;
  if (diff >= 300000) return 0;

  return Math.ceil((300000 - diff) / 60000);
}


// =====================
// STEP 1: CREATE MATCH
// =====================

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (i.customId !== "create_match") return;

  const cd = await checkHostCooldown(i.user.id);
  if (cd > 0)
    return i.reply({ content: `Wait **${cd} minutes** before creating another match.`, ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Choose your Match Mode")
    .setDescription("Select which team size you want to host.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mode_2v2").setLabel("🟢 2v2").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mode_3v3").setLabel("🔵 3v3").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mode_4v4").setLabel("🟣 4v4").setStyle(ButtonStyle.Secondary)
  );

  i.reply({ embeds: [embed], components: [row], ephemeral: true });
});


// =====================
// STEP 2: ASK REUSE
// =====================

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("mode_")) return;

  const mode = i.customId.replace("mode_", "");
  const stats = await HostStats.findOne({ userId: i.user.id });

  if (!stats) {
    return openModal(i, false, null, mode);
  }

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Use previous settings?")
    .setDescription("Do you want to reuse your last match data?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`reuse_yes_${mode}`).setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reuse_no_${mode}`).setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  i.reply({ embeds: [embed], components: [row], ephemeral: true });
});


// =====================
// STEP 3: REUSE HANDLERS (FEHLTE BEI DIR)
// =====================

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  // YES
  if (i.customId.startsWith("reuse_yes_")) {
    const mode = i.customId.replace("reuse_yes_", "");
    const stats = await HostStats.findOne({ userId: i.user.id });
    return openModal(i, true, stats, mode);
  }

  // NO
  if (i.customId.startsWith("reuse_no_")) {
    const mode = i.customId.replace("reuse_no_", "");
    return openModal(i, false, null, mode);
  }
});


// =====================
// MODAL BUILDER
// =====================

function openModal(i, autofill, data, mode) {
  const modal = new ModalBuilder()
    .setCustomId(`match_form_${mode}`)
    .setTitle(`Create ${mode.toUpperCase()} Match`);

  const fields = [
    ["gameplay", "Level | Rank | Playstyle", true, TextInputStyle.Short],
    ["ability", "Ability", true, TextInputStyle.Short],
    ["region", "Region", true, TextInputStyle.Short],
    ["comm", "VC | Language", true, TextInputStyle.Short],
    ["notes", "Notes (optional)", false, TextInputStyle.Paragraph]
  ];

  modal.addComponents(
    ...fields.map(([id, label, required, style]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setRequired(required)
          .setStyle(style)
          .setValue(
            autofill && data
              ? (id === "comm" ? data.communication : data[id] || "")
              : ""
          )
      )
    )
  );

  return i.showModal(modal);
}


// =====================
// STEP 4: SUBMIT FORM
// =====================

client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (!i.customId.startsWith("match_form_")) return;

  const mode = i.customId.replace("match_form_", "");
  const style = modeStyles[mode] || modeStyles["2v2"];

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
    { gameplay, ability, region, communication: comm, notes, mode },
    { upsert: true }
  );

  await RequestCounter.findOneAndUpdate(
    { hostId: user.id },
    { count: 0 },
    { upsert: true }
  );

  await HostCooldown.findOneAndUpdate(
    { userId: user.id },
    { timestamp: Date.now() },
    { upsert: true }
  );

  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: `${user.username}`, iconURL: user.displayAvatarURL({ size: 256 }) })
    .setTitle(`${style.emoji} ${mode.toUpperCase()} Match`)
    .setDescription(
`╔════════ MATCH ════════╗
🏐 **Mode:** ${mode.toUpperCase()}
👤 **Host:** ${user}
╚════════════════════════╝

🎯 **Gameplay**
Level: ${gp.level}
Rank: ${gp.rank}
Playstyle: ${gp.playstyle}

💥 **Ability**
${ability}

🌍 **Region**
${region}

🎙 **Communication**
VC: ${cm.vc}
Language: ${cm.language}

📝 **Looking for**
${notes || "None"}` );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`req_${user.id}`).setLabel("Play Together").setStyle(style.button),
    new ButtonBuilder().setCustomId(`refresh_${user.id}`).setLabel("Refresh Match").setStyle(ButtonStyle.Secondary)
  );

  const ch = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);

  const msg = await ch.send({
    content: `${user}`,
    embeds: [embed],
    components: [buttons]
  });

  setTimeout(async () => {
    try {
      const expired = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("expired").setLabel("Expired").setStyle(ButtonStyle.Secondary).setDisabled(true)
      );

      await msg.edit({
        content: `${user} — Match expired`,
        components: [expired]
      });

      setTimeout(() => msg.delete().catch(() => {}), 20000);
    } catch {}
  }, 600000);

  i.reply({ content: "Match created!", ephemeral: true });
});


// =====================
// REFRESH
// =====================

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("refresh_")) return;

  const hostId = i.customId.replace("refresh_", "");
  if (i.user.id !== hostId)
    return i.reply({ content: "Only the match host can refresh this.", ephemeral: true });

  await i.message.delete().catch(() => {});
  i.reply({ content: "Refreshing match...", ephemeral: true });
});


// PLAYER REQUEST (komplett korrigiert)
client.on("interactionCreate", async i => {
  if (!i.isButton() || !i.customId.startsWith("req_")) return;

  const hostId = i.customId.replace("req_", "");
  const requester = i.user;

  // Cooldown Log
  await Cooldowns.findOneAndUpdate(
    { userId: requester.id, hostId },
    { timestamp: Date.now() },
    { upsert: true }
  );

  // Count hochzählen
  const counter = await RequestCounter.findOneAndUpdate(
    { hostId },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );

  const host = await client.users.fetch(hostId).catch(() => {});
  if (!host) return;

  const matchEmbed = i.message.embeds[0];

  // Embed für den Host
  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Send your Volleyball Legends private server link")
    .setDescription(
`**${requester} wants to join your match.**

Requests so far: **${counter.count}**

Please send your Volleyball Legends private server link.

Below is the information from your match:

${matchEmbed.description}`
    );

  // Button, der das Modal öffnet (✔ korrekt, KEIN setTitle!)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`link_${requester.id}`)
      .setLabel("Send your Volleyball Legends link")
      .setStyle(ButtonStyle.Primary)
  );

  // Host bekommt die DM
  await host.send({ embeds: [embed], components: [row] }).catch(() => {});

  // Spieler bekommt Bestätigung
  return i.reply({ content: "Request sent!", ephemeral: true });
});



// LINK MODAL (komplett korrigiert)
client.on("interactionCreate", async i => {
  if (!i.isButton() || !i.customId.startsWith("link_")) return;

  const requesterId = i.customId.replace("link_", "");

  // Modal erstellen (✔ Titel < 45 Zeichen)
  const modal = new ModalBuilder()
    .setCustomId(`sendlink_${requesterId}`)
    .setTitle("Volleyball Legends private server link")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Enter your Volleyball Legends link")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );

  return i.showModal(modal);
});



// =====================
// LINK SUBMIT
// =====================

client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (!i.customId.startsWith("sendlink_")) return;

  const id = i.customId.replace("sendlink_", "");
  const link = i.fields.getTextInputValue("link").trim();

  const shareRegex = /^https:\/\/www\.roblox\.com\/share\?code=[A-Za-z0-9]+&type=Server$/;
  const vipRegex = /^https:\/\/www\.roblox\.com\/games\/[0-9]+\/[^/?]+\?privateServerLinkCode=[A-Za-z0-9_-]+$/;

  if (!link.startsWith("https://www.roblox.com"))
    return i.reply({ content: "Roblox links only.", ephemeral: true });

  if (!shareRegex.test(link) && !vipRegex.test(link))
    return i.reply({ content: "Invalid private server link format.", ephemeral: true });

  const host = await client.users.fetch(id).catch(() => {});
  if (host) {
    host.send(`Host sent the privat link:\n${link}`).catch(() => {});
  }

  i.reply({ content: "The Privat Server link has been sent!", ephemeral: true });
});


// =====================
// LOGIN
// =====================

client.login(process.env.BOT_TOKEN);