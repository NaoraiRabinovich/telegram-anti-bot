import { Bot } from "gramio";

const bot = new Bot({
  token: process.env.BOT_TOKEN as string,
});

bot.start();
console.log("Bot is running");
