// indexV2.js – final version with "Unknown" fallback

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
  AttachmentBuilder
} from "discord.js";

import express from "express";

// Express server for Cloudflare Tunnel
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot running"));
app.listen(3000, () => console.log("Express OK"));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// Channels
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

// Screenshot for host DM
const screenshot = new AttachmentBuilder(
  "/mnt/data/Screenshot 2025-11-20 190505.png"
);

// ---------------------------------------------------------------
// Place matchup embed
// ---------------------------------------------------------------
async function setupMatchmakingEmbed() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return console.log("Matchmaking channel not found.");

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => {});
  if (messages) channel.bulkDelete(messages).catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Click **Create Match** to open the match form.")
    .setColor("Blue");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
  console.log("Matchmaking embed posted.");
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await setupMatchmakingEmbed();
});

// ---------------------------------------------------------------
// Show Match Form
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "create_match") {
    const modal = new ModalBuilder()
      .setCustomId("match_form")
      .setTitle("Create Volley Legends Match");

    const gameplay = new TextInputBuilder()
      .setCustomId("gameplay")
      .setLabel("Gameplay Info (Level | Rank | Playstyle)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const ability = new TextInputBuilder()
      .setCustomId("ability")
      .setLabel("Ability")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const region = new TextInputBuilder()
      .setCustomId("region")
      .setLabel("Region")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const communication = new TextInputBuilder()
      .setCustomId("communication")
      .setLabel("Communication (VC | Language)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const notes = new TextInputBuilder()
      .setCustomId("notes")
      .setLabel("Additional Notes")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(gameplay),
      new ActionRowBuilder().addComponents(ability),
      new ActionRowBuilder().addComponents(region),
      new ActionRowBuilder().addComponents(communication),
      new ActionRowBuilder().addComponents(notes)
    );

    return interaction.showModal(modal);
  }
});

// ---------------------------------------------------------------
// Handle Match Form Submit
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "match_form") return;

  const host = interaction.user;

  // Gameplay: Level | Rank | Playstyle
  const rawGameplay = interaction.fields.getTextInputValue("gameplay");
  const parts = rawGameplay.split("|").map(x => x.trim());

  const level = parts[0] || "Unknown";
  const rank = parts[1] || "Unknown";
  const playstyle = parts[2] || "Unknown";

  // Communication: VC | Language
  const rawComm = interaction.fields.getTextInputValue("communication");
  const comm = rawComm.split("|").map(x => x.trim());

  const vc = comm[0] || "Unknown";
  const language = comm[1] || "Unknown";

  const ability = interaction.fields.getTextInputValue("ability") || "Unknown";
  const region = interaction.fields.getTextInputValue("region") || "Unknown";
  const notes = interaction.fields.getTextInputValue("notes") || "None";

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

  const channel = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  if (!channel)
    return interaction.reply({ content: "Posting channel not found.", ephemeral: true });

  await channel.send({
    content: `${host}`,
    embeds: [embed],
    components: [row]
  });

  await host.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Match Created")
        .setDescription("Your match is now live.")
        .setColor("Blue")
    ]
  }).catch(() => {});

  await interaction.reply({ content: "Your match has been created!", ephemeral: true });
});

// ---------------------------------------------------------------
// Player → Host request (DM)
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.replace("request_", "");
  const host = await client.users.fetch(hostId).catch(() => {});
  if (!host) return;

  const requester = interaction.user;

  const embed = new EmbedBuilder()
    .setTitle("New Player Request")
    .setDescription(`${requester} wants to play with you.`)
    .setColor("Orange");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${requester.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`decline_${requester.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sendlink_${requester.id}`).setLabel("Send Private Server Link").setStyle(ButtonStyle.Primary)
  );

  await host.send({
    content: "You received a new match request!",
    embeds: [embed],
    components: [row],
    files: [screenshot]
  }).catch(() => {});

  await interaction.reply({ content: "Your request was sent!", ephemeral: true });
});

// ---------------------------------------------------------------
// Accept / Decline
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (
    !interaction.customId.startsWith("accept_") &&
    !interaction.customId.startsWith("decline_")
  ) return;

  const [action, targetId] = interaction.customId.split("_");
  const target = await client.users.fetch(targetId).catch(() => {});
  if (!target) return;

  if (action === "accept") {
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Accepted!")
          .setDescription("The host accepted your request. Wait for the private server link.")
          .setColor("Green")
      ]
    }).catch(() => {});

    return interaction.reply({ content: "Player accepted.", ephemeral: true });
  }

  if (action === "decline") {
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Declined")
          .setDescription("The host declined your request.")
          .setColor("Red")
      ]
    }).catch(() => {});

    return interaction.reply({ content: "Player declined.", ephemeral: true });
  }
});

// ---------------------------------------------------------------
// Send Private Server Link Modal
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sendlink_")) return;

  const targetId = interaction.customId.replace("sendlink_", "");

  const modal = new ModalBuilder()
    .setCustomId(`sendlinkmodal_${targetId}`)
    .setTitle("Send Private Server Link");

  const input = new TextInputBuilder()
    .setCustomId("serverlink")
    .setLabel("Roblox Private Server Link")
    .setPlaceholder("https://www.roblox.com/...")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
});

// ---------------------------------------------------------------
// Send link (after modal submit)
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("sendlinkmodal_")) return;

  const targetId = interaction.customId.replace("sendlinkmodal_", "");
  const target = await client.users.fetch(targetId).catch(() => {});
  if (!target) return;

  const link = interaction.fields.getTextInputValue("serverlink");

  if (!link.startsWith("https://www.roblox.com/")) {
    return interaction.reply({
      content: "Invalid link. Only **https://www.roblox.com/** links are allowed.",
      ephemeral: true
    });
  }

  await target.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Private Server Link")
        .setDescription(`Here is your private server link:\n${link}`)
        .setColor("Blue")
    ]
  }).catch(() => {});

  return interaction.reply({ content: "Private server link sent to player.", ephemeral: true });
});

// ---------------------------------------------------------------
client.login(process.env.BOT_TOKEN);
