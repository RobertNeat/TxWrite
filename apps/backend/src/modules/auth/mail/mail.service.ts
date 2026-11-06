import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { renderVerificationEmail } from './verification-email.template.js';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'no-reply@localhost');
    const host = config.get<string>('SMTP_HOST');
    if (!host) {
      // No SMTP configured (local dev default) — codes are logged instead of
      // emailed so registration isn't blocked on having a mail server.
      this.transporter = null;
      return;
    }
    this.transporter = createTransport({
      host,
      port: Number(config.get<string>('SMTP_PORT', '587')),
      secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: config.get<string>('SMTP_USER')
        ? {
            user: config.get<string>('SMTP_USER'),
            pass: config.get<string>('SMTP_PASS'),
          }
        : undefined,
    });
  }

  async sendVerificationCode(email: string, code: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured — verification code for ${email}: ${code}`,
      );
      return;
    }
    const message = renderVerificationEmail(code);
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      // The user row already exists at this point; failing the request
      // would just dead-end them, since retrying hits a 409. Resend covers it.
      this.logger.error(
        `Failed to send verification email to ${email}`,
        error as Error,
      );
    }
  }
}
