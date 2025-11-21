// ================================================================
// indexV6.js – Volley Legends Matchmaking Bot with Mode Selection
// Added 2v2 / 3v3 / 4v4 mode choice before match form.
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

// SERVER
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot running"));
app.listen(3000, () => console.log("Express OK"));

// MONGO
mongoose.connect(process.env.MONGO_URI, { dbName: "VolleyBot" })
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("MongoDB Error:", err));

// SCHEMAS
const HostStats = mongoose.model("HostStats", new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String,
  mode: String
}));

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

// CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// AUTO DELETE DMs
client.on("messageCreate", async msg => {
  if (!msg.guild) setTimeout(() => msg.delete().catch(() => {}), 60000);
});

const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

// PARSERS
const parseGameplay = t => {
  const p = t.split("|").map(s => s.trim());
  return { level: p[0] || "Unknown", rank: p[1] || "Unknown", playstyle: p[2] || "Unknown" };
};

const parseCommunication = t => {
  const p = t.split("|").map(s => s.trim());
  return { vc: p[0] || "Unknown", language: p[1] || "Unknown" };
};

// RESET CHANNEL
async function resetMatchmakingChannel() {
  const ch = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!ch) return;

  const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => {});
  if (msgs) await ch.bulkDelete(msgs).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Click **Create Match** to start we made the bot only for you and your saftey | many scams links etc. we did add a Security Link proofer!");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Please click here do Creat a match")
      .setStyle(ButtonStyle.Success)
  );

  await ch.send({ embeds: [embed], components: [row] });
}

// READY
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  resetMatchmakingChannel();
});

// HOST COOLDOWN
async function checkHostCooldown(id) {
  const e = await HostCooldown.findOne({ userId: id });
  if (!e) return 0;
  const diff = Date.now() - e.timestamp;
  if (diff >= 300000) return 0;
  return Math.ceil((300000 - diff) / 60000);
}

// STEP 1 — PICK MODE
client.on("interactionCreate", async i => {
  if (!i.isButton() || i.customId !== "create_match") return;

  const cd = await checkHostCooldown(i.user.id);
  if (cd > 0) return i.reply({ content: `Wait **${cd} min**.`, ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Select which Match Mode you want Play!")
    .setDescription("Choose your team size.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mode_2v2").setLabel("2vs2").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mode_3v3").setLabel("3vs3").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mode_4v4").setLabel("4vs4").setStyle(ButtonStyle.Primary)
  );

  return i.reply({ embeds: [embed], components: [row], ephemeral: true });
});

// STEP 2 — CHECK REUSE
client.on("interactionCreate", async i => {
  if (!i.isButton() || !i.customId.startsWith("mode_")) return;

  const mode = i.customId.replace("mode_", "");
  const stats = await HostStats.findOne({ userId: i.user.id });

  if (!stats) return openModal(i, false, null, mode);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Last Layouth?")
    .setDescription("Do you want to autofill your last match settings?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`reuse_yes_${mode}`).setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reuse_no_${mode}`).setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  return i.reply({ embeds: [embed], components: [row], ephemeral: true });
});

// STEP 3 — OPEN FORM
function openModal(i, autofill, data, mode) {
  const m = new ModalBuilder().setCustomId(`match_form_${mode}`).setTitle(`Create ${mode.toUpperCase()} Match`);

  const fields = [
    ["gameplay", "Level | Rank | Playstyle", true, TextInputStyle.Short],
    ["ability", "Ability", true, TextInputStyle.Short],
    ["region", "Region", true, TextInputStyle.Short],
    ["comm", "VC | Language", true, TextInputStyle.Short],
    ["notes", "Notes", false, TextInputStyle.Paragraph]
  ].map(([id, label, req, style]) => {
    const ti = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setRequired(req)
      .setStyle(style);

    if (autofill && data) {
      const v = id === "comm" ? data.communication : data[id];
      if (v) ti.setValue(v);
    }

    return new ActionRowBuilder().addComponents(ti);
  });

  m.addComponents(...fields);
  return i.showModal(m);
}

// STEP 4 — SUBMIT FORM
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit() || !i.customId.startsWith("match_form_")) return;

  const mode = i.customId.replace("match_form_", "");
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

  await RequestCounter.findOneAndUpdate({ hostId: user.id }, { count: 0 }, { upsert: true });
  await HostCooldown.findOneAndUpdate({ userId: user.id }, { timestamp: Date.now() }, { upsert: true });

  // MODE COLORS
  const modeColors = {
    "2v2": "#22C55E",
    "3v3": "#3B82F6",
    "4v4": "#8B5CF6"
  };

  // MATCH EMBED
  const embed = new EmbedBuilder()
    .setColor(modeColors[mode] || "#22C55E")
    .setAuthor({
      name: `${user.username}'s Match`,
      iconURL: user.displayAvatarURL({ size: 256 })
    })
    .setTitle(`${mode.toUpperCase()} Match Created`)
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

**Looking for?**
${notes || "None"}`);


  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`req_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const ch = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  const msg = await ch.send({
    content: `${user}`,
    embeds: [embed],
    components: [btn]
  });

  // AUTO-EXPIRE BUTTON AFTER 10 MINUTES
  setTimeout(async () => {
    try {
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`req_${user.id}`)
          .setLabel("Expired")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await msg.edit({
        components: [disabledRow],
        content: `${user} — Match expired`
      });
    } catch {}
  }, 600000);

  return i.reply({ content: "Match created!", ephemeral: true });
});

// PLAYER REQUEST
client.on("interactionCreate", async i => {
  if (!i.isButton() || !i.customId.startsWith("req_")) return;

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

  const host = await client.users.fetch(hostId).catch(() => {});
  if (!host) return;

  const matchEmbed = i.message.embeds[0];

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("New Play Request is here")
    .setDescription(
`Player: ${requester}
Requests: ${counter.count}

Please enter the Volleyball Legends Privat Server link!

${matchEmbed.description}`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`link_${requester.id}`)
      .setLabel("Send Private Server Link")
      .setStyle(ButtonStyle.Primary)
  );

  await host.send({ embeds: [embed], components: [row] }).catch(() => {});
  return i.reply({ content: "Request sent!", ephemeral: true });
});

// SEND LINK MODAL
client.on("interactionCreate", async i => {
  if (!i.isButton() || !i.customId.startsWith("link_")) return;

  const id = i.customId.replace("link_", "");

  const modal = new ModalBuilder()
    .setCustomId(`sendlink_${id}`)
    .setTitle("Private Server Link")
    .addComponents(
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

// SEND LINK SUBMISSION
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit() || !i.customId.startsWith("sendlink_")) return;

  const id = i.customId.replace("sendlink_", "");
  const link = i.fields.getTextInputValue("link");

  const shareRegex = /^https:\/\/www\.roblox\.com\/share\?code=[A-Za-z0-9]+&type=Server$/;
  const vipRegex = /^https:\/\/www\.roblox\.com\/games\/[0-9]+\/[^/?]+\?privateServerLinkCode=[A-Za-z0-9_-]+$/;

  if (!link.startsWith("https://www.roblox.com"))
    return i.reply({ content: "Roblox links only.", ephemeral: true });

  if (!shareRegex.test(link) && !vipRegex.test(link))
    return i.reply({ content: "Invalid private server link format.", ephemeral: true });

  const user = await client.users.fetch(id).catch(() => {});
  if (user) user.send(`The host did sent the Volleyball Legends Privat Link!:\n${link}`).catch(() => {});

  return i.reply({ content: "Private server link sent!", ephemeral: true });
});

// LOGIN
client.login(process.env.BOT_TOKEN);
