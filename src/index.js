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
} from 'discord.js';

import express from 'express';

// Express server for Cloudflare Tunnel
const app = express();
app.get('/', (req, res) => res.send('Volley Legends Bot running'));
app.listen(3000, () => console.log('Express OK'));

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Message, Partials.Channel],
});

// Channel where the CREATE MATCH button should be posted
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";

// Create the fixed matchmaking embed
async function setupMatchmakingEmbed() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) {
    console.log("Matchmaking channel not found.");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Click below on **Create Match** to create your matchmaking post.")
    .setColor("Blue");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_match")
      .setLabel("Create Match")
      .setStyle(ButtonStyle.Primary)
  );

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => {});
  if (messages) {
    channel.bulkDelete(messages).catch(() => {});
  }

  await channel.send({ embeds: [embed], components: [row] });

  console.log("Matchmaking embed posted.");
}

// Runs when bot logs in
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await setupMatchmakingEmbed();
});

// ---------------------------------------
// FORM THAT OPENS WHEN "Create Match" IS CLICKED
// ---------------------------------------
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "create_match") {

    const form = new ModalBuilder()
      .setCustomId("match_form")
      .setTitle("Create Volley Legends Match");

    const level = new TextInputBuilder()
      .setCustomId("level")
      .setLabel("Level")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const playstyle = new TextInputBuilder()
      .setCustomId("playstyle")
      .setLabel("Playstyle")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const ability = new TextInputBuilder()
      .setCustomId("ability")
      .setLabel("Ability")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const rank = new TextInputBuilder()
      .setCustomId("rank")
      .setLabel("Rank")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const region = new TextInputBuilder()
      .setCustomId("region")
      .setLabel("Region")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const availability = new TextInputBuilder()
      .setCustomId("availability")
      .setLabel("Availability")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const vc = new TextInputBuilder()
      .setCustomId("vc")
      .setLabel("Voice Chat (Yes/No)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const language = new TextInputBuilder()
      .setCustomId("language")
      .setLabel("Language")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const notes = new TextInputBuilder()
      .setCustomId("notes")
      .setLabel("Additional Notes")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    form.addComponents(
      new ActionRowBuilder().addComponents(level),
      new ActionRowBuilder().addComponents(playstyle),
      new ActionRowBuilder().addComponents(ability),
      new ActionRowBuilder().addComponents(rank),
      new ActionRowBuilder().addComponents(region),
      new ActionRowBuilder().addComponents(availability),
      new ActionRowBuilder().addComponents(vc),
      new ActionRowBuilder().addComponents(language),
      new ActionRowBuilder().addComponents(notes)
    );

    await interaction.showModal(form);
  }
});

client.login(process.env.BOT_TOKEN);
