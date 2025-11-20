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

const app = express();
app.get('/', (req, res) => res.send('Volley Legends Bot running'));
app.listen(3000, () => console.log('Express OK'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Message, Partials.Channel],
});

// 👉 HIER kommt der neue CODE hin
const MATCHMAKING_CHANNEL_ID = "DEINE_CHANNEL_ID";

async function setupMatchmakingEmbed() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return console.log("Matchmaking-Channel nicht gefunden.");

  const embed = new EmbedBuilder()
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Klicke unten auf Create Match, um ein Match zu erstellen.")
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

  console.log("Matchmaking-Embed gesetzt.");
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await setupMatchmakingEmbed();
});

client.login(process.env.BOT_TOKEN);
