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
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  getDocs,
  query,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';

// --- إعدادات Firebase الحقيقية ---
const firebaseConfig = {
  apiKey: "AIzaSyAQc_-DSWh_55NHIdN1OJcGT0DLnjE49Kw",
  authDomain: "twitter-yemen.firebaseapp.com",
  projectId: "twitter-yemen",
  storageBucket: "twitter-yemen.firebasestorage.app",
  messagingSenderId: "520038900226",
  appId: "1:520038900226:web:c8360837c79b43cd1b7d1b",
  measurementId: "G-S0WH4Y0Y0F"
};

// تهيئة Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "twitter-yemen-stable-v1"; // معرف قاعدة البيانات

/**
 * وظيفة ضغط الصور (Image Compression)
 * تقوم بتقليل حجم الصور قبل رفعها لضمان عدم تجاوز حدود التخزين
 */
const compressImage = (base64Str, maxWidth = 600, maxHeight = 600) => {
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
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve(base64Str);
  });
};

// --- المكون الرئيسي App ---
export default function App() {
  const [fbUser, setFbUser] = useState(null);
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

  // 1. تسجيل الدخول والتحقق من الجلسة
  useEffect(() => {
    const init = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.warn("Firebase Auth Init issue:", err);
      } finally {
        const saved = sessionStorage.getItem('yem_twitter_session');
        if (saved) setActiveUser(JSON.parse(saved));
        setLoading(false);
      }
    };
    init();
    const unsub = onAuthStateChanged(auth, setFbUser);
    return () => unsub();
  }, []);

  // 2. تحديث البيانات بشكل حي ومباشر
  useEffect(() => {
    if (!fbUser) return;

    const tweetsCol = collection(db, 'artifacts', appId, 'public', 'data', 'tweets');
    const unsubTweets = onSnapshot(tweetsCol, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTweets(data.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });

    const msgsCol = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    const unsubMsgs = onSnapshot(msgsCol, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMessages(data.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0)));
    });

    return () => { unsubTweets(); unsubMsgs(); };
  }, [fbUser]);

  // --- دوال التحكم في الحسابات ---

  const handleSignup = async (e) => {
    e.preventDefault();
    setAuthError("");
    setIsAuthProcessing(true);
    if (authData.username.trim().length < 3) { setAuthError("الاسم قصير جداً."); setIsAuthProcessing(false); return; }
    
    try {
      const regRef = collection(db, 'artifacts', appId, 'public', 'data', 'registry');
      const snap = await getDocs(regRef);
      if (snap.docs.find(d => d.data().email === authData.email.toLowerCase())) {
        setAuthError("هذا البريد مسجل مسبقاً.");
      } else {
        const newUser = {
          email: authData.email.toLowerCase().trim(),
          password: authData.password,
          name: authData.username.trim(),
          bio: "يمني فخور 🇾🇪",
          avatar: null,
          cover: null,
          joined: new Date().toLocaleDateString('ar-YE'),
          uid: "yem_u_" + Math.random().toString(36).substr(2, 9)
        };
        await addDoc(regRef, newUser);
        setActiveUser(newUser);
        sessionStorage.setItem('yem_twitter_session', JSON.stringify(newUser));
        showStatus("مرحباً بك في أسرة اليمن تويتر!");
      }
    } catch (err) { setAuthError("فشل الاتصال بقاعدة البيانات."); }
    finally { setIsAuthProcessing(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    setIsAuthProcessing(true);
    try {
      const regRef = collection(db, 'artifacts', appId, 'public', 'data', 'registry');
      const snap = await getDocs(regRef);
      const match = snap.docs.find(d => 
        d.data().email === authData.email.toLowerCase().trim() && 
        d.data().password === authData.password
      );
      if (match) {
        const data = { ...match.data(), docId: match.id };
        setActiveUser(data);
        sessionStorage.setItem('yem_twitter_session', JSON.stringify(data));
      } else { setAuthError("البيانات غير صحيحة."); }
    } catch (err) { setAuthError("حدث خطأ في الدخول."); }
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
      showStatus("تم النشر!");
    } catch (err) { showStatus("خطأ في النشر."); }
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
        sessionStorage.setItem('yem_twitter_session', JSON.stringify(updated));
        setIsEditingProfile(false);
        showStatus("تم التحديث!");
      }
    } catch (err) { showStatus("خطأ في التحديث."); }
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
       <div className="text-8xl animate-bounce mb-8">🇾🇪</div>
       <div className="font-black tracking-widest animate-pulse">YEMEN TWITTER</div>
    </div>
  );

  // --- واجهة تسجيل الدخول ---
  if (!activeUser) {
    return (
      <div className="bg-[#020d2b] min-h-screen flex items-center justify-center p-4 font-sans text-right" dir="rtl">
        <div className="w-full max-w-md bg-[#0f172a]/60 border border-blue-900/40 p-10 rounded-[3rem] shadow-2xl backdrop-blur-xl">
          <div className="text-center mb-10">
            <div className="text-7xl mb-4 transform hover:scale-110 transition duration-500 cursor-default">🇾🇪</div>
            <h1 className="text-3xl font-black text-white mb-2">اليمن تويتر</h1>
            <p className="text-blue-400/70 text-sm font-medium">ساحة اليمنيين الحرّة</p>
          </div>
          <form onSubmit={authView === 'login' ? handleLogin : handleSignup} className="space-y-4">
            {authView === 'signup' && (
              <input required type="text" placeholder="الاسم المستعار" className="w-full bg-[#010a1f] border border-blue-900/60 p-5 rounded-2xl outline-none focus:border-blue-400 text-white transition shadow-inner"
                value={authData.username} onChange={e => setAuthData({...authData, username: e.target.value})} />
            )}
            <input required type="email" placeholder="البريد الإلكتروني" className="w-full bg-[#010a1f] border border-blue-900/60 p-5 rounded-2xl outline-none focus:border-blue-400 text-white transition shadow-inner"
              value={authData.email} onChange={e => setAuthData({...authData, email: e.target.value})} />
            <input required type="password" placeholder="كلمة السر" className="w-full bg-[#010a1f] border border-blue-900/60 p-5 rounded-2xl outline-none focus:border-blue-400 text-white transition shadow-inner"
              value={authData.password} onChange={e => setAuthData({...authData, password: e.target.value})} />
            
            {authError && <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl text-red-400 text-xs text-center font-bold animate-pulse">{authError}</div>}
            
            <button disabled={isAuthProcessing} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition shadow-xl active:scale-95 disabled:opacity-50">
              {isAuthProcessing ? "جاري..." : (authView === 'login' ? 'دخول' : 'إنشاء حساب جديد')}
            </button>
          </form>
          <button onClick={() => {setAuthView(authView === 'login' ? 'signup' : 'login'); setAuthError("");}} className="w-full text-blue-400 mt-10 text-sm font-bold hover:text-white transition">
            {authView === 'login' ? 'عضو جديد؟ سجل هويتك اليمنية الآن' : 'لديك حساب يمني؟ سجل دخولك'}
          </button>
        </div>
      </div>
    );
  }

  // --- واجهة الموقع الرئيسية ---
  return (
    <div className="bg-[#020d2b] text-[#f8fafc] min-h-screen flex justify-center font-sans" dir="rtl">
      {statusMsg && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-10 py-3 rounded-full z-[500] shadow-2xl font-black animate-fadeIn">
          {statusMsg}
        </div>
      )}
      <div className="flex w-full max-w-[1300px]">
        
        {/* القائمة الجانبية */}
        <nav className="w-20 md:w-1/4 flex flex-col items-start md:items-end px-4 border-l border-blue-900/30 sticky top-0 h-screen">
          <div className="p-3 my-4 text-[#38bdf8] cursor-pointer hover:bg-blue-900/40 rounded-full transition duration-300" onClick={() => setView('home')}>
             <svg viewBox="0 0 24 24" className="w-10 h-10 fill-current"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
          </div>
          <div className="space-y-1 w-full">
            <NavItem icon="🏠" label="الرئيسية" active={view === 'home'} onClick={() => setView('home')} />
            <NavItem icon="🔍" label="استكشف" active={view === 'explore'} onClick={() => setView('explore')} />
            <NavItem icon="🔔" label="التنبيهات" active={view === 'notif'} onClick={() => setView('notif')} />
            <NavItem icon="✉️" label="الرسائل" active={view === 'messages'} onClick={() => setView('messages')} />
            <NavItem icon="👤" label="الملف الشخصي" active={view === 'profile'} onClick={() => setView('profile')} />
            <NavItem icon="🛡️" label="الإدارة" active={view === 'admin'} onClick={() => setView('admin')} color="text-yellow-400" />
            <NavItem icon="🚪" label="خروج" onClick={() => {sessionStorage.clear(); setActiveUser(null);}} color="text-red-400 mt-20" />
          </div>
          
          <div onClick={() => setView('profile')} className="mt-auto mb-6 w-full p-2 flex items-center gap-3 hover:bg-blue-900/30 rounded-full cursor-pointer transition overflow-hidden group">
            {activeUser.avatar ? (
              <img src={activeUser.avatar} className="w-12 h-12 rounded-full object-cover border border-blue-500/40 shrink-0 group-hover:border-blue-400" alt="avatar" />
            ) : (
              <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center font-black shrink-0 text-lg shadow-lg">🇾🇪</div>
            )}
            <div className="hidden md:block truncate text-right">
              <div className="font-bold text-sm truncate text-white">{activeUser.name}</div>
              <div className="text-blue-400/50 text-[10px] font-mono tracking-tighter uppercase">@{activeUser.uid.slice(0, 8)}</div>
            </div>
          </div>
        </nav>

        {/* مساحة الخلاصة الرئيسية */}
        <main className="flex-1 border-l border-blue-900/30 max-w-[600px] min-h-screen relative bg-blue-950/10">
          <div className="sticky top-0 bg-[#020d2b]/90 backdrop-blur-2xl z-40 border-b border-blue-900/30 p-5 flex items-center justify-between shadow-sm">
            <h1 className="font-black text-xl tracking-tight">
              {view === 'home' ? 'الرئيسية' : view === 'profile' ? 'الملف الشخصي' : view === 'admin' ? 'لوحة الرقابة' : view === 'messages' ? 'المجلس اليمني' : 'اليمن تويتر'}
            </h1>
            <div className="text-xl animate-pulse">🇾🇪</div>
          </div>

          {view === 'home' && (
            <>
              {/* صندوق كتابة التغريدة */}
              <div className="p-5 border-b border-blue-900/30 flex gap-4 bg-blue-900/5 text-right">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-slate-800 border-2 border-blue-800/40 shrink-0 shadow-2xl">
                  {activeUser.avatar ? <img src={activeUser.avatar} className="w-full h-full object-cover" alt="me" /> : <div className="w-full h-full bg-blue-900 flex items-center justify-center font-bold">🇾🇪</div>}
                </div>
                <div className="w-full space-y-4">
                  <textarea className="bg-transparent w-full text-xl outline-none resize-none placeholder-slate-600 min-h-[120px] pt-2" placeholder="ماذا يحدث في يمننا اليوم؟"
                    value={tweetContent.text} onChange={e => setTweetContent({...tweetContent, text: e.target.value})}></textarea>
                  
                  {tweetContent.media && (
                    <div className="relative rounded-3xl overflow-hidden border-2 border-blue-800/50 shadow-2xl">
                      <button onClick={() => setTweetContent({...tweetContent, media: null})} className="absolute top-4 right-4 bg-black/80 p-2 rounded-full text-white z-10 hover:bg-red-600 transition">✕</button>
                      <img src={tweetContent.media} className="w-full h-auto max-h-[450px] object-cover" alt="preview" />
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-4 border-t border-blue-900/20">
                    <div className="flex gap-2">
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
                      <button onClick={() => fileInputRef.current.click()} className="text-[#38bdf8] text-3xl p-2 rounded-full hover:bg-blue-400/10 transition active:scale-90" title="إرفاق صورة">🖼️</button>
                      <button className="text-[#38bdf8] text-3xl p-2 rounded-full hover:bg-blue-400/10 transition active:scale-90">😊</button>
                      <button className="text-[#38bdf8] text-3xl p-2 rounded-full hover:bg-blue-400/10 transition active:scale-90">📊</button>
                    </div>
                    <button onClick={postTweet} className="bg-blue-500 hover:bg-blue-400 text-white font-black px-10 py-2.5 rounded-full shadow-[0_5px_20px_rgba(59,130,246,0.3)] transition active:scale-95 disabled:opacity-20" 
                      disabled={!tweetContent.text.trim() && !tweetContent.media}>نشر</button>
                  </div>
                </div>
              </div>
              <TweetFeed tweets={tweets} activeUserId={activeUser.uid} onLike={handleLike} />
            </>
          )}

          {view === 'profile' && <ProfileView user={activeUser} tweets={tweets.filter(t => t.userId === activeUser.uid)} onEdit={() => setIsEditingProfile(true)} onLike={handleLike} />}
          
          {view === 'explore' && (
             <div className="p-6 space-y-8 animate-fadeIn text-right">
                <div className="relative">
                   <input type="text" placeholder="ابحث عن يمنيين أو مواضيع..." className="w-full bg-[#010a1f] p-5 pr-14 rounded-3xl outline-none border border-blue-900/40 focus:border-blue-400 shadow-inner text-white transition" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                   <span className="absolute right-5 top-1/2 -translate-y-1/2 text-2xl opacity-40">🔍</span>
                </div>
                <TweetFeed tweets={filteredTweets} activeUserId={activeUser.uid} onLike={handleLike} />
             </div>
          )}

          {view === 'messages' && <MessagesPanel messages={messages} user={activeUser} input={msgInput} setInput={setMsgInput} onSend={() => {
            if(!msgInput.trim()) return;
            addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'messages'), { text: msgInput, senderId: activeUser.uid, senderName: activeUser.name, timestamp: serverTimestamp() });
            setMsgInput("");
          }} />}

          {view === 'admin' && <AdminPanel tweets={tweets} db={db} appId={appId} showStatus={showStatus} />}
          
          {view === 'notif' && <div className="p-32 text-center space-y-6 opacity-30 animate-pulse"><div className="text-9xl">🔔</div><div className="font-black text-2xl tracking-widest text-blue-400">هدوء تام في التنبيهات..</div></div>}
        </main>

        {/* الشريط الجانبي الأيمن */}
        <aside className="hidden lg:block w-80 px-6 py-4 space-y-6 sticky top-0 h-screen overflow-y-auto">
          <div className="bg-blue-950/40 rounded-[2.5rem] p-8 border border-blue-900/30 shadow-2xl">
            <h2 className="text-2xl font-black mb-6 text-blue-400 flex items-center gap-2 tracking-tighter">ترند اليمن 🇾🇪</h2>
            <TrendItem tag="#تحيا_الجمهورية_اليمنية" count="35.2K" />
            <TrendItem tag="#صنعاء_القديمة" count="21.5K" />
            <TrendItem tag="#سقطرى_الساحرة" count="12.8K" />
          </div>
          <p className="text-slate-600 text-[11px] px-8 text-center italic leading-relaxed font-bold">
            تم التطوير لدعم المحتوى اليمني. © 2026 اليمن تويتر.
          </p>
        </aside>
      </div>

      {/* نوافذ التعديل */}
      {isEditingProfile && <EditProfileModal profile={activeUser} onClose={() => setIsEditingProfile(false)} onSave={handleUpdateProfile} compress={compressImage} />}
    </div>
  );
}

// --- المكونات الفرعية ---

function NavItem({ icon, label, active, onClick, color = "" }) {
  return (
    <div onClick={onClick} className={`flex items-center gap-5 p-4 rounded-full hover:bg-blue-400/10 cursor-pointer transition duration-300 w-max md:w-full ${active ? 'font-black bg-blue-500/10 text-blue-300 shadow-sm' : 'text-slate-300'} ${color}`}>
      <span className="text-3xl">{icon}</span>
      <span className="hidden md:inline text-xl tracking-tight font-bold uppercase">{label}</span>
    </div>
  );
}

function TweetFeed({ tweets, activeUserId, onLike }) {
  return (
    <div className="divide-y divide-blue-900/20 pb-32">
      {tweets.map(t => <TweetItem key={t.id} tweet={t} activeUserId={activeUserId} onLike={onLike} />)}
      {tweets.length === 0 && <div className="p-32 text-center text-slate-700 italic font-medium">لا توجد تغريدات يمنية بعد.. كن أول من يغرد!</div>}
    </div>
  );
}

function TweetItem({ tweet, activeUserId, onLike }) {
  const isLiked = tweet.likes?.includes(activeUserId);
  return (
    <div className="p-6 hover:bg-white/[0.02] transition duration-300 cursor-pointer group border-b border-blue-900/10 text-right">
      <div className="flex gap-5 flex-row-reverse">
        <div className="w-14 h-14 rounded-full overflow-hidden bg-slate-800 shrink-0 border border-blue-900/40 shadow-xl">
          {tweet.userAvatar ? <img src={tweet.userAvatar} className="w-full h-full object-cover" alt="avatar" /> : <div className="w-full h-full bg-blue-800 flex items-center justify-center font-bold text-blue-300 text-xl">🇾🇪</div>}
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-2 mb-1.5 flex-row-reverse">
            <span className="font-black hover:underline text-white text-[17px] truncate">{tweet.userName}</span>
            <span className="text-blue-400/40 text-xs font-mono truncate">@{tweet.userId?.slice(0, 8)}</span>
          </div>
          <div className="text-[17px] text-slate-100 leading-relaxed whitespace-pre-wrap mb-4 font-medium">{tweet.text}</div>
          {tweet.media && (
            <div className="rounded-[2rem] border border-blue-900/30 overflow-hidden mb-5 shadow-2xl bg-black/40">
              <img src={tweet.media} className="w-full h-auto max-h-[550px] object-contain mx-auto" alt="media" />
            </div>
          )}
          <div className="flex justify-between mt-2 text-slate-500 text-sm max-w-sm flex-row-reverse">
            <div className="flex items-center gap-2 transition cursor-pointer hover:text-blue-400">
               <span className="text-xl">💬</span><span className="text-xs font-bold">0</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onLike(tweet.id, tweet.likes); }} className={`flex items-center gap-2 transition duration-500 ${isLiked ? 'text-pink-500 scale-110' : 'hover:text-pink-500'}`}>
               <span className="text-xl">{isLiked ? '❤️' : '🤍'}</span> 
               <span className="text-xs font-bold">{tweet.likes?.length || 0}</span>
            </button>
            <div className="flex items-center gap-2 opacity-50">
               <span className="text-xl">📊</span><span className="text-xs font-bold">{Math.floor(Math.random()*150)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileView({ user, tweets, onEdit, onLike }) {
  return (
    <div className="animate-fadeIn">
      <div className="h-56 bg-slate-800 overflow-hidden relative shadow-2xl">
        {user.cover ? <img src={user.cover} className="w-full h-full object-cover" alt="cover" /> : <div className="w-full h-full bg-gradient-to-bl from-blue-700 via-blue-900 to-[#020d2b]"></div>}
        <div className="absolute inset-0 bg-black/20"></div>
      </div>
      <div className="px-6 relative mb-12 border-b border-blue-900/20 pb-10 bg-gradient-to-b from-blue-900/5 to-transparent text-right">
        <div className="flex justify-between items-end -mt-20 flex-row-reverse">
          <div className="w-40 h-40 rounded-full border-[6px] border-[#020d2b] bg-slate-800 overflow-hidden shadow-[0_15px_50px_rgba(0,0,0,0.5)] relative z-10">
            {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" alt="avatar" /> : <div className="w-full h-full bg-blue-700 flex items-center justify-center text-7xl font-black">🇾🇪</div>}
          </div>
          <button onClick={onEdit} className="bg-white/5 border-2 border-blue-400/30 text-blue-300 font-black px-8 py-2.5 rounded-full hover:bg-blue-400/10 transition text-[15px] shadow-lg mb-4 active:scale-90 font-bold uppercase tracking-wider">تعديل ملفك</button>
        </div>
        <div className="mt-8 space-y-2">
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">{user.name}</h2>
          <p className="text-blue-400/60 text-sm font-mono tracking-widest uppercase">@{user.uid.slice(0, 10)}</p>
          <p className="mt-5 text-slate-100 leading-relaxed text-[17px] max-w-lg font-medium">{user.bio}</p>
          <div className="flex flex-wrap gap-6 mt-8 text-slate-400 text-xs font-black tracking-widest uppercase opacity-70 flex-row-reverse">
            <span className="flex items-center gap-1 font-bold">📅 انضم في {user.joined}</span>
            <span className="flex items-center gap-1 font-bold text-blue-400 tracking-tighter">📍 اليمن، الأرض الطيبة</span>
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
        const res = await compress(ev.target.result, field === 'avatar' ? 400 : 1000, field === 'avatar' ? 400 : 400);
        setFormData(prev => ({...prev, [field]: res}));
        setIsCompressing(false);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[500] flex items-center justify-center p-4 text-right" dir="rtl">
      <div className="bg-[#020d2b] w-full max-w-xl rounded-[3rem] border border-blue-800/40 overflow-hidden flex flex-col shadow-2xl">
        <div className="flex justify-between items-center p-8 border-b border-blue-900/30">
          <div className="flex items-center gap-6">
            <button onClick={onClose} className="text-4xl hover:bg-blue-900/40 p-1 rounded-full transition text-slate-500 hover:text-white">✕</button>
            <h3 className="font-black text-2xl text-white tracking-tighter uppercase">تحديث بياناتك</h3>
          </div>
          <button disabled={isCompressing} onClick={() => onSave(formData)} className="bg-blue-500 hover:bg-blue-400 text-white font-black px-10 py-2.5 rounded-full transition active:scale-95 disabled:opacity-30 shadow-xl">
            {isCompressing ? "جاري..." : "حفظ"}
          </button>
        </div>
        <div className="p-8 space-y-8 overflow-y-auto max-h-[75vh]">
          <div className="relative group cursor-pointer h-44 bg-slate-800 rounded-[2rem] overflow-hidden border border-blue-900/30 shadow-inner" onClick={() => coverRef.current.click()}>
            {formData.cover && <img src={formData.cover} className="w-full h-full object-cover opacity-60" alt="cover" />}
            <div className="absolute inset-0 flex items-center justify-center text-white font-black bg-black/30 opacity-0 group-hover:opacity-100 transition duration-500 text-xl tracking-tighter uppercase">تغيير الغلاف 📷</div>
            <input type="file" hidden ref={coverRef} accept="image/*" onChange={e => handleImg(e, 'cover')} />
          </div>
          <div className="relative -mt-24 mr-10 group cursor-pointer w-36 h-36 rounded-full border-[8px] border-[#020d2b] bg-slate-700 overflow-hidden shadow-2xl" onClick={() => avatarRef.current.click()}>
            {formData.avatar && <img src={formData.avatar} className="w-full h-full object-cover opacity-60" alt="avatar" />}
            <div className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-white bg-black/40 opacity-0 group-hover:opacity-100 transition duration-500 uppercase tracking-widest px-2 text-center">تغيير الصورة 📷</div>
            <input type="file" hidden ref={avatarRef} accept="image/*" onChange={e => handleImg(e, 'avatar')} />
          </div>
          <div className="space-y-6">
            <input className="w-full bg-[#010a1f] border-2 border-blue-900/40 rounded-[1.5rem] p-5 outline-none focus:border-blue-400 text-white font-black transition text-lg" placeholder="الاسم اليماني" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
            <textarea className="w-full bg-[#010a1f] border-2 border-blue-900/40 rounded-[1.5rem] p-5 outline-none focus:border-blue-400 resize-none h-36 text-white leading-relaxed font-medium" placeholder="النبذة الشخصية" value={formData.bio || ''} onChange={e => setFormData({...formData, bio: e.target.value})} />
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
    <div className="flex flex-col h-[calc(100vh-140px)] animate-fadeIn text-right">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-blue-950/10 scrollbar-hide">
        <div className="p-8 text-center bg-blue-900/10 rounded-[2rem] border border-blue-800/30 mb-10 shadow-lg font-black uppercase tracking-widest text-blue-400 text-sm">
           مرحباً بك في مجلس اليمن السعيد 🗣️
        </div>
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.senderId === user.uid ? 'justify-start flex-row-reverse' : 'justify-end flex-row-reverse'}`}>
            <div className={`p-5 rounded-[2rem] max-w-[85%] shadow-xl transition-all duration-500 hover:scale-[1.02] ${m.senderId === user.uid ? 'bg-blue-600 text-white rounded-bl-none' : 'bg-slate-800 text-slate-100 rounded-br-none border border-blue-900/30'}`}>
              <div className="text-[10px] opacity-70 font-black mb-1.5 uppercase border-b border-white/10 pb-1 tracking-widest">{m.senderName}</div>
              <div className="text-[15px] leading-relaxed break-words font-medium">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="p-6 border-t border-blue-900/30 flex gap-4 bg-[#020d2b]">
        <input type="text" className="bg-slate-900 flex-1 p-5 rounded-3xl outline-none text-white focus:ring-2 ring-blue-500/50 transition border border-blue-900/30 font-medium" placeholder="أرسل كلمة طيبة لليمنيين..." value={input} onChange={e => setInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && onSend()} />
        <button onClick={onSend} className="bg-blue-600 p-5 rounded-3xl transition active:scale-90 shadow-2xl hover:bg-blue-500 text-2xl">🕊️</button>
      </div>
    </div>
  );
}

function AdminPanel({ tweets, db, appId, showStatus }) {
  const handleDelete = async (id) => {
    if (!window.confirm("حذف هذه التغريدة نهائياً؟")) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'tweets', id));
      showStatus("تم حذف التغريدة");
    } catch (e) { showStatus("خطأ في الصلاحيات"); }
  };
  return (
    <div className="p-8 space-y-8 animate-fadeIn text-right">
      <h2 className="text-3xl font-black text-yellow-500 flex items-center gap-4 tracking-tighter uppercase font-bold">🛡️ لوحة الرقابة الإدارية</h2>
      <div className="bg-slate-900/80 rounded-[3rem] border border-blue-900/30 overflow-hidden shadow-2xl">
        <div className="bg-blue-900/30 p-6 text-blue-300 font-black grid grid-cols-4 gap-4 text-xs uppercase tracking-[0.2em] border-b border-blue-900/30 flex-row-reverse">
          <div className="col-span-2">المحتوى</div>
          <div>الناشر</div>
          <div>الإجراء</div>
        </div>
        <div className="divide-y divide-blue-900/20">
          {tweets.map(t => (
            <div key={t.id} className="p-6 grid grid-cols-4 gap-4 items-center hover:bg-white/5 transition duration-500 flex-row-reverse">
              <div className="col-span-2 truncate text-slate-200 text-sm font-semibold">{t.text || "[وسائط مرئية]"}</div>
              <div className="truncate text-blue-300/50 font-mono text-xs tracking-tighter font-bold uppercase">{t.userName}</div>
              <button onClick={() => handleDelete(t.id)} className="bg-red-400/10 text-red-400 px-6 py-2 rounded-full text-[10px] font-black hover:bg-red-500 hover:text-white transition duration-300 uppercase tracking-widest shadow-lg">حذف</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrendItem({ tag, count }) {
  return (
    <div className="py-5 hover:bg-blue-400/10 cursor-pointer transition duration-500 px-5 rounded-[1.5rem] group border-b border-blue-900/10 last:border-0 text-right">
      <div className="text-blue-400/40 text-[10px] font-black uppercase tracking-[0.2em] group-hover:text-blue-300 transition duration-500">متداول الآن في اليمن</div>
      <div className="font-black text-[#38bdf8] text-[17px] mt-1 tracking-tighter">{tag}</div>
      <div className="text-blue-400/30 text-[11px] mt-1.5 font-bold tracking-widest uppercase">{count} تغريدة</div>
    </div>
  );
}
