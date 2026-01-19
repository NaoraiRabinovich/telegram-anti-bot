import { Bot } from "gramio";
import * as dotenv from "dotenv";

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN!);
console.log("🤖 Bot started");

// ================================
// Types & State
// ================================

// Captcha state per user
type Challenge = {
  chatId: number;
  userId: number;
  correct: number;
  messageId: number;
  timeoutId: NodeJS.Timeout;
};

// key = `${chatId}:${userId}`
const pending = new Map<string, Challenge>();

const CAPTCHA_TIMEOUT_MS = 120_000; // 120 seconds

// ================================
// Member Join Detection (Reliable)
// ================================

// Detect new members using chat_member (reliable in supergroups)
bot.on("chat_member", async (ctx: any) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const update = ctx.chatMember;
  if (!update) return;

  const user = update.new_chat_member?.user;
  if (!user) return;

  // Only real joins: left -> member
  if (update.old_chat_member?.status !== "left") return;
  if (update.new_chat_member?.status !== "member") return;

  // Ignore bots
  if (user.isBot()) return;

  // Ignore admins
  const isAdmin = await isUserAdmin(ctx, user.id);
  if (isAdmin) return;

  try {
    await restrictUser(ctx, chatId, user.id);
    await sendMathCaptcha(ctx, chatId, user.id, user.firstName ?? "משתמש");
    console.log(`🆕 User joined & captcha sent: ${user.id}`);
  } catch (e) {
    console.error("join handling failed:", e);
  }
});

// ================================
// Captcha Button Handler
// ================================

// Handle captcha answer clicks
bot.on("callback_query", async (ctx: any) => {
  const data: string | undefined = ctx.data;
  if (!data || !data.startsWith("captcha:")) return;

  // captcha:<userId>:<answer>
  const [, userIdStr, answerStr] = data.split(":");
  const expectedUserId = Number(userIdStr);
  const chosenAnswer = Number(answerStr);

  const clickerId = ctx.from.id;
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Only challenged user can click
  if (clickerId !== expectedUserId) {
    await safeAnswerCallback(ctx, "זה לא המבחן שלך 🙂", true);
    return;
  }

  const key = makeKey(chatId, expectedUserId);
  const challenge = pending.get(key);

  // Expired or already handled
  if (!challenge) {
    await safeAnswerCallback(ctx, "האימות כבר הסתיים או שפג תוקף ⏳", true);
    return;
  }

  // Stop timeout & clean message
  clearTimeout(challenge.timeoutId);
  await safeDeleteMessage(ctx, chatId, challenge.messageId);

  if (chosenAnswer === challenge.correct) {
    // Correct answer
    try {
      await unrestrictUser(ctx, chatId, expectedUserId);
      await safeAnswerCallback(ctx, "אומתת בהצלחה ✅", false);
      await safeSendMessage(
        ctx,
        chatId,
        "🎉 ברוך הבא! עכשיו אפשר לכתוב בקבוצה.",
      );
    } catch (e) {
      console.error("unrestrict failed:", e);
      await safeAnswerCallback(
        ctx,
        "אומתת ✅ אבל אין לי הרשאות לשחרר אותך.",
        true,
      );
    } finally {
      pending.delete(key);
    }
    return;
  }

  // Wrong answer → kick
  await safeAnswerCallback(ctx, "טעות ❌", true);
  await kickUser(ctx, chatId, expectedUserId);
  pending.delete(key);
});

// ================================
// Helpers
// ================================

function makeKey(chatId: number, userId: number) {
  return `${chatId}:${userId}`;
}

// Check admin status
async function isUserAdmin(ctx: any, userId: number): Promise<boolean> {
  try {
    const admins = await ctx.bot.api.getChatAdministrators(ctx.chat.id);
    return admins.some((a: any) => a.user?.id === userId);
  } catch {
    return false;
  }
}

// Restrict user immediately
async function restrictUser(ctx: any, chatId: number, userId: number) {
  await ctx.bot.api.restrictChatMember(chatId, userId, {
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

// Restore permissions
async function unrestrictUser(ctx: any, chatId: number, userId: number) {
  await ctx.bot.api.restrictChatMember(chatId, userId, {
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

// Kick = ban + unban
async function kickUser(ctx: any, chatId: number, userId: number) {
  try {
    await ctx.bot.api.banChatMember(chatId, userId);
    await ctx.bot.api.unbanChatMember(chatId, userId);
  } catch (e) {
    console.error("kick failed:", e);
  }
}

// Send math captcha with 4 options
async function sendMathCaptcha(
  ctx: any,
  chatId: number,
  userId: number,
  name: string,
) {
  const key = makeKey(chatId, userId);

  // Avoid duplicates
  const existing = pending.get(key);
  if (existing) {
    clearTimeout(existing.timeoutId);
    await safeDeleteMessage(ctx, chatId, existing.messageId);
    pending.delete(key);
  }

  const x = randInt(1, 9);
  const y = randInt(1, 9);
  const correct = x + y;

  const options = buildOptions(correct);
  const keyboard = to2x2Keyboard(options, userId);

  const text = `ברוך הבא ${name}!\nכדי להתחיל לכתוב בקבוצה, עליך לפתור:\n\n${x} + ${y} = ?`;

  const sent = await ctx.bot.api.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: keyboard },
  });

  const timeoutId = setTimeout(async () => {
    const ch = pending.get(key);
    if (!ch) return;
    await safeDeleteMessage(ctx, chatId, ch.messageId);
    await kickUser(ctx, chatId, userId);
    pending.delete(key);
  }, CAPTCHA_TIMEOUT_MS);

  pending.set(key, {
    chatId,
    userId,
    correct,
    messageId: sent.message_id,
    timeoutId,
  });
}

// Build 4 options (1 correct + 3 wrong)
function buildOptions(correct: number): number[] {
  const set = new Set<number>([correct]);
  while (set.size < 4) {
    const delta = randInt(-6, 6);
    const candidate = correct + delta;
    if (candidate > 0) set.add(candidate);
  }
  const arr = Array.from(set);
  shuffle(arr);
  return arr;
}

// Inline keyboard 2x2
function to2x2Keyboard(options: number[], userId: number) {
  return [
    [
      {
        text: String(options[0]),
        callback_data: `captcha:${userId}:${options[0]}`,
      },
      {
        text: String(options[1]),
        callback_data: `captcha:${userId}:${options[1]}`,
      },
    ],
    [
      {
        text: String(options[2]),
        callback_data: `captcha:${userId}:${options[2]}`,
      },
      {
        text: String(options[3]),
        callback_data: `captcha:${userId}:${options[3]}`,
      },
    ],
  ];
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Safe wrappers (avoid crashes on missing permissions)
async function safeAnswerCallback(ctx: any, text: string, alert: boolean) {
  try {
    await ctx.answerCallbackQuery({ text, show_alert: alert });
  } catch {}
}

async function safeDeleteMessage(ctx: any, chatId: number, messageId: number) {
  try {
    await ctx.bot.api.deleteMessage(chatId, messageId);
  } catch {}
}

async function safeSendMessage(ctx: any, chatId: number, text: string) {
  try {
    await ctx.bot.api.sendMessage(chatId, text);
  } catch {}
}

bot.start();
