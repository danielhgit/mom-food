/* צלחת — public configuration only. Secrets live in the Cloudflare Worker.
   API_URL empty = smart help, reminders and cloud backup are hidden and the
   app runs fully offline on the phone. */
window.CFG = {
  VERSION: 'efe1588a',
  API_URL: 'https://tzalahat-api.daniel2009ha.workers.dev',
  VAPID_PUBLIC: 'BG0PEA4FQ1HPvcMrW1ORQQnXOiZWoys-xZ2g0jNpYjedvfbGSZDFcrgygBAqIeNbAsnK0AxunNfNORecBSDgiJg',       // Web Push public key (base64url)
};
