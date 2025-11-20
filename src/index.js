import { Client, GatewayIntentBits } from 'discord.js';
import express from 'express';

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(3000, () => console.log('Express running'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);
