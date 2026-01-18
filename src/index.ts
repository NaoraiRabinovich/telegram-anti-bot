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
    await sendCaptcha(ctx, chatId, user.id);
  }
});
// טיפול בלחיצה על כפתור ה-Captcha ואימות המשתמש
bot.on("callback_query", async (ctx: any) => {
  const data = ctx.data;
  if (!data) return;

  if (!data.startsWith("verify:")) return;

  const expectedUserId = Number(data.split(":")[1]);
  const clickerId = ctx.from.id;
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  if (clickerId !== expectedUserId) {
    await ctx.answerCallbackQuery({
      text: "זה לא בשבילך 🙂",
      show_alert: true,
    });
    return;
  }

  await unrestrictUser(ctx, chatId, clickerId);

  await ctx.answerCallbackQuery({
    text: "אומתת בהצלחה ✅",
  });

  const message = ctx.message;
  if (message) {
    await ctx.bot.api.editMessageText(
      chatId,
      message.message_id,
      "✅ אימות הושלם, ברוך הבא!",
    );
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
async function unrestrictUser(ctx: any, chatId: number, userId: number) {
  await ctx.api.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages: true,
      can_send_media_messages: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
      can_change_info: false,
      can_invite_users: true,
      can_pin_messages: false,
    },
  });
}

// שליחת Captcha עם כפתור
async function sendCaptcha(ctx: any, chatId: number, userId: number) {
  await ctx.api.sendMessage(chatId, "אימות אנושי: לחץ על הכפתור 👇", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "אני בן אדם 🤖❌",
            callback_data: `verify:${userId}`,
          },
        ],
      ],
    },
  });
}

bot.start();
