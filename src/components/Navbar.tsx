import { useState } from 'react';
import { Home, BookOpen, Users, User as UserIcon, Settings, LogOut, Globe, Menu, X } from 'lucide-react';
import { Language, translations } from '../translations';
import { User } from '../types';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  lang: Language;
  setLang: (l: Language) => void;
  user: User;
  onLogout: () => void;
}

export default function Navbar({ currentTab, setCurrentTab, lang, setLang, user, onLogout }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const t = translations[lang];

  // Helper check: has admin permissions
  const isAdmin = user.role === 'super_admin' || user.role === 'admin';

  const navItems = [
    { id: 'home', label: t.home, icon: Home },
    { id: 'library', label: t.library, icon: BookOpen },
    { id: 'groups', label: t.groups, icon: Users },
    { id: 'gcm', label: t.gcm, icon: UserIcon },
  ];

  if (isAdmin) {
    navItems.push({ id: 'admin', label: t.adminPanel, icon: Settings });
  }

  const handleTabClick = (tabId: string) => {
    setCurrentTab(tabId);
    setMobileMenuOpen(false);
  };

  return (
    <>
    <nav className="bg-white border-b border-slate-200 text-slate-800 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo Section */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 flex items-center justify-center overflow-hidden bg-transparent">
              <img
                src="/icon-512.png"
                alt="GCM Logo"
                className="w-full h-full object-contain"
                width={512}
                height={512}
              />
            </div>
            <span className="font-extrabold text-sm md:text-base text-indigo-950 font-sans">
              {t.appName}
            </span>
          </div>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 font-bold shadow-sm shadow-indigo-100/50'
                      : 'text-slate-600 hover:text-indigo-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right Controls: Language & Logout */}
          <div className="hidden md:flex items-center gap-3">
            {/* Language Switch */}
            <button
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-indigo-600" />
              <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
            </button>

            {/* Logout */}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-xs font-semibold text-red-600 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t.logout}</span>
            </button>
          </div>

          {/* Mobile Menu Toggle Button */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5 text-indigo-600" />
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus:outline-none cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Panel - now only for logout/lang, nav is bottom bar */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 pt-3 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">{user.firstName} {user.lastName} <span className="text-[10px] text-slate-500">· {user.role}</span></span>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl text-xs font-bold text-red-600 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>{t.logout}</span>
            </button>
          </div>
        </div>
      )}
    </nav>

    {/* Bottom Navigation for phone/tablet - best thumb reach, one-step back still works */}
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-xl border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around px-1 py-1.5 max-w-lg mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleTabClick(item.id)}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-2xl transition-all duration-200 cursor-pointer min-w-[60px] ${
                isActive ? 'text-indigo-700' : 'text-slate-500 active:text-indigo-600'
              }`}
            >
              <span className={`p-2 rounded-xl transition-all ${isActive ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 scale-105' : 'bg-slate-100 text-slate-500'}`}>
                <Icon className="w-5 h-5" />
              </span>
              <span className={`text-[10px] font-bold leading-none ${isActive ? 'text-indigo-700' : 'text-slate-500'}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
    </>
  );
}
