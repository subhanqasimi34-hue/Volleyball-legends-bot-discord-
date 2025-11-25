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
import dotenv from "dotenv";
import { query } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("Volley Legends Bot running — we made this bot for your safety");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Express listening on " + PORT);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

const MATCHMAKING_CHANNEL_ID = "1441139756007161906";
const FIND_PLAYERS_CHANNEL_ID = "1441813466787614832";

function parseGameplay(text) {
  const parts = text.split("|").map(v => v.trim());
  return {
    level: parts[0] || "Unknown",
    rank: parts[1] || "Unknown",
    playstyle: parts[2] || "Unknown"
  };
}

function parseCommunication(text) {
  const parts = text.split("|").map(v => v.trim());
  return {
    vc: parts[0] || "Unknown",
    language: parts[1] || "Unknown"
  };
}

const modeStyles = {
  "2v2": { color: "#22C55E", emoji: "🟢", button: ButtonStyle.Success },
  "3v3": { color: "#3B82F6", emoji: "🔵", button: ButtonStyle.Primary },
  "4v4": { color: "#8B5CF6", emoji: "🟣", button: ButtonStyle.Secondary },
  "6v6": { color: "#FACC15", emoji: "🟡", button: ButtonStyle.Secondary }
};

async function getHostStats(id) {
  const result = await query("SELECT * FROM host_stats WHERE user_id=$1", [id]);
  return result.rows[0] || null;
}

async function upsertHostStats(id, gameplay, ability, region, communication, notes, mode) {
  await query(
    `
      INSERT INTO host_stats (user_id, gameplay, ability, region, communication, notes, mode)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (user_id)
      DO UPDATE SET gameplay=$2, ability=$3, region=$4, communication=$5, notes=$6, mode=$7
    `,
    [id, gameplay, ability, region, communication, notes, mode]
  );
}

async function resetRequestCounter(id) {
  await query(
    `
      INSERT INTO request_counter (user_id, count)
      VALUES ($1, 0)
      ON CONFLICT(user_id)
      DO UPDATE SET count = 0
    `,
    [id]
  );
}


async function incrementRequestCounter(id) {
  const r = await query(
    `
      UPDATE request_counter
      SET count = COALESCE(count,0) + 1
      WHERE user_id=$1
      RETURNING count
    `,
    [id]
  );

  if (r.rows.length === 0) {
    const insert = await query(
      `
        INSERT INTO request_counter(user_id, count)
        VALUES ($1, 1)
        RETURNING count
      `,
      [id]
    );
    return insert.rows[0].count;
  }

  return r.rows[0].count;
}

async function updateHostCooldown(id) {
  await query(
    `
      INSERT INTO host_cooldown (user_id, timestamp)
      VALUES ($1, $2)
      ON CONFLICT(user_id)
      DO UPDATE SET timestamp=$2
    `,
    [id, Date.now()]
  );
}

async function checkHostCooldown(id) {
  const r = await query("SELECT timestamp FROM host_cooldown WHERE user_id=$1", [id]);
  if (r.rows.length === 0) return 0;

  const diff = Date.now() - Number(r.rows[0].timestamp);
  if (diff >= 300000) return 0;
  return Math.ceil((300000 - diff) / 60000);
}

async function upsertCooldown(userId, hostId) {
  await query(
    `
      INSERT INTO cooldowns (user_id, host_id, timestamp)
      VALUES ($1,$2,$3)
      ON CONFLICT(user_id, host_id)
      DO UPDATE SET timestamp=$3
    `,
    [userId, hostId, Date.now()]
  );
}

async function resetMatchmakingChannel() {
  const channel = client.channels.cache.get(MATCHMAKING_CHANNEL_ID);
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => {});
  if (messages) await channel.bulkDelete(messages).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Click Create Match to get started.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("create_match").setLabel("Create Match").setStyle(ButtonStyle.Success)
  );

  channel.send({ embeds: [embed], components: [row] });
}

client.once("ready", () => {
  console.log("Logged in as " + client.user.tag);
  resetMatchmakingChannel();
});

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (i.customId !== "create_match") return;

  const cd = await checkHostCooldown(i.user.id);
  if (cd > 0) {
    return i.reply({ content: `Wait ${cd} minutes before creating another match.`, ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Choose your Match Mode")
    .setDescription("Select which team size you want to host.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mode_2v2").setLabel("🟢 2v2").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mode_3v3").setLabel("🔵 3v3").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mode_4v4").setLabel("🟣 4v4").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("mode_6v6").setLabel("🟡 6v6").setStyle(ButtonStyle.Primary)
  );

  i.reply({ embeds: [embed], components: [row], ephemeral: true });
});

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("mode_")) return;

  const mode = i.customId.replace("mode_", "");
  const stats = await getHostStats(i.user.id);

  if (!stats) {
    return openModal(i, false, null, mode);
  }

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Use previous settings?")
    .setDescription("Do you want to reuse your last settings?");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`reuse_yes_${mode}`).setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reuse_no_${mode}`).setLabel("No").setStyle(ButtonStyle.Secondary)
  );

  i.reply({ embeds: [embed], components: [row], ephemeral: true });
});

function openModal(i, autofill, data, mode) {
  const modal = new ModalBuilder().setCustomId(`match_form_${mode}`).setTitle(`Create ${mode.toUpperCase()} Match`);

  const fields = [
    ["gameplay", "Level | Rank | Playstyle", true, TextInputStyle.Short],
    ["ability", "Ability", true, TextInputStyle.Short],
    ["region", "Region", true, TextInputStyle.Short],
    ["comm", "VC | Language", true, TextInputStyle.Short],
    ["notes", "Notes (optional)", false, TextInputStyle.Paragraph]
  ];

  modal.addComponents(
    ...fields.map(([id, label, req, style]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setRequired(req)
          .setStyle(style)
          .setValue(autofill && data ? (id === "comm" ? data.communication : data[id] || "") : "")
      )
    )
  );

  i.showModal(modal);
}

client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (!i.customId.startsWith("match_form_")) return;

  const mode = i.customId.replace("match_form_", "");
  const style = modeStyles[mode] || modeStyles["2v2"];

  const gameplay = i.fields.getTextInputValue("gameplay");
  const ability = i.fields.getTextInputValue("ability");
  const region = i.fields.getTextInputValue("region");
  const comm = i.fields.getTextInputValue("comm");
  const notes = i.fields.getTextInputValue("notes");

  const gp = parseGameplay(gameplay);
  const cm = parseCommunication(comm);
  const user = i.user;

  await upsertHostStats(user.id, gameplay, ability, region, comm, notes, mode);
  await resetRequestCounter(user.id);
  await updateHostCooldown(user.id);

  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 256 }) })
    .setTitle(`${style.emoji} ${mode.toUpperCase()} Match`)
    .setDescription(
      `╔════════ MATCH ════════╗
🏐 Mode: ${mode.toUpperCase()}
👤 Host: ${user}
╚════════════════════════╝

🎯 Gameplay
Level: ${gp.level}
Rank: ${gp.rank}
Playstyle: ${gp.playstyle}

💥 Ability
${ability}

🌍 Region
${region}

🎙 Communication
VC: ${cm.vc}
Language: ${cm.language}

📝 Looking for
${notes || "None"}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`req_${user.id}`).setLabel("Click here to Play Together").setStyle(style.button)
  );

  const channel = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID);
  const msg = await channel.send({ content: `${user}`, embeds: [embed], components: [row] });

  i.reply({ content: "Match created!", ephemeral: true });

  setTimeout(() => {
    const expiredRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("expired").setLabel("Match expired").setStyle(ButtonStyle.Danger)
    );

    msg.edit({
      content: `${user} — Match expired`,
      components: [expiredRow]
    }).catch(() => {});
  }, 240000);
});

client.on("interactionCreate", i => {
  if (!i.isButton()) return;
  if (i.customId === "expired") {
    i.reply({ content: "This match has expired.", ephemeral: true });
  }
});

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("req_")) return;

  const hostId = i.customId.replace("req_", "");
  const requester = i.user;

  await upsertCooldown(requester.id, hostId);
  const count = await incrementRequestCounter(hostId);

  const host = await client.users.fetch(hostId).catch(() => {});
  if (!host) return;

  const original = i.message.embeds[0];

  const embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Send your Volleyball Legends private server link")
    .setDescription(
      `${requester} wants to join your match.

Requests so far: ${count}

Below is the information from your match:

${original.description}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`link_${requester.id}`)
      .setLabel("Send your Volleyball Legends link")
      .setStyle(ButtonStyle.Primary)
  );

  host.send({ embeds: [embed], components: [row] }).catch(() => {});
  i.reply({ content: "Request sent!", ephemeral: true });
});

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!i.customId.startsWith("link_")) return;

  const reqId = i.customId.replace("link_", "");

  const modal = new ModalBuilder()
    .setCustomId(`sendlink_${reqId}`)
    .setTitle("Volleyball Legends private server link")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Enter your Volleyball Legends link")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );

  i.showModal(modal);
});

client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;
  if (!i.customId.startsWith("sendlink_")) return;

  const id = i.customId.replace("sendlink_", "");
  const link = i.fields.getTextInputValue("link").trim();

  const shareRegex = /^https:\/\/www\.roblox\.com\/share\?code=[A-Za-z0-9]+&type=Server$/;
  const vipRegex = /^https:\/\/www\.roblox\.com\/games\/[0-9]+\/[^/?]+\?privateServerLinkCode=[A-Za-z0-9_-]+$/;

  if (!link.startsWith("https://www.roblox.com")) {
    return i.reply({ content: "Roblox links only.", ephemeral: true });
  }

  if (!shareRegex.test(link) && !vipRegex.test(link)) {
    return i.reply({ content: "Invalid private server link format.", ephemeral: true });
  }

  const host = await client.users.fetch(id).catch(() => {});
  if (host) {
    host.send(`Host sent the private link:\n${link}`).catch(() => {});
  }

  i.reply({ content: "The private server link has been sent!", ephemeral: true });
});

client.login(process.env.BOT_TOKEN);