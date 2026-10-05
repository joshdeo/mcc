# Club form server

This small Node server receives the waitlist, volunteer and contact forms and emails each one to the address in MAIL_TO. The website itself is static and lives on GitHub Pages. This server runs somewhere else, because GitHub Pages cannot run Node.

## What you need

Node.js 18 or newer, and an email account that can send through SMTP. For Gmail, turn on two step verification, then create an app password at https://myaccount.google.com/apppasswords. Use that app password, never the normal account password.

## Run it

1. In this `server` folder run `npm install`.
2. Copy `.env.example` to a new file named `.env` and fill in SMTP_USER, SMTP_PASS and MAIL_FROM.
3. Set ALLOWED_ORIGINS to your GitHub Pages address, for example `https://yourname.github.io`. If the site has a path such as `/chess`, still use only the part before the path.
4. Run `npm start`. The server checks the SMTP login on startup and refuses to start if it is missing or wrong, so you never get a form that looks like it works but sends nothing.
5. Open http://localhost:3000, which serves the site too, and send a test message.

For a trial run that prints emails instead of sending them, set DRY_RUN=1.

## Hosting it

Any host that runs a Node app works, such as Render, Railway, Fly.io or a small VPS. Set the start command to `npm start` with the `server` folder as the root, add the `.env` values as environment variables in the host's dashboard, and set SERVE_SITE=0 and TRUST_PROXY=1. Once it has a public https address, open `assets/config.js` in the site and set:

    window.MCC_FORM_ENDPOINT = 'https://your-server.example.com/api/submit';

Commit that change and the forms on GitHub Pages will send through your server.

## Protections

- Each visitor can send 5 messages per 10 minutes, and the whole site is capped at 120 per hour.
- Only known forms and fields are accepted, with length and format checks. Youth waitlist entries must include an age and a parent or guardian.
- A hidden trap field catches simple bots. They get a fake success and nothing is sent.
- Everything is escaped in the email, and short fields are forced onto one line so no one can inject headers.
- Only the origins in ALLOWED_ORIGINS may post from a browser.
- Messages arrive with Reply To set to the sender, so you can answer by pressing reply.

## Keep private

Never commit or share `.env`. The included `.gitignore` already excludes it.
