const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");

const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_SECRET_KEY");

async function paystackGet(path, params = {}) {
  const url = new URL(`https://api.paystack.co${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  let response;
  try {
    response = await fetch(url, {
      headers: {Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}`},
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    throw new HttpsError("unavailable", "Could not reach the account verification service.");
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new HttpsError("unavailable", "The account verification service returned an invalid response.");
  }

  if (!response.ok || !result.status) {
    const isResolve = path === "/bank/resolve";
    throw new HttpsError(isResolve ? "not-found" : "failed-precondition",
      isResolve ? "No matching account was found. Check the bank and account number." : "Could not load the bank list.");
  }
  return result.data;
}

function requireSignedIn(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before verifying an account.");
}

exports.listNigerianBanks = onCall({secrets: [PAYSTACK_SECRET_KEY]}, async request => {
  requireSignedIn(request);
  const data = await paystackGet("/bank", {
    country: "nigeria",
    perPage: "100",
    use_cursor: "false",
    enabled_for_verification: "true"
  });
  const banks = (Array.isArray(data) ? data : [])
    .filter(bank => bank.code && bank.name && bank.active !== false)
    .map(bank => ({code: String(bank.code), name: String(bank.name)}));
  return {banks};
});

exports.resolveNigerianAccount = onCall({secrets: [PAYSTACK_SECRET_KEY]}, async request => {
  requireSignedIn(request);
  const accountNumber = String(request.data?.accountNumber || "");
  const bankCode = String(request.data?.bankCode || "");
  if (!/^\d{10}$/.test(accountNumber) || !/^[A-Za-z0-9_-]{1,20}$/.test(bankCode) || bankCode === "northfield") {
    throw new HttpsError("invalid-argument", "Enter a valid bank and 10-digit account number.");
  }

  const data = await paystackGet("/bank/resolve", {account_number: accountNumber, bank_code: bankCode});
  if (!data.account_name) throw new HttpsError("not-found", "No matching account was found.");
  return {accountName: String(data.account_name)};
});
