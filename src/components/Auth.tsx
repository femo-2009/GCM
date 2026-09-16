import React, { useEffect, useState } from "react";
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
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchProfileFromApi, signUpWithApproval } from "../lib/authApi";
import { Language, translations } from "../translations";
import { User } from "../types";
import { uploadProfileMedia } from "../lib/profileMedia";
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
  const [otp, setOtp] = useState("");
  const [authStatus, setAuthStatus] = useState<
    "idle" | "pending" | "blocked" | "registered" | "verifyEmail" | "mfaSetup" | "mfaChallenge"
  >("idle");
  const [mfaFactorId, setMfaFactorId] = useState<string>("");
  const [mfaChallengeId, setMfaChallengeId] = useState<string>("");
  const [mfaQrCode, setMfaQrCode] = useState<string>("");
  const [mfaSecret, setMfaSecret] = useState<string>("");
  const [mfaCode, setMfaCode] = useState<string>("");
  const [mfaUser, setMfaUser] = useState<User | null>(null);

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
  const [signupPhotoFile, setSignupPhotoFile] = useState<File | null>(null);

  const t = translations[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";

  const continueWithMfa = async (authenticatedUser: User) => {
    const isAdmin = authenticatedUser.role === "admin" || authenticatedUser.role === "super_admin";
    if (!isAdmin) {
      onAuthSuccess(authenticatedUser);
      return;
    }

    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;

    const verifiedFactor = data.totp.find((factor) => factor.status === "verified");
    setMfaUser(authenticatedUser);

    if (verifiedFactor) {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: verifiedFactor.id,
      });
      if (challengeError) throw challengeError;
      setMfaFactorId(verifiedFactor.id);
      setMfaChallengeId(challenge.id);
      setMfaCode("");
      setAuthStatus("mfaChallenge");
      return;
    }

    const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "GCM Admin Authenticator",
    });
    if (enrollmentError) throw enrollmentError;

    setMfaFactorId(enrollment.id);
    setMfaQrCode(enrollment.totp.qr_code);
    setMfaSecret(enrollment.totp.secret);
    setMfaCode("");
    setAuthStatus("mfaSetup");
  };

  const handleVerifyMfa = async () => {
    if (!mfaFactorId || !mfaChallengeId || mfaCode.trim().length !== 6 || !mfaUser) {
      setError(t.mfaInvalidCode);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode.trim(),
      });
      if (error) throw error;
      setAuthStatus("idle");
      onAuthSuccess(mfaUser);
    } catch (err: any) {
      setError(err.message || t.mfaInvalidCode);
    } finally {
      setLoading(false);
    }
  };

  const handleStartMfaSetup = async () => {
    if (!mfaFactorId || !mfaUser || mfaCode.trim().length !== 6) {
      setError(t.mfaInvalidCode);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });
      if (challengeError) throw challengeError;
      setMfaChallengeId(challenge.id);

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaCode.trim(),
      });
      if (verifyError) throw verifyError;
      setAuthStatus("idle");
      onAuthSuccess(mfaUser);
    } catch (err: any) {
      setError(err.message || t.mfaSetupError);
    } finally {
      setLoading(false);
    }
  };

  // Restore the email-verification screen after the user closes and reopens the site.
  useEffect(() => {
    const pendingEmail = window.localStorage.getItem("gcm_pending_verification_email");
    if (pendingEmail) {
      setFormData((prev) => ({ ...prev, email: pendingEmail }));
      setAuthStatus("verifyEmail");
    }
  }, []);

  // Detect the session created after the user clicks the email confirmation link.
  useEffect(() => {
    const checkConfirmedSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email_confirmed_at) return;

      try {
        const authenticatedUser = await fetchProfileFromApi(session.access_token);
        await uploadPendingSignupAvatar();
        if (authenticatedUser.status === "approved") {
          await continueWithMfa(authenticatedUser);
        } else if (authenticatedUser.status === "blocked") {
          await supabase.auth.signOut();
          setAuthStatus("blocked");
        } else {
          await supabase.auth.signOut();
          setAuthStatus("pending");
        }
      } catch (error) {
        console.error("Failed to verify confirmed email session:", error);
      }
    };

    checkConfirmedSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" && session?.user?.email_confirmed_at) {
          window.setTimeout(checkConfirmedSession, 0);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [onAuthSuccess]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(null);
  };

  const uploadPendingSignupAvatar = async () => {
    if (!signupPhotoFile) return;
    await uploadProfileMedia(signupPhotoFile, 'avatar', t.profileMediaUploadFailed);
    setSignupPhotoFile(null);
  };

  const handleVerifyEmail = async () => {
    const email = formData.email.trim().toLowerCase();
    const token = otp.trim();
    if (!email || !token) {
      setError(t.enterVerificationCode);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });
      if (verifyError) throw verifyError;

      const accessToken = data.session?.access_token;
      if (!accessToken) {
        throw new Error(t.verificationExpired);
      }

      window.localStorage.removeItem("gcm_pending_verification_email");
      const authenticatedUser = await fetchProfileFromApi(accessToken);
      await uploadPendingSignupAvatar();
      if (authenticatedUser.status === "approved") {
        await continueWithMfa(authenticatedUser);
      } else if (authenticatedUser.status === "blocked") {
        await supabase.auth.signOut();
        setAuthStatus("blocked");
      } else {
        await supabase.auth.signOut();
        setAuthStatus("pending");
      }
    } catch (err: any) {
      setError(err.message || (t.invalidVerificationCode));
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmail = async () => {
    const email = formData.email.trim().toLowerCase();
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (resendError) throw resendError;
      setError(t.verificationCodeSent);
    } catch (err: any) {
      setError(err.message || (t.resendCodeError));
    } finally {
      setLoading(false);
    }
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
        if (authError) {
          if (authError.code === "email_not_confirmed" || /email not confirmed/i.test(authError.message || "")) {
            window.localStorage.setItem("gcm_pending_verification_email", formData.email.trim().toLowerCase());
            setAuthStatus("verifyEmail");
            return;
          }
          throw authError;
        }

        const accessToken = authData.session?.access_token;
        if (!accessToken) {
          throw new Error(
            t.loginError,
          );
        }

        const authenticatedUser = await fetchProfileFromApi(accessToken);

        // Deny by default: only an explicitly "approved" status may enter the site.
        // Anything else (pending, blocked, or an unexpected/corrupted value) is
        // treated as not-yet-approved so we fail closed, not open.
        if (authenticatedUser.status === "approved") {
          await continueWithMfa(authenticatedUser);
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
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formData.email.trim())) {
          throw new Error(t.invalidEmail);
        }
        if (formData.firstName.trim().length < 2 || formData.firstName.trim().length > 60 || formData.lastName.trim().length < 2 || formData.lastName.trim().length > 60) {
          throw new Error(t.invalidName);
        }
        if (formData.password !== formData.confirmPassword) {
          throw new Error(t.passwordsDoNotMatch);
        }
        const egyptianPhone = formData.phone.trim().replace(/[\s().-]/g, "");
        const normalizedPhone = egyptianPhone.startsWith("+20")
          ? `0${egyptianPhone.slice(3)}`
          : egyptianPhone.startsWith("20")
            ? `0${egyptianPhone.slice(2)}`
            : egyptianPhone;
        if (!/^01[0125][0-9]{8}$/.test(normalizedPhone)) {
          throw new Error(t.invalidEgyptianPhone);
        }
        if (formData.password.length < 12) {
          throw new Error(t.passwordLength);
        }

        await signUpWithApproval({
          email: formData.email.trim(),
          password: formData.password,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          phone: normalizedPhone,
        });

        window.localStorage.setItem("gcm_pending_verification_email", formData.email.trim().toLowerCase());
        setAuthStatus("verifyEmail");
      }
    } catch (err: any) {
      if (err.code === "blocked") {
        setAuthStatus("blocked");
      } else if (err.code === "invalid_phone") {
        setError(t.invalidEgyptianPhone);
      } else if (err.code === "invalid_email") {
        setError(t.invalidEmail);
      } else if (err.code === "email_exists") {
        setError(t.emailAlreadyUsed);
      } else if (err.code === "phone_exists") {
        setError(t.phoneAlreadyUsed);
      } else if (err.code === "invalid_name") {
        setError(t.invalidName);
      } else if (err.code === "weak_password") {
        setError(t.weakPassword);
      } else if (err.code === "signup_failed") {
        setError(t.signupFailed);
      } else if (err.code === "rate_limited") {
        setError(t.rateLimited);
      } else {
        setError(err.message || t.unexpectedError);
      }
    } finally {
      setLoading(false);
    }
  };

  if (authStatus === "mfaSetup" || authStatus === "mfaChallenge") {
    const isSetup = authStatus === "mfaSetup";
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6" style={{ direction: dir }}>
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-indigo-50 border-2 border-indigo-200 flex items-center justify-center mb-5">
            <ShieldCheck className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 mb-3">
            {isSetup ? t.mfaSetupTitle : t.mfaChallengeTitle}
          </h2>
          <p className="text-slate-500 text-sm leading-relaxed mb-6">
            {isSetup ? t.mfaSetupMessage : t.mfaChallengeMessage}
          </p>
          {isSetup && mfaQrCode && (
            <div className="mb-5">
              <img src={mfaQrCode} alt="TOTP QR code" className="w-52 h-52 mx-auto border border-slate-200 rounded-xl" />
              <p className="text-[11px] text-slate-500 mt-3 break-all">{t.mfaSecret}: {mfaSecret}</p>
            </div>
          )}
          <input
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={t.mfaCodePlaceholder}
            className="w-full text-center tracking-[0.45em] bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-lg font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
            dir="ltr"
          />
          {error && <p className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 mt-4">{error}</p>}
          <button
            type="button"
            onClick={isSetup ? handleStartMfaSetup : handleVerifyMfa}
            disabled={loading || mfaCode.length !== 6}
            className="w-full py-3 mt-5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
          >
            {loading ? t.verifying : isSetup ? t.mfaEnableButton : t.mfaVerifyButton}
          </button>
        </motion.div>
      </div>
    );
  }

  // --- STATUS SCREENS (email verification / pending / blocked) ---
  if (authStatus !== "idle") {
    const isPending = authStatus === "pending";
    const isVerifyEmail = authStatus === "verifyEmail";
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
              isVerifyEmail
                ? "bg-indigo-50 border-2 border-indigo-200"
                : isPending
                  ? "bg-amber-50 border-2 border-amber-200"
                  : "bg-red-50 border-2 border-red-200"
            }`}
          >
            <ShieldAlert
              className={`w-10 h-10 ${isVerifyEmail ? "text-indigo-500" : isPending ? "text-amber-500" : "text-red-500"}`}
            />
          </div>

          <h2 className="text-2xl font-extrabold text-slate-900 mb-3">
            {authStatus === "verifyEmail"
              ? t.verifyEmailTitle
              : authStatus === "pending"
                ? t.pendingTitle
                : t.blockedTitleAuth}
          </h2>

          <p className="text-slate-500 text-sm leading-relaxed mb-8">
            {authStatus === "verifyEmail"
              ? t.verifyEmailMessage
              : authStatus === "pending"
                ? lang === "ar"
                  ? t.pendingApprovalMsg
                  : t.pendingApprovalMsg
                : lang === "ar"
                  ? t.blockedMsg
                  : t.blockedMsg}
          </p>

          {isVerifyEmail && (
            <div className="space-y-3 mb-5">
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                placeholder={t.verifyCodePlaceholder}
                className="w-full text-center tracking-[0.45em] bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-lg font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                dir="ltr"
              />
              <button
                type="button"
                onClick={handleVerifyEmail}
                disabled={loading || otp.trim().length < 8}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm cursor-pointer"
              >
                {loading ? (t.verifying) : (t.verifyCode)}
              </button>
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={loading}
                className="w-full py-2 text-indigo-600 hover:text-indigo-800 disabled:opacity-50 font-semibold text-sm cursor-pointer"
              >
                {t.resendCode}
              </button>
            </div>
          )}

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
              setSignupPhotoFile(null);
              setOtp("");
            }}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors text-sm cursor-pointer"
          >
            {t.backToLogin}
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
        <span>{lang === "ar" ? t.englishLanguage : t.arabicLanguage}</span>
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
                            {t.choosePhoto}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
                                  setError(t.profileMediaInvalidType);
                                  e.target.value = '';
                                  return;
                                }
                                setSignupPhotoFile(file);
                                setPhotoPreview(URL.createObjectURL(file));
                                setError(null);
                                e.target.value = '';
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
