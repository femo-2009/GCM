import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Plus, Minus, FileText, Users, User as UserIcon, Trash2, Edit2, X, Info, HelpCircle, UserCheck } from 'lucide-react';
import { Language, translations } from '../translations';
import { User, Disciple, UserGroup } from '../types';
import { supabase } from '../lib/supabase';
import { useLoading } from '../lib/LoadingContext';
import { uploadProfileMedia } from '../lib/profileMedia';

interface GCMViewProps {
  lang: Language;
  user: User;
  onUserUpdate: (updatedUser: User) => void;
}

export default function GCMView({ lang, user, onUserUpdate }: GCMViewProps) {
  const { withLoading, isLoading } = useLoading();
  const [loading, setLoading] = useState(false);
  const t = translations[lang];

  // Disciples modal states
  const [disciplesOpen, setDisciplesOpen] = useState(false);
  const [discipleFormOpen, setDiscipleFormOpen] = useState(false);
  const [editingDisciple, setEditingDisciple] = useState<Disciple | null>(null);
  const [selectedDisciple, setSelectedDisciple] = useState<Disciple | null>(null);

  // Disciple form fields
  const [discipleName, setDiscipleName] = useState('');
  const [discipleDesc, setDiscipleDesc] = useState('');
  const [disciplePhoto, setDisciplePhoto] = useState('');
  const [disciplePhotoPreview, setDisciplePhotoPreview] = useState('');

  // Custom groups states
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<UserGroup | null>(null);

  // Group form fields
  const [groupTitle, setGroupTitle] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupPhoto, setGroupPhoto] = useState('');
  const [groupPhotoPreview, setGroupPhotoPreview] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Personal plan editor states
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [planText, setPlanText] = useState(user.personalPlan?.text || '');
  const [planPhoto, setPlanPhoto] = useState('');
  const [planPhotoPreview, setPlanPhotoPreview] = useState(user.personalPlan?.photo || '');

  // 1. Profile photo upload handler
  const handleProfilePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const path = await uploadProfileMedia(file, 'avatar', t.profileMediaUploadFailed);
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ userId: user.id, photo: path }),
      });
      if (!res.ok) throw new Error(t.profileMediaUploadFailed);
      const data = await res.json();
      onUserUpdate(data.user);
    } catch (err: any) {
      console.error(err);
      alert(err.message || t.profileMediaUploadFailed);
    } finally {
      setLoading(false);
    }
  };

  // 2. Persistent Counts (+/-) updates
  const updateCount = async (type: 'christians' | 'friends', delta: number) => {
    const currentVal = user.counts[type] || 0;
    const newVal = Math.max(0, currentVal + delta);
    
    // Optimistic update
    const updatedUser = {
      ...user,
      counts: {
        ...user.counts,
        [type]: newVal
      }
    };
    onUserUpdate(updatedUser);

    await withLoading(async () => {
      try {
        const res = await fetch('/api/profile/update', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            userId: user.id,
            counts: {
              ...user.counts,
              [type]: newVal
            }
          }),
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to update count';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }
        
        const data = await res.json();
        onUserUpdate(data.user);
      } catch (err: any) {
        console.error('Failed to persist count:', err);
        // Revert optimistic update on error
        onUserUpdate(user);
        alert(err.message || (lang === 'ar' ? 'فشل تحديث العدد' : 'Failed to update count'));
      }
    });
  };

  // 3. Personal plan submit
  const handlePlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await withLoading(async () => {
      try {
        const res = await fetch('/api/profile/update', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            userId: user.id,
            personalPlan: {
              ...(planPhoto ? { photo: planPhoto } : {}),
              text: planText
            }
          }),
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to save personal plan';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }
        
        const data = await res.json();
        onUserUpdate(data.user);
        setPlanFormOpen(false);
        setPlanPhoto('');
        alert(lang === 'ar' ? 'تم حفظ الخطة الشخصية بنجاح' : 'Personal plan saved successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حفظ الخطة الشخصية' : 'Failed to save personal plan'));
      } finally {
        setLoading(false);
      }
    });
  };

  // 4. Disciples ADD / EDIT / DELETE
  const handleDiscipleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discipleName) return;

    await withLoading(async () => {
      try {
        const isEdit = !!editingDisciple;
        const res = await fetch('/api/profile/disciples', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            userId: user.id,
            action: isEdit ? 'edit' : 'add',
            discipleId: isEdit ? editingDisciple.id : undefined,
            name: discipleName,
            description: discipleDesc,
            ...(disciplePhoto ? { photo: disciplePhoto } : {})
          })
        });

        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to save disciple';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }

        const data = await res.json();
        onUserUpdate(data.user);
        // Reset
        setDiscipleFormOpen(false);
        setEditingDisciple(null);
        setDiscipleName('');
        setDiscipleDesc('');
        setDisciplePhoto('');
        setDisciplePhotoPreview('');
        alert(lang === 'ar' ? 'تم حفظ التلميذ بنجاح' : 'Disciple saved successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حفظ التلميذ' : 'Failed to save disciple'));
      }
    });
  };

  const handleDeleteDisciple = async (discipleId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(lang === 'ar' ? 'هل أنت متأكد من حذف هذا التلميذ؟ سيتم حذفه أيضاً من جميع مجموعاتك الخاصة.' : 'Are you sure you want to delete this disciple? They will also be removed from your groups.')) return;
    await withLoading(async () => {
      try {
        const res = await fetch('/api/profile/disciples', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            userId: user.id,
            action: 'delete',
            discipleId
          })
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to delete disciple';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }
        
        const data = await res.json();
        onUserUpdate(data.user);
        alert(lang === 'ar' ? 'تم حذف التلميذ بنجاح' : 'Disciple deleted successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حذف التلميذ' : 'Failed to delete disciple'));
      }
    });
  };

  const handleOpenEditDisciple = (d: Disciple, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingDisciple(d);
    setDiscipleName(d.name);
    setDiscipleDesc(d.description);
    setDisciplePhotoPreview(d.photo);
    setDisciplePhoto('');
    setDiscipleFormOpen(true);
  };

  // Helper reader
  const handlePhotoRead = async (e: React.ChangeEvent<HTMLInputElement>, setPhoto: (v: string) => void, setPreview: (v: string) => void, slot: 'personal-plan' | 'groups' | 'disciples') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setLoading(true);
    try {
      const path = await uploadProfileMedia(file, slot, t.profileMediaUploadFailed);
      setPhoto(path);
    } catch (err: any) {
      setPhoto('');
      setPreview('');
      alert(err.message || t.profileMediaUploadFailed);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  // 5. Custom groups ADD / EDIT / DELETE
  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupTitle) return;

    await withLoading(async () => {
      try {
        const isEdit = !!editingGroup;
        const res = await fetch('/api/profile/groups', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            userId: user.id,
            action: isEdit ? 'edit' : 'add',
            groupId: isEdit ? editingGroup.id : undefined,
            title: groupTitle,
            description: groupDesc,
            ...(groupPhoto ? { photo: groupPhoto } : {}),
            memberIds: selectedMemberIds
          })
        });

        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to save group';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }

        const data = await res.json();
        onUserUpdate(data.user);
        // Reset
        setGroupFormOpen(false);
        setEditingGroup(null);
        setGroupTitle('');
        setGroupDesc('');
        setGroupPhoto('');
        setGroupPhotoPreview('');
        setSelectedMemberIds([]);
        alert(lang === 'ar' ? 'تم حفظ المجموعة بنجاح' : 'Group saved successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حفظ المجموعة' : 'Failed to save group'));
      }
    });
  };

  const handleDeleteGroup = async (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(lang === 'ar' ? 'هل أنت متأكد من حذف هذه المجموعة الخاصة؟' : 'Are you sure you want to delete this custom group?')) return;
    await withLoading(async () => {
      try {
        const res = await fetch('/api/profile/groups', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            userId: user.id,
            action: 'delete',
            groupId
          })
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = 'Failed to delete group';
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }
        
        const data = await res.json();
        onUserUpdate(data.user);
        alert(lang === 'ar' ? 'تم حذف المجموعة بنجاح' : 'Group deleted successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حذف المجموعة' : 'Failed to delete group'));
      }
    });
  };

  const handleOpenEditGroup = (g: UserGroup, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingGroup(g);
    setGroupTitle(g.title);
    setGroupDesc(g.description);
    setGroupPhotoPreview(g.photo);
    setSelectedMemberIds(g.memberIds || []);
    setGroupPhoto('');
    setGroupFormOpen(true);
  };

  const toggleGroupMember = (dId: string) => {
    if (selectedMemberIds.includes(dId)) {
      setSelectedMemberIds(selectedMemberIds.filter((id) => id !== dId));
    } else {
      setSelectedMemberIds([...selectedMemberIds, dId]);
    }
  };

  return (
    <div className="py-6 space-y-8" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-[11px] text-indigo-900 leading-relaxed">
            <p className="font-bold mb-1">{t.dataProtectionLimitsTitle}</p>
            <p>{t.dataProtectionLimits}</p>
          </div>

      
      {/* 1. Header and Profile Banner */}
      <section className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-sm">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-[80px] pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row items-center gap-6 relative z-10">
          {/* Changeable Profile Photo */}
          <div className="relative group/avatar shrink-0">
            <div className="w-24 h-24 md:w-28 md:h-28 rounded-full overflow-hidden border-2 border-indigo-600 bg-slate-50 shadow-md relative">
              {user.photo ? (
                <img src={user.photo} alt={user.firstName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 bg-slate-100">
                  <UserIcon className="w-10 h-10 md:w-12 md:h-12" />
                </div>
              )}
              {loading && (
                <div className="absolute inset-0 bg-white/75 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            
            {/* Upload Input Overlay */}
            <label className="absolute bottom-0 right-0 p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-md cursor-pointer transition-transform transform hover:scale-110 z-20">
              <Camera className="w-4 h-4" />
              <input 
                type="file" 
                accept="image/*" 
                className="hidden" 
                disabled={loading}
                onChange={handleProfilePhotoUpload} 
              />
            </label>
          </div>

          <div className="text-center sm:text-right flex-1 font-sans">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-950">{user.firstName} {user.lastName}</h2>
            <p className="text-slate-500 text-xs md:text-sm mt-1">{user.email}</p>
            <p className="text-slate-500 text-[11px] font-semibold mt-0.5">{t.phoneNumber}: {user.phoneNumber}</p>
            
            <div className="mt-3.5 flex flex-wrap justify-center sm:justify-start gap-2">
              <span className="bg-indigo-50 border border-indigo-200/60 text-indigo-700 text-[10px] font-bold px-2.5 py-1 rounded-full">
                {user.role === 'super_admin' ? (lang === 'ar' ? 'مسؤول رئيسي' : 'Super Admin') : user.role === 'admin' ? (lang === 'ar' ? 'مسؤول فرعي' : 'Sub Admin') : (lang === 'ar' ? 'مستخدم معتمد' : 'Approved Servant')}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. My Evangelism Stats (كرازتي) */}
      <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">{t.myEvangelism}</h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Christians Stat */}
          <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 flex flex-col items-center text-center">
            <span className="text-xs font-bold text-slate-500 mb-2">{t.christianCount}</span>
            <span className="text-3xl font-extrabold text-indigo-600 font-mono mb-4">{user.counts?.christians || 0}</span>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateCount('christians', 1)}
                className="w-9 h-9 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-indigo-600 transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => updateCount('christians', -1)}
                className="w-9 h-9 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-indigo-600 transition-colors shadow-sm cursor-pointer"
              >
                <Minus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Friends Stat */}
          <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 flex flex-col items-center text-center">
            <span className="text-xs font-bold text-slate-500 mb-2">{t.friendCount}</span>
            <span className="text-3xl font-extrabold text-indigo-600 font-mono mb-4">{user.counts?.friends || 0}</span>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateCount('friends', 1)}
                className="w-9 h-9 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-indigo-600 transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => updateCount('friends', -1)}
                className="w-9 h-9 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-indigo-600 transition-colors shadow-sm cursor-pointer"
              >
                <Minus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 3. My Personal Plan & Sub Managers Panel (Bento block) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Personal Plan Block */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 flex flex-col justify-between shadow-sm">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              <h4 className="text-base font-bold text-slate-900">{t.myPersonalPlan}</h4>
            </div>

            {user.personalPlan ? (
              <div className="space-y-3 bg-slate-50 p-4 border border-slate-200 rounded-2xl">
                {user.personalPlan.photo && (
                  <img src={user.personalPlan.photo} className="w-full h-32 object-cover rounded-xl border border-slate-200 shadow-inner" />
                )}
                <p className="text-slate-700 text-xs md:text-sm leading-relaxed whitespace-pre-line max-h-28 overflow-y-auto font-sans">{user.personalPlan.text}</p>
              </div>
            ) : (
              <p className="text-slate-400 text-xs leading-relaxed py-6 text-center">
                {lang === 'ar' ? 'لم تقم بإنشاء خطة شخصية بعد.' : 'No personal plan created yet.'}
              </p>
            )}
          </div>

          <button
            onClick={() => {
              setPlanText(user.personalPlan?.text || '');
              setPlanPhotoPreview(user.personalPlan?.photo || '');
              setPlanPhoto('');
              setPlanFormOpen(true);
            }}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all shadow-md mt-4 cursor-pointer"
          >
            {user.personalPlan ? t.editPersonalPlan : t.addPersonalPlan}
          </button>
        </div>

        {/* Custom Discipleship & Private Groups Launchers */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 flex flex-col justify-between shadow-sm">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-600" />
              <h4 className="text-base font-bold text-slate-900">{lang === 'ar' ? 'أدوات المتابعة الشخصية' : 'Personal Discipleship Tools'}</h4>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed">
              {lang === 'ar' 
                ? 'مساحة خاصة بك لإضافة تلامذتك ومتابعتهم بشكل خاص وتجميعهم في مجموعات عمل مخصصة لمتابعة نموهم الروحي.'
                : 'A personal dashboard to record and follow up with your direct disciples privately and organize them into custom groups.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-6">
            <button
              onClick={() => setDisciplesOpen(true)}
              className="py-3 px-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs font-extrabold rounded-2xl transition-all shadow-sm flex flex-col items-center gap-2 cursor-pointer"
            >
              <div className="w-8 h-8 bg-indigo-50 border border-indigo-200/60 text-indigo-600 rounded-xl flex items-center justify-center">
                <UserCheck className="w-4 h-4" />
              </div>
              <span>{t.myDisciples} ({user.disciples?.length || 0})</span>
            </button>

            <button
              onClick={() => setGroupsOpen(true)}
              className="py-3 px-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs font-extrabold rounded-2xl transition-all shadow-sm flex flex-col items-center gap-2 cursor-pointer"
            >
              <div className="w-8 h-8 bg-indigo-50 border border-indigo-200/60 text-indigo-600 rounded-xl flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <span>{t.myGroups} ({user.groups?.length || 0})</span>
            </button>
          </div>
        </div>

      </div>


      {/* ==============================================
         MODALS & DIALOGS (AnimatePresence)
         ============================================== */}

      <AnimatePresence>
        {/* Modal: Edit Personal Plan Form */}
        {planFormOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-xl p-6 md:p-8 relative shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <button 
                onClick={() => setPlanFormOpen(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-lg font-bold text-slate-900 mb-6 pr-6">{user.personalPlan ? t.editPersonalPlan : t.addPersonalPlan}</h3>

              <form onSubmit={handlePlanSubmit} className="space-y-4">
                {/* Plan Image */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t.uploadPhoto}</label>
                  <div className="flex items-center gap-4">
                    {planPhotoPreview ? (
                      <div className="relative group">
                        <img src={planPhotoPreview} className="w-14 h-14 rounded-xl object-cover border border-slate-200" />
                        <button
                          type="button"
                          onClick={() => {
                            setPlanPhotoPreview('');
                            setPlanPhoto('');
                          }}
                          className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-600 text-white rounded-full hover:bg-red-500 transition-colors shadow-md cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="w-14 h-14 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-slate-400">
                        <Camera className="w-5 h-5" />
                      </div>
                    )}
                    <label className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold text-slate-700 rounded-xl cursor-pointer">
                      <span>{lang === 'ar' ? 'اختيار ملف' : 'Choose Image'}</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => handlePhotoRead(e, setPlanPhoto, setPlanPhotoPreview, 'personal-plan')} 
                      />
                    </label>
                  </div>
                </div>

                {/* Plan Text */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t.planText}</label>
                  <textarea
                    rows={5}
                    required
                    value={planText}
                    onChange={(e) => setPlanText(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    {t.save}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlanFormOpen(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Modal: My Disciples Manager (Open in Big Window) */}
        {disciplesOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-3xl p-6 md:p-8 relative shadow-2xl max-h-[85vh] flex flex-col animate-fadeIn"
            >
              <button 
                onClick={() => setDisciplesOpen(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center justify-between border-b border-slate-150 pb-4 mb-6">
                <h3 className="text-xl font-bold text-slate-950">{t.myDisciples}</h3>
                <button
                  onClick={() => {
                    setEditingDisciple(null);
                    setDiscipleName('');
                    setDiscipleDesc('');
                    setDisciplePhoto('');
                    setDisciplePhotoPreview('');
                    setDiscipleFormOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.addDisciple}</span>
                </button>
              </div>

              {/* Add/Edit Disciple form inside modal */}
              {discipleFormOpen && (
                <form onSubmit={handleDiscipleSubmit} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-6 space-y-4">
                  <p className="text-[10px] text-slate-500">{t.discipleLimits}</p>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-1">
                    <h4 className="text-xs font-bold text-indigo-700">{editingDisciple ? t.editDisciple : t.addDisciple}</h4>
                    <button type="button" onClick={() => setDiscipleFormOpen(false)} className="p-1 text-slate-400 hover:text-slate-900 rounded-lg cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t.discipleName}</label>
                      <input
                        type="text"
                        required
                        value={discipleName}
                        onChange={(e) => setDiscipleName(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-600 text-xs font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t.uploadPhoto}</label>
                      <div className="flex items-center gap-3">
                        {disciplePhotoPreview ? (
                          <img src={disciplePhotoPreview} className="w-9 h-9 object-cover rounded-xl border border-slate-200 bg-white" />
                        ) : (
                          <div className="w-9 h-9 bg-slate-100 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-slate-400">
                            <Camera className="w-4 h-4" />
                          </div>
                        )}
                        <label className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-700 rounded-xl cursor-pointer">
                          <span>{lang === 'ar' ? 'اختر ملف' : 'Choose File'}</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={(e) => handlePhotoRead(e, setDisciplePhoto, setDisciplePhotoPreview, 'disciples')} 
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">{t.discipleDesc}</label>
                    <textarea
                      rows={2}
                      value={discipleDesc}
                      onChange={(e) => setDiscipleDesc(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-600 text-xs font-sans"
                    />
                  </div>

                  <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
                    <button type="submit" disabled={isLoading} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">{isLoading ? t.actionInProgress : t.save}</button>
                    <button type="button" onClick={() => setDiscipleFormOpen(false)} className="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl cursor-pointer">{t.cancel}</button>
                  </div>
                </form>
              )}

              {/* Disciple cards list */}
              <div className="overflow-y-auto flex-1 pr-1">
                {!user.disciples || user.disciples.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-200">
                    {lang === 'ar' ? 'لا يوجد تلاميذ مضافين حالياً.' : 'No disciples added yet.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {user.disciples.map((d) => (
                      <div 
                        key={d.id}
                        className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center flex flex-col justify-between group hover:border-indigo-500/10 transition-colors"
                      >
                        <div>
                          <div className="w-16 h-16 mx-auto rounded-full overflow-hidden border border-slate-200 bg-white mb-3 relative shadow-inner">
                            {d.photo ? (
                              <img src={d.photo} alt={d.name} className="w-full h-full object-cover" />
                            ) : (
                              <UserIcon className="w-full h-full p-3.5 text-slate-400 bg-slate-100" />
                            )}
                          </div>
                          <h4 className="text-xs font-bold text-slate-900 line-clamp-1">{d.name}</h4>
                          <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{d.description || '...'}</p>
                        </div>

                        <div className="flex items-center justify-center gap-1.5 pt-4 mt-4 border-t border-slate-200">
                          <button
                            onClick={() => setSelectedDisciple(d)}
                            className="p-1 text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                            title={t.open}
                          >
                            <Info className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleOpenEditDisciple(d, e)}
                            className="p-1 text-slate-400 hover:text-slate-900 transition-colors cursor-pointer"
                            title={t.editLeader}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteDisciple(d.id, e)}
                            className="p-1 text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                            title={t.deleteLeader}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-5 border-t border-slate-150 mt-5">
                <button
                  onClick={() => setDisciplesOpen(false)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 cursor-pointer"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal: My Custom Groups Manager (Open in Big Window) */}
        {groupsOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-3xl p-6 md:p-8 relative shadow-2xl max-h-[85vh] flex flex-col"
            >
              <button 
                onClick={() => setGroupsOpen(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center justify-between border-b border-slate-150 pb-4 mb-6">
                <h3 className="text-xl font-bold text-slate-950">{t.myGroups}</h3>
                <button
                  onClick={() => {
                    setEditingGroup(null);
                    setGroupTitle('');
                    setGroupDesc('');
                    setGroupPhoto('');
                    setGroupPhotoPreview('');
                    setSelectedMemberIds([]);
                    setGroupFormOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'إضافة مجموعة متابعة' : 'Add Followup Group'}</span>
                </button>
              </div>

              {/* Group Add/Edit Form */}
              {groupFormOpen && (
                <form onSubmit={handleGroupSubmit} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-6 space-y-4">
                  <p className="text-[10px] text-slate-500">{t.groupLimits}</p>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-1">
                    <h4 className="text-xs font-bold text-indigo-700">{editingGroup ? t.editGroup : (lang === 'ar' ? 'إضافة مجموعة متابعة' : 'Add Group')}</h4>
                    <button type="button" onClick={() => setGroupFormOpen(false)} className="p-1 text-slate-400 hover:text-slate-950 rounded-lg cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t.groupTitle}</label>
                      <input
                        type="text"
                        required
                        value={groupTitle}
                        onChange={(e) => setGroupTitle(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-600 text-xs font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">{t.uploadPhoto}</label>
                      <div className="flex items-center gap-3">
                        {groupPhotoPreview ? (
                          <img src={groupPhotoPreview} className="w-9 h-9 object-cover rounded-xl border border-slate-200 bg-white" />
                        ) : (
                          <div className="w-9 h-9 bg-slate-100 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-slate-400">
                            <Camera className="w-4 h-4" />
                          </div>
                        )}
                        <label className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-700 rounded-xl cursor-pointer">
                          <span>{lang === 'ar' ? 'اختر ملف' : 'Choose File'}</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={(e) => handlePhotoRead(e, setGroupPhoto, setGroupPhotoPreview, 'groups')} 
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">{t.groupDesc}</label>
                    <textarea
                      rows={2}
                      value={groupDesc}
                      onChange={(e) => setGroupDesc(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-600 text-xs font-sans"
                    />
                  </div>

                  {/* Member Selector: Pick from Disciple list as requested */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t.members}</label>
                    {!user.disciples || user.disciples.length === 0 ? (
                      <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-xl border border-amber-200 flex items-center gap-1">
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>{t.noDisciplesYet}</span>
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto bg-slate-100 border border-slate-200 p-3 rounded-xl">
                        {user.disciples.map((d) => {
                          const isSelected = selectedMemberIds.includes(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => toggleGroupMember(d.id)}
                              className={`flex items-center gap-2 p-1.5 rounded-lg border text-[10px] font-bold text-right transition-colors cursor-pointer ${
                                isSelected 
                                  ? 'bg-indigo-50 border-indigo-400 text-indigo-700' 
                                  : 'bg-white border-slate-200 text-slate-600'
                              }`}
                            >
                              <img src={d.photo || 'https://via.placeholder.com/50'} className="w-5 h-5 rounded-full object-cover shrink-0" />
                              <span className="truncate">{d.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
                    <button type="submit" disabled={isLoading} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">{isLoading ? t.actionInProgress : t.save}</button>
                    <button type="button" onClick={() => setGroupFormOpen(false)} className="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl cursor-pointer">{t.cancel}</button>
                  </div>
                </form>
              )}

              {/* Group list */}
              <div className="overflow-y-auto flex-1 pr-1">
                {!user.groups || user.groups.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-200">
                    {lang === 'ar' ? 'لا توجد مجموعات خاصة حالياً.' : 'No custom groups created yet.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {user.groups.map((g) => {
                      return (
                        <div 
                          key={g.id}
                          className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-4 hover:border-indigo-500/15 transition-colors"
                        >
                          <img src={g.photo || 'https://via.placeholder.com/150'} className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs md:text-sm font-bold text-slate-900 truncate">{g.title}</h4>
                            <p className="text-[10px] text-slate-500 truncate mt-0.5">{g.memberIds?.length || 0} {lang === 'ar' ? 'أعضاء' : 'Members'}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => setSelectedGroup(g)}
                              className="p-1.5 bg-white border border-slate-200 text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer"
                              title={t.open}
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleOpenEditGroup(g, e)}
                              className="p-1.5 bg-white border border-slate-200 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteGroup(g.id, e)}
                              className="p-1.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-5 border-t border-slate-150 mt-5">
                <button
                  onClick={() => setGroupsOpen(false)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 cursor-pointer"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal: Disciple Details (Big Window) */}
        {selectedDisciple && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 relative shadow-2xl"
            >
              <button 
                onClick={() => setSelectedDisciple(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-4 text-center">
                <div className="w-24 h-24 mx-auto rounded-full overflow-hidden border border-slate-200 bg-slate-50">
                  {selectedDisciple.photo ? (
                    <img src={selectedDisciple.photo} alt={selectedDisciple.name} className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-full h-full p-6 text-slate-400 bg-slate-100" />
                  )}
                </div>

                <div>
                  <h3 className="text-base font-bold text-slate-900">{selectedDisciple.name}</h3>
                  <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider">{lang === 'ar' ? 'بيانات التلميذ' : 'Disciple Record'}</span>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl max-h-44 overflow-y-auto text-right">
                  <p className="text-slate-700 text-xs md:text-sm leading-relaxed whitespace-pre-line font-sans" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
                    {selectedDisciple.description || (lang === 'ar' ? 'لا توجد ملاحظات تفصيلية مضافة.' : 'No detailed notes provided.')}
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setSelectedDisciple(null)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal: Custom Group Details (Big Window) */}
        {selectedGroup && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg p-6 relative shadow-2xl max-h-[85vh] flex flex-col"
            >
              <button 
                onClick={() => setSelectedGroup(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                <img src={selectedGroup.photo || 'https://via.placeholder.com/400x200'} className="w-full h-40 object-cover rounded-2xl border border-slate-200" />
                
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{selectedGroup.title}</h3>
                  <p className="text-slate-500 text-xs mt-1 leading-relaxed whitespace-pre-line font-sans">{selectedGroup.description || '...'}</p>
                </div>

                <div className="border-t border-slate-150 pt-4">
                  <h4 className="text-xs font-bold text-indigo-700 mb-2">{lang === 'ar' ? 'أعضاء هذه المجموعة' : 'Group Members'}</h4>
                  {(!selectedGroup.memberIds || selectedGroup.memberIds.length === 0) ? (
                    <p className="text-[10px] text-slate-400">{lang === 'ar' ? 'لا يوجد أعضاء في هذه المجموعة.' : 'No members inside this group.'}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-200 p-3 rounded-2xl">
                      {selectedGroup.memberIds.map((memberId) => {
                        const d = user.disciples?.find((item) => item.id === memberId);
                        if (!d) return null;
                        return (
                          <div key={d.id} className="flex items-center gap-2 p-1.5 bg-white border border-slate-150 rounded-lg">
                            <img src={d.photo || 'https://via.placeholder.com/50'} className="w-6 h-6 rounded-full object-cover shrink-0" />
                            <span className="text-[10px] text-slate-700 font-semibold truncate">{d.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-150 mt-4">
                <button
                  onClick={() => setSelectedGroup(null)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
