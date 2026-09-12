import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Plus, Edit2, Trash2, X, Info, FolderOpen, Crown } from 'lucide-react';
import { Language, translations } from '../translations';
import { User, Group, Leader } from '../types';
import { supabase } from '../lib/supabase';
import { useLoading } from '../lib/LoadingContext';

interface GroupsViewProps {
  lang: Language;
  user: User;
  groups: Group[];
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  onNavigate?: (tab: string) => void;
}

export default function GroupsView({ lang, user, groups, setGroups, onNavigate }: GroupsViewProps) {
  const { withLoading } = useLoading();
  const [isAdding, setIsAdding] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  // All leaders (for display and assignment)
  const [leaders, setLeaders] = useState<Leader[]>([]);

  
  useEffect(() => {
    const loadLeaders = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const response = await fetch('/api/leaders', {
          headers: {
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to load leaders: ${response.status}`);
        }

        setLeaders(await response.json());
      } catch (error) {
        console.error(error);
      }
    };

    loadLeaders();
  }, []);
  // Auto-open a specific group's detail modal when navigated from leader slider
  useEffect(() => {
    const highlightId = localStorage.getItem('highlightGroupId');
    if (highlightId) {
      localStorage.removeItem('highlightGroupId');
      const group = groups.find((g) => g.id === highlightId);
      if (group) setSelectedGroup(group);
    }
  }, [groups]);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [selectedLeaderIds, setSelectedLeaderIds] = useState<Set<string>>(new Set());

  const t = translations[lang];

  // Admin access checks
  const canEditGroups = user.role === 'super_admin' || user.permissions.includes('edit_groups');

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setPhoto(base64);
        setPhotoPreview(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) return;

    await withLoading(async () => {
      try {
        const isEdit = !!editingGroup;
        const endpoint = isEdit ? `/api/groups/${editingGroup.id}` : '/api/groups';
        const method = isEdit ? 'PUT' : 'POST';

        const res = await fetch(endpoint, {
          method,
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({
            title,
            description,
            photo
          }),
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

        // Parse response to get group id (for newly created groups)
        const savedGroup = await res.json();
        const groupId = savedGroup.id || editingGroup?.id;

        // Assign / unassign leaders
        const authToken = (await supabase.auth.getSession()).data.session?.access_token;
        for (const leader of leaders) {
          const shouldBeAssigned = selectedLeaderIds.has(leader.id);
          const currentlyAssigned = leader.groupId === groupId;
          if (shouldBeAssigned !== currentlyAssigned) {
            await fetch(`/api/leaders/${leader.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
              },
              body: JSON.stringify({ groupId: shouldBeAssigned ? groupId : '' }),
            });
          }
        }

        // Refresh groups

        const { data: { session: refreshSession } } =
          await supabase.auth.getSession();

        const freshRes = await fetch('/api/home', {
          headers: {
            Authorization: `Bearer ${refreshSession?.access_token || ''}`,
          },
        });

        if (!freshRes.ok) {
          throw new Error(`Failed to refresh groups: ${freshRes.status}`);
        }

        const freshData = await freshRes.json();
        setGroups(freshData.groups || []);
        
        // Re-fetch leaders to reflect changes
        const freshLeaders = await fetch('/api/leaders');
        setLeaders(await freshLeaders.json());

        // Reset
        setIsAdding(false);
        setEditingGroup(null);
        setTitle('');
        setDescription('');
        setPhoto('');
        setPhotoPreview('');
        setSelectedLeaderIds(new Set());
        alert(lang === 'ar' ? 'تم حفظ المجموعة بنجاح' : 'Group saved successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حفظ المجموعة' : 'Failed to save group'));
      }
    });
  };

  const handleOpenEdit = (group: Group, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingGroup(group);
    setTitle(group.title);
    setDescription(group.description);
    setPhotoPreview(group.photo);
    setPhoto('');
    // Pre-select leaders already assigned to this group
    setSelectedLeaderIds(new Set(leaders.filter((l) => l.groupId === group.id).map((l) => l.id)));
    setIsAdding(true);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(lang === 'ar' ? 'هل أنت متأكد من حذف هذه المجموعة؟ جميع القادة المرتبطين بها سيصبحون غير مرتبطين.' : 'Are you sure you want to delete this group? All linked leaders will be unlinked.')) return;
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/groups/${id}`, { 
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          }
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
        
        // Refresh
        const freshRes = await fetch('/api/home');
        const freshData = await freshRes.json();
        setGroups(freshData.groups);
        alert(lang === 'ar' ? 'تم حذف المجموعة بنجاح' : 'Group deleted successfully');
      } catch (err: any) {
        console.error(err);
        alert(err.message || (lang === 'ar' ? 'فشل حذف المجموعة' : 'Failed to delete group'));
      }
    });
  };

  return (
    <div className="py-6 space-y-8" style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">{t.groups}</h2>
        </div>
        
        {canEditGroups && (
          <button
            id="add-group-btn"
            onClick={() => {
              setIsAdding(true);
              setEditingGroup(null);
              setTitle('');
              setDescription('');
              setPhoto('');
              setPhotoPreview('');
              setSelectedLeaderIds(new Set());
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-md transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.addGroup}</span>
          </button>
        )}
      </div>

      {/* Grid of Group Cards */}
      {groups.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 text-slate-500 text-sm">
          {lang === 'ar' ? 'لا توجد مجموعات مضافة حالياً.' : 'No groups added yet.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {groups.map((group) => {
            return (
              <div
                key={group.id}
                onClick={() => setSelectedGroup(group)}
                className="bg-white border border-slate-200 rounded-3xl overflow-hidden hover:border-indigo-500/30 shadow-sm cursor-pointer flex flex-col group transition-all duration-300"
              >
                <div className="h-48 overflow-hidden bg-slate-100 relative">
                  <img 
                    src={group.photo} 
                    alt={group.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-slate-900/10 to-transparent" />
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 mb-2 line-clamp-1 group-hover:text-indigo-600 transition-colors">
                      {group.title}
                    </h3>
                    <p className="text-slate-500 text-xs line-clamp-2 leading-relaxed mb-3">
                      {group.description || (lang === 'ar' ? 'لا يوجد وصف مضاف.' : 'No description provided.')}
                    </p>

                    {/* Leaders */}
                    {(() => {
                      const groupLeaders = leaders.filter((l) => l.groupId === group.id);
                      if (groupLeaders.length === 0) return null;
                      return (
                        <div className="mb-3">
                          <p className="text-[11px] font-semibold text-indigo-500 mb-1.5 flex items-center gap-1">
                            <Crown className="w-3 h-3" />
                            {lang === 'ar' ? 'القادة' : 'Leaders'}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {groupLeaders.map((l) => (
                              <button
                                key={l.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  localStorage.setItem('highlightLeaderId', l.id);
                                  onNavigate?.('home');
                                }}
                                className="text-xs font-medium px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors cursor-pointer"
                              >
                                {l.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-auto">
                    <span className="text-indigo-600 font-bold text-xs hover:underline flex items-center gap-1">
                      <span>{t.open}</span>
                    </span>

                    {canEditGroups && (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => handleOpenEdit(group, e)}
                          className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-indigo-600 hover:text-indigo-750 transition-colors cursor-pointer"
                          title={t.editGroup}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(group.id, e)}
                          className="p-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-red-600 hover:text-red-700 transition-colors cursor-pointer"
                          title={t.deleteGroup}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}


      {/* ==============================================
         MODALS & DIALOGS (AnimatePresence)
         ============================================== */}

      <AnimatePresence>
        {/* Modal: Admin Add/Edit Group */}
        {isAdding && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-xl p-6 md:p-8 relative shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <button 
                onClick={() => setIsAdding(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 mb-6 pr-6">
                {editingGroup ? t.editGroup : t.addGroup}
              </h3>

              <form onSubmit={handleGroupSubmit} className="space-y-4">
                {/* Photo Upload */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t.uploadPhoto}</label>
                  <div className="flex items-center gap-4">
                    {photoPreview ? (
                      <img src={photoPreview} alt="Group Preview" className="w-16 h-16 rounded-xl object-cover border border-slate-200 bg-slate-50" />
                    ) : (
                      <div className="w-16 h-16 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-slate-400">
                        <FolderOpen className="w-6 h-6" />
                      </div>
                    )}
                    <label className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold text-slate-700 rounded-xl transition-colors cursor-pointer">
                      <span>{lang === 'ar' ? 'اختر صورة من جهازك' : 'Choose Image File'}</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handlePhotoUpload} 
                      />
                    </label>
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t.groupTitle}</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t.groupDesc}</label>
                  <textarea
                    rows={4}
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                  />
                </div>

                {/* Leader Assignment */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5 text-amber-500" />
                    {lang === 'ar' ? 'تعيين القادة' : 'Assign Leaders'}
                  </label>
                  {leaders.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">
                      {lang === 'ar' ? 'لا يوجد قادة متاحون' : 'No leaders available'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-slate-200 rounded-xl bg-slate-50">
                      {leaders.map((l) => {
                        const isSelected = selectedLeaderIds.has(l.id);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => {
                              const next = new Set(selectedLeaderIds);
                              if (isSelected) next.delete(l.id);
                              else next.add(l.id);
                              setSelectedLeaderIds(next);
                            }}
                            className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                            }`}
                          >
                            {l.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
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
                    onClick={() => setIsAdding(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Modal: Open Group Details in Big Window */}
        {selectedGroup && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl p-6 md:p-8 relative shadow-2xl max-h-[85vh] flex flex-col"
            >
              <button 
                onClick={() => setSelectedGroup(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors z-10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="overflow-y-auto flex-1 space-y-5 pr-1">
                {/* Photo banner */}
                <div className="w-full h-56 md:h-72 rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 shadow-inner">
                  <img src={selectedGroup.photo} alt={selectedGroup.title} className="w-full h-full object-cover" />
                </div>

                <h3 className="text-xl md:text-2xl font-bold text-indigo-950 border-b border-slate-100 pb-3">{selectedGroup.title}</h3>

                {/* Scrollable description in larger window */}
                <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl max-h-56 overflow-y-auto">
                  <p className="text-slate-700 text-sm md:text-base leading-relaxed whitespace-pre-line text-justify font-sans">
                    {selectedGroup.description}
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-5 border-t border-slate-150 mt-5">
                <button
                  onClick={() => setSelectedGroup(null)}
                  className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition-colors cursor-pointer"
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
