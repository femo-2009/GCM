import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Settings,
  Shield,
  UserCheck,
  UserX,
  Info,
  Search,
  ShieldAlert,
  CheckSquare,
  Square,
  X,
  RefreshCw,
  Mail,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { Language, translations } from "../translations";
import { User } from "../types";
import { supabase } from "../lib/supabase";
import { useLoading } from "../lib/LoadingContext";
import { mapProfileToUser } from "../lib/userMapper";

interface AdminPanelViewProps {
  lang: Language;
  user: User;
}

export default function AdminPanelView({ lang, user }: AdminPanelViewProps) {
  const { withLoading } = useLoading();
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Modal / Detail States
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [assigningAdminUser, setAssigningAdminUser] = useState<User | null>(
    null,
  );

  // Custom permissions for the Make Admin flow
  const [permManageUsers, setPermManageUsers] = useState(false);
  const [permEditHome, setPermEditHome] = useState(false);
  const [permEditLibrary, setPermEditLibrary] = useState(false);
  const [permEditGroups, setPermEditGroups] = useState(false);

  const t = translations[lang];

  // Permissions check for current logged-in user
  const isSuperAdmin = user.role === "super_admin";
  const canManageUsers =
    isSuperAdmin || user.permissions.includes("manage_users");

  const fetchUsers = async () => {
    if (!canManageUsers) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No active session");

      const response = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Failed to load users");

      const mapped = (payload.users || []).map(mapProfileToUser);
      setPendingUsers(mapped.filter((u) => u.status === "pending"));
      setApprovedUsers(mapped.filter((u) => u.status === "approved"));
    } catch (error) {
      console.error("Failed to load confirmed users:", error);
      setPendingUsers([]);
      setApprovedUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [user]);

  const adminRequest = async (path: string, body?: unknown) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("No active session");
    const response = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || "Admin action failed");
    return payload;
  };

  const handleApprove = async (id: string) => {
    await withLoading(async () => {
      await adminRequest(`/api/admin/users/${id}/approve`);
      await fetchUsers();
    });
  };

  const handleBlockPending = async (id: string) => {
    await withLoading(async () => {
      await adminRequest(`/api/admin/users/${id}/block`);
      await fetchUsers();
    });
  };

  const handleRemoveAndBlockApproved = async (id: string) => {
    if (!confirm(lang === "ar" ? "هل أنت متأكد؟" : "Are you sure?")) return;
    await withLoading(async () => {
      await adminRequest(`/api/admin/users/${id}/block`);
      await fetchUsers();
      if (selectedUser?.id === id) setSelectedUser(null);
    });
  };

  const handleOpenAssignAdmin = (usr: User) => {
    setAssigningAdminUser(usr);
    setPermManageUsers(usr.permissions.includes("manage_users"));
    setPermEditHome(usr.permissions.includes("edit_home"));
    setPermEditLibrary(usr.permissions.includes("edit_library"));
    setPermEditGroups(usr.permissions.includes("edit_groups"));
  };

  const handleSaveAdminPermissions = async () => {
    if (!assigningAdminUser) return;
    await withLoading(async () => {
      const permissions = [];
      if (permManageUsers) permissions.push("manage_users");
      if (permEditHome) permissions.push("edit_home");
      if (permEditLibrary) permissions.push("edit_library");
      if (permEditGroups) permissions.push("edit_groups");

      await adminRequest(`/api/admin/users/${assigningAdminUser.id}/permissions`, { role: "admin", permissions });
      await fetchUsers();
      setAssigningAdminUser(null);
      alert(t.assignedAdminPerms);
    });
  };

  const handleDemoteToUser = async (uId: string) => {
    if (!confirm(lang === "ar" ? "هل أنت متأكد؟" : "Are you sure?")) return;
    await withLoading(async () => {
      await adminRequest(`/api/admin/users/${uId}/permissions`, { role: "user", permissions: [] });
      await fetchUsers();
      if (selectedUser?.id === uId) setSelectedUser(null);
    });
  };

  // Real-time search filter for approved users
  const filteredApprovedUsers = approvedUsers.filter((usr) => {
    const q = searchQuery.toLowerCase();
    const fullName = `${usr.firstName} ${usr.lastName}`.toLowerCase();
    return (
      fullName.includes(q) ||
      usr.email.toLowerCase().includes(q) ||
      usr.phoneNumber.includes(q)
    );
  });

  if (!canManageUsers) {
    return (
      <div className="py-12 text-center text-red-600 font-sans flex flex-col items-center gap-3">
        <ShieldAlert className="w-12 h-12" />
        <h3 className="text-lg font-bold">
          {lang === "ar" ? "غير مصرح لك" : "Unauthorized Access"}
        </h3>
        <p className="text-slate-500 text-sm">
          {lang === "ar"
            ? "لا تمتلك صلاحيات كافية لتصفح لوحة التحكم."
            : "You do not have permissions to view this admin panel."}
        </p>
      </div>
    );
  }

  return (
    <div
      className="py-6 space-y-10"
      style={{ direction: lang === "ar" ? "rtl" : "ltr" }}
    >
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-950 leading-relaxed">
        <p className="font-bold mb-1">{lang === 'ar' ? 'حدود حماية البيانات' : 'Data protection limits'}</p>
        <p>{lang === 'ar' ? 'الصور الشخصية والمرفوعة: حتى 5 MB وبأنواع JPG أو PNG أو WebP. الخطة الشخصية حتى 10,000 حرف. حد المجموعات 20، والتلاميذ 50، وأعضاء المجموعة 100.' : 'Profile and uploaded images: up to 5 MB in JPG, PNG, or WebP. Personal plan up to 10,000 characters. Limits: 20 groups, 50 disciples, and 100 members per group.'}</p>
      </div>

      {/* Page Title */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2.5">
          <Shield className="w-7 h-7 text-indigo-600" />
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {t.adminPanel}
          </h2>
        </div>

        <button
          onClick={fetchUsers}
          className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-500 hover:text-slate-850 transition-colors cursor-pointer"
          title={lang === "ar" ? "تحديث القوائم" : "Refresh Lists"}
        >
          <RefreshCw
            className={`w-4 h-4 ${loading ? "animate-spin text-indigo-600" : ""}`}
          />
        </button>
      </div>

      {/* 1. New Join Requests Queue (طلبات الانضمام) */}
      <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">
            {t.newRequests} ({pendingUsers.length})
          </h3>
        </div>

        {pendingUsers.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-200">
            {t.noPendingRequests}
          </div>
        ) : (
          <div className="grid gap-3">
            {pendingUsers.map((usr) => {
              return (
                <div
                  key={usr.id}
                  className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                      {usr.photo ? (
                        <img
                          src={usr.photo}
                          className="w-full h-full object-cover rounded-full"
                        />
                      ) : (
                        <UserIcon className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">
                        {usr.firstName} {usr.lastName}
                      </h4>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3 text-indigo-500" />
                        <span>{usr.email}</span>
                      </p>
                    </div>
                  </div>

                  {/* Actions: Info, Approve, Block */}
                  <div className="flex items-center gap-2 w-full sm:w-auto self-end sm:self-center">
                    <button
                      onClick={() => setSelectedUser(usr)}
                      className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      <Info className="w-3.5 h-3.5" />
                      <span>{t.info}</span>
                    </button>

                    <button
                      onClick={() => handleApprove(usr.id)}
                      className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-3.5 py-1.5 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl text-xs font-bold text-green-700 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{t.approve}</span>
                    </button>

                    <button
                      onClick={() => handleBlockPending(usr.id)}
                      className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl text-xs font-bold text-red-700 cursor-pointer"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>{t.block}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Approved Users Directory with Search (قائمة المستخدمين المعتمدين) */}
      <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">
              {t.approvedUsers} ({filteredApprovedUsers.length})
            </h3>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:w-64 z-10">
            <div
              className={`absolute inset-y-0 ${lang === "ar" ? "left-3" : "right-3"} flex items-center pointer-events-none`}
            >
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 font-sans"
            />
          </div>
        </div>

        {filteredApprovedUsers.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-200">
            {lang === "ar"
              ? "لا يوجد مستخدمين يطابقون البحث."
              : "No users match your query."}
          </div>
        ) : (
          <div className="grid gap-3 max-h-96 overflow-y-auto pr-1">
            {filteredApprovedUsers.map((usr) => {
              const userIsAdmin =
                usr.role === "admin" || usr.role === "super_admin";
              return (
                <div
                  key={usr.id}
                  className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                      {usr.photo ? (
                        <img
                          src={usr.photo}
                          className="w-full h-full object-cover rounded-full"
                        />
                      ) : (
                        <UserIcon className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900">
                          {usr.firstName} {usr.lastName}
                        </h4>
                        {userIsAdmin && (
                          <span className="text-[9px] bg-indigo-50 border border-indigo-200 text-indigo-700 font-extrabold px-2 py-0.5 rounded-full">
                            {usr.role === "super_admin"
                              ? "Super Admin"
                              : "Admin"}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3 text-indigo-500/60" />
                        <span>{usr.email}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto self-end sm:self-center">
                    <button
                      onClick={() => setSelectedUser(usr)}
                      className="flex-grow sm:flex-initial flex items-center justify-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <Info className="w-3.5 h-3.5" />
                      <span>{t.info}</span>
                    </button>

                    {/* Make admin / Manage admin roles */}
                    {isSuperAdmin && usr.id !== user.id && (
                      <>
                        {usr.role === "admin" ? (
                          <button
                            onClick={() => handleDemoteToUser(usr.id)}
                            className="flex-grow sm:flex-initial flex items-center justify-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl text-xs text-indigo-700 font-bold cursor-pointer"
                          >
                            <span>
                              {lang === "ar" ? "إلغاء الإدارة" : "Revoke Admin"}
                            </span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenAssignAdmin(usr)}
                            className="flex-grow sm:flex-initial flex items-center justify-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 cursor-pointer"
                          >
                            <span>{t.makeAdmin}</span>
                          </button>
                        )}
                      </>
                    )}

                    {/* Block / Remove button */}
                    {usr.id !== user.id && usr.role !== "super_admin" && (
                      <button
                        onClick={() => handleRemoveAndBlockApproved(usr.id)}
                        className="p-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl text-red-500 hover:text-red-700 cursor-pointer"
                        title={t.removeUser}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ==============================================
         MODALS & DIALOGS (AnimatePresence)
         ============================================== */}

      <AnimatePresence>
        {/* Modal: View User Signup Details (No passwords visible) */}
        {selectedUser && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 relative shadow-2xl text-center"
            >
              <button
                onClick={() => setSelectedUser(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-20 h-20 mx-auto rounded-full overflow-hidden border border-slate-200 bg-slate-50 mb-4">
                {selectedUser.photo ? (
                  <img
                    src={selectedUser.photo}
                    alt={selectedUser.firstName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserIcon className="w-full h-full p-5 text-slate-400 bg-slate-100" />
                )}
              </div>

              <h3 className="text-lg font-bold text-slate-900 mb-4">
                {selectedUser.firstName} {selectedUser.lastName}
              </h3>

              <div className="space-y-3 bg-slate-50 p-4 border border-slate-200 rounded-2xl text-right text-xs md:text-sm text-slate-700 font-sans">
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-500 font-bold">
                    {t.firstName}:
                  </span>
                  <span>{selectedUser.firstName}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-500 font-bold">
                    {t.lastName}:
                  </span>
                  <span>{selectedUser.lastName}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-500 font-bold">{t.email}:</span>
                  <span className="font-mono">{selectedUser.email}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-500 font-bold">
                    {t.phoneNumber}:
                  </span>
                  <span className="font-mono">{selectedUser.phoneNumber}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-500 font-bold">
                    {lang === "ar" ? "الدور / الصلاحية" : "Role / Type"}:
                  </span>
                  <span className="text-indigo-600 font-bold">
                    {selectedUser.role === "super_admin"
                      ? "Super Admin"
                      : selectedUser.role === "admin"
                        ? "Sub Admin"
                        : "Servant"}
                  </span>
                </div>
              </div>

              <div className="flex justify-end pt-5 mt-4">
                <button
                  onClick={() => setSelectedUser(null)}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal: Define Custom Admin Access Permissions */}
        {assigningAdminUser && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 md:p-8 relative shadow-2xl"
            >
              <button
                onClick={() => setAssigningAdminUser(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-lg font-bold text-slate-900 mb-2">
                {t.adminPermissions}
              </h3>
              <p className="text-slate-500 text-xs mb-6">
                {lang === "ar"
                  ? `قم باختيار الصلاحيات المتاحة للمسؤول الفرعي الجديد: ${assigningAdminUser.firstName}`
                  : `Assign customized access privileges for sub-admin: ${assigningAdminUser.firstName}`}
              </p>

              {/* Checkboxes Form for Admin Access */}
              <div className="space-y-3 mb-6">
                {/* 1. Manage Users & Requests */}
                <button
                  type="button"
                  onClick={() => setPermManageUsers(!permManageUsers)}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all text-right cursor-pointer"
                >
                  <span className="text-xs font-bold text-slate-700">
                    {t.permManageUsers}
                  </span>
                  {permManageUsers ? (
                    <CheckSquare className="w-5 h-5 text-indigo-600" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-300" />
                  )}
                </button>

                {/* 2. Edit welcome / home contents */}
                <button
                  type="button"
                  onClick={() => setPermEditHome(!permEditHome)}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all text-right cursor-pointer"
                >
                  <span className="text-xs font-bold text-slate-700">
                    {t.permEditHome}
                  </span>
                  {permEditHome ? (
                    <CheckSquare className="w-5 h-5 text-indigo-600" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-300" />
                  )}
                </button>

                {/* 3. Manage Library content */}
                <button
                  type="button"
                  onClick={() => setPermEditLibrary(!permEditLibrary)}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all text-right cursor-pointer"
                >
                  <span className="text-xs font-bold text-slate-700">
                    {t.permEditLibrary}
                  </span>
                  {permEditLibrary ? (
                    <CheckSquare className="w-5 h-5 text-indigo-600" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-300" />
                  )}
                </button>

                {/* 4. Manage Public Groups */}
                <button
                  type="button"
                  onClick={() => setPermEditGroups(!permEditGroups)}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all text-right cursor-pointer"
                >
                  <span className="text-xs font-bold text-slate-700">
                    {t.permEditGroups}
                  </span>
                  {permEditGroups ? (
                    <CheckSquare className="w-5 h-5 text-indigo-600" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-300" />
                  )}
                </button>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={handleSaveAdminPermissions}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => setAssigningAdminUser(null)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  {t.cancel}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
