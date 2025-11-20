// ================================================================
// indexV2.js – Volley Legends Matchmaking Bot
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

import express from "express";

// Express Webserver (for Cloudflare Tunnel)
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot running"));
app.listen(3000, () => console.log("Express OK"));

// Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// Your match channel
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";

let parentMessage = null;

// ================================================================
// Helper: Parse "Level | Rank | Playstyle"
// ================================================================
function parseLevelRankPlaystyle(text) {
  const parts = text.split("|").map(p => p.trim());

  let level = "Unknown";
  let rank = "Unknown";
  let playstyle = "Unknown";

  // Level = pure numbers
  const num = parts.find(p => /^\d{1,4}$/.test(p));
  if (num) level = num;

  // Rank detection
  const rankPart = parts.find(p =>
    /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(p)
  );
  if (rankPart) rank = rankPart;

  // Playstyle = leftover
  const style = parts.find(p => p !== num && p !== rankPart);
  if (style) playstyle = style;

  return { level, rank, playstyle };
}

// ================================================================
// Helper: Parse "VC | Language"
// ================================================================
function parseCommunication(text) {
  const parts = text.split("|").map(p => p.trim());
  let vc = "Unknown";
  let language = "Unknown";

  const vcPart = parts.find(p => /(yes|no|vc|voice)/i.test(p));
  if (vcPart) vc = vcPart;

  const langPart = parts.find(p =>
    /(eng|english|german|de|fr|turkish|spanish|arabic)/i.test(p)
  );
  if (langPart) language = langPart;

  return { vc, language };
}

// ================================================================
// Reset channel + post main embed
// ================================================================
async function resetMatchmakingChannel() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return console.log("Matchmaking channel not found.");

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => {});
  if (messages) await channel.bulkDelete(messages).catch(() => {});

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
  parentMessage = msg;
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await resetMatchmakingChannel();
});

// ================================================================
// User clicks: Create Match → Open modal
// ================================================================
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
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

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

// ================================================================
// Modal submitted → Post stats embed
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "match_form") return;

  const host = interaction.user;

  const gameplay = interaction.fields.getTextInputValue("gameplay");
  const ability = interaction.fields.getTextInputValue("ability");
  const region = interaction.fields.getTextInputValue("region");
  const comm = interaction.fields.getTextInputValue("communication");
  const notes = interaction.fields.getTextInputValue("notes") || "None";

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplay);
  const { vc, language } = parseCommunication(comm);

  // MATCH POST
  const embed = new EmbedBuilder()
    .setTitle("Volley Legends Match Found")
    .setDescription("A player is looking for teammates!")
    .setColor("Green")
    .addFields(
      { name: "Host", value: `${host}`, inline: false },
      { name: "Level", value: level, inline: true },
      { name: "Rank", value: rank, inline: true },
      { name: "Playstyle", value: playstyle, inline: true },
      { name: "Ability", value: ability, inline: true },
      { name: "Region", value: region, inline: true },
      { name: "Voice Chat", value: vc, inline: true },
      { name: "Language", value: language, inline: true },
      { name: "Notes", value: notes, inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${host.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  await parentMessage.reply({
    content: `${host}`,
    embeds: [embed],
    components: [row]
  });

  return interaction.reply({
    content: "Your match has been created!",
    ephemeral: true
  });
});

// ================================================================
// Player clicks: Play Together → Create request under match
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.replace("request_", "");
  const host = await client.users.fetch(hostId).catch(() => {});
  const requester = interaction.user;

  const statsEmbed = interaction.message.embeds[0];

  const embed = new EmbedBuilder()
    .setTitle("New Play Request")
    .setColor("Orange")
    .setDescription(`${requester} wants to play!`)
    .addFields(statsEmbed.fields);

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

  await parentMessage.reply({
    content: `${host}`,
    embeds: [embed],
    components: [row]
  });

  return interaction.reply({
    content: "Your request was sent!",
    ephemeral: true
  });
});

// ================================================================
// Accept / Decline
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  const id = interaction.customId;

  if (id.startsWith("accept_")) {
    const uid = id.replace("accept_", "");
    const user = await client.users.fetch(uid).catch(() => {});
    await user.send("The host accepted your request!").catch(() => {});
    return interaction.reply({ content: "Accepted.", ephemeral: true });
  }

  if (id.startsWith("decline_")) {
    const uid = id.replace("decline_", "");
    const user = await client.users.fetch(uid).catch(() => {});
    await user.send("The host declined your request.").catch(() => {});
    return interaction.reply({ content: "Declined.", ephemeral: true });
  }
});

// ================================================================
// Send private link
// ================================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sendlink_")) return;

  const uid = interaction.customId.replace("sendlink_", "");

  const modal = new ModalBuilder()
    .setCustomId(`privatelink_${uid}`)
    .setTitle("Send Private Server Link");

  const input = new TextInputBuilder()
    .setCustomId("link")
    .setLabel("Roblox Private Server Link")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("https://www.roblox.com/…");

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  return interaction.showModal(modal);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("privatelink_")) return;

  const uid = interaction.customId.replace("privatelink_", "");
  const user = await client.users.fetch(uid).catch(() => {});
  if (!user) return;

  const link = interaction.fields.getTextInputValue("link");

  if (!link.startsWith("https://www.roblox.com/")) {
    return interaction.reply({
      content: "❌ Link must start with https://www.roblox.com/",
      ephemeral: true
    });
  }

  await user.send(`Here is the private server link:\n${link}`).catch(() => {});

  return interaction.reply({ content: "Sent!", ephemeral: true });
});

// ================================================================
client.login(process.env.BOT_TOKEN);
