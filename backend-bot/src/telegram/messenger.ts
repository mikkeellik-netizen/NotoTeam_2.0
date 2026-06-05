import { InlineKeyboard, type Bot } from "grammy";

export class GrammyMessenger {
  constructor(private bot: Bot) {}

  async sendMessage(telegramId: string, text: string, options?: { webAppUrl?: string }) {
    const keyboard = options?.webAppUrl && /^https:\/\//i.test(options.webAppUrl)
      ? new InlineKeyboard().webApp("Открыть в приложении", options.webAppUrl)
      : undefined;

    try {
      await this.bot.api.sendMessage(telegramId, text, {
        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/parse|entity|markdown/i.test(message)) throw error;
      await this.bot.api.sendMessage(telegramId, unescapeMarkdownV2(text), {
        reply_markup: keyboard,
      });
    }
  }
}

function unescapeMarkdownV2(text: string) {
  return text.replace(/\\([_*[\]()~`>#+\-=|{}.!])/g, "$1");
}
