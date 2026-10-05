# Mississauga Chess Club website redesign

A faster, responsive redesign concept of the Mississauga Chess Club site. It is not the official club site. The home page is `index.html` at the top of this folder, so it works on GitHub Pages as is.

## Put it on GitHub Pages

1. Create a GitHub repository and upload everything in this folder, keeping the structure. Do not upload a `.env` file.
2. In the repository, open Settings, then Pages, choose the main branch and the root folder, and save.
3. Your site appears at https://yourname.github.io/reponame/.

## Make the forms send email

GitHub Pages only hosts static files, so the forms need the small server in the `server` folder running somewhere else. The steps are in `server/README.md`. In short: host it, then put its https address in `assets/config.js`, and put your GitHub Pages address in the server's ALLOWED_ORIGINS. Until that is done, the forms show an error and send nothing.

## Folder map

- `index.html` and the other `.html` files are the pages.
- `assets/` holds the styles, scripts, images and `config.js`.
- `server/` is the form server. It is not part of the public site.
