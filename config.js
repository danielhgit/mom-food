/* צלחת — public configuration only. Secrets live in the Cloudflare Worker.
   API_URL empty = smart help, reminders and cloud backup are hidden and the
   app runs fully offline on the phone. */
window.CFG = {
  VERSION: '7a9bfab9',
  API_URL: '',            // e.g. https://tzalahat-api.<account>.workers.dev
  VAPID_PUBLIC: '',       // Web Push public key (base64url)
};
