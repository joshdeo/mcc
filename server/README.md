# Club form server

This small server does two jobs. It serves the club website, and it receives the waitlist, volunteer and contact forms and emails each one to the address set in MAIL_TO, which is currently joshua.deosaran@gmail.com.

## What you need

Node.js version 18 or newer, and an email account that can send through SMTP. For a Gmail address, turn on two step verification and create an app password. Use that app password below, never the normal account password.

## Setup

1. Put the `site` folder and this `server` folder side by side, exactly as they came.
2. Open a terminal in the `server` folder and run `npm install`.
3. Copy `.env.example` to a new file named `.env` and fill in the SMTP details.
4. Run `npm start`.
5. Open http://localhost:3000 and submit a form. The email arrives at the address in MAIL_TO. To send forms somewhere else, change MAIL_TO in `.env`. The email app backup on the site pages uses a fixed address, set once when the site is built.

Until SMTP_HOST is filled in, the server runs in test mode. It prints each submission in the terminal instead of sending it, which is a safe way to try everything first.

## What it protects against

- Each person can send 5 messages per 10 minutes, and the whole site is capped at 120 per hour.
- Only the known forms and fields are accepted, with length limits and a check that the email address is shaped correctly.
- A hidden trap field catches simple spam bots. They get a fake success and nothing is sent.
- Everything is escaped in the email, so nobody can inject markup or extra email headers.
- Messages arrive with Reply To set to the sender, so the club can answer by pressing reply.

## If the server is down

The website forms fall back automatically. If the server cannot be reached, the form opens the visitor's email app with the message ready to send, and shows a copy box as a last resort. Nobody loses their message.

## Settings reference

All settings are in `.env`. MAIL_TO is where messages go. ALLOWED_ORIGIN restricts which site may post to the server. TRUST_PROXY should be 1 only when the server runs behind a proxy. PORT changes the port.

## Good to know

This server is what makes the forms send directly. It has to run somewhere that stays on, and whoever runs it owns the SMTP login and should keep the `.env` file private. Submissions are emailed and not stored anywhere else.
