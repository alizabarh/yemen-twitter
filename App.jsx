import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  doc, 
  setDoc,
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  getDocs,
  query,
  limit
} from 'firebase/firestore';

// --- إعدادات Firebase الحقيقية الخاصة بك ---
const firebaseConfig = {
  apiKey: "AIzaSyAQc_-DSWh_55NHIdN1OJcGT0DLnjE49Kw",
  authDomain: "twitter-yemen.firebaseapp.com",
  projectId: "twitter-yemen",
  storageBucket: "twitter-yemen.firebasestorage.app",
  messagingSenderId: "520038900226",
  appId: "1:520038900226:web:c8360837c79b43cd1b7d1b",
  measurementId: "G-S0WH4Y0Y0F"
};

// تشغيل Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "twitter-yemen-prod-v2"; 

// --- وظيفة مساعدة لضغط الصور لتقليل الحجم ---
const compressImage = (base64Str, maxWidth = 500, maxHeight = 500) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
      } else {
        if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.5));
    };
    img.onerror = () => resolve(base64Str);
  });
};

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [activeUser, setActiveUser] = useState(null);
  const [authView, setAuthView] = useState("login"); 
  const [authData, setAuthData] = useState({ email: "", password: "", username: "" });
  const [authError, setAuthError] = useState("");
  const [isAuthProcessing, setIsAuthProcessing] = useState(false);

  const [tweets, setTweets] = useState([]);
  const [messages, setMessages] = useState([]);
  const [view, setView] = useState("home"); 
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null); 
  
  const [tweetContent, setTweetContent] = useState({ text: "", media: null });
  const [msgInput, setMsgInput] = useState("");
  const fileInputRef = useRef(null);

  // 1. تهيئة النظام (بشكل مرن لتجنب Configuration Error)
  useEffect(() => {
    const initSystem = async () => {
      try {
        // نحاول تسجيل الدخول المجهول لتهيئة الاتصال
        await signInAnonymously(auth);
      } catch (err) {
        console.warn("Auth Provider (Anonymous) might be disabled, proceeding with local session...");
      } finally {
        const savedUser = sessionStorage.getItem('yem_twitter_user');
        if (savedUser) setActiveUser(JSON.parse(savedUser));
        setIsReady(true);
        setLoading(false);
      }
    };
    initSystem();
  }, []);

  // 2. مراقبة البيانات الحقيقية
  useEffect(() => {
    if (!isReady) return;

    const tweetsCol = collection(db, 'artifacts', appId, 'public', 'data', 'tweets');
    const unsubTweets = onSnapshot(tweetsCol, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTweets(data.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    }, (err) => console.error("Firestore Tweets Error:", err));

    const msgsCol = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    const unsubMsgs = onSnapshot(msgsCol, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMessages(data.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0)));
    }, (err) => console.error("Firestore Messages Error:", err));

    return () => { unsubTweets(); unsubMsgs(); };
  }, [isReady]);

  // --- إدارة الحسابات المخصصة ---

  const handleSignup = async (e) => {
    e.preventDefault();
    setAuthError("");
    setIsAuthProcessing(true);
    
    if (authData.username.length < 3) { setAuthError("الاسم قصير جداً."); setIsAuthProcessing(false); return; }
    
    try {
      const regRef = collection(db, 'artifacts', appId, 'public', 'data', 'registry');
      const snap = await getDocs(regRef);
      if (snap.docs.find(d => d.data().email === authData.email.toLowerCase())) {
        setAuthError("هذا البريد مسجل مسبقاً.");
      } else {
        const newUser = {
          email: authData.email.toLowerCase(),
          password: authData.password,
          name: authData.username,
          bio: "يمني فخور 🇾🇪",
          avatar: null,
          cover: null,
          joined: new Date().toLocaleDateString('ar-YE'),
          uid: "yem_" + Math.random().toString(36).substr(2, 9)
        };
        await addDoc(regRef, newUser);
        setActiveUser(newUser);
        sessionStorage.setItem('yem_twitter_user', JSON.stringify(newUser));
        showStatus("مرحباً بك في اليمن تويتر!");
      }
    } catch (err) { 
      setAuthError("تأكد من تفعيل Firestore في لوحة تحكم المشروع.");
      console.error(err);
    } finally { setIsAuthProcessing(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    setIsAuthProcessing(true);
    try {
      const regRef = collection(db, 'artifacts', appId, 'public', 'data', 'registry');
      const snap = await getDocs(regRef);
      const userMatch = snap.docs.find(d => 
        d.data().email === authData.email.toLowerCase() && 
        d.data().password === authData.password
      );
      if (userMatch) {
        const data = { ...userMatch.data(), docId: userMatch.id };
        setActiveUser(data);
        sessionStorage.setItem('yem_twitter_user', JSON.stringify(data));
        showStatus("تم تسجيل الدخول");
      } else { setAuthError("البريد أو كلمة السر غير صحيحة."); }
    } catch (err) { setAuthError("فشل تسجيل الدخول."); }
    finally { setIsAuthProcessing(false); }
  };

  const showStatus = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  };

  // --- العمليات الرئيسية ---

  const postTweet = async () => {
    if (!activeUser || (!tweetContent.text.trim() && !tweetContent.media)) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'tweets'), {
        text: tweetContent.text,
        media: tweetContent.media,
        userId: activeUser.uid,
        userName: activeUser.name,
        userAvatar: activeUser.avatar || null,
        likes: [],
        timestamp: serverTimestamp()
      });
      setTweetContent({ text: "", media: null });
      showStatus("تم النشر بنجاح!");
    } catch (err) { showStatus("فشل النشر. راجع قواعد Firestore."); }
  };

  const handleUpdateProfile = async (formData) => {
    try {
      const regRef = collection(db, 'artifacts', appId, 'public', 'data', 'registry');
      const snap = await getDocs(regRef);
      const userDoc = snap.docs.find(d => d.data().uid === activeUser.uid);
      if (userDoc) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'registry', userDoc.id), formData);
        const updated = { ...activeUser, ...formData };
        setActiveUser(updated);
        sessionStorage.setItem('yem_twitter_user', JSON.stringify(updated));
        setIsEditingProfile(false);
        showStatus("تم تحديث البروفايل!");
      }
    } catch (err) { showStatus("فشل التحديث."); }
  };

  const handleLike = async (id, currentLikes = []) => {
    if (!activeUser) return;
    const isLiked = currentLikes.includes(activeUser.uid);
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'tweets', id);
    await updateDoc(ref, { 
      likes: isLiked ? arrayRemove(activeUser.uid) : arrayUnion(activeUser.uid) 
    });
  };

  const filteredTweets = useMemo(() => {
    return tweets.filter(t => t.text?.toLowerCase().includes(searchQuery.toLowerCase()) || t.userName?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [tweets, searchQuery]);

  if (loading) return (
    <div className="bg-[#020d2b] h-screen flex flex-col items-center justify-center text-blue-400">
      <div className="text-7xl animate-bounce mb-4">🇾🇪</div>
      <div className="font-bold tracking-widest animate-pulse">جاري الاتصال بالسيرفر...</div>
    </div>
  );

  // --- صفحة الدخول والتسجيل ---
  if (!activeUser) {
    return (
      <div className="bg-[#020d2b] min-h-screen flex items-center justify-center p-4 font-sans text-right" dir="rtl">
        <div className="w-full max-w-md bg-blue-900/10 border border-blue-800/40 p-10 rounded-[2.5rem] shadow-2xl backdrop-blur-md">
          <div className="text-center mb-10">
            <div className="text-6xl mb-4">🇾🇪</div>
            <h1 className="text-3xl font-black text-white mb-2">اليمن تويتر</h1>
            <p className="text-blue-400/70 text-sm">أهلاً بك في بيتك اليمني</p>
          </div>
          <form onSubmit={authView === 'login' ? handleLogin : handleSignup} className="space-y-4">
            {authView === 'signup' && (
              <input required type="text" placeholder="الاسم المستعار" className="w-full bg-[#010a1f] border border-blue-900/60 p-4 rounded-2xl outline-none focus:border-blue-400 text-white"
                value={authData.username} onChange={e => setAuthData({...authData, username: e.target.value})} />
            )}
            <input required type="email" placeholder="البريد الإلكتروني" className="w-full bg-[#010a1f] border border-blue-900/60 p-4 rounded-2xl outline-none focus:border-blue-400 text-white"
              value={authData.email} onChange={e => setAuthData({...authData, email: e.target.value})} />
            <input required type="password" placeholder="كلمة السر" className="w-full bg-[#010a1f] border border-blue-900/60 p-4 rounded-2xl outline-none focus:border-blue-400 text-white"
              value={authData.password} onChange={e => setAuthData({...authData, password: e.target.value})} />
            {authError && <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl text-red-400 text-xs text-center font-bold">{authError}</div>}
            <button disabled={isAuthProcessing} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl transition shadow-lg active:scale-95">
              {isAuthProcessing ? "جاري التحقق..." : (authView === 'login' ? 'دخول' : 'تسجيل جديد')}
            </button>
          </form>
          <button onClick={() => {setAuthView(authView === 'login' ? 'signup' : 'login'); setAuthError("");}} className="w-full text-blue-400 mt-8 text-sm font-bold hover:text-white transition">
            {authView === 'login' ? 'ليس لديك حساب؟ اشترك مجاناً' : 'لديك حساب يمني؟ سجل دخولك'}
          </button>
        </div>
      </div>
    );
  }

  // --- الواجهة الرئيسية للموقع ---
  return (
    <div className="bg-[#020d2b] text-[#f8fafc] min-h-screen flex justify-center font-sans" dir="rtl">
      {statusMsg && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-8 py-3 rounded-full z-[100] shadow-2xl font-bold animate-fadeIn">
          {statusMsg}
        </div>
      )}
      <div className="flex w-full max-w-[1300px]">
        {/* Navigation Sidebar */}
        <nav className="w-20 md:w-1/4 flex flex-col items-start md:items-end px-4 border-l border-blue-900/30 sticky top-0 h-screen">
          <div className="p-3 my-2 text-[#38bdf8] cursor-pointer hover:bg-blue-400/10 rounded-full" onClick={() => setView('home')}>
             <svg viewBox="0 0 24 24" className="w-8 h-8 fill-current"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
          </div>
          <div className="space-y-1 w-full">
            <NavItem icon="🏠" label="الرئيسية" active={view === 'home'} onClick={() => setView('home')} />
            <NavItem icon="🔍" label="استكشف" active={view === 'explore'} onClick={() => setView('explore')} />
            <NavItem icon="🔔" label="التنبيهات" active={view === 'notif'} onClick={() => setView('notif')} />
            <NavItem icon="✉️" label="الرسائل" active={view === 'messages'} onClick={() => setView('messages')} />
            <NavItem icon="👤" label="الملف الشخصي" active={view === 'profile'} onClick={() => setView('profile')} />
            <NavItem icon="🛡️" label="الآدمن" active={view === 'admin'} onClick={() => setView('admin')} color="text-yellow-400" />
            <NavItem icon="🚪" label="خروج" onClick={() => {sessionStorage.clear(); setActiveUser(null);}} color="text-red-400 mt-10" />
          </div>
          
          <div onClick={() => setView('profile')} className="mt-auto mb-4 w-full p-2 flex items-center gap-2 hover:bg-blue-900/30 rounded-full cursor-pointer transition overflow-hidden border border-transparent hover:border-blue-800/40">
            {activeUser.avatar ? (
              <img src={activeUser.avatar} className="w-10 h-10 rounded-full object-cover border border-blue-500/40 shrink-0" alt="me" />
            ) : (
              <div className="w-10 h-10 bg-blue-700 rounded-full flex items-center justify-center font-bold shrink-0 text-xs">🇾🇪</div>
            )}
            <div className="hidden md:block truncate">
              <div className="font-bold text-sm truncate text-white">{activeUser.name}</div>
              <div className="text-blue-400/50 text-[10px]">@{activeUser.uid.slice(0, 5)}</div>
            </div>
          </div>
        </nav>

        {/* Main Feed Container */}
        <main className="flex-1 border-l border-blue-900/30 max-w-[600px] min-h-screen relative bg-blue-950/10">
          <div className="sticky top-0 bg-[#020d2b]/80 backdrop-blur-xl z-30 border-b border-blue-900/30 p-4 font-black text-xl">
            {view === 'home' ? 'الرئيسية' : view === 'profile' ? 'الملف الشخصي' : view === 'admin' ? 'الإدارة' : 'اليمن تويتر'}
          </div>

          {view === 'home' && (
            <>
              {/* Tweet Composer */}
              <div className="p-4 border-b border-blue-900/30 flex gap-4 bg-blue-900/5">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-800 border border-blue-800/40 shrink-0 shadow-lg">
                  {activeUser.avatar ? <img src={activeUser.avatar} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-blue-900 flex items-center justify-center font-bold">🇾🇪</div>}
                </div>
                <div className="w-full space-y-3">
                  <textarea className="bg-transparent w-full text-xl outline-none resize-none placeholder-slate-600 min-h-[100px]" placeholder="ماذا يحدث في اليمن؟"
                    value={tweetContent.text} onChange={e => setTweetContent({...tweetContent, text: e.target.value})}></textarea>
                  {tweetContent.media && (
                    <div className="relative rounded-2xl overflow-hidden border border-blue-800/50 shadow-2xl">
                      <button onClick={() => setTweetContent({...tweetContent, media: null})} className="absolute top-3 right-3 bg-black/70 p-2 rounded-full text-white z-10 hover:bg-red-600 transition">✕</button>
                      <img src={tweetContent.media} className="w-full h-auto max-h-[400px] object-cover" alt="p" />
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-3 border-t border-blue-900/20">
                    <div className="flex gap-1">
                      <input type="file" hidden ref={fileInputRef} accept="image/*" onChange={async e => {
                        const file = e.target.files[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = async ev => {
                            const res = await compressImage(ev.target.result);
                            setTweetContent({...tweetContent, media: res});
                          };
                          reader.readAsDataURL(file);
                        }
                      }} />
                      <button onClick={() => fileInputRef.current.click()} className="text-[#38bdf8] text-2xl p-2 rounded-full hover:bg-blue-400/10 transition">🖼️</button>
                      <button className="text-[#38bdf8] text-2xl p-2 rounded-full hover:bg-blue-400/10 transition">😊</button>
                      <button className="text-[#38bdf8] text-2xl p-2 rounded-full hover:bg-blue-400/10 transition">📊</button>
                    </div>
                    <button onClick={postTweet} className="bg-blue-500 hover:bg-blue-400 text-white font-black px-8 py-2 rounded-full shadow-lg transition active:scale-95 disabled:opacity-30" 
                      disabled={!tweetContent.text.trim() && !tweetContent.media}>نشر</button>
                  </div>
                </div>
              </div>
              <TweetFeed tweets={tweets} activeUserId={activeUser.uid} onLike={handleLike} />
            </>
          )}

          {view === 'profile' && <ProfileView user={activeUser} tweets={tweets.filter(t => t.userId === activeUser.uid)} onEdit={() => setIsEditingProfile(true)} onLike={handleLike} />}
          {view === 'explore' && <div className="p-4 space-y-6">
             <input type="text" placeholder="ابحث عن أشخاص أو كلمات يمنية..." className="w-full bg-[#010a1f] p-4 rounded-full outline-none border border-blue-900/40 focus:border-blue-400 shadow-inner" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
             <TweetFeed tweets={filteredTweets} activeUserId={activeUser.uid} onLike={handleLike} />
          </div>}
          {view === 'messages' && <MessagesPanel messages={messages} user={activeUser} input={msgInput} setInput={setMsgInput} onSend={() => {
            if(!msgInput.trim()) return;
            addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'messages'), { text: msgInput, senderId: activeUser.uid, senderName: activeUser.name, timestamp: serverTimestamp() });
            setMsgInput("");
          }} />}
          {view === 'admin' && <AdminPanel tweets={tweets} db={db} appId={appId} showStatus={showStatus} />}
          {view === 'notif' && <div className="p-20 text-center opacity-40 animate-pulse"><div className="text-8xl mb-4">🔔</div><div className="font-bold text-xl">لا يوجد تنبيهات جديدة حالياً</div></div>}
        </main>

        {/* Right Sidebar */}
        <aside className="hidden lg:block w-80 px-6 py-2 space-y-4">
          <div className="bg-blue-900/10 rounded-3xl p-6 border border-blue-900/30">
            <h2 className="text-xl font-black mb-4 text-blue-400">ترند اليمن السعيد 🇾🇪</h2>
            <TrendItem tag="#تحيا_الجمهورية_اليمنية" count="31.4K" />
            <TrendItem tag="#صنعاء_القديمة" count="18.9K" />
            <TrendItem tag="#عدن_الآن" count="12.2K" />
            <TrendItem tag="#سقطرى_جوهرة_اليمن" count="5.4K" />
          </div>
          <div className="text-slate-600 text-[11px] px-6 text-center italic">© 2026 اليمن تويتر - كل الحقوق محفوظة لأبناء اليمن</div>
        </aside>
      </div>

      {/* Modals */}
      {isEditingProfile && <EditProfileModal profile={activeUser} onClose={() => setIsEditingProfile(false)} onSave={handleUpdateProfile} compress={compressImage} />}
    </div>
  );
}

// --- المكونات الفرعية ---

function NavItem({ icon, label, active, onClick, color = "" }) {
  return (
    <div onClick={onClick} className={`flex items-center gap-4 p-3 rounded-full hover:bg-blue-900/30 cursor-pointer transition w-max md:w-full ${active ? 'font-bold bg-blue-500/10 text-blue-300' : 'text-slate-300'} ${color}`}>
      <span className="text-2xl">{icon}</span>
      <span className="hidden md:inline text-lg">{label}</span>
    </div>
  );
}

function TweetFeed({ tweets, activeUserId, onLike }) {
  return (
    <div className="divide-y divide-blue-900/20 pb-24">
      {tweets.map(t => <TweetItem key={t.id} tweet={t} activeUserId={activeUserId} onLike={onLike} />)}
      {tweets.length === 0 && <div className="p-20 text-center text-slate-600">لا توجد تغريدات حالياً.. ابدأ المحادثة!</div>}
    </div>
  );
}

function TweetItem({ tweet, activeUserId, onLike }) {
  const isLiked = tweet.likes?.includes(activeUserId);
  return (
    <div className="p-5 hover:bg-blue-900/5 transition cursor-pointer group border-b border-blue-900/10">
      <div className="flex gap-4">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-800 shrink-0 border border-blue-900/40 shadow-sm">
          {tweet.userAvatar ? <img src={tweet.userAvatar} className="w-full h-full object-cover" alt="p" /> : <div className="w-full h-full bg-blue-800 flex items-center justify-center font-bold text-blue-300">🇾🇪</div>}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold hover:underline text-white">{tweet.userName}</span>
            <span className="text-blue-400/40 text-xs font-mono">@{tweet.userId?.slice(0, 5)}</span>
            <span className="text-blue-400/30 text-xs shrink-0">· الآن</span>
          </div>
          <div className="text-[16px] text-slate-100 leading-relaxed whitespace-pre-wrap mb-4">{tweet.text}</div>
          {tweet.media && (
            <div className="rounded-2xl border border-blue-900/30 overflow-hidden mb-4 shadow-xl bg-black/20">
              <img src={tweet.media} className="w-full h-auto max-h-[500px] object-contain mx-auto" alt="tweet" />
            </div>
          )}
          <div className="flex justify-between mt-2 text-slate-500 text-sm max-w-sm">
            <span className="hover:text-blue-400 flex items-center gap-2 transition">💬 0</span>
            <span className="hover:text-green-500 flex items-center gap-2 transition">🔄 0</span>
            <button onClick={(e) => { e.stopPropagation(); onLike(tweet.id, tweet.likes); }} className={`flex items-center gap-2 transition ${isLiked ? 'text-pink-500' : 'hover:text-pink-500'}`}>
               {isLiked ? '❤️' : '🤍'} <span className="text-xs">{tweet.likes?.length || 0}</span>
            </button>
            <span className="hover:text-blue-400 flex items-center gap-2 transition">📊 {Math.floor(Math.random()*100)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileView({ user, tweets, onEdit, onLike }) {
  return (
    <div className="animate-fadeIn">
      <div className="h-48 bg-slate-800 overflow-hidden relative shadow-inner">
        {user.cover ? <img src={user.cover} className="w-full h-full object-cover" alt="c" /> : <div className="w-full h-full bg-gradient-to-l from-blue-800 via-blue-900 to-blue-950"></div>}
      </div>
      <div className="px-5 relative mb-10 border-b border-blue-900/20 pb-6">
        <div className="flex justify-between items-end -mt-16">
          <div className="w-36 h-36 rounded-full border-4 border-[#020d2b] bg-slate-800 overflow-hidden shadow-2xl relative z-10">
            {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" alt="a" /> : <div className="w-full h-full bg-blue-700 flex items-center justify-center text-6xl">🇾🇪</div>}
          </div>
          <button onClick={onEdit} className="border border-blue-400/40 text-blue-300 font-bold px-6 py-2 rounded-full hover:bg-blue-400/10 transition text-sm shadow-lg mb-2">تعديل الملف الشخصي</button>
        </div>
        <div className="mt-5 space-y-1">
          <h2 className="text-2xl font-black text-white tracking-tight">{user.name}</h2>
          <p className="text-blue-400/60 text-sm font-mono tracking-tighter">@{user.uid.slice(0, 8)}</p>
          <p className="mt-4 text-slate-200 leading-relaxed text-[15px]">{user.bio}</p>
          <div className="flex gap-4 mt-5 text-slate-400 text-xs font-bold uppercase tracking-widest">
            <span>📅 انضم في {user.joined}</span>
            <span>📍 اليمن، الأرض الطيبة</span>
          </div>
          <div className="flex gap-6 mt-5">
             <span className="font-bold text-white">450 <span className="text-slate-500 font-normal">متابع</span></span>
             <span className="font-bold text-white">210 <span className="text-slate-500 font-normal">يتابع</span></span>
          </div>
        </div>
      </div>
      <TweetFeed tweets={tweets} activeUserId={user.uid} onLike={onLike} />
    </div>
  );
}

function EditProfileModal({ profile, onClose, onSave, compress }) {
  const [formData, setFormData] = useState({...profile});
  const [isCompressing, setIsCompressing] = useState(false);
  const avatarRef = useRef();
  const coverRef = useRef();

  const handleImg = async (e, field) => {
    const file = e.target.files[0];
    if (file) {
      setIsCompressing(true);
      const reader = new FileReader();
      reader.onload = async ev => {
        const res = await compress(ev.target.result, field === 'avatar' ? 300 : 900, field === 'avatar' ? 300 : 350);
        setFormData(prev => ({...prev, [field]: res}));
        setIsCompressing(false);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
      <div className="bg-[#020d2b] w-full max-w-lg rounded-[2.5rem] border border-blue-800/40 overflow-hidden flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <div className="flex justify-between items-center p-6 border-b border-blue-900/30">
          <div className="flex items-center gap-6">
            <button onClick={onClose} className="text-3xl hover:bg-blue-900/40 p-1 rounded-full transition">✕</button>
            <h3 className="font-black text-xl text-white">تعديل ملفك</h3>
          </div>
          <button disabled={isCompressing} onClick={() => onSave(formData)} className="bg-white text-blue-950 font-black px-8 py-2 rounded-full hover:bg-blue-50 transition active:scale-95 disabled:opacity-40">
            {isCompressing ? "جاري المعالجة..." : "حفظ"}
          </button>
        </div>
        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
          <div className="relative group cursor-pointer h-36 bg-slate-800 rounded-3xl overflow-hidden border border-blue-900/30 shadow-inner" onClick={() => coverRef.current.click()}>
            {formData.cover && <img src={formData.cover} className="w-full h-full object-cover opacity-60" />}
            <div className="absolute inset-0 flex items-center justify-center text-white font-bold bg-black/20 opacity-0 group-hover:opacity-100 transition">تغيير الغلاف 📷</div>
            <input type="file" hidden ref={coverRef} accept="image/*" onChange={e => handleImg(e, 'cover')} />
          </div>
          <div className="relative -mt-16 mr-8 group cursor-pointer w-28 h-28 rounded-full border-4 border-[#020d2b] bg-slate-700 overflow-hidden shadow-2xl" onClick={() => avatarRef.current.click()}>
            {formData.avatar && <img src={formData.avatar} className="w-full h-full object-cover opacity-60" />}
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white bg-black/20 opacity-0 group-hover:opacity-100 transition">تعديل الصورة 📷</div>
            <input type="file" hidden ref={avatarRef} accept="image/*" onChange={e => handleImg(e, 'avatar')} />
          </div>
          <div className="space-y-5">
            <div className="border border-blue-900/40 bg-blue-950/20 rounded-2xl p-4 focus-within:border-blue-400 transition">
              <label className="block text-blue-400 text-[10px] font-black uppercase tracking-widest mb-1">الاسم</label>
              <input className="w-full bg-transparent outline-none text-white font-bold" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="border border-blue-900/40 bg-blue-950/20 rounded-2xl p-4 focus-within:border-blue-400 transition">
              <label className="block text-blue-400 text-[10px] font-black uppercase tracking-widest mb-1">النبذة التعريفية</label>
              <textarea className="w-full bg-transparent outline-none resize-none h-32 text-white leading-relaxed" value={formData.bio || ''} onChange={e => setFormData({...formData, bio: e.target.value})} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessagesPanel({ messages, user, input, setInput, onSend }) {
  const scrollRef = useRef();
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);
  return (
    <div className="flex flex-col h-[calc(100vh-140px)] animate-fadeIn">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-blue-950/5">
        <div className="p-10 text-center text-slate-600 italic text-sm">مرحباً بك في مجلس اليمن العام 🇾🇪 أرسل رسالة للجميع هنا</div>
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.senderId === user.uid ? 'justify-start' : 'justify-end'}`}>
            <div className={`p-4 rounded-3xl max-w-[85%] shadow-xl ${m.senderId === user.uid ? 'bg-blue-600 text-white rounded-br-none border border-blue-500/50' : 'bg-slate-800 text-slate-100 rounded-bl-none border border-blue-900/20'}`}>
              <div className="text-[10px] opacity-60 font-black mb-1 tracking-widest uppercase">{m.senderName}</div>
              <div className="text-[15px] leading-relaxed break-words">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-blue-900/30 flex gap-3 bg-[#020d2b]">
        <input type="text" className="bg-slate-900 flex-1 p-4 rounded-full outline-none text-white focus:ring-2 ring-blue-500/50 transition border border-blue-900/20" placeholder="أرسل كلمة طيبة لليمنيين..." value={input} onChange={e => setInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && onSend()} />
        <button onClick={onSend} className="bg-blue-600 p-4 rounded-full transition active:scale-90 shadow-lg font-bold hover:bg-blue-500">🕊️</button>
      </div>
    </div>
  );
}

function AdminPanel({ tweets, db, appId, showStatus }) {
  const handleDelete = async (id) => {
    if (!window.confirm("هل أنت متأكد من حذف هذه التغريدة نهائياً؟")) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tweets', id));
      showStatus("تم الحذف بنجاح!");
    } catch (e) { showStatus("فشل الحذف. راجع الصلاحيات."); }
  };
  return (
    <div className="p-6 space-y-6 animate-fadeIn">
      <h2 className="text-2xl font-black text-yellow-400 flex items-center gap-3">🛡️ لوحة الرقابة الإدارية</h2>
      <div className="bg-slate-900/80 rounded-[2.5rem] border border-blue-900/30 overflow-hidden shadow-2xl">
        <div className="bg-blue-900/30 p-4 text-blue-300 font-black grid grid-cols-4 gap-2 text-xs uppercase tracking-widest border-b border-blue-900/30">
          <div className="col-span-2">المحتوى المنشور</div>
          <div>الكاتب</div>
          <div>الإجراء</div>
        </div>
        <div className="divide-y divide-blue-900/20">
          {tweets.map(t => (
            <div key={t.id} className="p-5 grid grid-cols-4 gap-2 items-center hover:bg-white/5 transition">
              <div className="col-span-2 truncate text-slate-200 text-sm font-medium">{t.text || "[تغريدة وسائط]"}</div>
              <div className="truncate text-blue-300/50 font-mono text-xs">{t.userName}</div>
              <button onClick={() => handleDelete(t.id)} className="text-red-400 bg-red-400/10 px-6 py-2 rounded-full text-[10px] font-black hover:bg-red-500 hover:text-white transition w-max">حذف</button>
            </div>
          ))}
          {tweets.length === 0 && <div className="p-20 text-center text-slate-500 italic">لا توجد بيانات للمعالجة</div>}
        </div>
      </div>
    </div>
  );
}

function TrendItem({ tag, count }) {
  return (
    <div className="py-4 hover:bg-blue-400/10 cursor-pointer transition px-4 rounded-2xl group border-b border-blue-900/10 last:border-0">
      <div className="text-blue-400/40 text-[10px] font-black uppercase tracking-widest group-hover:text-blue-300 transition">متداول الآن في اليمن</div>
      <div className="font-bold text-[#38bdf8] text-base mt-1 tracking-tight">{tag}</div>
      <div className="text-blue-400/30 text-[11px] mt-1 font-medium">{count} تغريدة</div>
    </div>
  );
}
