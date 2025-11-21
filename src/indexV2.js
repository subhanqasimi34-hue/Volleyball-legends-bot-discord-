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

// -------------------------------------

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

  const l = p.find(x => /(eng|english|german|de|turkish|spanish|arabic)/i.test(x));
  if (l) language = l;

  return { vc, language };
}

function autoDelete(msg) {
  setTimeout(() => msg.delete().catch(()=>{}), 5 * 60 * 1000);
} async function resetMatchmakingChannel() {
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
  await resetMatchmakingChannel();
});

// -------------------------------------

async function checkHostCooldown(id) {
  const entry = await HostCooldown.findOne({ userId: id });
  if (!entry) return 0;

  const diff = Date.now() - entry.timestamp;
  if (diff >= 5 * 60 * 1000) return 0;

  return Math.ceil((5 * 60 * 1000 - diff) / 60000);
}

// -------------------------------------

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "create_match") return;

  const cd = await checkHostCooldown(interaction.user.id);
  if (cd > 0) {
    const msg = await interaction.reply({
      ephemeral: true,
      content: `❌ Wait **${cd} min** before creating another match.`
    });
    autoDelete(msg);
    return;
  }

  const reuseEmbed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("♻️ Reuse last stats?")
    .setDescription("Do you want to reuse your last stats?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("reuse_yes")
      .setLabel("Yes")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("reuse_no")
      .setLabel("No")
      .setStyle(ButtonStyle.Secondary)
  );

  const reply = await interaction.reply({
    ephemeral: true,
    embeds: [reuseEmbed],
    components: [row]
  });

  autoDelete(reply);
}); client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "reuse_yes") {
    const stats = await HostStats.findOne({ userId: interaction.user.id });
    openHostModal(interaction, true, stats);
  }

  if (interaction.customId === "reuse_no") {
    openHostModal(interaction, false, null);
  }
});

// -------------------------------------

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
          .setStyle(
            label === "Notes"
              ? TextInputStyle.Paragraph
              : TextInputStyle.Short
          )
      )
    )
  );

  interaction.showModal(modal);
}

// -------------------------------------

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

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const fp = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  await fp.send({
    content: `<@${user.id}>`,
    embeds: [embed],
    components: [row]
  });

  const reply = await interaction.reply({
    ephemeral: true,
    content: "Match created!"
  });

  autoDelete(reply);
});

// -------------------------------------

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.split("_")[1];
  const requester = interaction.user;

  const cd = await Cooldowns.findOne({ userId: requester.id, hostId });
  if (cd && Date.now() - cd.timestamp < 5 * 60 * 1000) {
    const min = Math.ceil(
      (5 * 60 * 1000 - (Date.now() - cd.timestamp)) / 60000
    );
    const err = await interaction.reply({
      ephemeral: true,
      content: `❌ Wait **${min} min** before sending again.`
    });
    autoDelete(err);
    return;
  }

  const oldStats = await PlayerStats.findOne({ userId: requester.id });
  openPlayerModal(interaction, !!oldStats, oldStats, hostId);
});

// -------------------------------------

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
          .setStyle(
            label === "Notes"
              ? TextInputStyle.Paragraph
              : TextInputStyle.Short
          )
      )
    )
  );

  interaction.showModal(modal);
} client.on("interactionCreate", async interaction => {
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
      .setLabel("Send Server Link")
      .setStyle(ButtonStyle.Primary)
  );

  const dm = await host.send({ embeds: [embed], components: [row] });
  autoDelete(dm);

  const done = await interaction.reply({
    ephemeral: true,
    content: "Your request was sent!"
  });
  autoDelete(done);
});

// ------------------------------------------------------
// Multi-Player matchmaking channel
// Host can accept unlimited players
// All go into one private channel
//-------------------------------------------------------

const activeMatchChannels = new Map();

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  const [type, playerId, hostId] = interaction.customId.split("_");

  if (type !== "accept" && type !== "decline") return;

  const guild = interaction.guild;
  const host = interaction.user;
  const player = await client.users.fetch(playerId);

  // DECLINE
  if (type === "decline") {
    const dm = await player.send("❌ Your request was declined.");
    autoDelete(dm);

    const ep = await interaction.reply({
      ephemeral: true,
      content: "Declined."
    });

    autoDelete(ep);
    return;
  }

  // ACCEPT
  let channelId = activeMatchChannels.get(hostId);
  let channel;

  if (channelId) {
    channel = guild.channels.cache.get(channelId);

    if (channel) {
      await channel.permissionOverwrites.edit(playerId, {
        ViewChannel: true,
        SendMessages: true
      });
    }
  }

  if (!channelId || !channel) {
    let category = guild.channels.cache.find(
      c => c.name === CATEGORY_NAME && c.type === 4
    );

    if (!category) {
      category = await guild.channels.create({
        name: CATEGORY_NAME,
        type: 4
      });
    }

    channel = await guild.channels.create({
      name: `matchmaking-${host.username}`,
      type: 0,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.id, deny: ["ViewChannel"] },
        { id: hostId, allow: ["ViewChannel", "SendMessages"] },
        { id: playerId, allow: ["ViewChannel", "SendMessages"] }
      ]
    });

    activeMatchChannels.set(hostId, channel.id);

    // FINISH MATCH button hinzufügen
    const finishRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`finishmatch_${hostId}`)
        .setLabel("Finish Match")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: "The host can finish the match anytime:",
      components: [finishRow]
    });
  }

  const dm = await player.send(
    "✅ Your request was accepted! You were added to the match channel."
  );
  autoDelete(dm);

  const ep = await interaction.reply({
    ephemeral: true,
    content: `Player added: <@${playerId}>`
  });
  autoDelete(ep);

  await channel.send(
    `🎉 <@${playerId}> joined the match with Host <@${hostId}>!`
  );
}); // ------------------------------------------------------
// SEND SERVER LINK – Host sends private Roblox link
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sendlink_")) return;

  const playerId = interaction.customId.split("_")[1];

  const modal = new ModalBuilder()
    .setCustomId(`privatelink_${playerId}`)
    .setTitle("Send Private Server Link");

  const input = new TextInputBuilder()
    .setCustomId("link")
    .setLabel("Roblox Private Link")
    .setPlaceholder("https://www.roblox.com/…")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(
    new ActionRowBuilder().addComponents(input)
  );

  interaction.showModal(modal);
});

// ------------------------------------------------------
// SERVER LINK VALIDATION + SEND DM TO PLAYER
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("privatelink_")) return;

  const playerId = interaction.customId.split("_")[1];
  const player = await client.users.fetch(playerId);
  const link = interaction.fields.getTextInputValue("link");

  const requiredPrefix = "https://www.roblox.com/";

  if (!link.startsWith(requiredPrefix)) {
    const err = await interaction.reply({
      ephemeral: true,
      content: "❌ Invalid link. Must start with **https://www.roblox.com/**"
    });
    autoDelete(err);
    return;
  }

  const dm = await player.send(`🔗 **Private Server Link:**\n${link}`);
  autoDelete(dm);

  const ep = await interaction.reply({
    ephemeral: true,
    content: "Link sent!"
  });
  autoDelete(ep);
});

// ------------------------------------------------------
// FINISH MATCH — Host closes the entire match
// Deletes the channel after DM notifications
// ------------------------------------------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("finishmatch_")) return;

  const hostId = interaction.customId.split("_")[1];
  const guild = interaction.guild;

  // Only Host can press it
  if (interaction.user.id !== hostId) {
    return interaction.reply({
      ephemeral: true,
      content: "❌ Only the host can finish the match."
    });
  }

  const channel = interaction.channel;

  // Notify all non-bot members
  for (const [memberId, member] of channel.members) {
    if (member.user.bot) continue;

    try {
      const dm = await member.send(
        "🏁 The host finished the match. The match channel will be deleted."
      );
      autoDelete(dm);
    } catch {}
  }

  const ok = await interaction.reply({
    ephemeral: true,
    content: "Match closed. Channel will be deleted."
  });
  autoDelete(ok);

  // Delete channel after short delay
  setTimeout(() => {
    channel.delete().catch(() => {});
  }, 2000);

  activeMatchChannels.delete(hostId);
}); // ------------------------------------------------------
// AUTO DELETE HELPER
// ------------------------------------------------------
function autoDelete(msg) {
  setTimeout(() => {
    if (!msg) return;
    msg.delete().catch(() => {});
  }, 5 * 60 * 1000);
}

// ------------------------------------------------------
// EXPRESS KEEPALIVE (UPTIME ROBOT / CLOUDFLARE OK)
// ------------------------------------------------------
import express from "express";
const app = express();
app.get("/", (req, res) => res.send("Volley Legends Bot Running"));
app.listen(3000);

// ------------------------------------------------------
// DATABASE CONNECTION
// ------------------------------------------------------
import mongoose from "mongoose";
mongoose.connect(process.env.MONGO_URI, { dbName: "VolleyBot" });

// ------------------------------------------------------
// BOT LOGIN
// ------------------------------------------------------
client.login(process.env.BOT_TOKEN);