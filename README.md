# Foil House bulk submission site

Static site, no build step. Serve the folder locally or upload it to any static host.

To preview locally, run `python3 -m http.server` from this folder and open
`http://localhost:8000`.

- `index.html`: the page shell, top-level tabs, and form slide navigation controls
- `css/styles.css`: all styling; brand colors and fonts are the variables at the top
- `js/config.js`: the submissions email
- `js/slide.js`: the reusable slide object
- `js/main.js`: the top-level tabs, ordered form slide list, partial loading, navigation, and form
- `public/slides/`: one HTML partial for each form and informational slide
- `images/logo.png`: logo

Still to fill in: the `[X]` business days and `[$X]` postage cap in the policy section of `public/slides/info.html`.
Submissions open an email with details filled in; photos are attached by the seller. A real backend is needed for automatic uploads.
