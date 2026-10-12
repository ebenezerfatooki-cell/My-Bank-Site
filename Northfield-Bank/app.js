import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,createUserWithEmailAndPassword,sendEmailVerification,signInWithEmailAndPassword,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,setDoc,getDoc,serverTimestamp,collection,query,where,orderBy,limit,getDocs,runTransaction,addDoc,onSnapshot} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import * as cfg from "./firebase-config.js";
const firebaseConfig = cfg.firebaseConfig || {};
const settings = {requireEmailVerification:false, requireFaceCheck:true, ...(cfg.settings||{})};

const $ = i => document.getElementById(i);
let activeLoads = 0, loaderTimer = null;
function beginLoading(text){
  const overlay = $("pageLoader");
  window.clearTimeout(loaderTimer);
  activeLoads++;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-busy", "true");
  $("pageLoaderText").textContent = text;
  let ended = false;
  return () => {
    if(ended) return;
    ended = true;
    activeLoads = Math.max(0, activeLoads - 1);
    if(!activeLoads) loaderTimer = window.setTimeout(() => {
      if(!activeLoads){ overlay.classList.add("hidden"); overlay.setAttribute("aria-busy", "false"); }
    }, 120);
  };
}
const finishStartupLoading = beginLoading("Loading Northfield Bank...");
const views = ["login","signup","email","face","dash","svc","support","receipt"];
let configured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");
let auth, db, listNigerianBanks, resolveNigerianAccount;
try{
  const app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app);
  const functions = getFunctions(app);
  listNigerianBanks = httpsCallable(functions, "listNigerianBanks");
  resolveNigerianAccount = httpsCallable(functions, "resolveNigerianAccount");
}catch(e){ configured = false; }
if(!configured){
  const w = $("cfgWarn"); w.classList.remove("hidden");
  w.textContent = cfg.firebaseConfig ? "Your Firebase keys look wrong. Copy them again into firebase-config.js."
    : "Could not read your keys. firebase-config.js must start with: export const firebaseConfig = {";
}
let stream = null, profile = null, uid = null, pending = null;

function show(v){ views.forEach(x => $("v-"+x).classList.toggle("hidden", x!==v)); if(v!=="face") stopCam(); window.scrollTo(0,0); }
function msg(id,t,ok){ const e=$(id); e.textContent=t||""; e.classList.toggle("ok",!!ok); }
function nice(e){
  const m = {
    "auth/email-already-in-use":"An account with this email already exists. Sign in instead.",
    "auth/invalid-email":"Enter a valid email address.",
    "auth/weak-password":"Password must be at least 8 characters.",
    "auth/invalid-credential":"Incorrect email or password.",
    "auth/user-not-found":"No account found for this email.",
    "auth/wrong-password":"Incorrect password.",
    "auth/too-many-requests":"Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed":"No connection. Check your internet and try again.",
    "permission-denied":"Could not save your details. Check your Firestore rules."
  };
  return m[e.code] || "Something went wrong. Try again.";
}
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => show(b.dataset.go)));

// SIGN UP: create account, save profile, send verification email
$("f-signup").addEventListener("submit", async e => {
  e.preventDefault();
  if(!configured) return msg("e-signup","Add your Firebase keys first.");
  const d = {name:$("s-name").value.trim(), phone:$("s-phone").value.trim(), email:$("s-email").value.trim().toLowerCase(),
    dob:$("s-dob").value, gender:$("s-gender").value, addr:$("s-addr").value.trim(), nin:$("s-nin").value.trim()};
  const p=$("s-pass").value, p2=$("s-pass2").value;
  if(d.name.split(/\s+/).length<2) return msg("e-signup","Enter your full name (first and last).");
  if(!/^\+?\d{10,14}$/.test(d.phone)) return msg("e-signup","Enter a valid phone number.");
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return msg("e-signup","Enter a valid email address.");
  if(!d.dob) return msg("e-signup","Enter your date of birth.");
  if(!d.gender) return msg("e-signup","Select your gender.");
  if(!d.addr) return msg("e-signup","Enter your home address.");
  if(!/^\d{11}$/.test(d.nin)) return msg("e-signup","NIN must be exactly 11 digits.");
  if(p.length<8) return msg("e-signup","Password must be at least 8 characters.");
  if(p!==p2) return msg("e-signup","Passwords do not match.");
  msg("e-signup",""); pending = {d, p};
  if(settings.requireFaceCheck) startFace(); else finishSignup();
});

// Runs after the face check passes: creates the account
async function finishSignup(){
  const {d, p} = pending;
  const stopLoading = beginLoading("Creating your account...");
  $("signupBtn").disabled = true;
  try{
    const cred = await createUserWithEmailAndPassword(auth, d.email, p);
    const acct = String(Math.floor(1000000000+Math.random()*9000000000));
    await setDoc(doc(db,"users",cred.user.uid), {...d, acct, balance:0, loan:0, createdAt: serverTimestamp()});
    if(settings.requireEmailVerification){
      await sendEmailVerification(cred.user);
      $("v-addr").textContent = d.email; msg("e-email","");
      show("email");
    } else {
      await signOut(auth);
      show("login"); msg("e-login","Account created. Sign in to continue.",true);
    }
  }catch(err){ show("signup"); msg("e-signup", nice(err)); }
  $("signupBtn").disabled = false;
  stopLoading();
}

// EMAIL VERIFICATION
$("resend").addEventListener("click", async () => {
  const stopLoading = beginLoading("Sending verification email...");
  try{ await sendEmailVerification(auth.currentUser); msg("e-email","Email sent again. Check your inbox.",true); }
  catch(err){ msg("e-email", nice(err)); }
  finally{ stopLoading(); }
});
$("verified").addEventListener("click", async () => {
  const stopLoading = beginLoading("Checking email verification...");
  try{
    await auth.currentUser.reload();
    if(!auth.currentUser.emailVerified) return msg("e-email","Not verified yet. Open the link in the email first.");
    await signOut(auth);
    show("login"); msg("e-login","Email verified. Sign in to continue.",true);
  }catch(err){ msg("e-login", nice(err)); show("login"); }
  finally{ stopLoading(); }
});

// LOGIN: needs verified email, then face check
$("f-login").addEventListener("submit", async e => {
  e.preventDefault();
  $("resendLogin").classList.add("hidden");
  if(!configured) return msg("e-login","Add your Firebase keys first.");
  const em=$("l-email").value.trim().toLowerCase(), pw=$("l-pass").value;
  if(!em||!pw) return msg("e-login","Enter your email and password.");
  const stopLoading = beginLoading("Signing in...");
  try{
    const cred = await signInWithEmailAndPassword(auth, em, pw);
    await cred.user.reload();
    if(settings.requireEmailVerification && !cred.user.emailVerified){
      msg("e-login","Verify your email first. Open the link we sent you.");
      $("resendLogin").classList.remove("hidden"); return;
    }
    const snap = await getDoc(doc(db,"users",cred.user.uid));
    uid = cred.user.uid; profile = snap.data() || {name:em, acct:"0000000000"};
    msg("e-login",""); showDash();
  }catch(err){ msg("e-login", nice(err)); }
  finally{ stopLoading(); }
});
$("resendLogin").addEventListener("click", async () => {
  const stopLoading = beginLoading("Sending verification email...");
  try{ await sendEmailVerification(auth.currentUser); msg("e-login","Verification email sent. Check your inbox.",true); }
  catch(err){ msg("e-login", nice(err)); }
  finally{ stopLoading(); }
});

// FACE VERIFICATION
function stopCam(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } }
function startFace(){
  show("face"); msg("e-face","");
  if(!navigator.mediaDevices?.getUserMedia) return msg("e-face","Camera not available. Use the selfie option below.");
  const stopLoading = beginLoading("Requesting camera access...");
  navigator.mediaDevices.getUserMedia({video:{facingMode:"user"},audio:false})
    .then(s => { stream=s; $("cam").srcObject=s; })
    .catch(() => msg("e-face","Camera access was blocked. Allow camera permission, or use the selfie option below."))
    .finally(stopLoading);
}
function detect(src, ok){
  if("FaceDetector" in window){
    const stopLoading = beginLoading("Checking for a face...");
    new window.FaceDetector({fastMode:true}).detect(src).then(f=>ok(f.length>0)).catch(()=>ok(true)).finally(stopLoading);
  }
  else ok(true);   // practice mode: browsers without a face detector accept the capture
}
function passed(found){
  if(!found) return msg("e-face","No face detected. Face the camera in good light and try again.");
  stopCam(); finishSignup();
}
$("snap").addEventListener("click", () => {
  const v=$("cam");
  if(!stream||!v.videoWidth) return msg("e-face","Camera is not ready. Wait a moment or use the selfie option.");
  detect(v, passed);
});
$("selfieBtn").addEventListener("click", () => $("selfie").click());
$("selfie").addEventListener("change", e => {
  const inp=e.target, f=inp.files[0]; if(!f) return;
  const url=URL.createObjectURL(f), img=new Image();
  img.onload = () => { URL.revokeObjectURL(url); inp.value=""; detect(img, passed); };
  img.onerror = () => { inp.value=""; msg("e-face","Could not read that photo. Try again."); };
  img.src = url;
});
$("cancel").addEventListener("click", () => { stopCam(); show("signup"); });

// CUSTOMER SERVICE + LIVE CHAT
let chatUnsub = null;
let chatMessagesUnsub = null;
let chatLoadingStop = null;
const chatRef = () => doc(db, "chatSessions", uid);
const chatMsgs = () => collection(chatRef(), "messages");
function stopChat(){
  if(chatUnsub){chatUnsub();chatUnsub=null;}
  if(chatMessagesUnsub){chatMessagesUnsub();chatMessagesUnsub=null;}
  if(chatLoadingStop){chatLoadingStop();chatLoadingStop=null;}
}
function openSupport(){
  show("support");
  $("chat-name").textContent = "Northfield Support";
  $("chat-status").textContent = "● Online · Customer Service";
  $("chat-messages").innerHTML = '<div class="chat-empty">Connecting to support…</div>';
  stopChat();
  chatLoadingStop = beginLoading("Loading support chat...");
  const session = chatRef();
  setDoc(session, {uid, name:profile.name||"Customer", email:profile.email||"", acct:profile.acct||"", updatedAt:serverTimestamp(), status:"open"}, {merge:true}).catch(()=>{});
  chatMessagesUnsub = onSnapshot(query(chatMsgs(), orderBy("createdAt","asc")), snap => {
    if(chatLoadingStop){chatLoadingStop();chatLoadingStop=null;}
    const box=$("chat-messages"); box.innerHTML="";
    if(snap.empty){ box.innerHTML='<div class="chat-empty">Hi! Welcome to Northfield Customer Support. How can we help you today?</div>'; return; }
    snap.forEach(d=>{
      const m=d.data(), row=document.createElement("div"); row.className="chat-row "+(m.senderId===uid?"mine":"theirs");
      const bubble=document.createElement("div"); bubble.className="chat-bubble"; bubble.textContent=m.text||"";
      const time=document.createElement("small"); time.textContent=m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit"}) : "";
      bubble.appendChild(time); row.appendChild(bubble); box.appendChild(row);
    });
    box.scrollTop=box.scrollHeight;
  }, err => {
    if(chatLoadingStop){chatLoadingStop();chatLoadingStop=null;}
    $("chat-status").textContent="Chat unavailable";
  });
}
async function sendChat(){
  const input=$("chat-input"), text=input.value.trim(); if(!text) return;
  const stopLoading = beginLoading("Sending message...");
  const b=$("chat-send"); b.disabled=true;
  try{
    await addDoc(chatMsgs(), {text, senderId:uid, senderName:profile.name||"Customer", role:"customer", createdAt:serverTimestamp()});
    await setDoc(chatRef(), {updatedAt:serverTimestamp(), lastMessage:text, status:"open"},{merge:true});
    input.value="";
  }catch(err){ msg("e-chat", nice(err)); }
  finally{ b.disabled=false; stopLoading(); input.focus(); }
}
$("chat-send").addEventListener("click", sendChat);
$("chat-form").addEventListener("submit", e=>{e.preventDefault();sendChat();});
$("chat-back").addEventListener("click", ()=>{stopChat();show("dash");});
document.querySelectorAll("[data-support]").forEach(b=>b.addEventListener("click",openSupport));

// DASHBOARD
const meRef = () => doc(db, "users", uid);
const txCol = ref => collection(ref, "transactions");
async function lookupAcct(a){
  const q = await getDocs(query(collection(db,"users"), where("acct","==",a), limit(1)));
  return q.empty ? null : {ref:q.docs[0].ref, name:q.docs[0].data().name};
}
async function doLogout(){ await signOut(auth); uid = null; $("l-pass").value=""; msg("e-login",""); show("login"); }

async function refresh(){
  profile = (await getDoc(meRef())).data();
  $("d-name").textContent = (profile.name || "").split(/\s+/)[0];
  $("d-av").textContent = (profile.name || "?")[0].toUpperCase();
  $("d-acct").textContent = profile.acct;
  paintBal();
  $("d-loan").textContent = summary();
  const snap = await getDocs(query(txCol(meRef()), orderBy("createdAt","desc"), limit(30)));
  setLast(snap.empty ? null : snap.docs[0].data());
  const list = $("d-hist");
  list.innerHTML = "";
  if(snap.empty){ list.innerHTML = '<li class="empty">No transactions yet.</li>'; return; }
  snap.forEach(s => {
    const t = s.data(), li = document.createElement("li");
    const when = t.createdAt ? t.createdAt.toDate().toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"}) : "";
    li.innerHTML = "<div><b></b><small></small></div><span></span>";
    li.querySelector("b").textContent = t.title;
    li.querySelector("small").textContent = [when, t.detail].filter(Boolean).join(" · ");
    const a = li.querySelector("span");
    a.textContent = (t.dir === "credit" ? "+" : "-") + naira(t.amount);
    a.className = t.dir === "credit" ? "pos" : "neg";
    list.appendChild(li);
  });
}
async function showDash(){
  const stopLoading = beginLoading("Loading your account...");
  show("dash"); msg("d-note","");
  try{ await refresh(); }catch(err){ msg("d-note", nice(err)); }
  finally{ stopLoading(); }
}

// Moves money safely: checks balances, updates them, and logs the transaction
async function post({dir, amount, type, title, detail="", to=null, loanDelta=0, saveDelta=0, fixedDelta=0, rewardsDelta=0, patch=null}){
  const me = meRef();
  const transactionRef = title ? doc(txCol(me)) : null;
  await runTransaction(db, async t => {
    const u = (await t.get(me)).data(), bal = u.balance||0, loan = u.loan||0, sav = u.savings||0, fix = u.fixed||0, rew = u.rewards||0;
    const rs = to ? await t.get(to) : null;
    if(dir === "debit" && bal < amount) throw new Error("Insufficient balance. Add money first.");
    if(sav + saveDelta < 0) throw new Error("You only have " + naira(sav) + " in savings.");
    if(fix + fixedDelta < 0) throw new Error("You only have " + naira(fix) + " in fixed savings.");
    const cash = BILLS.includes(type) ? amount / 100 : 0;
    t.update(me, {balance: dir === "debit" ? bal - amount : bal + amount, loan: Math.max(0, loan + loanDelta), savings: sav + saveDelta,
      fixed: fix + fixedDelta, rewards: Math.max(0, Math.round((rew + rewardsDelta + cash) * 100) / 100), ...(patch || {})});
    if(transactionRef) t.set(transactionRef, {type, title, detail, amount, dir, createdAt: serverTimestamp()});
    if(rs && rs.exists()){
      t.update(to, {balance: (rs.data().balance || 0) + amount});
      t.set(doc(txCol(to)), {type:"transfer", title:"Received from " + u.name, detail:"", amount, dir:"credit", createdAt: serverTimestamp()});
    }
  });
  if(transactionRef) lastReceipt = {id:transactionRef.id, type, title, detail, amount, dir, createdAt:new Date()};
}

const naira = n => "₦" + Number(n || 0).toLocaleString("en-NG", {minimumFractionDigits:2, maximumFractionDigits:2});
const rand = n => Array.from({length:n}, () => Math.floor(Math.random()*10)).join("");
const BILLS = ["airtime","data","electricity","tv","betting"];

let hide = false;
const paintBal = () => { $("d-bal").textContent = hide ? "****" : naira(profile.balance); };
$("eye").addEventListener("click", () => { hide = !hide; $("eye").textContent = hide ? "🙈" : "👁"; paintBal(); });
function setLast(t){ $("d-lasttxt").textContent = t ? t.title + " · " + (t.dir === "credit" ? "+" : "-") + naira(t.amount) : "No transactions yet"; }
const toHist = () => $("d-histbox").scrollIntoView({behavior:"smooth"});
$("toHist").addEventListener("click", toHist);
document.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => window.scrollTo({top:0,behavior:"smooth"})));
const summary = () => [profile.savings>0 && "Savings "+naira(profile.savings), profile.fixed>0 && "Fixed "+naira(profile.fixed), profile.loan>0 && "Loan owed "+naira(profile.loan), profile.rewards>0 && "Cashback "+naira(profile.rewards)].filter(Boolean).join(" · ");

const AMT = {id:"amt", label:"Amount (₦)", digits:true, max:9, ph:"5000"};
const NETS = ["MTN","Airtel","Glo","9mobile"];
const PLANS = [["350","1GB (1 day) - ₦350"],["800","2GB (7 days) - ₦800"],["1700","5GB (30 days) - ₦1,700"],["3000","10GB (30 days) - ₦3,000"]];
const TVS = [["2150","GOtv Smallie - ₦2,150"],["4600","GOtv Max - ₦4,600"],["15700","DStv Compact - ₦15,700"],["29500","DStv Premium - ₦29,500"]];
const RATES = {"3":15, "6":20, "12":25};
const need = (v, min, max, what) => { if(v < min || v > max) throw new Error(what + " must be between " + naira(min) + " and " + naira(max) + "."); };
const phoneOk = p => { if(!/^0\d{10}$/.test(p)) throw new Error("Enter a valid 11-digit phone number."); };
const inviteCode = () => "NF" + String(profile.acct).slice(-6);

const SVC = {
  transfer:{title:"Transfer money", btn:"Send money", fields:[
    {id:"bank", label:"Bank", opts:[["","Select a bank"],["northfield","Northfield Bank"]]},
    {id:"acct", label:"Account number", digits:true, max:10, ph:"10 digits"},
    {...AMT, ph:"1000"},
    {id:"note", label:"Narration", opt:true}],
   run: async v => {
    const amount = +v.amt; need(amount, 100, 5000000, "Transfer amount");
    if(!/^\d{10}$/.test(v.acct)) throw new Error("Account number must be 10 digits.");
    let to = null, name = v.accountName;
    if(v.bank === "northfield"){
      if(v.acct === profile.acct) throw new Error("You cannot send money to yourself.");
      const r = await lookupAcct(v.acct);
      if(!r) throw new Error("No Northfield account found with that number.");
      to = r.ref; name = r.name;
    }
    await post({dir:"debit", amount, type:"transfer", title:"Transfer to " + name, detail: v.bankName + (v.note ? " · " + v.note : ""), to});
    return "Sent " + naira(amount) + " to " + name + ".";
  }},
  airtime:{title:"Buy airtime", btn:"Buy airtime", fields:[
    {id:"net", label:"Network", opts:NETS}, {id:"phone", label:"Phone number", digits:true, max:11, ph:"08012345678"}, {...AMT, ph:"500"}],
   run: async v => {
    phoneOk(v.phone); const amount = +v.amt; need(amount, 50, 50000, "Airtime amount");
    await post({dir:"debit", amount, type:"airtime", title:v.net + " airtime", detail:v.phone});
    return naira(amount) + " " + v.net + " airtime sent to " + v.phone + ". You earned " + naira(amount/100) + " cashback.";
  }},
  data:{title:"Buy data", btn:"Buy data", fields:[
    {id:"net", label:"Network", opts:NETS}, {id:"phone", label:"Phone number", digits:true, max:11, ph:"08012345678"}, {id:"plan", label:"Data plan", opts:PLANS}],
   run: async v => {
    phoneOk(v.phone); const amount = +v.plan, label = PLANS.find(p => p[0] === v.plan)[1].split(" - ")[0];
    await post({dir:"debit", amount, type:"data", title:v.net + " data " + label, detail:v.phone});
    return label + " " + v.net + " data sent to " + v.phone + ".";
  }},
  electricity:{title:"Pay electricity", btn:"Pay bill", fields:[
    {id:"disco", label:"Provider", opts:["Ikeja Electric","Eko Electric","Abuja Electric","Port Harcourt Electric","Ibadan Electric","Kano Electric"]},
    {id:"kind", label:"Meter type", opts:["Prepaid","Postpaid"]},
    {id:"meter", label:"Meter number", digits:true, max:11, ph:"11 digits"}, {...AMT, ph:"2000"}],
   run: async v => {
    if(!/^\d{11}$/.test(v.meter)) throw new Error("Meter number must be 11 digits.");
    const amount = +v.amt; need(amount, 500, 500000, "Payment amount");
    await post({dir:"debit", amount, type:"electricity", title:v.disco + " (" + v.kind + ")", detail:"Meter " + v.meter});
    return v.kind === "Prepaid" ? "Paid " + naira(amount) + ". Your token: " + rand(20).replace(/(\d{4})(?=\d)/g, "$1-")
                                : "Paid " + naira(amount) + " to " + v.disco + ".";
  }},
  tv:{title:"TV subscription", btn:"Subscribe", fields:[
    {id:"card", label:"Smartcard / IUC number", digits:true, max:10, ph:"10 digits"}, {id:"plan", label:"Package", opts:TVS}],
   run: async v => {
    if(!/^\d{10}$/.test(v.card)) throw new Error("Smartcard number must be 10 digits.");
    const amount = +v.plan, label = TVS.find(p => p[0] === v.plan)[1].split(" - ")[0];
    await post({dir:"debit", amount, type:"tv", title:label, detail:"Card " + v.card});
    return label + " renewed for card " + v.card + ".";
  }},
  betting:{title:"Fund betting wallet", btn:"Fund wallet", fields:[
    {id:"co", label:"Provider", opts:["Bet9ja","SportyBet","BetKing","NairaBet"]}, {id:"user", label:"Customer ID or phone", max:20}, {...AMT, ph:"1000"}],
   run: async v => {
    const amount = +v.amt; need(amount, 100, 100000, "Amount");
    await post({dir:"debit", amount, type:"betting", title:v.co + " wallet", detail:v.user});
    return naira(amount) + " sent to your " + v.co + " wallet.";
  }},
  loan:{title:"Get a loan", btn:"Apply for loan", fields:[
    {...AMT, ph:"20000"}, {id:"term", label:"Repay over", opts:[["3","3 months"],["6","6 months"],["12","12 months"]]}],
   run: async v => {
    if(profile.loan > 0) throw new Error("Repay your current loan before applying for another.");
    const amount = +v.amt; need(amount, 5000, 200000, "Loan amount");
    const total = Math.round(amount * 1.10), months = +v.term;
    await post({dir:"credit", amount, type:"loan", title:"Loan received", detail:months + " months · 10% interest", loanDelta:total});
    return naira(amount) + " added to your balance. You owe " + naira(total) + " (about " + naira(total/months) + " a month).";
  }},
  repay:{title:"Repay loan", btn:"Repay", info:() => profile.loan > 0 ? "You owe " + naira(profile.loan) : "You have no loan.", fields:[{...AMT, ph:"5000"}],
   run: async v => {
    const amount = +v.amt;
    if(!(profile.loan > 0)) throw new Error("You have no loan to repay.");
    if(amount > profile.loan) throw new Error("You only owe " + naira(profile.loan) + ".");
    await post({dir:"debit", amount, type:"repay", title:"Loan repayment", loanDelta:-amount});
    return "Repaid " + naira(amount) + ". You now owe " + naira(profile.loan - amount) + ".";
  }},
  fund:{title:"Add money (demo)", btn:"Add money", fields:[{...AMT, ph:"10000"}],
   run: async v => {
    const amount = +v.amt; need(amount, 100, 1000000, "Amount");
    await post({dir:"credit", amount, type:"fund", title:"Wallet top-up (demo)"});
    return "Added " + naira(amount) + " to your balance.";
  }},
  save:{title:"Save", btn:"Continue", info:() => "Savings: " + naira(profile.savings) + "\nBalance: " + naira(profile.balance),
   fields:[{id:"act", label:"What do you want to do?", opts:[["in","Save money"],["out","Withdraw to balance"]]}, {...AMT, ph:"5000"}],
   run: async v => {
    const amount = +v.amt; need(amount, 100, 10000000, "Amount");
    if(v.act === "in"){ await post({dir:"debit", amount, type:"save", title:"Moved to savings", saveDelta:amount}); return "Saved " + naira(amount) + "."; }
    await post({dir:"credit", amount, type:"save", title:"Withdrawn from savings", saveDelta:-amount}); return "Moved " + naira(amount) + " back to your balance.";
  }},
  wealth:{title:"Wealth", btn:"Continue",
   info:() => "Fixed savings: " + naira(profile.fixed) + "\nSavings: " + naira(profile.savings) + "\nBalance: " + naira(profile.balance) + "\nTotal worth: " + naira((profile.balance||0) + (profile.savings||0) + (profile.fixed||0)) + "\n\nFixed savings earn 15% to 25% a year (demo).",
   fields:[{id:"act", label:"Action", opts:[["lock","Lock money in fixed savings"],["out","Withdraw fixed savings"]]}, {...AMT, ph:"10000"},
           {id:"term", label:"Lock period (new fixed savings)", opts:[["3","3 months · 15% a year"],["6","6 months · 20% a year"],["12","12 months · 25% a year"]]}],
   run: async v => {
    const amount = +v.amt;
    if(v.act === "lock"){
      need(amount, 5000, 10000000, "Fixed savings amount");
      const m = +v.term, r = RATES[v.term], gain = Math.round(amount * r / 100 * m / 12);
      await post({dir:"debit", amount, type:"fixed", title:"Fixed savings", detail:m + " months at " + r + "% a year", fixedDelta:amount});
      return "Locked " + naira(amount) + " for " + m + " months. Expected interest: " + naira(gain) + " (demo).";
    }
    need(amount, 100, 10000000, "Amount");
    await post({dir:"credit", amount, type:"fixed", title:"Fixed savings withdrawal", detail:"Early withdrawal, no interest", fixedDelta:-amount});
    return "Moved " + naira(amount) + " back to your balance. Early withdrawals earn no interest.";
  }},
  rewards:{title:"Rewards", btn:"Claim to balance", fields:[],
   info:() => "Cashback: " + naira(profile.rewards) + "\n\nEarn 1% back on airtime, data, electricity, TV and betting.",
   run: async () => {
    const r = Math.round((profile.rewards || 0) * 100) / 100;
    if(r <= 0) throw new Error("No cashback yet. Pay a bill to earn some.");
    await post({dir:"credit", amount:r, type:"rewards", title:"Cashback claimed", rewardsDelta:-r});
    return "Added " + naira(r) + " cashback to your balance.";
  }},
  card:{title:"My card", btn:"Update card", cls:"vcard",
   info:() => "NORTHFIELD BANK · DEBIT\n\n•••• •••• •••• " + String(profile.acct).slice(-4) + "\n" + (profile.name || "").toUpperCase() + "   EXP 10/29\nStatus: " + (profile.frozen ? "Frozen" : "Active"),
   fields:[{id:"act", label:"Card settings", opts:[["freeze","Freeze card"],["unfreeze","Unfreeze card"]]}],
   run: async v => {
    await post({dir:"credit", amount:0, type:"card", title:null, patch:{frozen: v.act === "freeze"}});
    return v.act === "freeze" ? "Card frozen." : "Card unfrozen.";
  }},
  invite:{title:"Invite friends", btn:"Copy invite message", fields:[],
   info:() => "Your invite code: " + inviteCode() + "\n\nShare it with friends so they can open a Northfield account.",
   run: async () => {
    const text = "Join me on Northfield Bank! Use my invite code " + inviteCode();
    try{ await navigator.clipboard.writeText(text); return "Copied. Paste it in a chat to invite a friend."; }
    catch(e){ return text; }
  }},
  me:{title:"My profile", btn:"Sign out", fields:[],
   info:() => (profile.name || "") + "\n" + (profile.email || "") + "\n" + (profile.phone || "") + "\nAccount number: " + profile.acct + "\nNIN: •••••••" + String(profile.nin || "").slice(-4),
   run: async () => { await doLogout(); return null; }}
};

let cur = null;
let lastReceipt = null;
let recipientLookupToken = 0;
let recipientLookupPending = null;
let resolvedRecipient = null;
function resetRecipientLookup(){
  recipientLookupToken++;
  recipientLookupPending = null;
  resolvedRecipient = null;
  $("account-name").value = "";
  msg("account-lookup-status", "");
}
async function verifyTransferAccount(){
  const bank = $("sv-bank").value;
  const accountNumber = $("sv-acct").value.trim();
  if(!/^\d{10}$/.test(accountNumber)){
    resetRecipientLookup();
    msg("account-lookup-status", "Enter a 10-digit account number.");
    return null;
  }
  const key = bank + ":" + accountNumber;
  if(resolvedRecipient?.key === key) return resolvedRecipient;
  if(recipientLookupPending?.key === key) return recipientLookupPending.promise;

  const token = ++recipientLookupToken;
  const stopLoading = beginLoading("Verifying recipient account...");
  const promise = (async () => {
    $("account-name").value = "";
    msg("account-lookup-status", "Verifying account...");
    try{
      let accountName;
      if(bank === "northfield"){
        if(accountNumber === profile.acct) throw new Error("You cannot send money to yourself.");
        const account = await lookupAcct(accountNumber);
        if(!account) throw new Error("No Northfield account found with that number.");
        accountName = account.name;
      } else {
        if(!resolveNigerianAccount) throw new Error("Account lookup is not available right now.");
        const result = await resolveNigerianAccount({accountNumber, bankCode:bank});
        accountName = result.data.accountName;
      }
      if(token !== recipientLookupToken || key !== $("sv-bank").value + ":" + $("sv-acct").value.trim()) return null;
      resolvedRecipient = {key, name:accountName, bankName:$ ("sv-bank").selectedOptions[0].textContent};
      $("account-name").value = accountName;
      msg("account-lookup-status", "Account verified", true);
      return resolvedRecipient;
    }catch(err){
      if(token === recipientLookupToken){
        $("account-name").value = "";
        msg("account-lookup-status", err.message || "Could not verify this account.");
      }
      return null;
    }finally{ stopLoading(); }
  })();
  recipientLookupPending = {key, promise};
  try{ return await promise; }
  finally{ if(recipientLookupPending?.key === key) recipientLookupPending = null; }
}
async function loadNigerianBanks(select){
  if(select.dataset.loaded) return;
  const stopLoading = beginLoading("Loading bank list...");
  try{
    if(!listNigerianBanks) throw new Error("Bank list is not available.");
    const result = await listNigerianBanks();
    if(!select.isConnected) return;
    result.data.banks.forEach(bank => select.add(new Option(bank.name, bank.code)));
    select.dataset.loaded = "true";
  }catch(e){
    if(select.isConnected) msg("account-lookup-status", "Could not load external banks. Northfield Bank is still available.");
  }finally{ stopLoading(); }
}
function renderReceipt(receipt, message){
  $("receipt-message").textContent = message;
  $("r-ref").textContent = receipt.id;
  $("r-date").textContent = receipt.createdAt.toLocaleString("en-NG", {dateStyle:"medium", timeStyle:"short"});
  $("r-name").textContent = profile.name || "";
  $("r-account").textContent = profile.acct || "";
  $("r-title").textContent = receipt.title;
  $("r-detail").textContent = receipt.detail || "-";
  $("r-direction").textContent = receipt.dir === "credit" ? "Credit" : "Debit";
  $("r-amount").textContent = (receipt.dir === "credit" ? "+" : "-") + naira(receipt.amount);
}
function openSvc(k, bank){
  cur = SVC[k]; $("svc-title").textContent = cur.title; msg("e-svc","");
  resetRecipientLookup();
  $("account-lookup").classList.toggle("hidden", k !== "transfer");
  const info = $("svc-info"); info.textContent = cur.info ? cur.info() : ""; info.className = "svc-info" + (cur.cls ? " " + cur.cls : "");
  const box = $("svc-fields"); box.innerHTML = "";
  cur.fields.forEach(f => {
    const l = document.createElement("label"); l.htmlFor = "sv-" + f.id; l.textContent = f.label + (f.opt ? " (optional)" : "");
    let el;
    if(f.opts){
      el = document.createElement("select");
      f.opts.forEach(o => { const [v,t] = Array.isArray(o) ? o : [o,o]; const op = document.createElement("option"); op.value = v; op.textContent = t; el.appendChild(op); });
    } else {
      el = document.createElement("input");
      if(f.digits) el.inputMode = "numeric";
      if(f.max) el.maxLength = f.max;
      if(f.ph) el.placeholder = f.ph;
    }
    el.id = "sv-" + f.id; box.append(l, el);
  });
  if(bank && $("sv-bank")) $("sv-bank").value = bank;
  if(k === "transfer"){
    const bankSelect = $("sv-bank"), accountInput = $("sv-acct");
    bankSelect.addEventListener("change", () => { resetRecipientLookup(); if(accountInput.value.length === 10) verifyTransferAccount(); });
    accountInput.addEventListener("input", resetRecipientLookup);
    accountInput.addEventListener("blur", () => { if(accountInput.value.length === 10) verifyTransferAccount(); });
    loadNigerianBanks(bankSelect);
  }
  $("svc-go").textContent = cur.btn; show("svc");
}
document.querySelectorAll("[data-svc]").forEach(b => b.addEventListener("click", () => openSvc(b.dataset.svc, b.dataset.bank)));
$("svc-back").addEventListener("click", () => show("dash"));
$("svc-form").addEventListener("submit", async e => {
  e.preventDefault();
  const v = {};
  for(const f of cur.fields){
    v[f.id] = $("sv-" + f.id).value.trim();
    if(!v[f.id] && !f.opt) return msg("e-svc", "Fill in: " + f.label + ".");
    if(f.digits && v[f.id] && !/^\d+$/.test(v[f.id])) return msg("e-svc", f.label + " must be numbers only.");
  }
  const b = $("svc-go"), stopLoading = beginLoading("Processing " + cur.title.toLowerCase() + "...");
  b.disabled = true; msg("e-svc","Processing...",true);
  lastReceipt = null;
  try{
    if(cur === SVC.transfer){
      const recipient = await verifyTransferAccount();
      if(!recipient) throw new Error("Verify the recipient account before continuing.");
      v.accountName = recipient.name;
      v.bankName = recipient.bankName;
    }
    const result = await cur.run(v);
    if(result !== null){
      await showDash(); msg("d-note", result, true);
      if(lastReceipt){
        const receipt = lastReceipt; lastReceipt = null;
        renderReceipt(receipt, result); show("receipt");
        window.setTimeout(() => window.print(), 250);
      }
    }
  }catch(err){ msg("e-svc", err.code ? nice(err) : err.message); }
  finally{ b.disabled = false; stopLoading(); }
});
$("receipt-print").addEventListener("click", () => window.print());
$("receipt-done").addEventListener("click", () => showDash());
finishStartupLoading();

