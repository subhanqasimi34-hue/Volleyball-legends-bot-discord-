// ================================================================
// Volley Legends Matchmaking Bot – Optimized Edition (<600 lines)
// Includes: MongoDB, Cooldowns, Auto-Delete, Reuse, Elegant Formatting
// ================================================================

import {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

// ================================================================
// EXPRESS SERVER
// ================================================================
const app = express();
app.get("/", (_, res) => res.send("Volley Legends Bot running"));
app.listen(3000);

// ================================================================
// MONGO CONNECTION
// ================================================================
mongoose.connect(process.env.MONGO_URI, { dbName: "VolleyBot" });

// ================================================================
// SCHEMAS
// ================================================================
const HostStats = mongoose.model("HostStats", new mongoose.Schema({
  userId: { type: String, unique: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String
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

// ================================================================
// DISCORD CLIENT
// ================================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ================================================================
// AUTO DELETE DMs AFTER 1 MINUTE
// ================================================================
client.on("messageCreate", msg => {
  if (!msg.guild) setTimeout(() => msg.delete().catch(() => {}), 60000);
});

// ================================================================
// CHANNELS
// ================================================================
const MATCHMAKING = "1441139756007161906";
const FIND_PLAYERS = "1441140684622008441";

// ================================================================
// PARSERS
// ================================================================
const parseGameplay = txt => {
  const parts = txt.split("|").map(x => x.trim());
  const level = parts.find(x => /^\d{1,4}$/.test(x)) || "Unknown";
  const rank = parts.find(x => /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(x)) || "Unknown";
  const playstyle = parts.find(x => x !== level && x !== rank) || "Unknown";
  return { level, rank, playstyle };
};

const parseComm = txt => {
  const parts = txt.split("|").map(x => x.trim());
  const vc = parts.find(x => /(yes|no|vc)/i.test(x)) || "Unknown";
  const language = parts.find(x =>
    /(eng|english|de|german|fr|turkish|spanish|arabic)/i.test(x)
  ) || "Unknown";
  return { vc, language };
};

// ================================================================
// CHANNEL RESET
// ================================================================
async function resetMain() {
  const ch = client.channels.cache.get(MATCHMAKING);
  if (!ch) return;
  const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => {});
  if (msgs) await ch.bulkDelete(msgs).catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Click Create Match to find teammates.")
    .setColor("#22C55E");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Success)
  );

  await ch.send({ embeds: [embed], components: [row] });
}

client.once("ready", async () => {
  await resetMain();
});

// ================================================================
// COOLDOWNS
// ================================================================
const hostCD = async id => {
  const e = await HostCooldown.findOne({ userId: id });
  if (!e) return 0;
  const left = 5 * 60000 - (Date.now() - e.timestamp);
  return left > 0 ? Math.ceil(left / 60000) : 0;
};

const reqCD = async (p, h) => {
  const e = await Cooldowns.findOne({ userId: p, hostId: h });
  if (!e) return 0;
  const left = 5 * 60000 - (Date.now() - e.timestamp);
  return left > 0 ? Math.ceil(left / 60000) : 0;
};

// ================================================================
// BUTTON: CREATE MATCH
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton() || i.customId !== "create_match") return;

  const wait = await hostCD(i.user.id);
  if (wait)
    return i.reply({ content: `Wait ${wait} minute(s).`, ephemeral: true });

  await resetMain();

  const saved = await HostStats.findOne({ userId: i.user.id });
  if (!saved) return openForm(i);

  const ask = new EmbedBuilder()
    .setTitle("Reuse previous settings?")
    .setColor("#22C55E");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  return i.reply({ embeds: [ask], components: [row], ephemeral: true });
});

// ================================================================
// OPEN FORM
// ================================================================
function openForm(i, auto = false, data = {}) {
  const modal = new ModalBuilder()
    .setCustomId("match_form")
    .setTitle("Create Match");

  const f = (id, label, style, val) => {
    const t = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setRequired(id !== "notes");
    if (val) t.setValue(val);
    return new ActionRowBuilder().addComponents(t);
  };

  modal.addComponents(
    f("gameplay", "Level | Rank | Playstyle", TextInputStyle.Short, auto ? data.gameplay : ""),
    f("ability", "Ability", TextInputStyle.Short, auto ? data.ability : ""),
    f("region", "Region", TextInputStyle.Short, auto ? data.region : ""),
    f("communication", "VC | Language", TextInputStyle.Short, auto ? data.communication : ""),
    f("notes", "Notes", TextInputStyle.Paragraph, auto ? data.notes : "")
  );

  return i.showModal(modal);
}

// ================================================================
// REUSE BUTTONS
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (i.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: i.user.id });
    return openForm(i, true, stats);
  }
  if (i.customId === "reuse_no") return openForm(i);
});

// ================================================================
// FORM SUBMIT
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit() || i.customId !== "match_form") return;

  const u = i.user;

  const gameplay = i.fields.getTextInputValue("gameplay");
  const ability = i.fields.getTextInputValue("ability");
  const region = i.fields.getTextInputValue("region");
  const comm = i.fields.getTextInputValue("communication");
  const notes = i.fields.getTextInputValue("notes");

  const { level, rank, playstyle } = parseGameplay(gameplay);
  const { vc, language } = parseComm(comm);

  await HostStats.findOneAndUpdate(
    { userId: u.id },
    { gameplay, ability, region, communication: comm, notes },
    { upsert: true }
  );

  await RequestCounter.findOneAndUpdate(
    { hostId: u.id },
    { count: 0 },
    { upsert: true }
  );

  await HostCooldown.findOneAndUpdate(
    { userId: u.id },
    { timestamp: Date.now() },
    { upsert: true }
  );

  const clean = [
    `ʟᴇᴠᴇʟ: ${level}`,
    `ʀᴀɴᴋ: ${rank}`,
    `ᴘʟᴀʏsᴛʏʟᴇ: ${playstyle}`,
    `ᴀʙɪʟɪᴛʏ: ${ability}`,
    `ʀᴇɢɪᴏɴ: ${region}`,
    `ᴠᴄ: ${vc}`,
    `ʟᴀɴɢᴜᴀɢᴇ: ${language}`,
    `ɴᴏᴛᴇs: ${notes || "None"}`
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Volley Legends Match")
    .setDescription(`${u}\n\n${clean}`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${u.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const ch = client.channels.cache.get(FIND_PLAYERS);
  await ch.send({ embeds: [embed], components: [row] });

  return i.reply({ content: "Match created.", ephemeral: true });
});

// ================================================================
// PLAYER REQUEST
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton() || !i.customId.startsWith("request_")) return;

  const hostId = i.customId.replace("request_", "");
  const requester = i.user;

  const cd = await reqCD(requester.id, hostId);
  if (cd)
    return i.reply({ content: `Wait ${cd} minute(s).`, ephemeral: true });

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

  const original = i.message.embeds[0];

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("New Play Request")
    .setDescription(
      `Player: ${requester}\nTotal Requests: ${counter.count}\n\n${original.description}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${requester.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`send_${requester.id}`).setLabel("Send Server Link").setStyle(ButtonStyle.Primary)
  );

  const ch = client.channels.cache.get(MATCHMAKING);
  await ch.send({ content: `<@${hostId}>`, embeds: [embed], components: [row] });

  return i.reply({ content: "Request sent.", ephemeral: true });
});

// ================================================================
// ACCEPT / DECLINE
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  if (i.customId.startsWith("accept_")) {
    const id = i.customId.replace("accept_", "");
    const user = await client.users.fetch(id).catch(() => {});
    await user.send("Your request was accepted.").catch(() => {});
    return i.reply({ content: "Accepted.", ephemeral: true });
  }

  if (i.customId.startsWith("decline_")) {
    const id = i.customId.replace("decline_", "");
    const user = await client.users.fetch(id).catch(() => {});
    await user.send("Your request was declined.").catch(() => {});
    return i.reply({ content: "Declined.", ephemeral: true });
  }
});

// ================================================================
// SEND PRIVATE SERVER LINK
// ================================================================
client.on("interactionCreate", async i => {
  if (!i.isButton() || !i.customId.startsWith("send_")) return;

  const id = i.customId.replace("send_", "");
  const modal = new ModalBuilder()
    .setCustomId(`plink_${id}`)
    .setTitle("Send Private Server Link");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("link")
        .setLabel("Roblox Private Server")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );

  return i.showModal(modal);
});

client.on("interactionCreate", async i => {
  if (!i.isModalSubmit() || !i.customId.startsWith("plink_")) return;

  const id = i.customId.replace("plink_", "");
  const link = i.fields.getTextInputValue("link");
  const user = await client.users.fetch(id).catch(() => {});

  if (!link.startsWith("https://www.roblox.com/"))
    return i.reply({ content: "Invalid link.", ephemeral: true });

  await user.send(
    `${link}\n\nPlease send the Discord private server. It's ineeded!`
  ).catch(() => {});

  return i.reply({ content: "Sent.", ephemeral: true });
});

// ================================================================
client.login(process.env.BOT_TOKEN);
