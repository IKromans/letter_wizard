# Burtiņu Burvis

A small Latvian/English typing game for children. The game is a self-contained static HTML page; it needs no server, build step, or external dependencies.

## Run locally

Open `burtinu_burvis.html` in a browser.

## Publish with GitHub Pages

This repository includes a GitHub Actions workflow that publishes the game whenever changes are pushed to `master`. It copies `burtinu_burvis.html` to the site's `index.html`, so the project opens directly at its Pages address.

1. Push the repository to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Set the custom domain to `skanitis.lv` and save it. Its A records should point to GitHub Pages; `www.skanitis.lv` can remain a CNAME to `ikromans.github.io` and redirect to the apex domain.
5. Push a commit to `master`, or start the **Deploy to GitHub Pages** workflow from the **Actions** tab.
6. After the workflow succeeds and HTTPS is available, visit [https://skanitis.lv/](https://skanitis.lv/).

The game runs entirely in the visitor's browser. Preferences, stars, and word history are stored locally in that browser; custom text is not uploaded to a server.
