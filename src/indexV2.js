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
} from "discord.js"

import express from "express"
import dotenv from "dotenv"
import { query } from "./db.js"

dotenv.config()


const app = express()
app.get("/", (req, res) => res.send("Volley Legends Bot running"))
app.listen(3000, () => console.log("Express OK"))

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
})


const MATCHMAKING_CHANNEL_ID = "1441139756007161906"
const FIND_PLAYERS_CHANNEL_ID = "1441813466787614832"


function parseGameplay(t) {
  let s = t.split("|").map(p => p.trim())
  return { level: s[0] || "Unknown", rank: s[1] || "Unknown", playstyle: s[2] || "Unknown" }
}

function parseCommunication(t) {
  let x = t.split("|").map(k => k.trim())
  return { vc: x[0] || "Unknown", language: x[1] || "Unknown" }
}

const modeStyles = {
  "2v2": { color: "#22C55E", emoji: "🟢", button: ButtonStyle.Success },
  "3v3": { color: "#3B82F6", emoji: "🔵", button: ButtonStyle.Primary },
  "4v4": { color: "#8B5CF6", emoji: "🟣", button: ButtonStyle.Secondary },
  "6v6": { color: "#FACC15", emoji: "🟡", button: ButtonStyle.Secondary }
}


async function getHostStats(id) {
  const r = await query(`SELECT * FROM host_stats WHERE user_id=$1`, [id])
  return r.rows[0] || null
}

async function upsertHostStats(id, gameplay, ability, region, communication, notes, mode) {
  await query(`
    INSERT INTO host_stats (user_id, gameplay, ability, region, communication, notes, mode)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (user_id)
    DO UPDATE SET gameplay=$2, ability=$3, region=$4, communication=$5, notes=$6, mode=$7;
  `, [id, gameplay, ability, region, communication, notes, mode])
}

async function resetRequestCounter(id) {
  await query(`
    INSERT INTO request_counter (host_id, count)
    VALUES ($1, 0)
    ON CONFLICT(host_id)
    DO UPDATE SET count = 0;
  `, [id])
}

async function incrementRequestCounter(id) {
  const r = await query(`
    UPDATE request_counter
    SET count = COALESCE(count,0) + 1
    WHERE host_id=$1
    RETURNING count;
  `, [id])

  if (r.rows.length === 0) {
    const insert = await query(`
      INSERT INTO request_counter(host_id, count)
      VALUES ($1, 1)
      RETURNING count;
    `, [id])
    return insert.rows[0].count
  }

  return r.rows[0].count
}

async function updateHostCooldown(id) {
  await query(`
    INSERT INTO host_cooldown (user_id, timestamp)
    VALUES ($1, $2)
    ON CONFLICT(user_id)
    DO UPDATE SET timestamp=$2;
  `, [id, Date.now()])
}

async function checkHostCooldown(id) {
  const r = await query(`SELECT timestamp FROM host_cooldown WHERE user_id=$1`, [id])
  if (r.rows.length === 0) return 0

  let diff = Date.now() - Number(r.rows[0].timestamp)
  if (diff >= 300000) return 0
  return Math.ceil((300000 - diff) / 60000)
}

async function upsertCooldown(userId, hostId) {
  await query(`
    INSERT INTO cooldowns (user_id, host_id, timestamp)
    VALUES ($1,$2,$3)
    ON CONFLICT(user_id, host_id)
    DO UPDATE SET timestamp=$3;
  `, [userId, hostId, Date.now()])
}



async function resetMatchmakingChannel() {
  let ch = client.channels.cache.get(MATCHMAKING_CHANNEL_ID)
  if (!ch) return

  let msgs = await ch.messages.fetch({ limit: 100 }).catch(() => { })
  if (msgs) await ch.bulkDelete(msgs).catch(() => { })

  let e = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Volley Legends Matchmaking")
    .setDescription("Click Create Match to get started.")

  let r = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("create_match").setLabel("Create Match").setStyle(ButtonStyle.Success)
  )

  ch.send({ embeds: [e], components: [r] })
}



client.once("ready", () => {
  console.log("Logged in as " + client.user.tag)
  resetMatchmakingChannel()
})



client.on("interactionCreate", async i => {
  if (!i.isButton()) return
  if (i.customId !== "create_match") return

  let cd = await checkHostCooldown(i.user.id)
  if (cd > 0) {
    return i.reply({ content: `Wait ${cd} minutes before creating another match.`, ephemeral: true })
  }

  let e = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Choose your Match Mode")
    .setDescription("Select which team size you want to host.")

  let r = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mode_2v2").setLabel("🟢 2v2").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mode_3v3").setLabel("🔵 3v3").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mode_4v4").setLabel("🟣 4v4").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("mode_6v6").setLabel("🟡 6v6").setStyle(ButtonStyle.Primary)
  )

  i.reply({ embeds: [e], components: [r], ephemeral: true })
})



client.on("interactionCreate", async i => {
  if (!i.isButton()) return
  if (!i.customId.startsWith("mode_")) return

  let mode = i.customId.replace("mode_", "")
  let stats = await getHostStats(i.user.id)

  if (!stats) {
    return openModal(i, false, null, mode)
  }

  let e = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Use previous settings?")
    .setDescription("Do you want to reuse your last settings?")

  let r = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`reuse_yes_${mode}`).setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reuse_no_${mode}`).setLabel("No").setStyle(ButtonStyle.Secondary)
  )

  i.reply({ embeds: [e], components: [r], ephemeral: true })
})



function openModal(i, autofill, data, mode) {
  let m = new ModalBuilder()
    .setCustomId(`match_form_${mode}`)
    .setTitle(`Create ${mode.toUpperCase()} Match`)

  let fields = [
    ["gameplay", "Level | Rank | Playstyle", true, TextInputStyle.Short],
    ["ability", "Ability", true, TextInputStyle.Short],
    ["region", "Region", true, TextInputStyle.Short],
    ["comm", "VC | Language", true, TextInputStyle.Short],
    ["notes", "Notes (optional)", false, TextInputStyle.Paragraph]
  ]

  m.addComponents(
    ...fields.map(([id, label, req, sty]) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setRequired(req)
          .setStyle(sty)
          .setValue(
            autofill && data
              ? (id === "comm" ? data.communication : data[id] || "")
              : ""
          )
      )
    )
  )

  i.showModal(m)
}



client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return
  if (!i.customId.startsWith("match_form_")) return

  let mode = i.customId.replace("match_form_", "")
  let style = modeStyles[mode] || modeStyles["2v2"]

  let gameplay = i.fields.getTextInputValue("gameplay")
  let ability = i.fields.getTextInputValue("ability")
  let region = i.fields.getTextInputValue("region")
  let comm = i.fields.getTextInputValue("comm")
  let notes = i.fields.getTextInputValue("notes")

  let gp = parseGameplay(gameplay)
  let cm = parseCommunication(comm)
  let u = i.user

  await upsertHostStats(u.id, gameplay, ability, region, comm, notes, mode)
  await resetRequestCounter(u.id)
  await updateHostCooldown(u.id)

  let embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: u.username, iconURL: u.displayAvatarURL({ size: 256 }) })
    .setTitle(`${style.emoji} ${mode.toUpperCase()} Match`)
    .setDescription(
      `╔════════ MATCH ════════╗
🏐 Mode: ${mode.toUpperCase()}
👤 Host: ${u}
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
    )

  let r = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`req_${u.id}`)
      .setLabel("Click here to Play Together")
      .setStyle(style.button)
  )

  let ch = client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID)
  let msg = await ch.send({ content: `${u}`, embeds: [embed], components: [r] })

  i.reply({ content: "Match created!", ephemeral: true })

  setTimeout(() => {
    let expiredRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("expired").setLabel("Match expired").setStyle(ButtonStyle.Danger)
    )
    msg.edit({
      content: `${u} — Match expired`,
      components: [expiredRow]
    }).catch(() => { })
  }, 240000)
})


client.on("interactionCreate", i => {
  if (!i.isButton()) return
  if (i.customId === "expired") {
    return i.reply({ content: "This match has expired.", ephemeral: true })
  }
})


client.on("interactionCreate", async i => {
  if (!i.isButton()) return
  if (!i.customId.startsWith("req_")) return

  let hostId = i.customId.replace("req_", "")
  let requester = i.user

  await upsertCooldown(requester.id, hostId)
  let cnt = await incrementRequestCounter(hostId)

  let host = await client.users.fetch(hostId).catch(() => { })
  if (!host) return

  let originalEmbed = i.message.embeds[0]

  let embed = new EmbedBuilder()
    .setColor("#22C55E")
    .setTitle("Send your Volleyball Legends private server link")
    .setDescription(
      `${requester} wants to join your match.

Requests so far: ${cnt}

Below is the information from your match:

${originalEmbed.description}`
    )

  let r = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`link_${requester.id}`)
      .setLabel("Send your Volleyball Legends link")
      .setStyle(ButtonStyle.Primary)
  )

  host.send({ embeds: [embed], components: [r] }).catch(() => { })

  i.reply({ content: "Request sent!", ephemeral: true })
})


client.on("interactionCreate", async i => {
  if (!i.isButton()) return
  if (!i.customId.startsWith("link_")) return

  let reqId = i.customId.replace("link_", "")

  let m = new ModalBuilder()
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
    )

  i.showModal(m)
})



client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return
  if (!i.customId.startsWith("sendlink_")) return

  let id = i.customId.replace("sendlink_", "")
  let link = i.fields.getTextInputValue("link").trim()

  let shareRegex = /^https:\/\/www\.roblox\.com\/share\?code=[A-Za-z0-9]+&type=Server$/
  let vipRegex = /^https:\/\/www\.roblox\.com\/games\/[0-9]+\/[^/?]+\?privateServerLinkCode=[A-Za-z0-9_-]+$/

  if (!link.startsWith("https://www.roblox.com"))
    return i.reply({ content: "Roblox links only.", ephemeral: true })

  if (!shareRegex.test(link) && !vipRegex.test(link))
    return i.reply({ content: "Invalid private server link format.", ephemeral: true })

  let host = await client.users.fetch(id).catch(() => { })
  if (host) {
    host.send(`Host sent the private link:\n${link}`).catch(() => { })
  }

  i.reply({ content: "The private server link has been sent!", ephemeral: true })
})

client.login(process.env.BOT_TOKEN)
