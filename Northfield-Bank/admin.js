import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,collection,query,orderBy,onSnapshot,doc,setDoc,addDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as cfg from "./firebase-config.js";

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
const finishStartupLoading = beginLoading("Checking admin session...");
let chatErr = "";
const admins = (cfg.adminEmails || []).map(e => String(e).toLowerCase());
const naira = n => "₦" + Number(n || 0).toLocaleString("en-NG", {minimumFractionDigits:2, maximumFractionDigits:2});
const msg = t => { $("a-msg").textContent = t || ""; };
let auth = null, db = null, unsub = null, chatUnsub = null, messagesUnsub = null, all = [], chats = [], first = true, fresh = new Set(), selectedChat = null;
let initialAccountsStop = null, initialChatsStop = null, selectedChatLoadingStop = null;
try{ const app = initializeApp(cfg.firebaseConfig || {}); auth = getAuth(app); db = getFirestore(app); }catch(e){}

function show(v){ $("v-login").classList.toggle("hidden", v !== "login"); $("v-list").classList.toggle("hidden", v !== "list"); $("v-chats").classList.toggle("hidden", v !== "chats"); }

$("f-admin").addEventListener("submit", async e => {
  e.preventDefault(); msg("");
  if(!auth) return msg("Firebase keys are missing. Check firebase-config.js.");
  const stopLoading = beginLoading("Signing in to admin...");
  try{ await signInWithEmailAndPassword(auth, $("a-email").value.trim(), $("a-pass").value); }
  catch(err){ msg("Incorrect email or password."); }
  finally{ stopLoading(); }
});
$("a-out").addEventListener("click", async () => {
  const stopLoading = beginLoading("Signing out...");
  try{ await signOut(auth); }
  finally{ stopLoading(); }
});
$("search").addEventListener("input", render);
$("tab-accounts").addEventListener("click",()=>{show("list");$("tab-accounts").classList.add("active");$("tab-chats").classList.remove("active")});
$("tab-chats").addEventListener("click",()=>{show("chats");$("tab-chats").classList.add("active");$("tab-accounts").classList.remove("active")});
$("back-accounts").addEventListener("click",()=>{show("list");$("tab-accounts").classList.add("active");$("tab-chats").classList.remove("active")});
$("chat-close").addEventListener("click",()=>{
  $("admin-chat").classList.add("hidden");
  if(messagesUnsub){messagesUnsub();messagesUnsub=null;}
  if(selectedChatLoadingStop){selectedChatLoadingStop();selectedChatLoadingStop=null;}
});

if(auth) onAuthStateChanged(auth, u => {
  if(initialAccountsStop){initialAccountsStop();initialAccountsStop=null;}
  if(initialChatsStop){initialChatsStop();initialChatsStop=null;}
  if(unsub){ unsub(); unsub = null; }
  if(chatUnsub){ chatUnsub(); chatUnsub=null; }
  if(messagesUnsub){ messagesUnsub(); messagesUnsub=null; }
  if(selectedChatLoadingStop){selectedChatLoadingStop();selectedChatLoadingStop=null;}
  if(!u){ show("login"); finishStartupLoading(); return; }
  if(!admins.includes((u.email || "").toLowerCase())){ msg("This account is not an admin."); finishStartupLoading(); signOut(auth); return; }
  show("list"); msg(""); first = true; fresh.clear();
  let firstChatSnapshot = true, firstAccountSnapshot = true;
  initialChatsStop = beginLoading("Loading customer chats...");
  initialAccountsStop = beginLoading("Loading accounts...");
  chatUnsub = onSnapshot(query(collection(db,"chatSessions"), orderBy("updatedAt","desc")), snap => {
    if(firstChatSnapshot){firstChatSnapshot=false;initialChatsStop?.();initialChatsStop=null;}
    chatErr=""; chats=snap.docs.map(d=>({id:d.id,...d.data()})); renderChats();
  }, err=>{
    if(firstChatSnapshot){firstChatSnapshot=false;initialChatsStop?.();initialChatsStop=null;}
    chats=[]; chatErr="Chat inbox is blocked. In Firestore, create supportAgents/" + u.uid + " with a field role = admin, and publish the rules in firestore.rules."; renderChats();
  });
  unsub = onSnapshot(query(collection(db, "users"), orderBy("createdAt", "desc")), snap => {
    if(firstAccountSnapshot){firstAccountSnapshot=false;initialAccountsStop?.();initialAccountsStop=null;}
    if(!first) snap.docChanges().forEach(c => { if(c.type === "added"){ fresh.add(c.doc.id); notify(c.doc.data().name || "Someone"); } });
    first = false;
    all = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
  }, err => {
    if(firstAccountSnapshot){firstAccountSnapshot=false;initialAccountsStop?.();initialAccountsStop=null;}
    show("login"); msg("Could not load accounts: " + (err.code || "error"));
  });
  finishStartupLoading();
});
else finishStartupLoading();

function notify(name){
  const t = $("toast"); t.textContent = "New account: " + name; t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 6000);
  try{ const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(); o.connect(c.destination); o.frequency.value = 880; o.start(); o.stop(c.currentTime + 0.25); }catch(e){}
}

function render(){
  const q = $("search").value.trim().toLowerCase();
  const list = all.filter(u => !q || [u.name, u.email, u.phone, u.acct].join(" ").toLowerCase().includes(q));
  $("count").textContent = "(" + all.length + " total)";
  const box = $("list"); box.innerHTML = "";
  if(!list.length){ box.innerHTML = '<p class="sub">No accounts found.</p>'; return; }
  list.forEach(u => {
    const c = document.createElement("div"); c.className = "ucard" + (fresh.has(u.id) ? " fresh" : "");
    const h = document.createElement("h3"); h.textContent = u.name || "(no name)"; c.appendChild(h);
    const joined = u.createdAt && u.createdAt.toDate ? u.createdAt.toDate().toLocaleString("en-NG", {dateStyle:"medium", timeStyle:"short"}) : "just now";
    [["Email",u.email],["Phone",u.phone],["Date of birth",u.dob],["Gender",u.gender],["Address",u.addr],["Account no.",u.acct],["Balance",naira(u.balance)],["Joined",joined]].forEach(([k,v]) => {
      const r = document.createElement("div"); r.className = "urow";
      const a = document.createElement("span"); a.textContent = k;
      const b = document.createElement("b"); b.textContent = v || "-";
      r.append(a, b); c.appendChild(r);
    });
    // NIN is hidden until you tap Show
    const nr = document.createElement("div"); nr.className = "urow";
    const na = document.createElement("span"); na.textContent = "NIN";
    const nb = document.createElement("b"), nin = String(u.nin || ""), masked = nin ? "•••••••" + nin.slice(-4) : "-";
    nb.textContent = masked;
    if(nin){
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "reveal"; btn.textContent = "Show";
      btn.addEventListener("click", () => { const open = btn.textContent === "Hide"; nb.textContent = open ? masked : nin; btn.textContent = open ? "Show" : "Hide"; });
      nb.appendChild(btn);
    }
    nr.append(na, nb); c.appendChild(nr);
    box.appendChild(c);
  });
}

function renderChats(){
  const box=$("chat-list"); box.innerHTML=""; $("chat-count").textContent="("+chats.length+")";
  if(chatErr){const p=document.createElement("p");p.className="sub";p.textContent=chatErr;box.appendChild(p);return;}
  if(!chats.length){box.innerHTML='<p class="sub">No customer chats yet.</p>';return;}
  chats.forEach(c=>{const b=document.createElement("button");b.type="button";b.className="chat-item"+(c.status==="open"?" unread":"");b.innerHTML="<b></b><small></small><small></small>";b.querySelector("b").textContent=c.name||"Customer";b.querySelectorAll("small")[0].textContent=(c.email||"")+" · Account "+(c.acct||"-");b.querySelectorAll("small")[1].textContent=c.lastMessage||"No messages yet";b.addEventListener("click",()=>openAdminChat(c));box.appendChild(b);});
}
function openAdminChat(c){
  selectedChat=c; $("admin-chat").classList.remove("hidden"); $("selected-name").textContent=c.name||"Customer"; $("selected-meta").textContent=(c.email||"")+" · Account "+(c.acct||"-");
  if(messagesUnsub) messagesUnsub();
  if(selectedChatLoadingStop) selectedChatLoadingStop();
  const stopLoading=beginLoading("Loading conversation...");
  selectedChatLoadingStop=stopLoading;
  let firstMessageSnapshot=true;
  const msgs=collection(doc(db,"chatSessions",c.id),"messages");
  messagesUnsub=onSnapshot(query(msgs,orderBy("createdAt","asc")),snap=>{
    if(firstMessageSnapshot){firstMessageSnapshot=false;stopLoading();if(selectedChatLoadingStop===stopLoading)selectedChatLoadingStop=null;}
    const box=$("admin-messages");box.innerHTML="";snap.forEach(d=>{const m=d.data(),row=document.createElement("div");row.className="admin-bubble "+(m.role==="admin"?"admin":"customer");const sp=document.createElement("span");sp.textContent=m.text||"";const tm=document.createElement("small");tm.textContent=m.createdAt?.toDate?m.createdAt.toDate().toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit"}):"";sp.appendChild(tm);row.appendChild(sp);box.appendChild(row);});box.scrollTop=box.scrollHeight;
  },()=>{
    if(firstMessageSnapshot){firstMessageSnapshot=false;stopLoading();if(selectedChatLoadingStop===stopLoading)selectedChatLoadingStop=null;}
    $("admin-messages").textContent="Could not load this conversation.";
  });
  setDoc(doc(db,"chatSessions",c.id),{status:"open"},{merge:true}).catch(()=>{});
}
$("admin-chat-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!selectedChat)return;
  const input=$("admin-chat-input"),text=input.value.trim();if(!text)return;
  const b=e.submitter;b.disabled=true;
  const stopLoading=beginLoading("Sending reply...");
  try{
    await addDoc(collection(doc(db,"chatSessions",selectedChat.id),"messages"),{text,senderId:auth.currentUser.uid,senderName:auth.currentUser.email||"Northfield Support",role:"admin",createdAt:serverTimestamp()});
    await setDoc(doc(db,"chatSessions",selectedChat.id),{updatedAt:serverTimestamp(),lastMessage:text,status:"open"},{merge:true});
    input.value="";
  }catch(err){alert("Could not send reply.");}
  finally{b.disabled=false;stopLoading();input.focus();}
});
