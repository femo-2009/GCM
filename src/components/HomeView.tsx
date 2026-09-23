import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Edit2, Trash2, HelpCircle, Save, X, Info, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Language, translations } from '../translations';
import { User, Leader, Group, HomeConfig } from '../types';
import { supabase } from '../lib/supabase';
import { useLoading } from '../lib/LoadingContext';

interface HomeViewProps {
  lang: Language;
  user: User;
  groups: Group[];
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  onNavigate?: (tab: string) => void;
}

export default function HomeView({ lang, user, groups, setGroups, onNavigate }: HomeViewProps) {
  const { withLoading } = useLoading();
  const [loading, setLoading] = useState(true);
  const [homeConfig, setHomeConfig] = useState<HomeConfig | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);

  // Modals / Editors state
  const [isEditingWelcome, setIsEditingWelcome] = useState(false);
  const [welcomeAr, setWelcomeAr] = useState('');
  const [welcomeEn, setWelcomeEn] = useState('');

  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [planPhoto, setPlanPhoto] = useState('');
  const [planTextAr, setPlanTextAr] = useState('');
  const [planTextEn, setPlanTextEn] = useState('');
  const [planPhotoPreview, setPlanPhotoPreview] = useState('');

  // Plan Details Modal
  const [isViewingPlanDetails, setIsViewingPlanDetails] = useState(false);

  // Leaders Manager Modal
  const [isManagingLeaders, setIsManagingLeaders] = useState(false);
  const [isAddingLeader, setIsAddingLeader] = useState(false);
  const [editingLeader, setEditingLeader] = useState<Leader | null>(null);
  
  // Leader Form State
  const [leaderName, setLeaderName] = useState('');
  const [leaderDesc, setLeaderDesc] = useState('');
  const [leaderGroupId, setLeaderGroupId] = useState('');
  const [leaderPhoto, setLeaderPhoto] = useState('');
  const [leaderPhotoPreview, setLeaderPhotoPreview] = useState('');
  const [leaderPhotoPosition, setLeaderPhotoPosition] = useState('50% 50%');
  const [leaderPhotoScale, setLeaderPhotoScale] = useState(1);
  const [isSavingLeader, setIsSavingLeader] = useState(false);
  const [isUploadingLeaderPhoto, setIsUploadingLeaderPhoto] = useState(false);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const leaderFormRef = useRef<HTMLFormElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Detailed Leader View Modal
  const [selectedLeader, setSelectedLeader] = useState<Leader | null>(null);

  const t = translations[lang];

  // Admin access checks
  const canEditHome = user.role === 'super_admin' || user.permissions.includes('edit_home');

  const fetchData = async () => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/home', {
          headers: {
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
        });
      const data: any = await res.json();
      setHomeConfig(data.homeConfig);
      setLeaders(data.leaders);
      setGroups(data.groups);
      
      // Seed form values
      setWelcomeAr(data.homeConfig.welcomeMessageAr);
      setWelcomeEn(data.homeConfig.welcomeMessageEn);
      setPlanPhotoPreview(data.homeConfig.planPhoto);
      setPlanTextAr(data.homeConfig.planTextAr);
      setPlanTextEn(data.homeConfig.planTextEn);
    } catch (error) {
      console.error('Failed to fetch home data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Auto-open a specific leader's detail modal when navigated from group cards
  useEffect(() => {
    const highlightId = localStorage.getItem('highlightLeaderId');
    if (highlightId && leaders.length > 0) {
      localStorage.removeItem('highlightLeaderId');
      const leader = leaders.find((l) => l.id === highlightId);
      if (leader) setSelectedLeader(leader);
    }
  }, [leaders]);

  const [isSliderHovered, setIsSliderHovered] = useState(false);

  // Number of copies needed so content always fills the viewport (no white space)
  const CARD_W = 316; // ~300px card + 16px gap
  const contentW = leaders.length * CARD_W;
  const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const copies = Math.max(2, Math.ceil(vpW / contentW) + 1);

  const marqueeDuration = leaders.length * 10;
  const [animDelay, setAnimDelay] = useState(0);

  const handleManualScroll = (dir: 'left' | 'right') => {
    if (leaders.length === 0) return;
    const cardTime = marqueeDuration / leaders.length;
    const effective = lang === 'ar' ? (dir === 'left' ? 'right' : 'left') : dir;
    const delta = effective === 'right' ? cardTime : -cardTime;
    setAnimDelay((prev) => ((prev + delta) % marqueeDuration + marqueeDuration) % marqueeDuration);
  };

  // Welcome message update
  const handleSaveWelcome = async () => {
    await withLoading(async () => {
      try {
        const res = await fetch('/api/home/welcome', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({ welcomeMessageAr: welcomeAr, welcomeMessageEn: welcomeEn }),
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to save welcome message';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }
        
        const updatedConfig: any = await res.json();
        setHomeConfig(prev => ({ ...prev, ...updatedConfig }));
        setIsEditingWelcome(false);
        alert(lang === 'ar' ? 'تم حفظ رسالة الترحيب بنجاح' : 'Welcome message saved successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حفظ رسالة الترحيب' : 'Failed to save welcome message'));
      }
    });
  };

  // Photo uploads
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, setPhoto: (v: string) => void, setPreview: (v: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setPhoto(base64);
        setPreview(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  // Secure leader photo upload (follows site security: 5MB, jpeg/png/webp, private bucket)
  const handleLeaderPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert(lang === 'ar' ? 'نوع الصورة غير مدعوم (jpeg/png/webp فقط)' : 'Unsupported image type (jpeg/png/webp only)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert(lang === 'ar' ? 'الصورة كبيرة جداً (الحد 5MB)' : 'Image too large (max 5MB)');
      return;
    }
    setIsUploadingLeaderPhoto(true);
    try {
      // instant local preview (like slider will show) while uploading securely
      const localPreview = URL.createObjectURL(file);
      setLeaderPhotoPreview(localPreview);
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('file', file, file.name);
      const res = await fetch('/api/leader-media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        body: formData,
      });
      const payload: any = await res.json().catch(() => null);
      if (!res.ok || typeof payload?.path !== 'string') {
        throw new Error(payload?.error || (lang === 'ar' ? 'فشل رفع الصورة' : 'Failed to upload image'));
      }
      setLeaderPhoto(payload.path);
      // keep preview as object URL until next fetchData hydrates signed URL; also store path for submission
    } catch (err: any) {
      console.error(err);
      alert(err.message || (lang === 'ar' ? 'فشل رفع الصورة' : 'Failed to upload image'));
      // keep previous photo if exists
    } finally {
      setIsUploadingLeaderPhoto(false);
      // reset file input value to allow re-select same file
      e.target.value = '';
    }
  };

  // WhatsApp-style drag to adjust photo crop (like WhatsApp profile photo)
  const handleEditorPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!leaderPhotoPreview) return;
    setIsDraggingPhoto(true);
  };
  const handleEditorPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDraggingPhoto || !editorRef.current) return;
    const rect = editorRef.current.getBoundingClientRect();
    const clientX = (e as any).touches ? (e as any).touches[0].clientX : (e as any).clientX;
    const clientY = (e as any).touches ? (e as any).touches[0].clientY : (e as any).clientY;
    const xPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    // WhatsApp: dragging moves the focal point; we set object-position to where user dragged
    setLeaderPhotoPosition(`${Math.round(xPct)}% ${Math.round(yPct)}%`);
  };
  const handleEditorPointerUp = () => setIsDraggingPhoto(false);

  // General Plan update
  const handleSavePlan = async () => {
    await withLoading(async () => {
      try {
        const res = await fetch('/api/home/plan', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            planPhoto,
            planTextAr,
            planTextEn
          }),
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to save plan';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }
        
        const updatedConfig: any = await res.json();
        setHomeConfig(prev => ({ ...prev, ...updatedConfig }));
        setIsEditingPlan(false);
        alert(lang === 'ar' ? 'تم حفظ الخطة العامة بنجاح' : 'General plan saved successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حفظ الخطة العامة' : 'Failed to save general plan'));
      }
    });
  };

  // Leader: Add or Edit Submit
  const handleSaveLeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaderName || isSavingLeader) return;

    // Double-check: prevent form resubmission
    if (leaderFormRef.current) {
      const submitButton = leaderFormRef.current.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitButton && submitButton.disabled) {
        return;
      }
    }

    setIsSavingLeader(true);
    
    // Disable the submit button immediately
    if (leaderFormRef.current) {
      const submitButton = leaderFormRef.current.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitButton) {
        submitButton.disabled = true;
      }
    }
    
    await withLoading(async () => {
      try {
        const isEdit = !!editingLeader;
        const endpoint = isEdit ? `/api/leaders/${editingLeader.id}` : '/api/leaders';
        const method = isEdit ? 'PUT' : 'POST';


        // Security: trim inputs, enforce limits client-side
        const trimmedName = leaderName.trim();
        if (trimmedName.length < 2 || trimmedName.length > 100) {
          throw new Error(lang === 'ar' ? 'اسم القائد يجب أن يكون بين 2 و 100 حرف' : 'Leader name must be 2-100 characters');
        }
        if (leaderDesc.length > 5000) {
          throw new Error(lang === 'ar' ? 'الوصف طويل جداً' : 'Description too long');
        }
        // If user picked a new photo but upload not finished, block
        if (isUploadingLeaderPhoto) {
          throw new Error(lang === 'ar' ? 'انتظر حتى يكتمل رفع الصورة' : 'Please wait for image upload to finish');
        }
        // Determine photo to send: if new upload path exists use it, otherwise keep existing leader's photo when editing
        const photoToSend = leaderPhoto || (editingLeader?.photo && !leaderPhotoPreview.startsWith('blob:') ? editingLeader.photo : '');

        const res = await fetch(endpoint, {
          method,
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            name: trimmedName,
            description: leaderDesc.trim(),
            photo: photoToSend,
            groupId: leaderGroupId,
            photoPosition: leaderPhotoPosition || '50% 50%',
            photoScale: leaderPhotoScale || 1
          }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to save leader';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }

        // Refresh (will hydrate signed URLs)
        await fetchData();
        // Reset states
        setIsAddingLeader(false);
        setEditingLeader(null);
        setLeaderName('');
        setLeaderDesc('');
        setLeaderGroupId('');
        setLeaderPhoto('');
        setLeaderPhotoPreview('');
        setLeaderPhotoPosition('50% 50%');
        setLeaderPhotoScale(1);
        alert(lang === 'ar' ? 'تم حفظ القائد بنجاح' : 'Leader saved successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حفظ القائد' : 'Failed to save leader'));
      } finally {
        setIsSavingLeader(false);
      }
    });
  };

  const handleDeleteLeader = async (id: string) => {
    if (!confirm(lang === 'ar' ? 'هل أنت متأكد من حذف هذا القائد؟' : 'Are you sure you want to delete this leader?')) return;
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/leaders/${id}`, { 
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          }
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to delete leader';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }
        
        await fetchData();
        alert(lang === 'ar' ? 'تم حذف القائد بنجاح' : 'Leader deleted successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حذف القائد' : 'Failed to delete leader'));
      }
    });
  };

  const handleOpenEditLeader = (leader: Leader) => {
    setEditingLeader(leader);
    setLeaderName(leader.name);
    setLeaderDesc(leader.description);
    setLeaderGroupId(leader.groupId);
    setLeaderPhotoPreview(leader.photo);
    setLeaderPhoto('');
    setLeaderPhotoPosition((leader as any).photoPosition || '50% 50%');
    setLeaderPhotoScale((leader as any).photoScale || 1);
    setIsAddingLeader(true);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-500">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <span>{t.splashLoading}</span>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-10" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
      
      {/* 1. Welcome Message Banner */}
      <section id="welcome-message-section" className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-sm">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-[80px] pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-extrabold text-indigo-950 mb-3 tracking-tight">
              {t.welcome}!
            </h2>
            <p className="text-slate-600 text-sm md:text-base leading-relaxed whitespace-pre-line font-medium font-sans">
              {lang === 'ar' ? homeConfig?.welcomeMessageAr : homeConfig?.welcomeMessageEn}
            </p>
          </div>
          {canEditHome && (
            <button
              id="edit-welcome-btn"
              onClick={() => setIsEditingWelcome(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shadow-sm transition-colors shrink-0 self-start md:self-center cursor-pointer"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>{t.editWelcomeMsg}</span>
            </button>
          )}
        </div>
      </section>

      {/* 2. Leaders Carousel Slider */}
      <section id="leaders-slider-section" className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">{t.leadersSliderTitle}</h3>
          </div>
          <div className="flex items-center gap-2">
            {canEditHome && (
              <button
                id="manage-leaders-btn"
                onClick={() => setIsManagingLeaders(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-md transition-colors mr-2 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.leadersList}</span>
              </button>
            )}
            <button
              onClick={() => handleManualScroll('left')}
              className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
              title={lang === 'ar' ? 'السابق' : 'Previous'}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleManualScroll('right')}
              className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
              title={lang === 'ar' ? 'التالي' : 'Next'}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {leaders.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-3xl border border-slate-200 text-slate-500 text-sm">
            {lang === 'ar' ? 'لا يوجد قادة مضافين حالياً' : 'No leaders added yet'}
          </div>
        ) : (
          <div
            onMouseEnter={() => setIsSliderHovered(true)}
            onMouseLeave={() => setIsSliderHovered(false)}
            className="relative w-full overflow-hidden"
          >
            <div
              className="marquee-track gap-4"
              style={{
                '--copies': copies,
                animationName: lang === 'ar' ? 'marquee-rtl' : 'marquee',
                animationDuration: `${marqueeDuration}s`,
                animationTimingFunction: 'linear',
                animationIterationCount: 'infinite',
                animationPlayState: (isSliderHovered ? 'paused' : 'running') as any,
                animationDelay: `-${animDelay}s`,
              } as React.CSSProperties}
            >
              {Array.from({ length: copies }, () => leaders).flat().map((leader, index) => {
                const linkedGroup = groups.find((g) => g.id === leader.groupId);
                return (
                  <div
                    key={`${leader.id}-${index}`}
                    className="w-[200px] sm:w-[260px] shrink-0 bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm flex flex-col group hover:border-indigo-500/30 transition-all duration-300"
                  >
                    <div className="relative h-32 sm:h-44 overflow-hidden bg-slate-100">
                      <img 
                        src={leader.photo} 
                        alt={leader.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-all duration-500"
                        style={{ objectPosition: (leader as any).photoPosition || '50% 50%', transform: `scale(${(leader as any).photoScale || 1})`, transformOrigin: (leader as any).photoPosition || '50% 50%' }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent opacity-85" />
                      
                    {/* Floating connected group label — clickable to visit group page */}
                    {linkedGroup && (
                      <button
                        onClick={(e) => { e.stopPropagation(); localStorage.setItem('highlightGroupId', leader.groupId); onNavigate?.('groups'); }}
                        className={`absolute bottom-3 ${lang === 'ar' ? 'right-3' : 'left-3'} bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full max-w-[90%] truncate shadow-md cursor-pointer transition-colors flex items-center gap-1`}
                        title={lang === 'ar' ? 'زيارة المجموعة' : 'Visit group'}
                      >
                        <span className="truncate">{linkedGroup.title}</span>
                        <span className="opacity-80 shrink-0 text-[9px]">
                          {lang === 'ar' ? '←' : '→'}
                        </span>
                      </button>
                    )}
                    </div>
                    <div className="p-5 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="text-base font-bold text-slate-900 mb-2 line-clamp-1 group-hover:text-indigo-600 transition-colors">{leader.name}</h4>
                        <p className="text-slate-500 text-xs line-clamp-3 leading-relaxed mb-4">{leader.description || (lang === 'ar' ? 'لا يوجد وصف حالياً.' : 'No description provided.')}</p>
                      </div>
                      
                      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-slate-100">
                        <button
                          onClick={() => setSelectedLeader(leader)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                        >
                          <Info className="w-3.5 h-3.5 text-indigo-600" />
                          <span>{t.info}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 3. General Plan Section */}
      <section id="general-plan-section" className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">{t.generalPlanTitle}</h3>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm grid md:grid-cols-2">
          {/* Plan Image */}
          <div className="h-64 md:h-auto min-h-[240px] relative bg-slate-100">
            <img 
              src={homeConfig?.planPhoto} 
              alt="General Plan"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-l from-white/90 via-transparent to-transparent md:via-transparent opacity-95" />
          </div>

          {/* Plan Summary / Text */}
          <div className="p-6 md:p-8 flex flex-col justify-between">
            <div>
              <h4 className="text-lg font-bold text-indigo-950 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <span>{t.generalPlanTitle}</span>
              </h4>
              <p className="text-slate-600 text-xs md:text-sm leading-relaxed whitespace-pre-line line-clamp-5 mb-6">
                {lang === 'ar' ? homeConfig?.planTextAr : homeConfig?.planTextEn}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                id="see-more-details-btn"
                onClick={() => setIsViewingPlanDetails(true)}
                className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 shadow-md transition-colors cursor-pointer"
              >
                {t.seeMoreDetails}
              </button>
              {canEditHome && (
                <button
                  id="edit-plan-btn"
                  onClick={() => setIsEditingPlan(true)}
                  className="w-full sm:w-auto px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                >
                  {t.editGeneralPlan}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {/* Modal: Edit Welcome Message */}
        {isEditingWelcome && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-xl p-6 md:p-8 relative shadow-2xl"
            >
              <button 
                onClick={() => setIsEditingWelcome(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 mb-6 pr-6">{t.editWelcomeMsg}</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.welcomeMsgAr}</label>
                  <textarea
                    rows={4}
                    value={welcomeAr}
                    onChange={(e) => setWelcomeAr(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                    dir="rtl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.welcomeMsgEn}</label>
                  <textarea
                    rows={4}
                    value={welcomeEn}
                    onChange={(e) => setWelcomeEn(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                    dir="ltr"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleSaveWelcome}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    {t.save}
                  </button>
                  <button
                    onClick={() => setIsEditingWelcome(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal: Edit General Plan */}
        {isEditingPlan && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-xl p-6 md:p-8 relative shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <button 
                onClick={() => setIsEditingPlan(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 mb-6 pr-6">{t.editGeneralPlan}</h3>

              <div className="space-y-4">
                {/* Photo Preview & Upload */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.uploadPhoto}</label>
                  <div className="flex items-center gap-4">
                    <img 
                      src={planPhotoPreview} 
                      alt="Plan Preview" 
                      className="w-20 h-20 rounded-xl object-cover border border-slate-200 bg-slate-50" 
                    />
                    <label className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold text-slate-700 rounded-xl transition-colors cursor-pointer">
                      <span>{lang === 'ar' ? 'اختر ملف صورة' : 'Choose Image File'}</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => handlePhotoUpload(e, setPlanPhoto, setPlanPhotoPreview)} 
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.planTextAr}</label>
                  <textarea
                    rows={5}
                    value={planTextAr}
                    onChange={(e) => setPlanTextAr(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                    dir="rtl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t.planTextEn}</label>
                  <textarea
                    rows={5}
                    value={planTextEn}
                    onChange={(e) => setPlanTextEn(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                    dir="ltr"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleSavePlan}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    {t.save}
                  </button>
                  <button
                    onClick={() => setIsEditingPlan(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal: General Plan Details (Big Window) */}
        {isViewingPlanDetails && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl p-6 md:p-8 relative shadow-2xl max-h-[85vh] overflow-y-auto"
            >
              <button 
                onClick={() => setIsViewingPlanDetails(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-6">
                <div className="h-56 md:h-72 w-full rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 shadow-inner">
                  <img 
                    src={homeConfig?.planPhoto} 
                    alt="Plan Image" 
                    className="w-full h-full object-cover" 
                  />
                </div>

                <h3 className="text-xl md:text-2xl font-bold text-indigo-950 border-b border-slate-100 pb-3">{t.generalPlanTitle}</h3>

                <p className="text-slate-700 text-sm md:text-base leading-relaxed whitespace-pre-line font-sans">
                  {lang === 'ar' ? homeConfig?.planTextAr : homeConfig?.planTextEn}
                </p>

                <div className="flex justify-end pt-4">
                  <button
                    onClick={() => setIsViewingPlanDetails(false)}
                    className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition-colors cursor-pointer"
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal: Admin Manage Leaders List */}
        {isManagingLeaders && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-3xl p-6 md:p-8 relative shadow-2xl max-h-[85vh] overflow-y-auto"
            >
              <button 
                onClick={() => setIsManagingLeaders(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center justify-between border-b border-slate-150 pb-4 mb-6">
                <h3 className="text-xl font-bold text-slate-900">{t.leadersList}</h3>
                <button
                  onClick={() => {
                    setIsAddingLeader(true);
                    setEditingLeader(null);
                    setLeaderName('');
                    setLeaderDesc('');
                    setLeaderGroupId('');
                    setLeaderPhoto('');
                    setLeaderPhotoPreview('');
                    setLeaderPhotoPosition('50% 50%');
                    setLeaderPhotoScale(1);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-md transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.addLeader}</span>
                </button>
              </div>

              {/* Form inside Modal to Add/Edit Leader */}
              {isAddingLeader && (
                <form ref={leaderFormRef} onSubmit={handleSaveLeader} className="bg-slate-50 border border-slate-250 rounded-2xl p-5 mb-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2">
                    <h4 className="text-xs font-bold text-indigo-900">{editingLeader ? t.editLeader : t.addLeader}</h4>
                    <button 
                      type="button"
                      onClick={() => setIsAddingLeader(false)}
                      className="p-1 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t.leaderName}</label>
                      <input
                        type="text"
                        required
                        value={leaderName}
                        onChange={(e) => setLeaderName(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-600 text-xs font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t.selectGroup}</label>
                      <select
                        value={leaderGroupId}
                        onChange={(e) => setLeaderGroupId(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-600 text-xs font-sans"
                      >
                        <option value="">-- {t.noGroup} --</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.title}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">{t.leaderDesc}</label>
                    <textarea
                      rows={2}
                      value={leaderDesc}
                      onChange={(e) => setLeaderDesc(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-600 text-xs font-sans"
                    />
                  </div>

                  {/* Leader Photo - WhatsApp-style fit: drag + zoom */}
                  <div className="space-y-3 bg-white border border-slate-200 rounded-2xl p-4">
                    <label className="block text-xs font-bold text-slate-700">{lang === 'ar' ? 'صورة القائد - مثل واتساب (اسحب للتوسيط + تكبير)' : 'Leader Photo - WhatsApp fit (drag to reposition + zoom)'} <span className="font-normal text-[10px] text-slate-400">({lang === 'ar' ? 'آمن: jpeg/png/webp حتى 5MB' : 'secure: jpeg/png/webp max 5MB'})</span></label>
                    <div className="grid md:grid-cols-2 gap-4 items-start">
                      {/* WhatsApp-style editor - drag to fit */}
                      <div className="space-y-2">
                        <span className="text-[11px] font-semibold text-slate-500">{lang === 'ar' ? 'اسحب الصورة داخل الإطار كما في واتساب' : 'Drag photo inside frame like WhatsApp'}</span>
                        <div
                          ref={editorRef}
                          onMouseDown={handleEditorPointerDown}
                          onMouseMove={handleEditorPointerMove}
                          onMouseUp={handleEditorPointerUp}
                          onMouseLeave={handleEditorPointerUp}
                          onTouchStart={handleEditorPointerDown}
                          onTouchMove={handleEditorPointerMove}
                          onTouchEnd={handleEditorPointerUp}
                          className="relative w-full max-w-[260px] h-44 overflow-hidden bg-slate-100 border border-slate-200 rounded-2xl shadow-sm select-none"
                          style={{ cursor: leaderPhotoPreview ? (isDraggingPhoto ? 'grabbing' : 'grab') : 'default', touchAction: 'none' }}
                        >
                          {leaderPhotoPreview ? (
                            <img
                              src={leaderPhotoPreview}
                              alt="Preview"
                              draggable={false}
                              className="w-full h-full object-cover"
                              style={{ objectPosition: leaderPhotoPosition, transform: `scale(${leaderPhotoScale})`, transformOrigin: leaderPhotoPosition }}
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-1">
                              <HelpCircle className="w-6 h-6" />
                              <span className="text-[10px]">{lang === 'ar' ? 'لا توجد صورة - اختر صورة أولاً' : 'No image - choose one first'}</span>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/30 to-transparent pointer-events-none" />
                          {leaderPhotoPreview && <div className="absolute top-2 right-2 bg-black/60 text-white text-[9px] px-2 py-0.5 rounded-full pointer-events-none">{lang === 'ar' ? 'اسحب للتحريك' : 'Drag to move'}</div>}
                        </div>
                        {leaderPhotoPreview && (
                          <div className="space-y-1 max-w-[260px]">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-slate-600">{lang === 'ar' ? 'تكبير' : 'Zoom'}</span>
                              <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">{leaderPhotoScale.toFixed(1)}x</span>
                            </div>
                            <input type="range" min={0.5} max={3} step={0.1} value={leaderPhotoScale} onChange={(e) => setLeaderPhotoScale(parseFloat(e.target.value))} className="w-full accent-indigo-600" />
                            <div className="flex justify-between text-[9px] text-slate-400"><span>0.5x {lang === 'ar' ? 'تصغير' : 'shrink'}</span><span>3x {lang === 'ar' ? 'تكبير' : 'zoom'}</span></div>
                          </div>
                        )}
                      </div>
                      {/* Upload + hint + reset */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <label className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${isUploadingLeaderPhoto ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600'}`}>
                            <span>{isUploadingLeaderPhoto ? (lang === 'ar' ? 'جاري الرفع...' : 'Uploading...') : (lang === 'ar' ? 'اختيار صورة' : 'Choose Image')}</span>
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={isUploadingLeaderPhoto} onChange={handleLeaderPhotoUpload} />
                          </label>
                          {leaderPhotoPreview && <button type="button" onClick={() => { setLeaderPhotoPosition('50% 50%'); setLeaderPhotoScale(1); }} className="text-[11px] text-slate-500 hover:text-slate-700 underline">{lang === 'ar' ? 'إعادة ضبط' : 'Reset fit'}</button>}
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                          <p className="text-[11px] font-semibold text-slate-700">{lang === 'ar' ? 'مثل واتساب:' : 'Like WhatsApp:'}</p>
                          <p className="text-[10px] text-slate-500 leading-relaxed">{lang === 'ar' ? '• اسحب الصورة داخل الإطار لتوسيط الوجه • استخدم شريط التكبير لتكبير/تصغير • المعاينة هي نفس ما سيظهر في السلايدر تماماً' : '• Drag photo inside frame to center face • Use zoom slider to zoom in/out • Preview is exactly what slider will show'}</p>
                          <p className="text-[10px] font-mono bg-white border border-slate-200 rounded px-1.5 py-1 mt-1">pos: {leaderPhotoPosition} • scale: {leaderPhotoScale.toFixed(1)}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSavingLeader || isUploadingLeaderPhoto}
                      className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isUploadingLeaderPhoto ? (lang === 'ar' ? 'جاري رفع الصورة...' : 'Uploading image...') : isSavingLeader ? (lang === 'ar' ? 'جاري الحفظ...' : 'Saving...') : t.save}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingLeader(false)}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                    >
                      {t.cancel}
                    </button>
                  </div>
                </form>
              )}

              {/* Leaders list table or cards */}
              <div className="grid gap-3 max-h-[50vh] overflow-y-auto">
                {leaders.map((leader) => {
                  const linkedGroup = groups.find((g) => g.id === leader.groupId);
                  return (
                    <div 
                      key={leader.id}
                      className="flex items-center gap-4 p-3 bg-slate-50 border border-slate-150 rounded-2xl"
                    >
                      <img 
                        src={leader.photo} 
                        alt={leader.name} 
                        className="w-11 h-11 rounded-xl object-cover bg-white border border-slate-200" 
                        style={{ objectPosition: (leader as any).photoPosition || '50% 50%', transform: `scale(${(leader as any).photoScale || 1})`, transformOrigin: (leader as any).photoPosition || '50% 50%' }}
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs md:text-sm font-bold text-slate-800 truncate">{leader.name}</h4>
                        <p className="text-[10px] text-slate-500 truncate">
                          {linkedGroup ? `${lang === 'ar' ? 'مجموعة:' : 'Group:'} ${linkedGroup.title}` : t.noGroup}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleOpenEditLeader(leader)}
                          className="p-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-indigo-600 hover:text-indigo-700 rounded-lg transition-all cursor-pointer"
                          title={t.editLeader}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteLeader(leader.id)}
                          className="p-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 hover:text-red-700 rounded-lg transition-all cursor-pointer"
                          title={t.deleteLeader}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-6 border-t border-slate-200 mt-6">
                <button
                  onClick={() => setIsManagingLeaders(false)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 cursor-pointer"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal: Leader Details (Big Window) */}
        {selectedLeader && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 relative shadow-2xl"
            >
              <button 
                onClick={() => setSelectedLeader(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-4 text-center">
                <div className="w-28 h-28 mx-auto rounded-full overflow-hidden border-2 border-indigo-600 shadow-xl bg-slate-100">
                  <img src={selectedLeader.photo} alt={selectedLeader.name} className="w-full h-full object-cover" style={{ objectPosition: (selectedLeader as any).photoPosition || '50% 50%', transform: `scale(${(selectedLeader as any).photoScale || 1})`, transformOrigin: (selectedLeader as any).photoPosition || '50% 50%' }} />
                </div>

                <div className="pt-2">
                  <h3 className="text-lg font-bold text-slate-900">{selectedLeader.name}</h3>
                  {groups.find((g) => g.id === selectedLeader.groupId) && (
                    <button
                      onClick={() => { setSelectedLeader(null); localStorage.setItem('highlightGroupId', selectedLeader.groupId); onNavigate?.('groups'); }}
                      className="inline-flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-150 rounded-full px-3 py-1 mt-1 text-[11px] font-bold text-indigo-700 cursor-pointer transition-colors"
                    >
                      {groups.find((g) => g.id === selectedLeader.groupId)?.title}
                      <span className="text-[9px]">{lang === 'ar' ? '←' : '→'}</span>
                    </button>
                  )}
                </div>

                <div className="text-right p-4 bg-slate-50 border border-slate-200 rounded-2xl max-h-44 overflow-y-auto">
                  <p className="text-slate-600 text-xs md:text-sm leading-relaxed whitespace-pre-line font-sans" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
                    {selectedLeader.description || (lang === 'ar' ? 'لا يوجد وصف مضاف.' : 'No description added.')}
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setSelectedLeader(null)}
                    className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-750 transition-colors cursor-pointer"
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
