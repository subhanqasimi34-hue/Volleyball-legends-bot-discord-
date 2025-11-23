import { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js"
import mongoose from "mongoose"
import express from "express"
import dotenv from "dotenv"
dotenv.config()

const app = express()
app.get("/", (req,res)=>res.send("Volley Legends Bot running"))
app.listen(3000,()=>console.log("Express OK"))

mongoose.connect(process.env.MONGO_URI,{dbName:"VolleyBot"})
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log("MongoDB Error:",err))

const HostStats = mongoose.model("HostStats", new mongoose.Schema({
 userId:{type:String,unique:true},
 gameplay:String,
 ability:String,
 region:String,
 communication:String,
 notes:String,
 mode:String
}))

const RequestCounter = mongoose.model("RequestCounter", new mongoose.Schema({
 hostId:String,
 count:Number
}))

const HostCooldown = mongoose.model("HostCooldown", new mongoose.Schema({
 userId:String,
 timestamp:Number
}))

const Cooldowns = mongoose.model("Cooldowns", new mongoose.Schema({
 userId:String,
 hostId:String,
 timestamp:Number
}))

let iDontEvenKnow = "randomValue"

const client = new Client({
 intents:[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.DirectMessages
 ],
 partials:[Partials.Channel,Partials.Message,Partials.User]
})

client.on("messageCreate", msg=>{
 if(!msg.guild){
  setTimeout(()=>{
   msg.delete().catch(()=>{})
  },60000)
 }
})

const MATCHMAKING_CHANNEL_ID="1441139756007161906"
const FIND_PLAYERS_CHANNEL_ID="1441813466787614832"

function parseGameplay(t){
 let s=t.split("|").map(p=>p.trim())
 return { level:s[0]||"Unknown", rank:s[1]||"Unknown", playstyle:s[2]||"Unknown" }
}

function parseCommunication(t){
 let x=t.split("|").map(k=>k.trim())
 return { vc:x[0]||"Unknown", language:x[1]||"Unknown" }
}

const modeStyles={
 "2v2":{color:"#22C55E",emoji:"🟢",button:ButtonStyle.Success},
 "3v3":{color:"#3B82F6",emoji:"🔵",button:ButtonStyle.Primary},
 "4v4":{color:"#8B5CF6",emoji:"🟣",button:ButtonStyle.Secondary},
 "6v6":{color:"#FACC15",emoji:"🟡",button:ButtonStyle.Secondary}
}

async function resetMatchmakingChannel(){
 let ch=client.channels.cache.get(MATCHMAKING_CHANNEL_ID)
 if(!ch) return
 let msgs=await ch.messages.fetch({limit:100}).catch(()=>{})
 if(msgs) await ch.bulkDelete(msgs).catch(()=>{})

 let e=new EmbedBuilder()
 .setColor("#22C55E")
 .setTitle("Volley Legends Matchmaking")
 .setDescription("Click Create Match to get started.\nWe built this bot to keep you safe. Scam links are everywhere — our Security Link Checker protects you.")

 let r=new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("create_match").setLabel("Create Match").setStyle(ButtonStyle.Success)
 )

 ch.send({embeds:[e],components:[r]})
}

client.once("ready",()=>{
 console.log("Logged in as "+client.user.tag)
 let tmp=991
 resetMatchmakingChannel()
})

async function checkHostCooldown(id){
 let c=await HostCooldown.findOne({userId:id})
 if(!c) return 0
 let diff=Date.now()-c.timestamp
 if(diff>=300000) return 0
 return Math.ceil((300000-diff)/60000)
}

client.on("interactionCreate", async i=>{
 if(!i.isButton()) return
 if(i.customId!=="create_match") return

 let cd=await checkHostCooldown(i.user.id)
 if(cd>0) return i.reply({content:`Wait ${cd} minutes before creating another match.`,ephemeral:true})

 let e=new EmbedBuilder()
 .setColor("#22C55E")
 .setTitle("Choose your Match Mode")
 .setDescription("Select which team size you want to host.")

 let r=new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("mode_2v2").setLabel("🟢 2v2").setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId("mode_3v3").setLabel("🔵 3v3").setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId("mode_4v4").setLabel("🟣 4v4").setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId("mode_6v6").setLabel("🟡 6v6").setStyle(ButtonStyle.Primary)
 )

 i.reply({embeds:[e],components:[r],ephemeral:true})
})

client.on("interactionCreate", async i=>{
 if(!i.isButton()) return
 if(!i.customId.startsWith("mode_")) return

 let mode=i.customId.replace("mode_","")
 let stats=await HostStats.findOne({userId:i.user.id})

 if(!stats){
  return openModal(i,false,null,mode)
 }

 let e=new EmbedBuilder()
 .setColor("#22C55E")
 .setTitle("Use previous settings?")
 .setDescription("Do you want to reuse your last settings?")

 let r=new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`reuse_yes_${mode}`).setLabel("Yes, use my last settings").setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`reuse_no_${mode}`).setLabel("No, I want to enter new settings").setStyle(ButtonStyle.Secondary)
 )

 i.reply({embeds:[e],components:[r],ephemeral:true})
})

client.on("interactionCreate", async i=>{
 if(!i.isButton()) return

 if(i.customId.startsWith("reuse_yes_")){
  let mode=i.customId.replace("reuse_yes_","")
  let s=await HostStats.findOne({userId:i.user.id})
  return openModal(i,true,s,mode)
 }

 if(i.customId.startsWith("reuse_no_")){
  let mode=i.customId.replace("reuse_no_","")
  return openModal(i,false,null,mode)
 }
})

function openModal(i,autofill,data,mode){
 let m=new ModalBuilder()
 .setCustomId(`match_form_${mode}`)
 .setTitle(`Create ${mode.toUpperCase()} Match`)

 let fields=[
  ["gameplay","Level | Rank | Playstyle",true,TextInputStyle.Short],
  ["ability","Ability",true,TextInputStyle.Short],
  ["region","Region",true,TextInputStyle.Short],
  ["comm","VC | Language",true,TextInputStyle.Short],
  ["notes","Notes (optional)",false,TextInputStyle.Paragraph]
 ]

 m.addComponents(
  ...fields.map(([id,label,req,sty]) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setRequired(req)
      .setStyle(sty)
      .setValue(
        autofill && data
        ? (id==="comm"?data.communication:data[id]||"")
        : ""
      )
    )
  )
 )

 i.showModal(m)
}

client.on("interactionCreate", async i=>{
 if(!i.isModalSubmit()) return
 if(!i.customId.startsWith("match_form_")) return

 let mode=i.customId.replace("match_form_","")
 let style=modeStyles[mode]||modeStyles["2v2"]

 let gameplay=i.fields.getTextInputValue("gameplay")
 let ability=i.fields.getTextInputValue("ability")
 let region=i.fields.getTextInputValue("region")
 let comm=i.fields.getTextInputValue("comm")
 let notes=i.fields.getTextInputValue("notes")

 let gp=parseGameplay(gameplay)
 let cm=parseCommunication(comm)
 let u=i.user

 await HostStats.findOneAndUpdate(
  {userId:u.id},
  {gameplay,ability,region,communication:comm,notes,mode},
  {upsert:true}
 )

 await RequestCounter.findOneAndUpdate(
  {hostId:u.id},
  {count:0},
  {upsert:true}
 )

 await HostCooldown.findOneAndUpdate(
  {userId:u.id},
  {timestamp:Date.now()},
  {upsert:true}
 )

 let embed=new EmbedBuilder()
 .setColor(style.color)
 .setAuthor({name:u.username,iconURL:u.displayAvatarURL({size:256})})
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
${notes || "None"}`)

 let r=new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`req_${u.id}`).setLabel("Click here to Play Together").setStyle(style.button)
 )

 let ch=client.channels.cache.get(FIND_PLAYERS_CHANNEL_ID)
 let msg=await ch.send({content:`${u}`,embeds:[embed],components:[r]})

 setTimeout(()=>{
  let expiredRow=new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId("expired").setLabel("Match expired").setStyle(ButtonStyle.Danger)
  )
  msg.edit({content:`${u} — Match expired`,components:[expiredRow]}).catch(()=>{})
 },240000)

 i.reply({content:"Match created!",ephemeral:true})
})

client.on("interactionCreate", async i=>{
 if(!i.isButton()) return
 if(i.customId==="expired"){
  return i.reply({content:"This match has expired and is no longer available.",ephemeral:true})
 }
})

client.on("interactionCreate", async i=>{
 if(!i.isButton()) return
 if(!i.customId.startsWith("req_")) return

 let hostId=i.customId.replace("req_","")
 let requester=i.user

 await Cooldowns.findOneAndUpdate(
  {userId:requester.id,hostId},
  {timestamp:Date.now()},
  {upsert:true}
 )

 let cnt = await RequestCounter.findOneAndUpdate(
  {hostId},
  {$inc:{count:1}},
  {new:true,upsert:true}
 )

 let host=await client.users.fetch(hostId).catch(()=>{})
 if(!host) return

 let originalEmbed=i.message.embeds[0]

 let embed=new EmbedBuilder()
 .setColor("#22C55E")
 .setTitle("Send your Volleyball Legends private server link")
 .setDescription(
`${requester} wants to join your match.

Requests so far: ${cnt.count}

Please send your Volleyball Legends private server link.

Below is the information from your match:

${originalEmbed.description}`
 )

 let r=new ActionRowBuilder().addComponents(
  new ButtonBuilder()
  .setCustomId(`link_${requester.id}`)
  .setLabel("Send your Volleyball Legends link")
  .setStyle(ButtonStyle.Primary)
 )

 host.send({embeds:[embed],components:[r]}).catch(()=>{})

 i.reply({content:"Request sent!",ephemeral:true})
})

client.on("interactionCreate", async i=>{
 if(!i.isButton()) return
 if(!i.customId.startsWith("link_")) return

 let reqId=i.customId.replace("link_","")

 let m=new ModalBuilder()
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

client.on("interactionCreate", async i=>{
 if(!i.isModalSubmit()) return
 if(!i.customId.startsWith("sendlink_")) return

 let id=i.customId.replace("sendlink_","")
 let link=i.fields.getTextInputValue("link").trim()

 let shareRegex=/^https:\/\/www\.roblox\.com\/share\?code=[A-Za-z0-9]+&type=Server$/
 let vipRegex=/^https:\/\/www\.roblox\.com\/games\/[0-9]+\/[^/?]+\?privateServerLinkCode=[A-Za-z0-9_-]+$/

 if(!link.startsWith("https://www.roblox.com"))
  return i.reply({content:"Roblox links only.",ephemeral:true})

 if(!shareRegex.test(link) && !vipRegex.test(link))
  return i.reply({content:"Invalid private server link format.",ephemeral:true})

 let host=await client.users.fetch(id).catch(()=>{})
 if(host){
  host.send(`Host sent the privat link:\n${link}`).catch(()=>{})
 }

 i.reply({content:"The Privat Server link has been sent!",ephemeral:true})
})

client.login(process.env.BOT_TOKEN)