// Firebase web app config (Firebase console > Project settings > Your apps > Config)
export const firebaseConfig = {
  apiKey: "AIzaSyDzjACZg6mysqRVBrVUWbBOalnXUqgmTnM",
  authDomain: "northfield-bank-83ec1.firebaseapp.com",
  projectId: "northfield-bank-83ec1",
  storageBucket: "northfield-bank-83ec1.firebasestorage.app",
  messagingSenderId: "697882853961",
  appId: "1:697882853961:web:6d46e1d973ad9e8db8f598"
};

// Testing switches: set to false to skip that step
export const settings = {
  requireEmailVerification: true,
  requireFaceCheck: true
};

// Emails allowed to open admin.html.
// 1) Replace the placeholder below with your own email.
// 2) Add that same email in Firebase Authentication > Users > Add user.
export const adminEmails = ["ebenezerfatooki@gmail.com"];
