/** Kept in its own file so later styling passes touch only this. */
import { APP_NAME } from '../../../common/config/app-name.js';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// Inline-styled, table-free but div-based layout: email clients strip <style> blocks
// and don't support CSS var(), so every value here is a literal hex/px and every
// style lives on its element.
export function renderVerificationEmail(code: string): RenderedEmail {
  const fontFamily = "'IBM Plex Sans', Arial, sans-serif";

  return {
    subject: `Kod weryfikacyjny — ${APP_NAME}`,
    text: `Twój kod weryfikacyjny do ${APP_NAME}: ${code}\n\nKod jest aktywny 15 minut.`,
    html: `
<div style="margin:0;padding:24px 12px;background-color:#f2f5fb;font-family:${fontFamily};">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d3ddf1;">
    <div style="background-color:#e9effb;padding:20px 24px;">
      <span style="font-size:18px;font-weight:600;color:#304c89;font-family:${fontFamily};">${APP_NAME}</span>
    </div>
    <div style="padding:28px 24px;text-align:center;">
      <p style="margin:0 0 16px;font-size:14px;color:#14213d;font-family:${fontFamily};">
        Twój kod weryfikacyjny:
      </p>
      <div style="display:inline-block;background-color:#e9effb;border-radius:10px;padding:14px 28px;margin:0 0 16px;">
        <span style="font-size:32px;font-weight:600;letter-spacing:6px;color:#304c89;font-family:${fontFamily};">${code}</span>
      </div>
      <p style="margin:0;font-size:12px;color:#51607e;font-family:${fontFamily};">
        Kod jest aktywny 15 minut.
      </p>
    </div>
  </div>
</div>
`.trim(),
  };
}
