# Foil House bulk submission site

Static site, no build step. Open `index.html` or upload the folder to any static host.

- `index.html`: the three pages (form, shipping help, about) as sections
- `css/styles.css`: all styling; brand colors and fonts are the variables at the top
- `js/config.js`: the submissions email
- `js/main.js`: page navigation and the form
- `images/logo.png`: logo

Still to fill in: the `[X]` business days and `[$X]` postage cap in the policy section of `index.html`.
Submissions open an email with details filled in; photos are attached by the seller. A real backend is needed for automatic uploads.
