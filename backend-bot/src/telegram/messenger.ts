import { InlineKeyboard, InputFile, type Bot } from "grammy";
import type { BotOutboxAttachment } from "../ports.js";

export class GrammyMessenger {
  constructor(private bot: Bot) {}

  async sendMessage(
    telegramId: string,
    text: string,
    options?: { webAppUrl?: string; attachment?: BotOutboxAttachment },
  ) {
    const keyboard = options?.webAppUrl && /^https:\/\//i.test(options.webAppUrl)
      ? new InlineKeyboard().webApp("Открыть в приложении", options.webAppUrl)
      : undefined;

    if (options?.attachment) {
      await this.sendDocument(telegramId, text, options.attachment, keyboard);
      return;
    }

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

  private async sendDocument(
    telegramId: string,
    text: string,
    attachment: BotOutboxAttachment,
    keyboard?: InlineKeyboard,
  ) {
    const buffer = Buffer.from(attachment.content, attachment.encoding === "base64" ? "base64" : "utf8");
    const file = new InputFile(buffer, attachment.fileName);
    const caption = text.slice(0, 900);

    try {
      await this.bot.api.sendDocument(telegramId, file, {
        caption,
        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/parse|entity|markdown/i.test(message)) throw error;
      await this.bot.api.sendDocument(telegramId, file, {
        caption: unescapeMarkdownV2(caption),
        reply_markup: keyboard,
      });
    }
  }
}

function unescapeMarkdownV2(text: string) {
  return text.replace(/\\([_*[\]()~`>#+\-=|{}.!])/g, "$1");
}
