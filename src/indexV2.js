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

const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
app.listen(3000);

mongoose.connect(process.env.MONGO_URI, { dbName: "VolleyBot" });

const statsSchema = {
  userId: { type: String, required: true, unique: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String
};

const HostStats = mongoose.model("HostStats", new mongoose.Schema(statsSchema));
const PlayerStats = mongoose.model("PlayerStats", new mongoose.Schema(statsSchema));
const Cooldowns = mongoose.model("Cooldowns", new mongoose.Schema({ userId: String, hostId: String, timestamp: Number }));
const HostCooldown = mongoose.model("HostCooldown", new mongoose.Schema({ userId: String, timestamp: Number }));
const RequestCounter = mongoose.model("RequestCounter", new mongoose.Schema({ hostId: String, count: Number }));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";
const CATEGORY_NAME = "Matchmaking";

function parseLevelRankPlaystyle(text) {
  const p = text.split("|").map(t => t.trim());
  let level = "Unknown", rank = "Unknown", playstyle = "Unknown";
  const lvl = p.find(x => /^\d{1,4}$/i.test(x));
  if (lvl) level = lvl;
  const rk = p.find(x => /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(x));
  if (rk) rank = rk;
  const ps = p.find(x => x !== lvl && x !== rk);
  if (ps) playstyle = ps;
  return { level, rank, playstyle };
}

function parseCommunication(text) {
  const p = text.split("|").map(t => t.trim());
  let vc = "Unknown", language = "Unknown";
  const v = p.find(x => /(yes|no|vc|voice)/i.test(x));
  if (v) vc = v;
  const l = p.find(x => /(eng|de|german|english|turkish|spanish|arabic)/i.test(x));
  if (l) language = l;
  return { vc, language };
}

function autoDelete(message) {
  setTimeout(() => {
    message.delete().catch(() => {});
  }, 5 * 60 * 1000);
}

async function resetMatchmakingChannel() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return;
  const old = await channel.messages.fetch({ limit: 100 });
  if (old) channel.bulkDelete(old).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 𝙑𝙤𝙡𝙡𝙚𝙮 𝙇𝙚𝙜𝙚𝙣𝙙𝙨 𝗠𝗮𝘁𝗰𝗵𝗺𝗮𝗸𝗶𝗻𝗴")
    .setDescription("Find teammates instantly.\nPress **Create Match** to begin.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("create_match").setLabel("Create Match").setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

client.once("ready", async () => {
  await resetMatchmakingChannel();
});

async function checkHostCooldown(id) {
  const e = await HostCooldown.findOne({ userId: id });
  if (!e) return 0;
  const d = Date.now() - e.timestamp;
  return d >= 5 * 60 * 1000 ? 0 : Math.ceil((5 * 60 * 1000 - d) / 60000);
}

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (i.customId !== "create_match") return;

  const cd = await checkHostCooldown(i.user.id);
  if (cd > 0) {
    const msg = await i.reply({ ephemeral: true, content: `❌ Wait **${cd} min** before creating another match.` });
    autoDelete(msg);
    return;
  }

  const reuseEmbed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("♻️ Reuse last stats?")
    .setDescription("Do you want to reuse your last stats?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  const msg = await i.reply({ ephemeral: true, embeds: [reuseEmbed], components: [row] });
  autoDelete(msg);
});

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  if (i.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: i.user.id });
    openHostModal(i, true, stats);
  }

  if (i.customId === "reuse_no") {
    openHostModal(i, false, null);
  }
});

function openHostModal(i, autofill, data) {
  const modal = new ModalBuilder().setCustomId("host_form").setTitle("Create Match");
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
          .setValue(autofill && val ? val : "")
          .setRequired(id !== "notes")
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      )
    )
  );

  i.showModal(modal);
}

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

  await HostCooldown.findOneAndUpdate({ userId: user.id }, { timestamp: Date.now() }, { upsert: true });
  await RequestCounter.findOneAndUpdate({ hostId: user.id }, { count: 0 }, { upsert: true });

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
      `📝 ${notes || "None"}`
    );

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const fp = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await fp.send({ content: `<@${user.id}>`, embeds: [embed], components: [btn] });

  const ep = await i.reply({ ephemeral: true, content: "Match created!" });
  autoDelete(ep);
});

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("request_")) return;

  const hostId = i.customId.split("_")[1];
  const requester = i.user;

  const cd = await Cooldowns.findOne({ userId: requester.id, hostId });
  if (cd && Date.now() - cd.timestamp < 5 * 60 * 1000) {
    const min = Math.ceil((5 * 60 * 1000 - (Date.now() - cd.timestamp)) / 60000);
    const msg = await i.reply({ ephemeral: true, content: `❌ Wait **${min} min** before sending again.` });
    autoDelete(msg);
    return;
  }

  const oldStats = await PlayerStats.findOne({ userId: requester.id });
  openPlayerModal(i, !!oldStats, oldStats, hostId);
});

function openPlayerModal(i, autofill, data, hostId) {
  const modal = new ModalBuilder().setCustomId(`player_form_${hostId}`).setTitle("Your Stats");

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
          .setValue(autofill && val ? val : "")
          .setRequired(id !== "p_notes")
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      )
    )
  );

  i.showModal(modal);
}

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
  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  const host = await client.users.fetch(hostId);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🔔 New Play Request")
    .setDescription(
      `👤 **Player:** <@${requester.id}>\n` +
      `📨 Total Requests: ${requestCount}\n\n` +
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
    new ButtonBuilder().setCustomId(`accept_${requester.id}_${hostId}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}_${hostId}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sendlink_${requester.id}_${hostId}`).setLabel("Send Server Link").setStyle(ButtonStyle.Primary)
  );

  const dm = await host.send({ embeds: [embed], components: [row] });
  autoDelete(dm);

  const ep = await i.reply({ ephemeral: true, content: "Your request was sent!" });
  autoDelete(ep);
});

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  const [type, userId, hostId] = i.customId.split("_");

  if (type === "accept") {
    const requester = await client.users.fetch(userId);
    const guild = i.guild;

    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === 4);
    if (!category) {
      category = await guild.channels.create({ name: CATEGORY_NAME, type: 4 });
    }

    const channel = await guild.channels.create({
      name: `matchmaking-${i.user.username}`,
      type: 0,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.id, deny: ["ViewChannel"] },
        { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
        { id: requester.id, allow: ["ViewChannel", "SendMessages"] }
      ]
    });

    const msg = await requester.send("✅ Your request was accepted! A private match channel was created.");
    autoDelete(msg);

    const reply = await i.reply({ ephemeral: true, content: "Match accepted. Private channel created." });
    autoDelete(reply);

    setTimeout(() => {
      channel.delete().catch(() => {});
    }, 5 * 60 * 1000);
  }

  if (type === "decline") {
    const requester = await client.users.fetch(userId);
    const dm = await requester.send("❌ Your request was declined.");
    autoDelete(dm);
    const ep = await i.reply({ ephemeral: true, content: "Declined." });
    autoDelete(ep);
  }
});

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("sendlink_")) return;

  const requesterId = i.customId.split("_")[1];

  const modal = new ModalBuilder()
    .setCustomId(`privatelink_${requesterId}`)
    .setTitle("Send Private Server Link")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Roblox Private Link")
          .setPlaceholder("https://www.roblox.com/…")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );

  i.showModal(modal);
});

client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (!i.customId.startsWith("privatelink_")) return;

  const requesterId = i.customId.split("_")[1];
  const user = await client.users.fetch(requesterId);
  const link = i.fields.getTextInputValue("link");

  if (!link.startsWith("https://www.roblox.com/")) {
    const ep = await i.reply({ ephemeral: true, content: "❌ Invalid link. Must start with https://www.roblox.com/" });
    autoDelete(ep);
    return;
  }

  const dm = await user.send(`🔗 Private Server Link:\n${link}`);
  autoDelete(dm);

  const ep = await i.reply({ ephemeral: true, content: "Link sent!" });
  autoDelete(ep);
});

client.login(process.env.BOT_TOKEN);