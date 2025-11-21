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
  userId: { type: String, required: true, unique: true },
  gameplay: String,
  ability: String,
  region: String,
  communication: String,
  notes: String
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

const ActiveChannels = mongoose.model(
  "ActiveChannels",
  new mongoose.Schema({ hostId: String, channelId: String })
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

  const v = p.find(x => /(yes|no|vc|voice)/i.test(x));
  if (v) vc = v;

  const l = p.find(x => /(eng|de|german|english|turkish|spanish|arabic)/i.test(x));
  if (l) language = l;

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

  const old = await channel.messages.fetch({ limit: 100 });
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

async function checkHostCooldown(id) {
  const e = await HostCooldown.findOne({ userId: id });
  if (!e) return 0;

  const d = Date.now() - e.timestamp;
  return d >= 5 * 60 * 1000
    ? 0
    : Math.ceil((5 * 60 * 1000 - d) / 60000);
}
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

  const msg = await interaction.reply({
    ephemeral: true,
    embeds: [reuseEmbed],
    components: [row]
  });

  autoDelete(msg);
});

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
    ...fields.map(([id, label, value]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setValue(autofill && value ? value : "")
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

client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "host_form") return;

  const user = interaction.user;

  const gameplay = interaction.fields.getTextInputValue("gameplay");
  const ability = interaction.fields.getTextInputValue("ability");
  const region = interaction.fields.getTextInputValue("region");
  const communication = interaction.fields.getTextInputValue("communication");
  const notes = interaction.fields.getTextInputValue("notes");

  await HostStats.findOneAndUpdate(
    { userId: user.id },
    { gameplay, ability, region, communication, notes },
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
  const { vc, language } = parseCommunication(communication);

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

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_${user.id}`)
      .setLabel("Play Together")
      .setStyle(ButtonStyle.Success)
  );

  const channel = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);

  await channel.send({
    content: `<@${user.id}>`,
    embeds: [embed],
    components: [button]
  });

  const reply = await interaction.reply({
    ephemeral: true,
    content: "Match created!"
  });

  autoDelete(reply);
});
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("request_")) return;

  const hostId = interaction.customId.split("_")[1];
  const requester = interaction.user;

  const cooldown = await Cooldowns.findOne({ userId: requester.id, hostId });
  if (cooldown && Date.now() - cooldown.timestamp < 5 * 60 * 1000) {
    const remaining = Math.ceil(
      (5 * 60 * 1000 - (Date.now() - cooldown.timestamp)) / 60000
    );

    const msg = await interaction.reply({
      ephemeral: true,
      content: `❌ Please wait **${remaining} min** before sending another request.`
    });

    autoDelete(msg);
    return;
  }

  const oldStats = await PlayerStats.findOne({ userId: requester.id });
  openPlayerModal(interaction, !!oldStats, oldStats, hostId);
});


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
    ...fields.map(([id, label, value]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setValue(autofill && value ? value : "")
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
}


client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("player_form_")) return;

  const hostId = interaction.customId.split("_")[2];
  const requester = interaction.user;

  const gameplay = interaction.fields.getTextInputValue("p_gameplay");
  const ability = interaction.fields.getTextInputValue("p_ability");
  const region = interaction.fields.getTextInputValue("p_region");
  const communication = interaction.fields.getTextInputValue("p_communication");
  const notes = interaction.fields.getTextInputValue("p_notes");

  await PlayerStats.findOneAndUpdate(
    { userId: requester.id },
    { gameplay, ability, region, communication, notes },
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
  const { vc, language } = parseCommunication(communication);

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

  const reply = await interaction.reply({
    ephemeral: true,
    content: "Your request was sent!"
  });

  autoDelete(reply);
});
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  const [action, playerId, hostId] = interaction.customId.split("_");

  // ACCEPT
  if (action === "accept") {
    const host = interaction.user;
    const player = await client.users.fetch(playerId);
    const guild = interaction.guild;

    // CATEGORY FINDEN/ERSTELLEN
    let category = guild.channels.cache.find(
      c => c.name === CATEGORY_NAME && c.type === 4
    );

    if (!category) {
      category = await guild.channels.create({
        name: CATEGORY_NAME,
        type: 4
      });
    }

    // CHANNEL-NAME
    const safeName = host.username.toLowerCase().replace(/[^a-z0-9]/g, "");
    const channelName = `matchmaking-${safeName}`;

    // CHANNEL SUCHEN ODER ERSTELLEN
    let channel = guild.channels.cache.find(
      c => c.name === channelName && c.parentId === category.id
    );

    if (!channel) {
      channel = await guild.channels.create({
        name: channelName,
        type: 0,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.id, deny: ["ViewChannel"] },
          { id: host.id, allow: ["ViewChannel", "SendMessages"] },
          { id: player.id, allow: ["ViewChannel", "SendMessages"] }
        ]
      });
    } else {
      await channel.permissionOverwrites.edit(player.id, {
        ViewChannel: true,
        SendMessages: true
      });
    }

    const acceptedDM = await player.send(
      "✅ Your request was accepted! A private match channel was created."
    );
    autoDelete(acceptedDM);

    const confirmation = await interaction.reply({
      ephemeral: true,
      content: "Match accepted! Private channel ready."
    });
    autoDelete(confirmation);

    setTimeout(() => {
      channel.delete().catch(() => {});
    }, 5 * 60 * 1000);
  }

  // DECLINE
  if (action === "decline") {
    const player = await client.users.fetch(playerId);
    const declineDM = await player.send("❌ Your request was declined.");
    autoDelete(declineDM);

    const reply = await interaction.reply({
      ephemeral: true,
      content: "Player declined."
    });
    autoDelete(reply);
  }
});


//
// SEND PRIVATE LINK
//
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("sendlink_")) return;

  const requesterId = interaction.customId.split("_")[1];

  const modal = new ModalBuilder()
    .setCustomId(`privatelink_${requesterId}`)
    .setTitle("Send Private Server Link");

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


//
// PRIVATE LINK SUBMIT
//
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("privatelink_")) return;

  const requesterId = interaction.customId.split("_")[1];
  const requester = await client.users.fetch(requesterId);
  const link = interaction.fields.getTextInputValue("link");

  if (!link.startsWith("https://www.roblox.com/")) {
    const msg = await interaction.reply({
      ephemeral: true,
      content: "❌ Invalid link. It must start with **https://www.roblox.com/**"
    });
    autoDelete(msg);
    return;
  }

  const sent = await requester.send(`🔗 Private Server Link:\n${link}`);
  autoDelete(sent);

  const reply = await interaction.reply({
    ephemeral: true,
    content: "Link sent!"
  });
  autoDelete(reply);
});


//
// LOGIN
//
client.login(process.env.BOT_TOKEN);
