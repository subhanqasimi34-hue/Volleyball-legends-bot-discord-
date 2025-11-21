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
  TextInputStyle,
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
app.listen(3000, () => console.log("Express OK"));

mongoose
  .connect(process.env.MONGO_URI, { dbName: "VolleyBot" })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("MongoDB Error:", err));

const statsSchema = {
  userId: { type: String, required: true, unique: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String,
};

const HostStats = mongoose.model("HostStats", new mongoose.Schema(statsSchema));
const PlayerStats = mongoose.model("PlayerStats", new mongoose.Schema(statsSchema));

const Cooldowns = mongoose.model(
  "Cooldowns",
  new mongoose.Schema({ userId: String, hostId: String, timestamp: Number })
);

const HostCooldown = mongoose.model(
  "HostCooldown",
  new mongoose.Schema({ userId: String, timestamp: Number })
);

const RequestCounter = mongoose.model(
  "RequestCounter",
  new mongoose.Schema({ hostId: String, count: Number })
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

function parseLevelRankPlaystyle(text) {
  const parts = text.split("|").map((p) => p.trim());
  let level = "Unknown",
    rank = "Unknown",
    playstyle = "Unknown";

  const lvl = parts.find((p) => /^\d{1,4}$/i.test(p));
  if (lvl) level = lvl;

  const rk = parts.find((p) =>
    /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(p)
  );
  if (rk) rank = rk;

  const ps = parts.find((p) => p !== lvl && p !== rk);
  if (ps) playstyle = ps;

  return { level, rank, playstyle };
}

function parseCommunication(text) {
  const parts = text.split("|").map((p) => p.trim());
  let vc = "Unknown",
    language = "Unknown";

  const vcPart = parts.find((p) => /(yes|no|vc|voice)/i.test(p));
  if (vcPart) vc = vcPart;

  const lang = parts.find((p) =>
    /(eng|english|german|de|fr|turkish|spanish|arabic)/i.test(p)
  );
  if (lang) language = lang;

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

  const old = await channel.messages.fetch({ limit: 100 }).catch(() => {});
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
  console.log(`Logged in as ${client.user.tag}`);
  await resetMatchmakingChannel();
});

async function checkHostCooldown(userId) {
  const entry = await HostCooldown.findOne({ userId });
  if (!entry) return 0;

  const diff = Date.now() - entry.timestamp;
  return diff >= 5 * 60 * 1000 ? 0 : Math.ceil((5 * 60 * 1000 - diff) / 60000);
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "create_match") return;

  const cd = await checkHostCooldown(interaction.user.id);
  if (cd > 0) {
    return interaction.reply({
      ephemeral: true,
      content: `❌ You must wait **${cd} minute(s)** before creating another match.`,
    });
  }

  const reuseEmbed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("♻️ Reuse last stats?")
    .setDescription("Do you want to reuse your last stats?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("reuse_yes").setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reuse_no").setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  const msg = await interaction.reply({
    ephemeral: true,
    embeds: [reuseEmbed],
    components: [row],
  });

  autoDelete(msg);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: interaction.user.id });
    openHostModal(interaction, true, stats);
  }

  if (interaction.customId === "reuse_no") {
    openHostModal(interaction, false, null);
  }
});

function openHostModal(interaction, autofill, data) {
  const modal = new ModalBuilder().setCustomId("host_form").setTitle("Create Match");

  const fields = [
    ["gameplay", "Level | Rank | Playstyle", data?.gameplay],
    ["ability", "Ability", data?.ability],
    ["region", "Region", data?.region],
    ["communication", "VC | Language", data?.communication],
    ["notes", "Notes", data?.notes],
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

client.on("interactionCreate", async (interaction) => {
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

  await HostCooldown.findOneAndUpdate(
    { userId: user.id },
    { timestamp: Date.now() },
    { upsert: true }
  );

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Volley Legends Match Found")
    .setDescription(
      `👤 **Host:** <@${user.id}>\n\n` +
        `📌 **Stats:**\n` +
        `• 📊 Level: ${level}\n` +
        `• 🏅 Rank: ${rank}\n` +
        `• 🎮 Playstyle: ${playstyle}\n\n` +
        `📌 **Profile:**\n` +
        `• ⚡ Ability: ${ability}\n` +
        `• 🌍 Region: ${region}\n` +
        `• 🎤 VC: ${vc}\n` +
        `• 🗣️ Language: ${language}\n\n` +
        `📝 **Notes:**\n${notes || "None"}`
    );

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`request_${user.id}`).setLabel("Play Together").setStyle(ButtonStyle.Success)
  );

  const channel = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await channel.send({ content: `<@${user.id}>`, embeds: [embed], components: [btn] });

  const ep = await interaction.reply({ ephemeral: true, content: "Match created!" });
  autoDelete(ep);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.split("_")[1];
  const requester = interaction.user;

  const cd = await Cooldowns.findOne({ userId: requester.id, hostId });
  if (cd && Date.now() - cd.timestamp < 5 * 60 * 1000) {
    const min = Math.ceil((5 * 60 * 1000 - (Date.now() - cd.timestamp)) / 60000);

    const msg = await interaction.reply({
      ephemeral: true,
      content: `❌ You must wait **${min} minute(s)** before sending another request.`,
    });
    autoDelete(msg);
    return;
  }

  const oldStats = await PlayerStats.findOne({ userId: requester.id });
  openPlayerModal(interaction, !!oldStats, oldStats, hostId);
});

function openPlayerModal(interaction, autofill, data, hostId) {
  const modal = new ModalBuilder().setCustomId(`player_form_${hostId}`).setTitle("Your Stats");

  const fields = [
    ["p_gameplay", "Level | Rank | Playstyle", data?.gameplay],
    ["p_ability", "Ability", data?.ability],
    ["p_region", "Region", data?.region],
    ["p_communication", "VC | Language", data?.communication],
    ["p_notes", "Notes", data?.notes],
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

client.on("interactionCreate", async (interaction) => {
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
        `📨 **Total Requests:** ${requestCount}\n\n` +
        `📌 **Player Stats:**\n` +
        `• 📊 Level: ${level}\n` +
        `• 🏅 Rank: ${rank}\n` +
        `• 🎮 Playstyle: ${playstyle}\n` +
        `• ⚡ Ability: ${ability}\n` +
        `• 🌍 Region: ${region}\n` +
        `• 🎤 VC: ${vc}\n` +
        `• 🗣️ Language: ${language}\n` +
        `• 📝 Notes: ${notes || "None"}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${requester.id}_${hostId}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}_${hostId}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sendlink_${requester.id}_${hostId}`).setLabel("Send Server Link").setStyle(ButtonStyle.Primary)
  );

  const dm = await host.send({ embeds: [embed], components: [row] });
  autoDelete(dm);

  const ep = await interaction.reply({ ephemeral: true, content: "Your request was sent!" });
  autoDelete(ep);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const parts = interaction.customId.split("_");
  const type = parts[0];

  if (type === "accept") {
    const requesterId = parts[1];
    const user = await client.users.fetch(requesterId);

    const dm = await user.send("✅ Your request was accepted!");
    autoDelete(dm);

    const ep = await interaction.reply({ ephemeral: true, content: "Accepted!" });
    autoDelete(ep);
  }

  if (type === "decline") {
    const requesterId = parts[1];
    const user = await client.users.fetch(requesterId);

    const dm = await user.send("❌ Your request got declined.");
    autoDelete(dm);

    const ep = await interaction.reply({ ephemeral: true, content: "Declined!" });
    autoDelete(ep);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sendlink_")) return;

  const requesterId = interaction.customId.split("_")[1];

  const modal = new ModalBuilder().setCustomId(`privatelink_${requesterId}`).setTitle("Send Private Server Link");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("link")
        .setLabel("Roblox Private Link")
        .setPlaceholder("https://www.roblox.com/…")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    )
  );

  interaction.showModal(modal);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("privatelink_")) return;

  const requesterId = interaction.customId.split("_")[1];
  const user = await client.users.fetch(requesterId);
  const link = interaction.fields.getTextInputValue("link");

  if (!link.startsWith("https://www.roblox.com/")) {
    const ep = await interaction.reply({
      ephemeral: true,
      content: "❌ Invalid link. Must start with https://www.roblox.com/",
    });
    autoDelete(ep);
    return;
  }

  const dm = await user.send(`🔗 The Host sent you a private link:\n${link}`);
  autoDelete(dm);

  const ep = await interaction.reply({ ephemeral: true, content: "Link sent!" });
  autoDelete(ep);
});

client.login(process.env.BOT_TOKEN);