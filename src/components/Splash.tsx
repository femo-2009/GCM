import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Globe } from 'lucide-react';
import { Language, translations } from '../translations';
import logoImg1 from '../assets/logo-splash-1.png';
import logoImg2 from '../assets/logo-splash-2.png';
import logoImg3 from '../assets/logo-splash-3.png';
import logoImg4 from '../assets/logo-splash-4.png';
import logoImg5 from '../assets/logo-splash-5.png';
import logoImg6 from '../assets/logo-splash-6.png';

const splashLogos = [logoImg1, logoImg2, logoImg3, logoImg4, logoImg5, logoImg6];

interface SplashProps {
  onComplete: () => void;
  lang: Language;
  setLang: (l: Language) => void;
}

export default function Splash({ onComplete, lang, setLang }: SplashProps) {
  const [progress, setProgress] = useState(0);
  const [logoImg] = useState(() => splashLogos[Math.floor(Math.random() * splashLogos.length)]);
  const t = translations[lang];

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          setTimeout(onComplete, 500); // add a slight buffer
          return 100;
        }
        return prev + 4;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [onComplete]);

  return (
    <div 
      id="splash-screen"
      className="fixed inset-0 bg-slate-50 flex flex-col items-center justify-center text-slate-900 z-50 p-6 overflow-hidden select-none"
    >
      {/* Dynamic Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Language Switch on Splash */}
      <div className="absolute top-6 right-6 z-50">
        <button
          id="splash-lang-btn"
          onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          className="flex items-center gap-2 px-4 py-2 bg-white/90 hover:bg-white border border-slate-200 rounded-full text-xs font-medium text-slate-700 transition-all duration-200 shadow-sm cursor-pointer"
        >
          <Globe className="w-4 h-4 text-indigo-600" />
          <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
        </button>
      </div>

      <div className="max-w-md w-full text-center flex flex-col items-center relative z-10">
        {/* Glowing Logo */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="relative mb-8"
        >
          <div className="absolute inset-0 bg-indigo-500/10 rounded-full blur-2xl animate-pulse" />
          <div className="relative w-28 h-28 bg-gradient-to-tr from-indigo-700 via-indigo-600 to-indigo-500 rounded-3xl p-0.5 shadow-xl flex items-center justify-center transform rotate-12 hover:rotate-0 transition-transform duration-500">
            <div className="w-full h-full bg-white rounded-[22px] flex items-center justify-center transform -rotate-12 hover:rotate-0 transition-transform duration-500 overflow-hidden">
              <img src={logoImg} alt="GCM Logo" className="w-full h-full object-cover rounded-[22px]" />
            </div>
          </div>
          {/* Miniature Floating Cross Decor */}
          <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-1.5 rounded-full shadow-lg">
            <Sparkles className="w-4 h-4" />
          </div>
        </motion.div>

        {/* App Title with Elegant Typography */}
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="text-3xl md:text-4xl font-extrabold tracking-tight text-indigo-950 font-sans"
          style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}
        >
          {t.welcomeToGCM}
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="text-slate-600 mt-3 text-sm md:text-base max-w-xs md:max-w-md font-sans"
          style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}
        >
          {t.splashSubtitle}
        </motion.p>

        {/* Progress Loading Bar */}
        <div className="w-64 bg-slate-200 border border-slate-300 h-2.5 rounded-full mt-10 overflow-hidden relative shadow-inner">
          <motion.div 
            className="bg-gradient-to-r from-indigo-600 to-indigo-500 h-full rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ ease: 'linear' }}
          />
        </div>
        
        <span className="text-slate-500 text-xs mt-3 font-mono">
          {t.splashLoading} {progress}%
        </span>
      </div>
      
      {/* Subtle branding label */}
      <div className="absolute bottom-6 text-slate-400 text-xs font-medium tracking-wider font-sans text-center">
        <div>© 2026 GCM. All Rights Reserved.</div>
        <div className="mt-0.5">
          {t.footerDeveloperLabel}{' — '}
          <a href="https://afraim-porfiolio.afraimfarag7.workers.dev/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline font-semibold">
            {t.footerDeveloperLink}
          </a>
        </div>
      </div>
    </div>
  );
}
