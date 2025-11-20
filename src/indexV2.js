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

import express from "express";

// Express server (for Cloudflare Tunnel)
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot running"));
app.listen(3000, () => console.log("Express OK"));

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// Channels
const MATCHMAKING_CHANNEL_ID = "1441139756007161906"; // Create Match + Requests

// Auto parsing helpers
function parseLevelRankPlaystyle(text) {
  const parts = text.split("|").map(p => p.trim());

  let level = "Unknown";
  let rank = "Unknown";
  let playstyle = "Unknown";

  const num = parts.find(p => /^\d{1,4}$/.test(p));
  if (num) level = num;

  const rankPart = parts.find(p =>
    /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(p)
  );
  if (rankPart) rank = rankPart;

  const style = parts.find(p => p !== num && p !== rankPart);
  if (style) playstyle = style;

  return { level, rank, playstyle };
}

function parseCommunication(text) {
  const parts = text.split("|").map(p => p.trim());

  let vc = "Unknown";
  let language = "Unknown";

  const vcPart = parts.find(p => /(yes|no|vc|voice)/i.test(p));
  if (vcPart) vc = vcPart;

  const lang = parts.find(p =>
    /(eng|english|german|de|fr|turkish|spanish|arabic)/i.test(p)
  );
  if (lang) language = lang;

  return { vc, language };
}

// ================================
// Reset matchmaking channel + post Create Match
// ================================
async function resetMatchmakingChannel() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return console.log("Matchmaking channel not found.");

  // Delete_everything
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => {});
  if (messages) await channel.bulkDelete(messages).catch(() => {});

  // New main embed
  const embed = new EmbedBuilder()
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Click **Create Match** to start matchmaking.")
    .setColor("Blue");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  return msg; // parent message for replies
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await resetMatchmakingChannel();
});

// ================================
// Open modal when Create Match clicked
// ================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "create_match") {
    await resetMatchmakingChannel();

    const modal = new ModalBuilder()
      .setCustomId("match_form")
      .setTitle("Create Volley Legends Match");

    const gameplay = new TextInputBuilder()
      .setCustomId("gameplay")
      .setLabel("Level | Rank | Playstyle")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const ability = new TextInputBuilder()
      .setCustomId("ability")
      .setLabel("Ability")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const region = new TextInputBuilder()
      .setCustomId("region")
      .setLabel("Region")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const comm = new TextInputBuilder()
      .setCustomId("communication")
      .setLabel("VC | Language")
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const notes = new TextInputBuilder()
      .setCustomId("notes")
      .setLabel("Notes")
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(
      new ActionRowBuilder().addComponents(gameplay),
      new ActionRowBuilder().addComponents(ability),
      new ActionRowBuilder().addComponents(region),
      new ActionRowBuilder().addComponents(comm),
      new ActionRowBuilder().addComponents(notes)
    );

    return interaction.showModal(modal);
  }
});

// ================================
// Submit match form → RETURN parent message for replies
// ================================
let parentMessage; // store the new create match message

client.on("messageCreate", msg => {
  if (msg.channel.id === MATCHMAKING_CHANNEL_ID &&
      msg.embeds.length > 0 &&
      msg.embeds[0].title === "Volley Legends Matchmaking") {
    parentMessage = msg;
  }
});

// ================================
// Handle match creation
// ================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "match_form") return;

  const host = interaction.user;

  const gameplayRaw = interaction.fields.getTextInputValue("gameplay");
  const ability = interaction.fields.getTextInputValue("ability");
  const region = interaction.fields.getTextInputValue("region");
  const commRaw = interaction.fields.getTextInputValue("communication");
  const notes = interaction.fields.getTextInputValue("notes") || "None";

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplayRaw);
  const { vc, language } = parseCommunication(commRaw);

  const embed = new EmbedBuilder()
    .setTitle("Match Created")
    .setColor("Green")
    .setDescription(`Your match is now live.`);

  await host.send({ embeds: [embed] }).catch(() => {});

  return interaction.reply({
    content: "Your match has been created!",
    ephemeral: true
  });
});

// ================================
// Play Together → Post request as REPLY under parent Embed
// ================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const requester = interaction.user;

  const stats = interaction.message.embeds[0].fields;
  if (!stats) {
    return interaction.reply({
      content: "Stats unavailable.",
      ephemeral: true
    });
  }

  const hostId = interaction.customId.replace("request_", "");
  const host = await client.users.fetch(hostId).catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle("New Play Request")
    .setColor("Orange")
    .setDescription(`${requester} wants to play!`)
    .addFields(
      { name: "Level", value: stats.find(f => f.name === "Level")?.value || "?" },
      { name: "Rank", value: stats.find(f => f.name === "Rank")?.value || "?" },
      { name: "Playstyle", value: stats.find(f => f.name === "Playstyle")?.value || "?" },
      { name: "Ability", value: stats.find(f => f.name === "Ability")?.value || "?" },
      { name: "Region", value: stats.find(f => f.name === "Region")?.value || "?" },
      { name: "VC", value: stats.find(f => f.name === "Voice Chat")?.value || "?" },
      { name: "Language", value: stats.find(f => f.name === "Language")?.value || "?" },
      { name: "Notes", value: stats.find(f => f.name === "Notes")?.value || "?" }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`accept_${requester.id}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`decline_${requester.id}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`sendlink_${requester.id}`)
      .setLabel("Send Private Server Link")
      .setStyle(ButtonStyle.Primary)
  );

  // Reply unter dem parentMessage
  if (parentMessage) {
    await parentMessage.reply({
      content: `${host}`,
      embeds: [embed],
      components: [row]
    });
  }

  return interaction.reply({
    content: "Your request was sent!",
    ephemeral: true
  });
});

// ================================
// Accept / Decline
// ================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (!interaction.customId.startsWith("accept_") &&
      !interaction.customId.startsWith("decline_")) return;

  const [action, userId] = interaction.customId.split("_");
  const user = await client.users.fetch(userId).catch(() => {});
  if (!user) return;

  if (action === "accept") {
    await user.send("The host accepted your request!").catch(() => {});
    return interaction.reply({ content: "Accepted.", ephemeral: true });
  }

  if (action === "decline") {
    await user.send("The host declined your request.").catch(() => {});
    return interaction.reply({ content: "Declined.", ephemeral: true });
  }
});

// ================================
// Send Private Server Link Modal
// ================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sendlink_")) return;

  const userId = interaction.customId.replace("sendlink_", "");

  const modal = new ModalBuilder()
    .setCustomId(`linkmodal_${userId}`)
    .setTitle("Send Private Server Link");

  const input = new TextInputBuilder()
    .setCustomId("serverlink")
    .setLabel("Roblox Private Server Link")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("https://www.roblox.com/...");

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  return interaction.showModal(modal);
});

// ================================
// Handle Private Link Submission
// ================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("linkmodal_")) return;

  const userId = interaction.customId.replace("linkmodal_", "");
  const user = await client.users.fetch(userId).catch(() => {});
  if (!user) return;

  const link = interaction.fields.getTextInputValue("serverlink");

  if (!link.startsWith("https://www.roblox.com/")) {
    return interaction.reply({
      content: "Invalid link — must start with https://www.roblox.com/",
      ephemeral: true
    });
  }

  await user.send(`Here is your private server link:\n${link}`).catch(() => {});

  return interaction.reply({
    content: "Private server link sent!",
    ephemeral: true
  });
});

client.login(process.env.BOT_TOKEN);
