import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Language, translations } from './translations';
import { User, Group } from './types';
import { supabase } from './lib/supabase';
import { fetchProfileFromApi } from './lib/authApi';
import { LoadingProvider } from './lib/LoadingContext';
import Splash from './components/Splash';
import Auth from './components/Auth';
import Navbar from './components/Navbar';
import HomeView from './components/HomeView';
import LibraryView from './components/LibraryView';
import GroupsView from './components/GroupsView';
import GCMView from './components/GCMView';
import AdminPanelView from './components/AdminPanelView';
import LoadingBar from './components/LoadingBar';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [lang, setLang] = useState<Language>('ar');
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentTab, setCurrentTab] = useState('home');

  // One-step back for phone/tablet/laptop: tab changes push history so hardware back goes one tab back, not exit app
  const navigateTab = (tab: string) => {
    if (tab === currentTab) return;
    try { window.history.pushState({ tab: currentTab }, '', `?tab=${tab}`); } catch {}
    setCurrentTab(tab);
  };

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const prevTab = (e.state as any)?.tab;
      if (prevTab && typeof prevTab === 'string') {
        setCurrentTab(prevTab);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const t = translations[lang];

  // Always start on home when site/app is closed and reopened (not last tab)
  useEffect(() => {
    try { localStorage.removeItem('gcm_current_tab'); } catch {}
    // Clear any stale ?tab= query param on fresh load
    if (window.location.search.includes('tab=')) {
      try { window.history.replaceState({}, '', window.location.pathname); } catch {}
    }
  }, []);

  // Set HTML dir/lang attribute based on language
  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  // On mount: check for existing Supabase session (no passwords in localStorage)
  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.access_token) {
          const authenticatedUser = await fetchProfileFromApi(session.access_token);

          if (authenticatedUser.status === 'approved') {
            setUser(authenticatedUser);
          } else {
            await supabase.auth.signOut();
          }
        }
      } catch (err) {
        console.error('Session init error:', err);
        await supabase.auth.signOut();
      } finally {
        // We let the Splash component timer handle hiding the splash screen
      }
    };

    initSession();
  }, []);

  const handleAuthSuccess = (authenticatedUser: User) => {
    setUser(authenticatedUser);
    setCurrentTab('home');
  };

  const handleUserUpdate = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setCurrentTab('home');
    setGroups([]);
  };

  if (showSplash) {
    return (
      <Splash
        lang={lang}
        setLang={setLang}
        onComplete={() => setShowSplash(false)}
      />
    );
  }

  if (!user) {
    return <Auth lang={lang} setLang={setLang} onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <LoadingProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
        <Navbar
          currentTab={currentTab}
          setCurrentTab={navigateTab}
          lang={lang}
          setLang={setLang}
          user={user}
          onLogout={handleLogout}
        />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pb-24 md:pb-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentTab}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {currentTab === 'home' && (
                <HomeView lang={lang} user={user} groups={groups} setGroups={setGroups} onNavigate={navigateTab} />
              )}
              {currentTab === 'library' && <LibraryView lang={lang} user={user} />}
              {currentTab === 'groups' && (
                <GroupsView lang={lang} user={user} groups={groups} setGroups={setGroups} onNavigate={navigateTab} />
              )}
              {currentTab === 'gcm' && (
                <GCMView lang={lang} user={user} onUserUpdate={handleUserUpdate} />
              )}
              {currentTab === 'admin' && <AdminPanelView lang={lang} user={user} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <LoadingBar />
        <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
          <div>{t.footerCopyright}</div>
          <div className="mt-1">
            {t.footerDeveloperLabel}{' — '}
            <a href="https://afraim-porfolio.afraimfarag7.workers.dev/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-semibold">
              {t.footerDeveloperLink}
            </a>
          </div>
        </footer>
      </div>
    </LoadingProvider>
  );
}
