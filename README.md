# Skanītis — Burvju spēles

A small Latvian/English game site for children, with a typing game and a math game. Both games are self-contained static HTML pages; no server, build step, or external dependencies are required.

## Run locally

Open `index.html` in a browser to choose a game. The typing and math games are also available directly from `burtinu_burvis.html` and `ciparu_burvis.html`.

## Publish with GitHub Pages

This repository includes a GitHub Actions workflow that publishes the site whenever changes are pushed to `master`. It publishes the landing page and both games, so visitors can choose a game at the site's home page.

1. Push the repository to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Set the custom domain to `skanitis.lv` and save it. Its A records should point to GitHub Pages; `www.skanitis.lv` can remain a CNAME to `ikromans.github.io` and redirect to the apex domain.
5. Push a commit to `master`, or start the **Deploy to GitHub Pages** workflow from the **Actions** tab.
6. After the workflow succeeds and HTTPS is available, visit [https://skanitis.lv/](https://skanitis.lv/).

The games run entirely in the visitor's browser. Language, color theme, sound preferences, stars, and word history are stored locally in that browser; custom typing text is not uploaded to a server.
