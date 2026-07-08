import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldAlert,
  Loader2,
  Globe,
  Eye,
  EyeOff,
  LogIn,
  UserPlus,
  User as UserIcon,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchProfileFromApi, signUpWithApproval } from "../lib/authApi";
import { Language, translations } from "../translations";
import { User } from "../types";
import logoImg from "../assets/logo.png";

interface AuthProps {
  lang: Language;
  setLang: (l: Language) => void;
  onAuthSuccess: (user: User) => void;
}

export default function Auth({ lang, setLang, onAuthSuccess }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [authStatus, setAuthStatus] = useState<
    "idle" | "pending" | "blocked" | "registered"
  >("idle");

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
    phone: "",
    photo: "",
  });

  const [photoPreview, setPhotoPreview] = useState("");

  const t = translations[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        // --- LOGIN ---
        const { data: authData, error: authError } =
          await supabase.auth.signInWithPassword({
            email: formData.email.trim(),
            password: formData.password,
          });
        if (authError) throw authError;

        const accessToken = authData.session?.access_token;
        if (!accessToken) {
          throw new Error(
            lang === "ar"
              ? "تعذّر إتمام تسجيل الدخول."
              : "Could not complete sign in.",
          );
        }

        const authenticatedUser = await fetchProfileFromApi(accessToken);

        // Deny by default: only an explicitly "approved" status may enter the site.
        // Anything else (pending, blocked, or an unexpected/corrupted value) is
        // treated as not-yet-approved so we fail closed, not open.
        if (authenticatedUser.status === "approved") {
          onAuthSuccess(authenticatedUser);
        } else if (authenticatedUser.status === "blocked") {
          await supabase.auth.signOut();
          setAuthStatus("blocked");
        } else {
          await supabase.auth.signOut();
          setAuthStatus("pending");
        }
      } else {
        // --- SIGN UP ---
        if (!formData.firstName.trim() || !formData.lastName.trim()) {
          throw new Error(t.requiredField);
        }
        if (formData.password !== formData.confirmPassword) {
          throw new Error(t.passwordsDoNotMatch);
        }
        if (formData.phone.trim().length < 7) {
          throw new Error(t.phoneLength);
        }
        if (formData.password.length < 6) {
          throw new Error(t.passwordLength);
        }

        await signUpWithApproval({
          email: formData.email.trim(),
          password: formData.password,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          phone: formData.phone.trim(),
          photo: formData.photo || "",
        });

        setAuthStatus("registered");
      }
    } catch (err: any) {
      if (err.code === "blocked") {
        setAuthStatus("blocked");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // --- STATUS SCREENS (pending / blocked / registered) ---
  if (authStatus !== "idle") {
    const isPending = authStatus === "pending" || authStatus === "registered";
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-slate-50 p-6"
        style={{ direction: dir }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-md p-10 text-center"
        >
          <div
            className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-5 ${
              isPending
                ? "bg-amber-50 border-2 border-amber-200"
                : "bg-red-50 border-2 border-red-200"
            }`}
          >
            <ShieldAlert
              className={`w-10 h-10 ${isPending ? "text-amber-500" : "text-red-500"}`}
            />
          </div>

          <h2 className="text-2xl font-extrabold text-slate-900 mb-3">
            {authStatus === "registered"
              ? lang === "ar"
                ? "تم التسجيل بنجاح!"
                : "Registration Successful!"
              : authStatus === "pending"
                ? lang === "ar"
                  ? "حسابك قيد المراجعة"
                  : "Account Pending Review"
                : lang === "ar"
                  ? "حسابك محظور"
                  : "Account Blocked"}
          </h2>

          <p className="text-slate-500 text-sm leading-relaxed mb-8">
            {authStatus === "registered"
              ? lang === "ar"
                ? "تم إنشاء حسابك بنجاح. يُرجى انتظار موافقة المسؤول لتفعيل الحساب."
                : "Your account has been created. Please wait for admin approval to activate it."
              : authStatus === "pending"
                ? lang === "ar"
                  ? t.pendingApprovalMsg
                  : t.pendingApprovalMsg
                : lang === "ar"
                  ? t.blockedMsg
                  : t.blockedMsg}
          </p>

          <button
            onClick={() => {
              setAuthStatus("idle");
              setIsLogin(true);
              setFormData({
                email: "",
                password: "",
                confirmPassword: "",
                firstName: "",
                lastName: "",
                phone: "",
                photo: "",
              });
              setPhotoPreview("");
            }}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors text-sm cursor-pointer"
          >
            {lang === "ar" ? "العودة لصفحة الدخول" : "Back to Login"}
          </button>
        </motion.div>
      </div>
    );
  }

  // --- MAIN LOGIN / SIGNUP FORM ---
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-50 p-4 relative overflow-hidden"
      style={{ direction: dir }}
    >
      {/* Background glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-500/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[300px] bg-blue-500/8 rounded-full blur-[100px] pointer-events-none" />

      {/* Language toggle */}
      <button
        onClick={() => setLang(lang === "ar" ? "en" : "ar")}
        className="absolute top-5 right-5 flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 rounded-full text-xs font-semibold text-slate-700 shadow-sm hover:shadow-md transition-all cursor-pointer"
      >
        <Globe className="w-3.5 h-3.5 text-indigo-600" />
        <span>{lang === "ar" ? "English" : "العربية"}</span>
      </button>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Card */}
        <div className="bg-white border border-slate-200 rounded-3xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-br from-indigo-700 to-indigo-500 px-8 pt-8 pb-10 text-white text-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_30%_40%,white_1px,transparent_1px)] bg-[length:24px_24px]" />
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg mb-4 overflow-hidden">
                <img
                  src={logoImg}
                  alt="GCM Logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight">
                {t.appName}
              </h1>
              <p className="text-indigo-200 text-xs mt-1">{t.splashSubtitle}</p>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-slate-100 bg-slate-50">
            <button
              onClick={() => {
                setIsLogin(true);
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-xs font-bold transition-all cursor-pointer ${
                isLogin
                  ? "bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              {t.login}
            </button>
            <button
              onClick={() => {
                setIsLogin(false);
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-xs font-bold transition-all cursor-pointer ${
                !isLogin
                  ? "bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t.signup}
            </button>
          </div>

          {/* Form */}
          <div className="p-8">
            <AnimatePresence mode="wait">
              <motion.form
                key={isLogin ? "login" : "signup"}
                initial={{ opacity: 0, x: isLogin ? -16 : 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: isLogin ? 16 : -16 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleSubmit}
                className="space-y-4"
              >
                {/* Signup-only fields */}
                {!isLogin && (
                  <div className="space-y-3">
                    {/* Photo Upload */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                        {t.uploadPhoto}
                      </label>
                      <div className="flex items-center gap-3">
                        {photoPreview ? (
                          <img
                            src={photoPreview}
                            alt="Preview"
                            className="w-12 h-12 rounded-xl object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="w-12 h-12 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex items-center justify-center text-slate-400">
                            <UserIcon className="w-6 h-6" />
                          </div>
                        )}
                        <label className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold text-slate-700 rounded-xl cursor-pointer">
                          <span>
                            {lang === "ar" ? "اختر صورة" : "Choose Photo"}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  const base64 = reader.result as string;
                                  setFormData((prev) => ({
                                    ...prev,
                                    photo: base64,
                                  }));
                                  setPhotoPreview(base64);
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                          {t.firstName}
                        </label>
                        <input
                          type="text"
                          name="firstName"
                          required
                          value={formData.firstName}
                          onChange={handleChange}
                          placeholder=""
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all font-sans"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                          {t.lastName}
                        </label>
                        <input
                          type="text"
                          name="lastName"
                          required
                          value={formData.lastName}
                          onChange={handleChange}
                          placeholder=""
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all font-sans"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Email */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                    {t.email}
                  </label>
                  <input
                    type="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="example@email.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all font-sans"
                    dir="ltr"
                  />
                </div>

                {/* Phone (signup only) */}
                {!isLogin && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                      {t.phoneNumber}
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      required
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="01234567890"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all font-sans"
                      dir="ltr"
                    />
                  </div>
                )}

                {/* Password */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                    {t.password}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      required
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all font-sans"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Confirm Password (signup only) */}
                {!isLogin && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                      {t.confirmPassword}
                    </label>
                    <input
                      type="password"
                      name="confirmPassword"
                      required
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all font-sans"
                      dir="ltr"
                    />
                  </div>
                )}

                {/* Error */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-xl px-4 py-3"
                  >
                    {error}
                  </motion.div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-200 mt-2"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isLogin ? (
                    <>
                      <LogIn className="w-4 h-4" /> {t.login}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" /> {t.signup}
                    </>
                  )}
                </button>

                {/* Switch mode link */}
                <p className="text-center text-xs text-slate-500 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setError(null);
                    }}
                    className="text-indigo-600 font-bold hover:underline cursor-pointer"
                  >
                    {isLogin ? t.dontHaveAccount : t.alreadyHaveAccount}
                  </button>
                </p>
              </motion.form>
            </AnimatePresence>
          </div>
        </div>

        <p className="text-center text-slate-400 text-xs mt-6">
          {t.footerCopyright}
        </p>
        <p className="text-center text-slate-400 text-[10px] mt-1">
          {t.footerDeveloperLabel}{' — '}
          <a href="https://afraim-porfiolio.afraimfarag7.workers.dev/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-semibold">
            {t.footerDeveloperLink}
          </a>
        </p>
      </motion.div>
    </div>
  );
}
