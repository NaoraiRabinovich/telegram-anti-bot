import { Bot } from "gramio";
import * as dotenv from "dotenv";

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN!);

console.log("🤖 Bot started");

// מאזין לכניסת משתמשים חדשים
bot.on("new_chat_members", async (ctx) => {
  const chatId = ctx.chat.id;
  const newMembers = ctx.newChatMembers;
  if (!newMembers) return;

  for (const user of newMembers) {
    if (user.isBot()) continue; // isBot היא פונקציה

    const isAdmin = await isUserAdmin(ctx, user.id);
    if (isAdmin) continue;

    await restrictUser(ctx, chatId, user.id);
    console.log(`🔒 User ${user.id} restricted`);
  }
});

// בדיקה אם משתמש אדמין
async function isUserAdmin(ctx: any, userId: number): Promise<boolean> {
  const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
  return admins.some((admin: any) => admin.user?.id === userId);
}

// Restrict למשתמש
async function restrictUser(ctx: any, chatId: number, userId: number) {
  await ctx.api.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
      can_change_info: false,
      can_invite_users: false,
      can_pin_messages: false,
    },
  });
}

bot.start();
