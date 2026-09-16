import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen,
  FileText,
  Camera,
  Video,
  Plus,
  Edit2,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  X,
  FolderOpen,
  AlertCircle,
} from "lucide-react";

import { Language, translations } from "../translations";
import { User, LibraryItem, LibraryType } from "../types";
import { supabase } from "../lib/supabase";
import { useLoading } from "../lib/LoadingContext";

interface LibraryViewProps {
  lang: Language;
  user: User;
}

function isAllowedYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'youtu.be') return /^[a-zA-Z0-9_-]{11}$/.test(url.pathname.slice(1));
    if (hostname !== 'youtube.com' && hostname !== 'm.youtube.com') return false;
    if (url.pathname === '/watch') return /^[a-zA-Z0-9_-]{11}$/.test(url.searchParams.get('v') || '');
    return /^\/embed\/[a-zA-Z0-9_-]{11}$/.test(url.pathname);
  } catch {
    return false;
  }
}

export default function LibraryView({ lang, user }: LibraryViewProps) {
  const { withLoading } = useLoading();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | LibraryType>("all");

  // Add Item state
  const [isAdding, setIsAdding] = useState(false);
  const [addType, setAddType] = useState<LibraryType>("text");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mediaFile, setMediaFile] = useState("");
  const [mediaFilePreview, setMediaFilePreview] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  // Edit Item state
  const [editingItem, setEditingItem] = useState<LibraryItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // View Item Modal State
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});

  // Custom Video Player States
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const t = translations[lang];

  // Admin access checks
  const canEditLibrary =
    user.role === "super_admin" || user.permissions.includes("edit_library");

  const fetchLibrary = async () => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        setItems([]);
        return;
      }
      const res = await fetch("/api/library", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: LibraryItem[] = await res.json();
        setItems(data);

        const privateMedia = data.filter(
          (item) =>
            (item.type === 'photo') &&
            Boolean(item.url) &&
            item.url!.startsWith('/api/videos/stream/'),
        );

        const loadedMedia = await Promise.all(
          privateMedia.map(async (item) => {
            try {
              const mediaResponse = await fetch(item.url!, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!mediaResponse.ok) return null;
              const blob = await mediaResponse.blob();
              return [item.id, URL.createObjectURL(blob)] as const;
            } catch {
              return null;
            }
          }),
        );

        setMediaUrls((current) => {
          const next = { ...current };
          loadedMedia.forEach((entry) => {
            if (entry) next[entry[0]] = entry[1];
          });
          return next;
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLibrary();

    return () => {
      // Object URLs are released when the component is unmounted.
      Object.values(mediaUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const loadSelectedPrivateVideo = async () => {
      if (
        !selectedItem ||
        selectedItem.type !== 'video' ||
        !selectedItem.url?.startsWith('/api/videos/stream/') ||
        mediaUrls[selectedItem.id]
      ) {
        return;
      }

      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) return;

      try {
        const response = await fetch(selectedItem.url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        setMediaUrls((current) => ({ ...current, [selectedItem.id]: objectUrl }));
      } catch (error) {
        console.error('Failed to load private video:', error);
      }
    };

    loadSelectedPrivateVideo();
  }, [selectedItem, mediaUrls]);

  // Sync video status
  useEffect(() => {
    if (selectedItem?.type === "video" && videoRef.current) {
      const video = videoRef.current;
      const onTimeUpdate = () => setCurrentTime(video.currentTime);
      const onDurationChange = () => setDuration(video.duration);
      const onPause = () => setIsPlaying(false);
      const onPlay = () => setIsPlaying(true);

      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("durationchange", onDurationChange);
      video.addEventListener("pause", onPause);
      video.addEventListener("play", onPlay);

      return () => {
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("durationchange", onDurationChange);
        video.removeEventListener("pause", onPause);
        video.removeEventListener("play", onPlay);
      };
    }
  }, [selectedItem]);

  // Close the details modal, explicitly stopping and resetting any playing video
  // so it never keeps playing (audio/video) in the background after closing.
  const closeItemModal = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSelectedItem(null);
  };

  // Allow closing the modal with the Escape key too
  useEffect(() => {
    if (!selectedItem) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeItemModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem]);


  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (addType === 'video') {
      alert(lang === 'ar' ? 'الفيديوهات يجب أن تكون روابط YouTube فقط.' : 'Videos must use YouTube URLs only.');
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    if (addType === "text") return;

    setMediaId("");
    setUploading(true);
    setUploadProgress(0);
    setUploadMessage(
      lang === "ar" ? "جارٍ رفع الملف..." : "Uploading file...",
    );

    try {
      const PART_SIZE = 40 * 1024 * 1024; // 40 MB per part (under 50 MB Supabase limit)
      const ext = file.name.split(".").pop() || (addType === "photo" ? "jpg" : "mp4");
      const totalParts = Math.ceil(file.size / PART_SIZE);

      if (addType === "photo" || totalParts <= 1) {
        // === Single-part upload (photo or small video) ===
        const storagePath = `${addType}s/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("media")
          .upload(storagePath, file, {
            contentType: file.type || (addType === "photo" ? "image/jpeg" : "video/mp4"),
            upsert: true,
          });
        if (uploadError) throw uploadError;

        setUploadProgress(100);

        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch("/api/videos/register", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title,
            description,
            fileName: file.name,
            mimeType: file.type || (addType === "photo" ? "image/jpeg" : "video/mp4"),
            sizeBytes: file.size,
            storagePath,
            type: addType,
          }),
        });

        const payload: any = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Registration failed");

        setMediaFile(payload.video?.file_url || payload.publicUrl);
        setMediaFilePreview(payload.video?.file_url || payload.publicUrl);
        setMediaId(payload.video?.id || "");
        setUploadMessage(
          lang === "ar" ? "تم الرفع بنجاح." : "Upload completed.",
        );
      } else {
        // === Multi-part upload (large video split into <50 MB parts) ===
        const baseId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const pathPrefix = `videos/${baseId}`;
        const partPaths: string[] = [];

        for (let i = 0; i < totalParts; i++) {
          const start = i * PART_SIZE;
          const end = Math.min(start + PART_SIZE, file.size);
          const partBlob = file.slice(start, end);
          const partPath = `${pathPrefix}/part-${i}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from("media")
            .upload(partPath, partBlob, {
              contentType: "application/octet-stream",
              upsert: true,
            });
          if (uploadError) throw uploadError;

          partPaths.push(partPath);
          const percent = Math.round(((i + 1) / totalParts) * 90);
          setUploadProgress(percent);
          setUploadMessage(
            lang === "ar"
              ? `رفع الجزء ${i + 1}/${totalParts}...`
              : `Uploading part ${i + 1}/${totalParts}...`,
          );
        }

        setUploadMessage(
          lang === "ar" ? "جارٍ تسجيل الملف..." : "Registering file...",
        );

        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch("/api/videos/register", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title,
            description,
            fileName: file.name,
            mimeType: file.type || "video/mp4",
            sizeBytes: file.size,
            parts: partPaths,
            type: addType,
          }),
        });

        const payload: any = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Registration failed");

        setMediaFile(payload.video?.file_url || payload.publicUrl);
        setMediaFilePreview(payload.video?.file_url || payload.publicUrl);
        setMediaId(payload.video?.id || "");
        setUploadProgress(100);
        setUploadMessage(
          lang === "ar" ? "تم الرفع بنجاح." : "Upload completed.",
        );
      }
    } catch (err: any) {
      console.error(err);
      setMediaFile("");
      setMediaFilePreview("");
      setMediaId("");
      const message = err?.message
        ? lang === "ar"
          ? `فشل الرفع: ${err.message}`
          : `Upload failed: ${err.message}`
        : lang === "ar"
          ? "فشل الرفع."
          : "Upload failed.";
      setUploadMessage(message);
      alert(message);
    } finally {
      setUploading(false);
    }
  };

  const handleAddItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) return;

    if (addType !== "text") {
      if (uploading) {
        alert(
          lang === "ar"
            ? "يرجى الانتظار حتى يكتمل رفع الملف."
            : "Please wait for the upload to finish.",
        );
        return;
      }
      if (addType === 'video' && !isAllowedYouTubeUrl(externalUrl)) {
        alert(lang === 'ar' ? 'أدخل رابط YouTube صحيحًا وآمنًا.' : 'Enter a valid HTTPS YouTube URL.');
        return;
      }
      if (addType === 'photo' && !mediaFile && !externalUrl.trim()) {
        alert(
          lang === "ar"
            ? "يرجى اختيار ملف أو إدخال رابط خارجي قبل الحفظ."
            : "Please choose a file or provide an external URL before saving.",
        );
        return;
      }
    }

    await withLoading(async () => {
      try {
        const res = await fetch("/api/library", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({
            type: addType,
            title,
            description,
            url: addType === "text" ? "" : addType === "video" ? externalUrl.trim() : mediaFile || externalUrl,
            mediaId: addType === "photo" && mediaFile ? mediaId : undefined,
          }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = "Failed to add library item";
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }

        await fetchLibrary();
        setIsAdding(false);
        resetForm();
        alert(
          lang === "ar"
            ? "تمت إضافة المادة بنجاح"
            : "Library item added successfully",
        );
      } catch (err: any) {
        console.error(err);
        alert(
          err.message ||
            (lang === "ar" ? "فشل إضافة المادة" : "Failed to add library item"),
        );
      }
    });
  };

  const handleDeleteItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !confirm(
        lang === "ar"
          ? "هل أنت متأكد من حذف هذه المادة؟"
          : "Are you sure you want to delete this library item?",
      )
    )
      return;
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/library/${id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        });

        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = "Failed to delete library item";
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }

        await fetchLibrary();
        alert(
          lang === "ar"
            ? "تم حذف المادة بنجاح"
            : "Library item deleted successfully",
        );
      } catch (err: any) {
        console.error(err);
        alert(
          err.message ||
            (lang === "ar"
              ? "فشل حذف المادة"
              : "Failed to delete library item"),
        );
      }
    });
  };

  const handleOpenEdit = (item: LibraryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingItem(item);
    setTitle(item.title);
    setDescription(item.description);
    setAddType(item.type);
    setMediaFile("");
    setMediaFilePreview(item.type === "photo" ? item.url || "" : "");
    setMediaId("");
    setExternalUrl(item.type !== "text" && item.url ? item.url : "");
    setUploadProgress(0);
    setUploadMessage("");
    setIsAdding(true);
    setIsEditing(true);
  };

  const handleUpdateItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || !editingItem) return;

    if (editingItem.type !== "text") {
      if (uploading) {
        alert(
          lang === "ar"
            ? "يرجى الانتظار حتى يكتمل رفع الملف."
            : "Please wait for the upload to finish.",
        );
        return;
      }
    }

    await withLoading(async () => {
      try {
        const body: Record<string, string> = { title, description };
        if (editingItem.type !== "text" && mediaFile) {
          body.url = mediaFile;
          if (mediaId) body.mediaId = mediaId;
        } else if (editingItem.type !== "text" && externalUrl && externalUrl !== editingItem.url) {
          body.url = externalUrl;
        }

        const res = await fetch(`/api/library/${editingItem.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errorText = await res.text();
          let errorMessage = "Failed to update library item";
          try {
            const error = JSON.parse(errorText);
            errorMessage = error.error || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }

        await fetchLibrary();
        setIsAdding(false);
        setIsEditing(false);
        setEditingItem(null);
        resetForm();
        alert(
          lang === "ar"
            ? "تم تحديث المادة بنجاح"
            : "Library item updated successfully",
        );
      } catch (err: any) {
        console.error(err);
        alert(
          err.message ||
            (lang === "ar" ? "فشل تحديث المادة" : "Failed to update library item"),
        );
      }
    });
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setMediaFile("");
    setMediaFilePreview("");
    setMediaId("");
    setExternalUrl("");
    setUploadProgress(0);
    setUploadMessage("");
  };

  // Video Controls helper
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch((err) => console.error(err));
      }
    }
  };

  const skipSeconds = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(
        0,
        Math.min(
          videoRef.current.duration,
          videoRef.current.currentTime + seconds,
        ),
      );
    }
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current && duration > 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const percentage = clickX / width;
      videoRef.current.currentTime = percentage * duration;
    }
  };

  const filteredItems = items.filter(
    (item) => activeTab === "all" || item.type === activeTab,
  );

  const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds)) return "0:00";
    const mins = Math.floor(timeInSeconds / 60);
    const secs = Math.floor(timeInSeconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
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
    <div
      className="py-6 space-y-8"
      style={{ direction: lang === "ar" ? "rtl" : "ltr" }}
    >
      {/* Header and Add Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {t.library}
          </h2>
        </div>

        {canEditLibrary && (
          <button
            id="add-library-item-btn"
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-md transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.addItem}</span>
          </button>
        )}
      </div>

      {/* Categories Filter Bar */}
      <div className="flex gap-2 bg-slate-100 border border-slate-200 p-1.5 rounded-2xl max-w-md">
        {(["all", "text", "photo", "video"] as const).map((tab) => {
          const isActive = activeTab === tab;
          let label = t.all;
          let Icon = FolderOpen;
          if (tab === "text") {
            Icon = FileText;
            label = t.text;
          }
          if (tab === "photo") {
            Icon = Camera;
            label = t.photo;
          }
          if (tab === "video") {
            Icon = Video;
            label = t.video;
          }

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-1 rounded-xl text-xs font-bold transition-all duration-250 cursor-pointer ${
                isActive
                  ? "bg-white text-indigo-600 shadow-sm border border-slate-200/60"
                  : "text-slate-500 hover:text-slate-950 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Library Grid */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 text-slate-500 text-sm">
          {lang === "ar"
            ? "المكتبة فارغة حالياً."
            : "The library is currently empty."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item) => {
            return (
              <div
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="bg-white border border-slate-200 rounded-3xl overflow-hidden hover:border-indigo-500/30 shadow-sm cursor-pointer flex flex-col group transition-all duration-300"
              >
                {/* Visual Header depending on item type */}
                {item.type === "photo" && item.url ? (
                  <div className="h-44 relative bg-slate-100 overflow-hidden">
                    <img
                      src={mediaUrls[item.id] || item.url}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-3 right-3 bg-indigo-600 text-white p-1.5 rounded-lg shadow-md">
                      <Camera className="w-4 h-4" />
                    </div>
                  </div>
                ) : item.type === "video" && item.url ? (
                  <div className="h-44 relative bg-slate-900 flex items-center justify-center overflow-hidden">
                    {(() => {
                      const u = item.url!;
                      const ytMatch = u.match(/(?:v=|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
                      if (ytMatch) {
                        return (
                          <img
                            src={`https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`}
                            alt={item.title}
                            className="w-full h-full object-cover opacity-70 group-hover:scale-105 transition-transform duration-500"
                          />
                        );
                      }
                      return (
                        <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
                          <Video className="w-10 h-10 text-white/30" />
                        </div>
                      );
                    })()}
                    <div className="absolute inset-0 bg-slate-900/20" />
                    <div className="absolute w-12 h-12 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </div>
                    <div className="absolute top-3 right-3 bg-indigo-600 text-white p-1.5 rounded-lg shadow-md">
                      <Video className="w-4 h-4" />
                    </div>
                  </div>
                ) : (
                  // Text items fallback logo header
                  <div className="h-32 bg-slate-50 border-b border-slate-100 flex items-center justify-center p-6 relative">
                    <FileText className="w-8 h-8 text-indigo-600/20" />
                    <div className="absolute top-3 right-3 bg-indigo-600 text-white p-1.5 rounded-lg shadow-md">
                      <FileText className="w-4 h-4" />
                    </div>
                  </div>
                )}

                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-base font-bold text-slate-900 mb-2 line-clamp-1 group-hover:text-indigo-600 transition-colors">
                      {item.title}
                    </h4>
                    {/* Description preview text */}
                    {item.type === "text" ? (
                      <p className="text-slate-500 text-xs line-clamp-2 leading-relaxed mb-4">
                        {lang === "ar"
                          ? "اضغط لفتح وقراءة النص التفصيلي..."
                          : "Click to open and read full text details..."}
                      </p>
                    ) : (
                      <p className="text-slate-500 text-xs line-clamp-1 leading-relaxed mb-4">
                        {lang === "ar" ? "محتوى مرئي" : "Visual content"}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-auto">
                    <span className="text-indigo-600 font-bold text-xs group-hover:text-indigo-700 hover:underline flex items-center gap-1">
                      <span>{t.open}</span>
                    </span>
                    {canEditLibrary && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => handleOpenEdit(item, e)}
                          className="p-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer"
                          title={lang === "ar" ? "تعديل المادة" : "Edit Item"}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteItem(item.id, e)}
                          className="p-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-red-600 hover:text-red-700 transition-colors cursor-pointer"
                          title={lang === "ar" ? "حذف المادة" : "Delete Item"}
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
        {/* Modal: Admin Add Library Item */}
        {isAdding && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-xl p-6 md:p-8 relative shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => { setIsAdding(false); setIsEditing(false); setEditingItem(null); resetForm(); }}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 mb-6 pr-6">
                {isEditing ? (lang === "ar" ? "تعديل المادة" : "Edit Item") : t.addItem}
              </h3>

              <form onSubmit={isEditing ? handleUpdateItemSubmit : handleAddItemSubmit} className="space-y-4">
                {!isEditing && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      {t.dataType}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["text", "photo", "video"] as const).map((type) => {
                        const isSel = addType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => {
                              setAddType(type);
                              setMediaFile("");
                              setMediaFilePreview("");
                              setMediaId("");
                              setExternalUrl("");
                            }}
                            className={`py-2 px-3 border rounded-xl text-xs font-bold transition-all cursor-pointer ${
                              isSel
                                ? "bg-indigo-600 text-white border-indigo-600 shadow-md"
                                : "bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-900"
                            }`}
                          >
                            {type === "text"
                              ? t.text
                              : type === "photo"
                                ? t.photo
                                : t.video}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Item Title */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    {t.itemTitle}
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                  />
                </div>

                {/* Item Description */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    {t.itemDesc}
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors text-sm font-sans"
                  />
                </div>

                {/* Photo or Video Specific Upload Controls */}
                {addType !== "text" && (
                  <div className="space-y-3 bg-slate-50 p-4 border border-slate-200 rounded-2xl">
                    <h4 className="text-xs font-bold text-indigo-950 mb-1">
                      {addType === "photo"
                        ? lang === "ar"
                          ? "بيانات الصورة"
                          : "Photo Data"
                        : lang === "ar"
                          ? "بيانات الفيديو"
                          : "Video Data"}
                    </h4>
                    {isEditing && (
                      <p className="text-[10px] text-slate-400 font-medium">
                        {lang === "ar" ? "اتركه فارغاً للاحتفاظ بالوسائط الحالية" : "Leave empty to keep current media"}
                      </p>
                    )}

                    {addType === "photo" ? (
                      <>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">{lang === "ar" ? "تحميل صورة من جهازك" : "Upload photo from device"}</label>
                        <div className="flex items-center gap-3">
                          {mediaFilePreview && <img src={mediaFilePreview} className="w-10 h-10 object-cover rounded-lg border border-slate-200 bg-white" />}
                          <label className="px-3 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700 rounded-xl transition-colors cursor-pointer">
                            <span>{lang === "ar" ? "اختر صورة" : "Choose Photo"}</span>
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileUpload} />
                          </label>
                          {mediaFile && <span className="text-[10px] text-green-600 truncate max-w-[150px] font-bold">✓ {lang === "ar" ? "تم اختيار الصورة" : "Photo selected"}</span>}
                          {uploading && <span className="text-[10px] text-indigo-600 font-bold">{uploadProgress}%</span>}
                        </div>
                        {uploading && <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
                        {uploadMessage && <p className="text-[10px] text-slate-500">{uploadMessage}</p>}
                      </>
                    ) : (
                      <>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">{lang === "ar" ? "رابط فيديو YouTube" : "YouTube video URL"}</label>
                        <input type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." required className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-600 text-xs font-sans" />
                        <p className="text-[10px] text-slate-400 mt-1">{lang === "ar" ? "يجب أن يكون الرابط HTTPS من YouTube فقط، ويمكن أن يكون Public أو Unlisted." : "Use an HTTPS YouTube URL only. Public and Unlisted videos are supported."}</p>
                      </>
                    )}
                  </div>
                )}

                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="submit"
                    disabled={uploading}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    {uploading ? `${uploadProgress}%` : isEditing ? (lang === "ar" ? "تحديث" : "Update") : t.save}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsAdding(false); setIsEditing(false); setEditingItem(null); resetForm(); }}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Modal: Open Library Item Details (Bigger Window) */}
        {selectedItem && (
          <div
            onClick={closeItemModal}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl p-6 md:p-8 relative shadow-2xl max-h-[85vh] flex flex-col"
            >
              <button
                onClick={closeItemModal}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors z-10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="overflow-y-auto flex-1 space-y-5 pr-1">
                {/* Media Presentation */}
                {selectedItem.type === "photo" && selectedItem.url && (
                  <div className="w-full max-h-[70vh] aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                    <img
                      src={mediaUrls[selectedItem.id] || selectedItem.url}
                      alt={selectedItem.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}

                {selectedItem.type === "video" && selectedItem.url && (
                  (() => {
                    const url = mediaUrls[selectedItem.id] || selectedItem.url;
                    const isYoutube = /(?:youtube\.com|youtu\.be)/.test(url);
                    const isFacebook = /(?:facebook\.com|fb\.watch)/.test(url);

                    if (isYoutube) {
                      const match = url.match(/(?:v=|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
                      const embedId = match?.[1];
                      return (
                        <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black border border-slate-800">
                          <iframe
                            src={embedId ? `https://www.youtube.com/embed/${embedId}` : url}
                            className="w-full h-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      );
                    }

                    if (isFacebook) {
                      return (
                        <div className="w-full aspect-video rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center p-6">
                          <div className="text-center">
                            <Video className="w-10 h-10 text-indigo-600 mx-auto mb-3" />
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:text-indigo-700 font-bold text-sm underline"
                            >
                              {lang === "ar" ? "افتح الفيديو على فيسبوك" : "Open video on Facebook"}
                            </a>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="w-full bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 relative group/player flex flex-col">
                        <video
                          ref={videoRef}
                          src={url}
                          crossOrigin="anonymous"
                          className="w-full aspect-video bg-black focus:outline-none"
                          onError={(e) => console.error("Video error:", (e.target as HTMLVideoElement)?.error)}
                        />

                        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-col gap-2">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-slate-500 font-mono">
                              {formatTime(currentTime)}
                            </span>
                            <div
                              onClick={handleProgressBarClick}
                              className="flex-1 bg-slate-200 h-2 rounded-full cursor-pointer overflow-hidden relative"
                            >
                              <div
                                className="bg-indigo-600 h-full rounded-full"
                                style={{
                                  width: `${(currentTime / (duration || 1)) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {formatTime(duration)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={togglePlay}
                                className="w-8 h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center transition-colors cursor-pointer"
                                title={isPlaying ? t.pause : t.play}
                              >
                                {isPlaying ? (
                                  <Pause className="w-4 h-4 fill-current" />
                                ) : (
                                  <Play className="w-4 h-4 fill-current ml-0.5" />
                                )}
                              </button>

                              <button
                                onClick={() => skipSeconds(-10)}
                                className="p-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors cursor-pointer"
                                title={t.rewind10}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>

                              <button
                                onClick={() => skipSeconds(10)}
                                className="p-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors cursor-pointer"
                                title={t.skip10}
                              >
                                <RotateCw className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="text-[10px] text-indigo-700 font-bold bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-150">
                              {t.videoPlayer}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                )}

                {/* Distinctive Typography for Text Title vs Description */}
                <div className="space-y-3 font-sans">
                  <h3 className="text-xl md:text-2xl font-bold text-slate-900 border-b border-slate-100 pb-2">
                    {selectedItem.title}
                  </h3>

                  {/* Scrollable description in larger window */}
                  <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl max-h-56 overflow-y-auto">
                    <p className="text-slate-700 text-sm md:text-base leading-relaxed whitespace-pre-line text-justify font-sans">
                      {selectedItem.description}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-5 border-t border-slate-150 mt-5">
                <button
                  onClick={closeItemModal}
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
