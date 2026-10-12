NORTHFIELD BANK - PRACTICE PROJECT
Customer app + admin page + customer service live chat (Firebase)

FILES
index.html, style.css, app.js     Customer site
admin.html, admin.js              Admin page: all accounts + live chat inbox
firebase-config.js                Your Firebase keys and admin email
firestore.rules                   Complete Firestore rules (paste into Firebase)

ONE-TIME SETUP
1. Firebase console > Authentication > Sign-in method: turn on Email/Password.
2. Firebase console > Firestore Database: create the database.
3. firebase-config.js: check your keys, and replace YOUR_EMAIL@gmail.com with your admin email.
4. Authentication > Users > Add user: add that same email with a password.
   Copy that user's UID (shown in the Users list).
5. Firestore Database > Start collection:
     Collection ID:  supportAgents
     Document ID:    (paste the UID)
     Field:          role   (string)   =   admin
6. Firestore Database > Rules: delete everything, paste the contents of firestore.rules, tap Publish.
   (Do not paste only the chat rules, or signup and transactions will stop working.)

ACCOUNT NAME LOOKUP (PAYSTACK)
- The transfer form loads Nigerian bank names and verifies account names through Paystack.
- Firebase Functions require the Firebase project to use the Blaze (pay-as-you-go) plan.
- Install the Firebase CLI if needed, then run these commands from this folder:
   npm --prefix functions install
   firebase login
   firebase use northfield-bank-83ec1
   firebase functions:secrets:set PAYSTACK_SECRET_KEY
   firebase deploy --only functions
- Paste your Paystack secret key only into the CLI prompt. Never put it in app.js,
  firebase-config.js, or any other browser file. Use Paystack test credentials for this demo.
- Account-name lookup is not a money transfer; external-bank transfers remain simulated.

RUNNING IT
- Open the folder in VS Code and use Live Server (right-click index.html > Open with Live Server).
  Never double-click the files: the browser blocks the scripts from file:// addresses.
- Customer site:  http://127.0.0.1:5500/index.html
- Admin page:     http://127.0.0.1:5500/admin.html

GETTING A PUBLIC LINK
1. Go to app.netlify.com/drop and drag the whole folder onto the page.
2. Copy the link it gives you.
3. Firebase console > Authentication > Settings > Authorized domains > Add domain:
   paste the link's address without https:// (for example: your-site.netlify.app).

TESTING SWITCHES (in firebase-config.js, bottom section "settings")
requireEmailVerification: false   set true to require a verified email before sign-in
requireFaceCheck: true            face check when creating an account; set false to skip

IMPORTANT
This is a practice project, not real banking software. Use fake names, NINs, addresses and passwords
while testing. Airtime, data, bills, cards and interest are all simulated. Real NIN and customer data
needs consent, a secure server, and data-protection compliance.
