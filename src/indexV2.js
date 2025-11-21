// ================================================================
// indexV6.js – Volley Legends Matchmaking Bot (Final Optimized Edition)
// Clean Unicode labels, DM requests, 1-minute DM auto-delete,
// Strong Roblox Share validation ONLY for Volley Legends.
// VIP-Server komplett entfernt.
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

// CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// AUTO DELETE DMs (1 min)
client.on("messageCreate", async msg => {
  if (!msg.guild) {
    setTimeout(() => msg.delete().catch(() => {}), 60000);
  }
});

// CHANNELS
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

// PARSER HELPERS
const parseGameplay = t => {
  const p = t.split("|").map(s => s.trim());
  return {
    level: p[0] || "Unknown",
    rank: p[1] || "Unknown",
    playstyle: p[2] || "Unknown"
  };
};

const parseCommunication = t => {
  const p = t.split("|").map(s => s.trim());
  return {
    vc: p[0] || "Unknown",
    language: p[1] || "Unknown"
  };
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
    .setDescription("Click **Create Match** to start.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Success)
  );

  await ch.send({ embeds: [embed], components: [row] });
}

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

// CREATE MATCH
client.on("interactionCreate", async i => {
  if (!i.isButton() || i.customId !== "create_match") return;

  const cd = await checkHostCooldown(i.user.id);
  if (cd > 0) {
    const m = await i.user.send(`You must wait **${cd} min** before creating again.`)
      .catch(() => {});
    if (m) setTimeout(() => m.delete().catch(() => {}), 60000);
    return i.reply({ content: "Cooldown active.", ephemeral: true });
  }

  const stats = await HostStats.findOne({ userId: i.user.id });
  if (!stats) return openModal(i, false, null);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Reuse previous settings?")
    .setDescription("Do you want to autofill from your last match?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  return i.reply({ embeds: [embed], components: [row], ephemeral: true });
});

// OPEN MODAL
function openModal(i, autofill, data) {
  const m = new ModalBuilder().setCustomId("match_form").setTitle("Create Match");

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
      const val = id === "comm" ? data.communication : data[id];
      if (val) ti.setValue(val);
    }
    return new ActionRowBuilder().addComponents(ti);
  });

  m.addComponents(...fields);
  return i.showModal(m);
}

// REUSE BUTTONS
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (i.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: i.user.id });
    return openModal(i, true, stats);
  }
  if (i.customId === "reuse_no") return openModal(i, false, null);
});

// SUBMIT MATCH FORM
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit() || i.customId !== "match_form") return;

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
    .setTitle("New Play Request")
    .setDescription(
`ᴘʟᴀʏᴇʀ: ${requester}
ʀᴇǫᴜᴇsᴛs: ${counter.count}

Please send the Discord private server. It's needed!

${matchEmbed.description}
`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${requester.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`link_${requester.id}`).setLabel("Send Private Server Link").setStyle(ButtonStyle.Primary)
  );

  await host.send({ embeds: [embed], components: [row] }).catch(() => {});

  return i.reply({ content: "Request sent!", ephemeral: true });
});

// ACCEPT / DECLINE
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  if (i.customId.startsWith("accept_")) {
    const id = i.customId.replace("accept_", "");
    const u = await client.users.fetch(id).catch(() => {});
    if (u) u.send("Your request was accepted.").catch(() => {});
    return i.reply({ content: "Accepted.", ephemeral: true });
  }

  if (i.customId.startsWith("decline_")) {
    const id = i.customId.replace("decline_", "");
    const u = await client.users.fetch(id).catch(() => {});
    if (u) u.send("Your request was declined.").catch(() => {});
    return i.reply({ content: "Declined.", ephemeral: true });
  }
});

// SEND LINK MODAL
client.on("interactionCreate", async i => {
  if (!i.isButton() || !i.customId.startsWith("link_")) return;

  const id = i.customId.replace("link_", "");

  const modal = new ModalBuilder()
    .setCustomId(`sendlink_${id}`)
    .setTitle("Private Server Link");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("link")
        .setLabel("Roblox Share Server Link")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  return i.showModal(modal);
});

// SUBMIT LINK (ONLY SHARE-LINKS + API VALIDATION)
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit() || !i.customId.startsWith("sendlink_")) return;

  const id = i.customId.replace("sendlink_", "");
  const link = i.fields.getTextInputValue("link");

  const GAME_ID = "17242062041";

  const shareRegex =
    /^https:\/\/www\.roblox\.com\/share\?code=[A-Za-z0-9]+&type=Server$/;

  if (!shareRegex.test(link)) {
    return i.reply({
      content:
        "❌ Invalid link.\n\n" +
        "**Only Roblox Share-Servers for Volley Legends are allowed.**\n\n" +
        "Example:\nhttps://www.roblox.com/share?code=XXXX&type=Server",
      ephemeral: true
    });
  }

  // Extract code
  const code = new URL(link).searchParams.get("code");

  try {
    const res = await fetch(`https://apis.roblox.com/share/v1/share/${code}`);
    const data = await res.json();

    // Check if share belongs to Volley Legends
    const placeId = data?.sharedPlaceId;

    if (!placeId || String(placeId) !== GAME_ID) {
      return i.reply({
        content:
          "❌ This Share-Link does not belong to Volley Legends.\n" +
          "Please send a correct Share-Server from the game.",
        ephemeral: true
      });
    }
  } catch (err) {
    return i.reply({
      content: "❌ Could not validate this link. Try again later.",
      ephemeral: true
    });
  }

  // Send link to requester
  const user = await client.users.fetch(id).catch(() => {});
  if (user) {
    await user.send(`Here is your Volley Legends private server:\n${link}`)
      .catch(() => {});
  }

  return i.reply({ content: "Share link sent!", ephemeral: true });
});

// LOGIN
client.login(process.env.BOT_TOKEN);
