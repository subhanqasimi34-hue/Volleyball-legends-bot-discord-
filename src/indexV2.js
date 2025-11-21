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
  ChannelType,
  PermissionFlagsBits
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

// ------------------------------------------------------
// EXPRESS KEEPALIVE
// ------------------------------------------------------
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
app.listen(3000);

// ------------------------------------------------------
// DATABASE CONNECTION
// ------------------------------------------------------
mongoose.connect(process.env.MONGO_URI, { dbName: "VolleyBot" });

// ------------------------------------------------------
// MONGO SCHEMAS
// ------------------------------------------------------
const statsSchema = {
  userId: { type: String, required: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String
};

const HostStats = mongoose.model("HostStats", new mongoose.Schema(statsSchema));
const PlayerStats = mongoose.model("PlayerStats", new mongoose.Schema(statsSchema));

const Cooldowns = mongoose.model("Cooldowns",
  new mongoose.Schema({ userId: String, hostId: String, timestamp: Number })
);

const HostCooldown = mongoose.model("HostCooldown",
  new mongoose.Schema({ userId: String, timestamp: Number })
);

const RequestCounter = mongoose.model("RequestCounter",
  new mongoose.Schema({ hostId: String, count: Number })
);

const ActiveMatch = mongoose.model("ActiveMatch",
  new mongoose.Schema({
    hostId: String,
    channelId: String,
    players: [String]
  })
);

// ------------------------------------------------------
// DISCORD CLIENT
// ------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// CONFIG
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";
const CATEGORY_NAME = "Matchmaking";

// ------------------------------------------------------
// HELPERS
// ------------------------------------------------------
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

  const v = p.find(x => /(vc|voice|yes|no)/i.test(x));
  if (v) vc = v;

  const l = p.find(x =>
    /(eng|english|german|de|turkish|spanish|arabic)/i.test(x)
  );
  if (l) language = l;

  return { vc, language };
}

function autoDelete(msg) {
  setTimeout(() => {
    if (!msg) return;
    msg.delete().catch(() => {});
  }, 5 * 60 * 1000);
}

// ------------------------------------------------------
// RESET MATCHMAKING CHANNEL
// ------------------------------------------------------
async function resetMatchmakingChannel() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return;

  const old = await channel.messages.fetch({ limit: 100 }).catch(() => {});
  if (old) channel.bulkDelete(old).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Volley Legends Matchmaking")
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
  console.log("Bot ready.");
  await resetMatchmakingChannel();
});

// ------------------------------------------------------
// HOST COOLDOWN
// ------------------------------------------------------
async function checkHostCooldown(id) {
  const entry = await HostCooldown.findOne({ userId: id });
  if (!entry) return 0;

  const diff = Date.now() - entry.timestamp;
  if (diff >= 5 * 60 * 1000) return 0;

  return Math.ceil((5 * 60 * 1000 - diff) / 60000);
}

// ------------------------------------------------------
// CREATE MATCH BUTTON
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "create_match") return;

  const cd = await checkHostCooldown(interaction.user.id);
  if (cd > 0) {
    return interaction.reply({
      ephemeral: true,
      content: `❌ Wait **${cd} min** before creating another match.`
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

  await interaction.reply({
    ephemeral: true,
    embeds: [reuseEmbed],
    components: [row]
  });
});

// ------------------------------------------------------
// REUSE STATS YES/NO
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: interaction.user.id });
    openHostModal(interaction, true, stats);
  }

  if (interaction.customId === "reuse_no") {
    openHostModal(interaction, false, null);
  }
});

// ------------------------------------------------------
// HOST FORM MODAL
// ------------------------------------------------------
function openHostModal(interaction, autofill, data) {
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
          .setValue(autofill && val ? val : "")
          .setRequired(id !== "notes")
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      )
    )
  );

  interaction.showModal(modal);
}

// ------------------------------------------------------
// HOST SUBMITS FORM
// ------------------------------------------------------
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

  await HostCooldown.findOneAndUpdate(
    { userId: user.id },
    { timestamp: Date.now() },
    { upsert: true }
  );

  await RequestCounter.findOneAndUpdate(
    { hostId: user.id },
    { count: 0 },
    { upsert: true }
  );

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("🏐 Volley Legends Match Found")
    .setDescription(
      `👤 **Host:** <@${user.id}>\n\n` +
      `• Level: ${level}\n` +
      `• Rank: ${rank}\n` +
      `• Playstyle: ${playstyle}\n` +
      `• Ability: ${ability}\n` +
      `• Region: ${region}\n` +
      `• VC: ${vc}\n` +
      `• Language: ${language}\n` +
      `• Notes: ${notes || "None"}`
    );

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const fp = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await fp.send({ content: `<@${user.id}>`, embeds: [embed], components: [btn] });

  await interaction.reply({
    ephemeral: true,
    content: "Match created!"
  });
});

// ------------------------------------------------------
// PLAYER CLICKS PLAY TOGETHER
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.split("_")[1];
  const requester = interaction.user;

  const cd = await Cooldowns.findOne({ userId: requester.id, hostId });
  if (cd && Date.now() - cd.timestamp < 5 * 60 * 1000) {
    return interaction.reply({
      ephemeral: true,
      content: `❌ Wait before sending another request.`
    });
  }

  const oldStats = await PlayerStats.findOne({ userId: requester.id });
  openPlayerModal(interaction, !!oldStats, oldStats, hostId);
});

// ------------------------------------------------------
// PLAYER MODAL
// ------------------------------------------------------
function openPlayerModal(interaction, autofill, data, hostId) {
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
          .setValue(autofill && val ? val : "")
          .setRequired(id !== "p_notes")
          .setStyle(label === "Notes" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      )
    )
  );

  interaction.showModal(modal);
}

// ------------------------------------------------------
// PLAYER SUBMITS MODAL (NEUE VERSION MIT EPHEMERAL BUTTONS)
// ------------------------------------------------------
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

  const counter = await RequestCounter.findOneAndUpdate(
    { hostId },
    { $inc: { count: 1 } },
    { new: true, upsert: true }
  );

  const host = await client.users.fetch(hostId);

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  // DM without buttons
  try {
    await host.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#22C55E")
          .setTitle("New Play Request")
          .setDescription(
            `Player: <@${requester.id}>\n` +
            `Level: ${level}\nRank: ${rank}\nPlaystyle: ${playstyle}\n` +
            `Ability: ${ability}\nRegion: ${region}\nVC: ${vc}\nLanguage: ${language}\n` +
            `Notes: ${notes || "None"}`
          )
      ]
    });
  } catch {}

  // ephemeral buttons
  await interaction.reply({
    ephemeral: true,
    embeds: [
      new EmbedBuilder()
        .setColor("#22C55E")
        .setTitle("New Request")
        .setDescription(`Player <@${requester.id}> sent you a request.`)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`accept_${requester.id}_${hostId}`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`decline_${requester.id}_${hostId}`)
          .setLabel("Decline")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`sendlink_${requester.id}_${hostId}`)
          .setLabel("Send Link")
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

// ------------------------------------------------------
// ACCEPT / DECLINE / CHANNEL CREATION
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  const [type, playerId, hostId] = interaction.customId.split("_");

  if (type !== "accept" && type !== "decline") return;

  if (interaction.user.id !== hostId) {
    return interaction.reply({
      ephemeral: true,
      content: "Only the host can use this."
    });
  }

  const guild = interaction.guild;
  const player = await client.users.fetch(playerId);

  if (type === "decline") {
    try {
      await player.send("Your request was declined.");
    } catch {}
    return interaction.reply({ ephemeral: true, content: "Declined." });
  }

  // ACCEPT
  let category = guild.channels.cache.find(
    c => c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory
  );

  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory
    });
  }

  const channel = await guild.channels.create({
    name: `matchmaking-${interaction.user.username}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: hostId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: playerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
    ]
  });

  try {
    await player.send("Your request was accepted! Check the match channel.");
  } catch {}

  await channel.send(`Player <@${playerId}> joined the match!`);

  return interaction.reply({
    ephemeral: true,
    content: "Player added."
  });
});

// ------------------------------------------------------
// SEND SERVER LINK
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sendlink_")) return;

  const playerId = interaction.customId.split("_")[1];

  const modal = new ModalBuilder()
    .setCustomId(`privatelink_${playerId}`)
    .setTitle("Send Private Server Link");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("link")
        .setLabel("Roblox Link")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );

  interaction.showModal(modal);
});

// ------------------------------------------------------
// VALIDATE SERVER LINK
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("privatelink_")) return;

  const playerId = interaction.customId.split("_")[1];
  const link = interaction.fields.getTextInputValue("link");

  if (!link.startsWith("https://www.roblox.com/")) {
    return interaction.reply({
      ephemeral: true,
      content: "Invalid link."
    });
  }

  const player = await client.users.fetch(playerId);
  await player.send(`Private Server Link:\n${link}`);

  return interaction.reply({
    ephemeral: true,
    content: "Link sent!"
  });
});

// ------------------------------------------------------
// FINISH MATCH
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("finishmatch_")) return;

  const hostId = interaction.customId.split("_")[1];

  if (interaction.user.id !== hostId) {
    return interaction.reply({
      ephemeral: true,
      content: "Only the host can finish the match."
    });
  }

  const channel = interaction.channel;

  for (const [, member] of channel.members) {
    if (!member.user.bot) {
      try {
        await member.send("The match has ended.");
      } catch {}
    }
  }

  await interaction.reply({ ephemeral: true, content: "Closing match..." });

  setTimeout(() => {
    channel.delete().catch(() => {});
  }, 2000);
});

// ------------------------------------------------------
// BOT LOGIN
// ------------------------------------------------------
client.login(process.env.BOT_TOKEN);
