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
Submissions are saved to Firestore after authentication; uploaded photos remain in the local submission directory for now.

## Google sign-in setup

The site now requires Google sign-in before showing the submission form. To configure it:

1. Create a Web OAuth client in Google Cloud Console under APIs & Services > Credentials.
2. Add `http://localhost:3000` and your production origin as authorized JavaScript origins.
3. Copy `env.example` to `.env`, set `GOOGLE_CLIENT_ID`, and set `AUTH_SESSION_SECRET` to a long random value.
4. Restart the server.

Google accounts are verified by the server and kept in a signed, HTTP-only session cookie. The authenticated user is available as `req.user` for persistence in the optional Firestore integration below.

## Firestore setup

Firestore is optional until configured. The current integration stores authenticated profiles in `users/{googleUserId}` and submissions in `users/{googleUserId}/submissions/{submissionId}` while retaining the local submission files and photos.

1. Open the [Firebase console](https://console.firebase.google.com/) and create or select the same project used for Google sign-in.
2. Open **Build > Firestore Database**, click **Create database**, and choose a region. The server uses the Admin SDK, so choose production mode.
3. Open **Project settings > Service accounts**, choose **Firebase Admin SDK**, and click **Generate new private key**.
4. Save the downloaded JSON as `firebase-service-account.json` in the project root. Never commit or upload it.
5. Set `FIREBASE_PROJECT_ID` in `.env` to the Firebase project ID. The `GOOGLE_APPLICATION_CREDENTIALS` path can remain `./firebase-service-account.json`.
6. Restart the server. It will log `Firestore enabled for project ...` when the connection is active.

Firestore's current free quota includes 1 GiB stored data, 50,000 document reads/day, 20,000 document writes/day, 20,000 document deletes/day, and 10 GiB/month outbound transfer. Monitor usage in the Firebase console and add a budget alert before enabling billing.
