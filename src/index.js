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
} from 'discord.js';

import express from 'express';

// Express server (needed for Cloudflare Tunnel)
const app = express();
app.get('/', (req, res) => res.send('Volley Legends Bot running'));
app.listen(3000, () => console.log('Express OK'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User]
});

// CHANNELS
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

// LOAD SCREENSHOT
const screenshot = new AttachmentBuilder("/mnt/data/Screenshot 2025-11-20 190505.png");

// ---------------------------------------------------------------
// POST FIXED MATCHMAKING EMBED
// ---------------------------------------------------------------
async function setupMatchmakingEmbed() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return console.log("Matchmaking channel not found.");

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

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => {});
  if (messages) channel.bulkDelete(messages).catch(() => {});

  await channel.send({ embeds: [embed], components: [row] });
  console.log("Matchmaking embed posted.");
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await setupMatchmakingEmbed();
});

// ---------------------------------------------------------------
// OPEN MATCH FORM
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "create_match") {
    const form = new ModalBuilder()
      .setCustomId("match_form")
      .setTitle("Create Volley Legends Match");

    const fields = [
      ["level", "Level"],
      ["playstyle", "Playstyle"],
      ["ability", "Ability"],
      ["rank", "Rank"],
      ["region", "Region"],
      ["availability", "Availability"],
      ["vc", "Voice Chat (Yes/No)"],
      ["language", "Language"]
    ];

    form.addComponents(
      ...fields.map(([id, label]) =>
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(id)
            .setLabel(label)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("notes")
          .setLabel("Additional Notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      )
    );

    return interaction.showModal(form);
  }
});

// ---------------------------------------------------------------
// HANDLE MATCH CREATION
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "match_form") return;

  const host = interaction.user;

  const data = {
    level: interaction.fields.getTextInputValue("level"),
    playstyle: interaction.fields.getTextInputValue("playstyle"),
    ability: interaction.fields.getTextInputValue("ability"),
    rank: interaction.fields.getTextInputValue("rank"),
    region: interaction.fields.getTextInputValue("region"),
    availability: interaction.fields.getTextInputValue("availability"),
    vc: interaction.fields.getTextInputValue("vc"),
    language: interaction.fields.getTextInputValue("language"),
    notes: interaction.fields.getTextInputValue("notes") || "None"
  };

  const embed = new EmbedBuilder()
    .setTitle("Volley Legends Match Found")
    .setColor("Green")
    .setDescription("A player is looking for teammates!")
    .addFields(
      { name: "Host", value: `${host}`, inline: false },
      { name: "Level", value: data.level, inline: true },
      { name: "Playstyle", value: data.playstyle, inline: true },
      { name: "Ability", value: data.ability, inline: true },
      { name: "Rank", value: data.rank, inline: true },
      { name: "Region", value: data.region, inline: true },
      { name: "Availability", value: data.availability, inline: true },
      { name: "Voice Chat", value: data.vc, inline: true },
      { name: "Language", value: data.language, inline: true },
      { name: "Notes", value: data.notes, inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_play_${host.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const channel = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  if (!channel)
    return interaction.reply({
      content: "Could not find posting channel.",
      ephemeral: true,
    });

  await channel.send({
    content: `${host}`,
    embeds: [embed],
    components: [row],
  });

  // DM TO PLAYER
  await host.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Match Created")
        .setDescription("Your Volley Legends match has been created.\nPlayers can now request to play with you.")
        .setColor("Blue")
    ]
  }).catch(() => {});

  await interaction.reply({ content: "Your match has been created!", ephemeral: true });

});

// ---------------------------------------------------------------
// PLAYER REQUEST → SEND DM TO HOST
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (!interaction.customId.startsWith("request_play_")) return;

  const hostId = interaction.customId.replace("request_play_", "");
  const host = await client.users.fetch(hostId);
  const requester = interaction.user;

  const embed = new EmbedBuilder()
    .setTitle("New Player Request")
    .setDescription(`${requester} wants to play with you.`)
    .setColor("Orange");

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
      .setCustomId(`send_link_${requester.id}`)
      .setLabel("Send Private Server Link")
      .setStyle(ButtonStyle.Primary)
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
// ACCEPT / DECLINE
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, targetId] = interaction.customId.split("_");
  const target = await client.users.fetch(targetId);

  if (action === "accept") {
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Accepted!")
          .setDescription("The host accepted your request. They will send you a private server link.")
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
// PRIVATE SERVER LINK MODAL
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("send_link_")) return;

  const targetId = interaction.customId.replace("send_link_", "");

  const modal = new ModalBuilder()
    .setCustomId(`link_modal_${targetId}`)
    .setTitle("Send Private Server Link");

  const linkField = new TextInputBuilder()
    .setCustomId("server_link")
    .setLabel("Roblox Private Server Link")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(linkField));

  return interaction.showModal(modal);
});

// ---------------------------------------------------------------
// HANDLE PRIVATE SERVER LINK
// ---------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("link_modal_")) return;

  const targetId = interaction.customId.replace("link_modal_", "");
  const target = await client.users.fetch(targetId);

  const link = interaction.fields.getTextInputValue("server_link");

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

  return interaction.reply({
    content: "Private server link sent to player.",
    ephemeral: true,
  });
});

// ---------------------------------------------------------------
client.login(process.env.BOT_TOKEN);
