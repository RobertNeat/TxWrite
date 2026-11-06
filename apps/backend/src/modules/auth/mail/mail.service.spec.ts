import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service.js';
import { renderVerificationEmail } from './verification-email.template.js';
import { APP_NAME } from '../../../common/config/app-name.js';

describe('MailService', () => {
  it('does not throw when SMTP is unconfigured (logs instead of sending)', async () => {
    const service = new MailService({
      get: () => undefined,
    } as unknown as ConfigService);
    await expect(
      service.sendVerificationCode('alice@example.com', '123456'),
    ).resolves.toBeUndefined();
  });
});

describe('renderVerificationEmail', () => {
  it('includes the app name in the subject and the code in the html', () => {
    const message = renderVerificationEmail('123456');
    expect(message.subject).toContain(APP_NAME);
    expect(message.text).toContain(APP_NAME);
    expect(message.html).toContain('123456');
    expect(message.html).toContain(APP_NAME);
  });
});
