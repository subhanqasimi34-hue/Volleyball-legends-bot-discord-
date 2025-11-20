// Full new index.js with automatic parsing + DM fail detection

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

// Express server (Cloudflare Tunnel)
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot running"));
app.listen(3000, () => console.log("Express OK"));

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// CHANNELS
const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441140684622008441";

// SCREENSHOT used in host DM
const screenshot = new AttachmentBuilder(
  "/mnt/data/Screenshot 2025-11-20 190505.png"
);

// ================================================================
// AUTO-DETECT PARSING FUNCTIONS
// ================================================================

function parseLevelRankPlaystyle(text) {
  const parts = text.split("|").map(p => p.trim());

  let level = "Unknown";
  let rank = "Unknown";
  let playstyle = "Unknown";

  // LEVEL = number
  const number = parts.find(p => /^\d{1,4}$/.test(p));
  if (number) level = number;

  // RANK = anything containing known rank words or roman numbers
  const rankPart = parts.find(p =>
    /(bronze|silver|gold|diamond|elite|pro|i|ii|iii)/i.test(p)
  );
  if (rankPart) rank = rankPart;

  // PLAYSTYLE = whatever is left
  const playPart = parts.find(
    p => p !== number && p !== rankPart
  );
  if (playPart) playstyle = playPart;

  return { level, rank, playstyle };
}

function parseCommunication(text) {
  const parts = text.split("|").map(p => p.trim());

  let vc = "Unknown";
  let language = "Unknown";

  const vcPart = parts.find(p => /(yes|no|vc|voice)/i.test(p));
  if (vcPart) vc = vcPart;

  const langPart = parts.find(p => /(eng|de|fr|spanish|arabic|turkish|english)/i.test(p));
  if (langPart) language = langPart;

  return { vc, language };
}

// ================================================================
// PLACE MATCHMAKING EMBED
// ================================================================
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

// ================================================================
// OPEN MATCH FORM
// ================================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "create_match") return;

  const modal = new ModalBuilder()
    .setCustomId("match_form")
    .setTitle("Create Volley Legends Match");

  const gameplay = new TextInputBuilder()
    .setCustomId("gameplay")
    .setLabel("Gameplay (Level | Rank | Playstyle)")
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
    .setLabel("Notes")
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
});

// ================================================================
// HANDLE SUBMITTED MATCH FORM
// ================================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "match_form") return;

  const host = interaction.user;

  const gameplayRaw = interaction.fields.getTextInputValue("gameplay");
  const commRaw = interaction.fields.getTextInputValue("communication");

  const ability = interaction.fields.getTextInputValue("ability");
  const region = interaction.fields.getTextInputValue("region");
  const notes = interaction.fields.getTextInputValue("notes") || "None";

  const { level, rank, playstyle } = parseLevelRankPlaystyle(gameplayRaw);
  const { vc, language } = parseCommunication(commRaw);

  const embed = new EmbedBuilder()
    .setTitle("Volley Legends Match Found")
    .setColor("Green")
    .setDescription("A player is looking for teammates!")
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
  await channel.send({ content: `${host}`, embeds: [embed], components: [row] });

  await host.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Match Created")
        .setDescription("Your match is now live.")
        .setColor("Blue")
    ]
  }).catch(() => {});

  await interaction.reply({
    content: "Your match has been created!",
    ephemeral: true
  });
});

// ================================================================
// PLAYER REQUEST → DM HOST  (with DM fail detection)
// ================================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.replace("request_", "");
  const host = await client.users.fetch(hostId).catch(() => {});
  if (!host) {
    return interaction.reply({
      content: "❌ The host could not be found.",
      ephemeral: true
    });
  }

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
      .setCustomId(`sendlink_${requester.id}`)
      .setLabel("Send Private Server Link")
      .setStyle(ButtonStyle.Primary)
  );

  let dmFailed = false;

  await host
    .send({
      content: "You received a new match request!",
      embeds: [embed],
      components: [row],
      files: [screenshot]
    })
    .catch((err) => {
      dmFailed = true;
      console.log("DM failed:", err);
    });

  if (dmFailed) {
    return interaction.reply({
      content:
        "❌ The host has DMs disabled. They must enable **Direct Messages** on Discord to receive your request.",
      ephemeral: true
    });
  }

  return interaction.reply({
    content: "Your request was sent!",
    ephemeral: true
  });
});

// ================================================================
// ACCEPT / DECLINE HANDLER
// ================================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (
    !interaction.customId.startsWith("accept_") &&
    !interaction.customId.startsWith("decline_")
  )
    return;

  const [action, targetId] = interaction.customId.split("_");
  const target = await client.users.fetch(targetId).catch(() => {});
  if (!target) return;

  if (action === "accept") {
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Accepted!")
          .setDescription("The host accepted your request.")
          .setColor("Green")
      ]
    }).catch(() => {});

    return interaction.reply({
      content: "Player accepted.",
      ephemeral: true
    });
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

    return interaction.reply({
      content: "Player declined.",
      ephemeral: true
    });
  }
});

// ================================================================
// SEND PRIVATE SERVER LINK → MODAL
// ================================================================
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
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  return interaction.showModal(modal);
});

// ================================================================
// HANDLE LINK SUBMIT
// ================================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("sendlinkmodal_")) return;

  const targetId = interaction.customId.replace("sendlinkmodal_", "");
  const target = await client.users.fetch(targetId).catch(() => {});
  if (!target) return;

  const link = interaction.fields.getTextInputValue("serverlink");

  if (!link.startsWith("https://www.roblox.com/")) {
    return interaction.reply({
      content:
        "❌ Invalid link. Only **https://www.roblox.com/** links are allowed.",
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
    content: "Private server link sent.",
    ephemeral: true
  });
});

// START BOT
client.login(process.env.BOT_TOKEN);
